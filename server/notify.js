// Web push notifications. Gentle by design:
//   • a daily reminder at the chosen time (skipped if you have already read today, or on quiet days)
//   • an optional evening follow-up, only if you took a part today and have not read it yet
//   • one celebration when the family completes the whole Surah together
// Each kind is sent at most once per person per day (notification_log).
import * as webpush from 'web-push';
import { randomBytes } from 'node:crypto';
import { partsForDay, rangesForDay, familyDate } from './parts.js';
import { coverage } from './reading.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);
export const isQuietDays = (s) => typeof s === 'string' && /^([0-6](,[0-6])*)?$/.test(s);
const SEND_WINDOW_MIN = 4 * 60; // if the server was asleep, still send up to 4 hours late, never later

const TEXT = {
  en: {
    dailyTitle: 'Family Quran reading',
    dailyDefault: 'It is time for today’s family Quran reading.',
    progress: (taken, read) => `${taken} of 6 parts taken · ${read} of 48 pages read today.`,
    free: (n) => `Part ${n} is still free.`,
    followTitle: 'A gentle reminder',
    followBody: (n) => `Your part (Part ${n}) is waiting for you whenever you are ready.`,
    wholeTitle: 'Alhamdulillah 🤍',
    wholeBody: 'Together the family completed Surah Al-Baqarah today.',
    testTitle: 'Notifications are on',
    testBody: 'This is how your daily reading reminder will look.',
  },
  ar: {
    dailyTitle: 'قراءة العائلة',
    dailyDefault: 'حان وقت قراءة العائلة اليومية من القرآن.',
    progress: (taken, read) => `اختير ${taken} من ٦ أجزاء · قُرئت ${read} من ٤٨ صفحة اليوم.`,
    free: (n) => `الجزء ${n} ما زال متاحًا.`,
    followTitle: 'تذكير لطيف',
    followBody: (n) => `جزؤك (الجزء ${n}) بانتظارك متى ما كنت مستعدًا.`,
    wholeTitle: 'الحمد لله 🤍',
    wholeBody: 'أتمّت العائلة سورة البقرة معًا اليوم.',
    testTitle: 'التنبيهات مفعّلة',
    testBody: 'هكذا سيظهر تذكير القراءة اليومي.',
  },
};
const text = (locale) => TEXT[locale] || TEXT.en;
const toArabicDigits = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// ---------------- keys & sending ----------------

/** VAPID keys and the wake-up key are created once and kept in the database (no setup needed). */
export async function ensureNotifyKeys(db) {
  const get = async (k) => (await db.get('SELECT value FROM app_settings WHERE key = ?', k))?.value;
  let pub = process.env.VAPID_PUBLIC_KEY || (await get('vapid_public'));
  let priv = process.env.VAPID_PRIVATE_KEY || (await get('vapid_private'));
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'vapid_public', pub);
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'vapid_private', priv);
  }
  let cronKey = process.env.CRON_KEY || (await get('cron_key'));
  if (!cronKey) {
    cronKey = randomBytes(18).toString('base64url');
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'cron_key', cronKey);
  }
  return { publicKey: pub, privateKey: priv, cronKey };
}

/** Real sender using the Web Push protocol. Returns 'ok', 'gone' (subscription expired) or 'error'. */
export function webPushSender({ publicKey, privateKey, subject, agent }) {
  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 6 * 3600,
        urgency: 'normal',
        vapidDetails: { subject, publicKey, privateKey },
        timeout: 15000,
        ...(agent ? { agent } : {}),
      });
      return 'ok';
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) return 'gone';
      console.error('push failed', e.statusCode || '', e.body || e.message);
      return 'error';
    }
  };
}

/** Send a payload to all of a person's devices; forget devices that have unsubscribed. */
export async function sendToUser(db, send, userId, payload) {
  const subs = await db.all('SELECT id, endpoint, keys_json FROM push_subscriptions WHERE user_id = ?', userId);
  let delivered = 0;
  for (const s of subs) {
    const r = await send({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload);
    if (r === 'ok') delivered++;
    else if (r === 'gone') await db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
  }
  return delivered;
}

// ---------------- settings ----------------

export async function familyReminder(db, familyId, nowIso) {
  let r = await db.get('SELECT * FROM family_reminders WHERE family_id = ?', familyId);
  if (!r) {
    await db.run('INSERT OR IGNORE INTO family_reminders (family_id, updated_at) VALUES (?, ?)', familyId, nowIso);
    r = await db.get('SELECT * FROM family_reminders WHERE family_id = ?', familyId);
  }
  return r;
}

/** Reminder settings are chosen by the family administrator and apply to everyone. */
export function effective(fam) {
  return {
    enabled: Boolean(fam.enabled),
    time: fam.time_local,
    quietDays: fam.quiet_days.split(',').filter(Boolean).map(Number),
    followup: Boolean(fam.followup_enabled),
    followupTime: fam.followup_time,
    celebrate: Boolean(fam.celebrate),
    message: fam.message,
  };
}

// ---------------- scheduling ----------------

function localClock(tz, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t).value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')), weekday };
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const due = (clock, hhmm) => clock.minutes >= toMinutes(hhmm) && clock.minutes - toMinutes(hhmm) < SEND_WINDOW_MIN;

async function logOnce(db, userId, kind, date, nowIso) {
  const r = await db.run('INSERT OR IGNORE INTO notification_log (user_id, kind, local_date, sent_at) VALUES (?, ?, ?, ?)', userId, kind, date, nowIso);
  return r.changes > 0; // false = already sent today
}

/**
 * Check every member and send whatever reminders are due. Safe to run as often as you like
 * (every minute while awake, and from an outside wake-up service every 15 minutes).
 */
export async function runReminders(db, send, now) {
  const nowIso = now.toISOString();
  const sent = { daily: 0, followup: 0 };
  const members = await db.all(
    `SELECT u.id, u.timezone, u.locale, m.family_id FROM users u JOIN family_memberships m ON m.user_id = u.id
      WHERE m.status = 'active' AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`);
  const famCache = new Map();
  for (const u of members) {
    if (!famCache.has(u.family_id)) {
      const family = await db.get('SELECT id, timezone FROM families WHERE id = ?', u.family_id);
      const fDate = familyDate(family, now);
      famCache.set(u.family_id, { family, fDate, rem: await familyReminder(db, u.family_id, nowIso), parts: await partsForDay(db, u.family_id, fDate), ranges: await rangesForDay(db, u.family_id, fDate) });
    }
    const f = famCache.get(u.family_id);
    const s = effective(f.rem);
    if (!s.enabled) continue;
    const clock = localClock(u.timezone, now);
    if (s.quietDays.includes(clock.weekday)) continue;
    const readToday = await db.get('SELECT 1 AS x FROM daily_completions WHERE user_id = ? AND local_date = ?', u.id, clock.date);
    if (readToday) continue; // never remind someone who has already read today
    const T = text(u.locale);
    const ar = u.locale === 'ar';
    const myOpen = f.parts.find((p) => p.claim?.user.id === u.id && !p.claim.done);

    if (due(clock, s.time) && (await logOnce(db, u.id, 'daily', clock.date, nowIso))) {
      const taken = f.parts.filter((p) => p.claim).length;
      const read = coverage(f.ranges).pagesRead.length;
      const free = f.parts.find((p) => !p.claim);
      let body = `${s.message || T.dailyDefault} ${T.progress(taken, read)}`;
      if (free && !myOpen) body += ` ${T.free(free.number)}`;
      await sendToUser(db, send, u.id, { title: T.dailyTitle, body: ar ? toArabicDigits(body) : body, url: '/', tag: 'daily' });
      sent.daily++;
    } else if (s.followup && myOpen && due(clock, s.followupTime) && toMinutes(s.followupTime) > toMinutes(s.time)
      && (await logOnce(db, u.id, 'followup', clock.date, nowIso))) {
      const body = T.followBody(myOpen.number);
      await sendToUser(db, send, u.id, { title: T.followTitle, body: ar ? toArabicDigits(body) : body, url: `/read?part=${myOpen.number}`, tag: 'followup' });
      sent.followup++;
    }
  }
  return sent;
}

/** Called after a part is marked read: if the whole Surah is now complete, celebrate once. */
export async function celebrateIfComplete(db, send, familyId, fDate, now) {
  const ranges = await rangesForDay(db, familyId, fDate);
  if (!coverage(ranges).wholeSurah) return 0;
  const nowIso = now.toISOString();
  const fam = await familyReminder(db, familyId, nowIso);
  if (!effective(fam).celebrate) return 0;
  const members = await db.all(
    `SELECT u.id, u.locale FROM users u JOIN family_memberships m ON m.user_id = u.id
      WHERE m.family_id = ? AND m.status = 'active' AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`, familyId);
  let n = 0;
  for (const u of members) {
    if (!(await logOnce(db, u.id, 'whole', fDate, nowIso))) continue;
    const T = text(u.locale);
    await sendToUser(db, send, u.id, { title: T.wholeTitle, body: T.wholeBody, url: '/family', tag: 'whole' });
    n++;
  }
  return n;
}

export const testPayload = (locale) => ({ title: text(locale).testTitle, body: text(locale).testBody, url: '/', tag: 'test' });
