import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deleteUserData } from './db.js';
import {
  SESSION_COOKIE, SESSION_DAYS, MAX_FAILED_BEFORE_LOCK, sha256, newToken, hashPin, verifyPin,
  pinProblem, loginNameProblem, IpLimiter, parseCookies,
} from './auth.js';
import { isValidTimeZone, localDate, addDays } from './time.js';
import {
  TOTAL_VERSES, getPlan, getProgress, saveProgress, markComplete, undoComplete, personalStats, todayPortion, planStartVerse, coverage,
} from './reading.js';
import { QURAN, partByNumber } from './quran.js';
import { familyDate, partsForDay, rangesForDay, wholeSurahDates, syncPartCompletion, yesterday } from './parts.js';
import { timingSafeEqual } from 'node:crypto';
import {
  runReminders, celebrateIfComplete, sendToUser, testPayload, familyReminder, isTime, isQuietDays,
} from './notify.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVITE_DAYS = 7;
const AVATAR_COLORS = ['green', 'navy', 'gold', 'teal', 'rose', 'plum'];
const AVATARS = ['', '🌙', '⭐', '🌿', '🌸', '🕊️', '🌳', '☀️', '💧', '📖', '🌷', '🍃'];

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

const str = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? (Number.isInteger(Number(v)) ? Number(v) : NaN) : NaN);

/**
 * @param {object} o
 * @param {import('./db.js').Db} o.db
 * @param {() => Date} [o.now] injectable clock (tests)
 * @param {string|null} [o.setupCode] one-time code required to create the first family
 * @param {boolean} [o.secureCookies]
 */
export function createApp({ db, now = () => new Date(), setupCode = null, secureCookies = false, serveClient = false, notify = null }) {
  // notify = { publicKey, cronKey, send(subscription, payload) } — push notifications (optional in tests)
  const app = express();
  const ipLimiter = new IpLimiter();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'https://everyayah.com', 'https://verses.quran.com'],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: secureCookies,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '50kb' }));

  // CSRF defence: state-changing API calls must come from our own JS (custom header) — cookies are SameSite=Lax too.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-requested-with') !== 'baqara') {
      return res.status(403).json({ error: 'csrf' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Lightweight health check for the host (does not touch the database).
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // ---------- helpers ----------
  const iso = () => now().toISOString();

  /** Wrap an async route: its return value is sent as JSON; errors go to the error handler. */
  const route = (fn) => (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((r) => { if (r !== undefined && !res.headersSent) res.json(r); })
      .catch(next);
  };

  async function startSession(res, userId) {
    const token = newToken();
    const t = now();
    const expires = new Date(t.getTime() + SESSION_DAYS * 86400000);
    await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      sha256(token), userId, t.toISOString(), expires.toISOString(), t.toISOString());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/', maxAge: SESSION_DAYS * 86400000,
    });
  }

  async function loadSessionUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const row = await db.get(
      `SELECT u.*, s.token_hash, s.expires_at AS session_expires, s.last_seen_at, m.family_id, m.role, m.status, m.joined_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         JOIN family_memberships m ON m.user_id = u.id
        WHERE s.token_hash = ?`,
      sha256(token),
    );
    if (!row || row.session_expires < iso() || row.status !== 'active') return null;
    // Record activity at most once an hour (saves database writes).
    if (now().getTime() - new Date(row.last_seen_at).getTime() > 3600000) {
      await db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', iso(), row.token_hash);
    }
    return row;
  }

  const requireUser = (req, res, next) => {
    loadSessionUser(req).then((u) => {
      if (!u) return res.status(401).json({ error: 'not_signed_in' });
      req.user = u;
      next();
    }).catch(next);
  };
  const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_only' }));

  /** Ensure the target user belongs to the requesting admin's family. */
  async function memberOfMyFamily(req, userId) {
    const m = await db.get('SELECT m.*, u.display_name FROM family_memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.family_id = ?',
      userId, req.user.family_id);
    if (!m) fail(404, 'member_not_found');
    return m;
  }

  async function createInvite(d, familyId, userId, purpose) {
    const token = newToken();
    await d.run('UPDATE invitations SET used_at = ? WHERE user_id = ? AND used_at IS NULL', iso(), userId); // revoke older links
    await d.run('INSERT INTO invitations (family_id, user_id, token_hash, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      familyId, userId, sha256(token), purpose, iso(), new Date(now().getTime() + INVITE_DAYS * 86400000).toISOString());
    return { token, path: `/invite/${token}`, expiresInDays: INVITE_DAYS };
  }

  async function findInvite(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const inv = await db.get(
      `SELECT i.*, u.display_name, u.login_name, f.name AS family_name, m.role
         FROM invitations i JOIN users u ON u.id = i.user_id JOIN families f ON f.id = i.family_id
         JOIN family_memberships m ON m.user_id = i.user_id AND m.family_id = i.family_id
        WHERE i.token_hash = ?`,
      sha256(token),
    );
    if (!inv || inv.used_at || inv.expires_at < iso()) return null;
    return inv;
  }

  function publicUser(u) {
    return {
      id: u.id, displayName: u.display_name, loginName: u.login_name, avatar: u.avatar, avatarColor: u.avatar_color,
      locale: u.locale, timezone: u.timezone, theme: u.theme, fontScale: u.font_scale, role: u.role, readerLayout: u.reader_layout || 'list',
    };
  }

  // ---------- setup (first family) ----------
  const familyCount = async () => (await db.get('SELECT COUNT(*) AS n FROM families')).n;

  app.get('/api/setup/status', route(async () => ({ needsSetup: (await familyCount()) === 0 })));

  app.post('/api/setup', route(async (req, res) => {
    if ((await familyCount()) > 0) fail(409, 'already_set_up');
    if (!setupCode || req.body.setupCode !== setupCode) fail(403, 'bad_setup_code');
    const familyName = str(req.body.familyName);
    const displayName = str(req.body.displayName, 40);
    const loginName = str(req.body.loginName, 30).toLowerCase();
    const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : 'UTC';
    const locale = req.body.locale === 'ar' ? 'ar' : 'en';
    if (!familyName || !displayName) fail(400, 'name_required');
    const lp = loginNameProblem(loginName); if (lp) fail(400, lp);
    const pp = pinProblem(req.body.pin, { minLength: 6 }); if (pp) fail(400, pp);
    const pinHash = hashPin(req.body.pin);
    const userId = await db.tx(async (t) => {
      if ((await t.get('SELECT COUNT(*) AS n FROM families')).n > 0) fail(409, 'already_set_up');
      const f = await t.run('INSERT INTO families (name, timezone, created_at) VALUES (?, ?, ?)', familyName, tz, iso());
      const u = await t.run('INSERT INTO users (display_name, login_name, pin_hash, locale, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        displayName, loginName, pinHash, locale, tz, iso());
      await t.run("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order, joined_at) VALUES (?, ?, 'admin', 'active', 0, ?)",
        f.lastInsertRowid, u.lastInsertRowid, iso());
      return u.lastInsertRowid;
    });
    await startSession(res, userId);
    return { ok: true };
  }));

  // ---------- invitations ----------
  app.get('/api/invite/:token', route(async (req) => {
    const inv = await findInvite(req.params.token);
    if (!inv) fail(404, 'invite_invalid');
    return { displayName: inv.display_name, familyName: inv.family_name, purpose: inv.purpose, loginName: inv.login_name, role: inv.role };
  }));

  app.post('/api/invite/:token/accept', route(async (req, res) => {
    const inv = await findInvite(req.params.token);
    if (!inv) fail(404, 'invite_invalid');
    const pp = pinProblem(req.body.pin, { minLength: inv.role === 'admin' ? 6 : 4 }); if (pp) fail(400, pp);
    let loginName = inv.login_name;
    if (inv.purpose === 'join') {
      loginName = str(req.body.loginName, 30).toLowerCase();
      const lp = loginNameProblem(loginName); if (lp) fail(400, lp);
      const taken = await db.get('SELECT id FROM users WHERE login_name = ? AND id != ?', loginName, inv.user_id);
      if (taken) fail(409, 'login_name_taken');
    }
    const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : null;
    const pinHash = hashPin(req.body.pin);
    await db.tx(async (t) => {
      const used = await t.run('UPDATE invitations SET used_at = ? WHERE id = ? AND used_at IS NULL', iso(), inv.id);
      if (!used.changes) fail(404, 'invite_invalid'); // two taps at once: only the first wins
      await t.run('UPDATE users SET login_name = ?, pin_hash = ?, failed_logins = 0, locked_until = NULL, timezone = COALESCE(?, timezone), locale = ? WHERE id = ?',
        loginName, pinHash, inv.purpose === 'join' ? tz : null, req.body.locale === 'ar' ? 'ar' : 'en', inv.user_id);
      await t.run("UPDATE family_memberships SET status = 'active', joined_at = COALESCE(joined_at, ?) WHERE user_id = ?", iso(), inv.user_id);
      if (inv.purpose === 'reset') await t.run('DELETE FROM sessions WHERE user_id = ?', inv.user_id); // sign out other devices
    });
    await startSession(res, inv.user_id);
    return { ok: true };
  }));

  // ---------- login / logout ----------
  app.post('/api/auth/login', route(async (req, res) => {
    const ip = req.ip;
    const t = now().getTime();
    if (ipLimiter.blocked(ip, t)) fail(429, 'too_many_attempts');
    const loginName = str(req.body.loginName, 30).toLowerCase();
    const u = await db.get("SELECT u.* FROM users u JOIN family_memberships m ON m.user_id = u.id WHERE u.login_name = ? AND m.status = 'active'", loginName);
    if (u?.locked_until && u.locked_until > iso()) {
      return res.status(429).json({ error: 'account_locked', retryAt: u.locked_until });
    }
    if (!u || !verifyPin(String(req.body.pin ?? ''), u.pin_hash)) {
      ipLimiter.fail(ip, t);
      if (u) {
        const failed = u.failed_logins + 1;
        // 5 wrong PINs -> 15 min pause, doubling each further time.
        const lockMinutes = failed >= MAX_FAILED_BEFORE_LOCK ? 15 * 2 ** (failed - MAX_FAILED_BEFORE_LOCK) : 0;
        const until = lockMinutes ? new Date(t + Math.min(lockMinutes, 24 * 60) * 60000).toISOString() : null;
        await db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', failed, until, u.id);
      }
      fail(401, 'bad_credentials');
    }
    await db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', u.id);
    ipLimiter.reset(ip);
    await startSession(res, u.id);
    return { ok: true };
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- reminders wake-up (called by an outside service every ~15 minutes, and by the server itself) ----------
  const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  app.get('/api/cron/tick', route(async (req) => {
    if (!notify || !sameKey(req.query.key, notify.cronKey)) fail(403, 'bad_key');
    const sent = await runReminders(db, notify.send, now());
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_wakeup', ?)", iso());
    return { ok: true, sent };
  }));

  // ---------- everything below requires a signed-in family member ----------
  app.use('/api', requireUser);

  app.get('/api/quran', (req, res) => {
    res.set('Cache-Control', 'private, max-age=86400');
    res.json(QURAN);
  });

  app.get('/api/me', route(async (req) => {
    const f = await db.get('SELECT id, name, timezone, max_members FROM families WHERE id = ?', req.user.family_id);
    return {
      user: publicUser(req.user),
      family: { id: f.id, name: f.name, timezone: f.timezone, maxMembers: f.max_members },
      stats: await personalStats(db, req.user, req.user.joined_at, now()),
    };
  }));

  app.patch('/api/me', route(async (req) => {
    const b = req.body;
    const u = req.user;
    const displayName = b.displayName !== undefined ? str(b.displayName, 40) : u.display_name;
    if (!displayName) fail(400, 'name_required');
    const avatar = b.avatar !== undefined ? (AVATARS.includes(b.avatar) ? b.avatar : fail(400, 'bad_avatar')) : u.avatar;
    const avatarColor = b.avatarColor !== undefined ? (AVATAR_COLORS.includes(b.avatarColor) ? b.avatarColor : fail(400, 'bad_color')) : u.avatar_color;
    const locale = b.locale !== undefined ? (['en', 'ar'].includes(b.locale) ? b.locale : fail(400, 'bad_locale')) : u.locale;
    const theme = b.theme !== undefined ? (['system', 'light', 'dark'].includes(b.theme) ? b.theme : fail(400, 'bad_theme')) : u.theme;
    const timezone = b.timezone !== undefined ? (isValidTimeZone(b.timezone) ? b.timezone : fail(400, 'bad_timezone')) : u.timezone;
    const readerLayout = b.readerLayout !== undefined ? (['list', 'page'].includes(b.readerLayout) ? b.readerLayout : fail(400, 'bad_layout')) : u.reader_layout || 'list';
    let fontScale = u.font_scale;
    if (b.fontScale !== undefined) {
      fontScale = Number(b.fontScale);
      if (!(fontScale >= 0.8 && fontScale <= 2.2)) fail(400, 'bad_font_scale');
    }
    await db.run('UPDATE users SET display_name = ?, avatar = ?, avatar_color = ?, locale = ?, theme = ?, timezone = ?, font_scale = ?, reader_layout = ? WHERE id = ?',
      displayName, avatar, avatarColor, locale, theme, timezone, fontScale, readerLayout, u.id);
    return { ok: true };
  }));

  app.post('/api/me/pin', route(async (req) => {
    if (!verifyPin(String(req.body.currentPin ?? ''), req.user.pin_hash)) fail(400, 'current_pin_wrong');
    const pp = pinProblem(req.body.newPin, { minLength: req.user.role === 'admin' ? 6 : 4 }); if (pp) fail(400, pp);
    await db.run('UPDATE users SET pin_hash = ? WHERE id = ?', hashPin(req.body.newPin), req.user.id);
    return { ok: true };
  }));

  async function personalExport(user) {
    const id = user.id;
    return {
      profile: publicUser(user),
      plan: await getPlan(db, id),
      progress: (await db.get('SELECT current_verse, furthest_verse, cycles_completed, total_verses_read, updated_at FROM reading_progress WHERE user_id = ?', id)) ?? null,
      completions: await db.all('SELECT local_date, from_verse, to_verse, completed_at FROM daily_completions WHERE user_id = ? ORDER BY local_date', id),
      bookmarks: await db.all('SELECT verse, created_at FROM bookmarks WHERE user_id = ? ORDER BY verse', id),
      reflections: await db.all('SELECT local_date, verse_from, verse_to, body, visibility, created_at, updated_at FROM reflections WHERE user_id = ?', id),
    };
  }

  app.get('/api/me/export', route(async (req, res) => {
    res.set('Content-Disposition', 'attachment; filename="my-baqarah-reading.json"');
    return { exportedAt: iso(), ...(await personalExport(req.user)) };
  }));

  app.delete('/api/me', route(async (req, res) => {
    if (!verifyPin(String(req.body?.pin ?? ''), req.user.pin_hash)) fail(400, 'current_pin_wrong');
    if (req.user.role === 'admin') {
      const admins = (await db.get("SELECT COUNT(*) AS n FROM family_memberships WHERE family_id = ? AND role = 'admin' AND status = 'active'", req.user.family_id)).n;
      if (admins <= 1) fail(409, 'last_admin');
    }
    await deleteUserData(db, req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- reading ----------
  app.get('/api/progress', route(async (req) => {
    const [p, plan, bm] = await Promise.all([
      getProgress(db, req.user.id, iso()),
      getPlan(db, req.user.id),
      db.all('SELECT verse FROM bookmarks WHERE user_id = ? ORDER BY verse', req.user.id),
    ]);
    return { position: p.current_verse, portion: todayPortion(plan, p), bookmarks: bm.map((r) => r.verse) };
  }));

  app.put('/api/progress', route(async (req) => {
    const verse = int(req.body.verse);
    const seen = req.body.seen === undefined ? verse : int(req.body.seen);
    if (!(verse >= 1 && verse <= TOTAL_VERSES) || !(seen >= 1 && seen <= TOTAL_VERSES)) fail(400, 'bad_verse');
    await saveProgress(db, req.user.id, verse, seen, iso());
    return { ok: true };
  }));

  app.put('/api/plan', route(async (req) => {
    const type = req.body.planType;
    if (!['free', 'whole', 'verses', 'days'].includes(type)) fail(400, 'bad_plan');
    const vpd = type === 'verses' ? int(req.body.versesPerDay) : null;
    const days = type === 'days' ? int(req.body.daysTotal) : null;
    if (type === 'verses' && !(vpd >= 1 && vpd <= TOTAL_VERSES)) fail(400, 'bad_plan');
    if (type === 'days' && !(days >= 1 && days <= 365)) fail(400, 'bad_plan');
    const plan = { plan_type: type, verses_per_day: vpd, days_total: days };
    await db.tx(async (t) => {
      await t.run(
        `INSERT INTO reading_plans (user_id, plan_type, verses_per_day, days_total, page_from, page_to, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET plan_type = excluded.plan_type, verses_per_day = excluded.verses_per_day,
           days_total = excluded.days_total, page_from = NULL, page_to = NULL, updated_at = excluded.updated_at`,
        req.user.id, type, vpd, days, iso());
      const p = await getProgress(t, req.user.id, iso());
      const start = planStartVerse(plan, p.current_verse);
      await t.run('UPDATE reading_progress SET cycle_start_verse = ?, current_verse = ?, furthest_verse = ?, updated_at = ? WHERE user_id = ?',
        start, start, start - 1, iso(), req.user.id);
    });
    return { ok: true };
  }));

  // ---------- daily family parts ----------
  const familyOf = (req) => db.get('SELECT id, timezone FROM families WHERE id = ?', req.user.family_id);

  async function todayParts(req) {
    const family = await familyOf(req);
    const date = familyDate(family, now());
    const [parts, ranges, yParts] = await Promise.all([
      partsForDay(db, family.id, date),
      rangesForDay(db, family.id, date),
      db.all('SELECT part FROM part_claims WHERE user_id = ? AND local_date = ?', req.user.id, yesterday(date)),
    ]);
    const cov = coverage(ranges);
    return {
      date,
      parts,
      mine: parts.filter((p) => p.claim?.user.id === req.user.id).map((p) => p.number),
      myYesterday: yParts.map((r) => r.part),
      totalPages: 48,
      pagesReadToday: cov.pagesRead,
      wholeSurahToday: cov.wholeSurah,
    };
  }

  app.get('/api/parts/today', route((req) => todayParts(req)));

  app.post('/api/parts/:n/claim', route(async (req) => {
    const part = partByNumber(int(req.params.n));
    if (!part) fail(400, 'bad_part');
    const family = await familyOf(req);
    const date = familyDate(family, now());
    await db.tx(async (t) => {
      const c = await t.get('SELECT user_id FROM part_claims WHERE family_id = ? AND local_date = ? AND part = ?', family.id, date, part.number);
      if (c && c.user_id !== req.user.id) fail(409, 'part_taken');
      if (!c) await t.run('INSERT INTO part_claims (family_id, local_date, part, user_id, claimed_at) VALUES (?, ?, ?, ?, ?)', family.id, date, part.number, req.user.id, iso());
    });
    return todayParts(req);
  }));

  app.delete('/api/parts/:n/claim', route(async (req) => {
    const part = partByNumber(int(req.params.n));
    if (!part) fail(400, 'bad_part');
    const family = await familyOf(req);
    const date = familyDate(family, now());
    const c = await db.get('SELECT * FROM part_claims WHERE family_id = ? AND local_date = ? AND part = ?', family.id, date, part.number);
    if (!c) return todayParts(req);
    // Members give back their own part; the administrator can free a part someone took but has not read.
    if (c.user_id !== req.user.id && req.user.role !== 'admin') fail(403, 'not_your_part');
    if (c.done_at) fail(409, 'part_done');
    await db.run('DELETE FROM part_claims WHERE id = ?', c.id);
    return todayParts(req);
  }));

  async function setPartDone(req, done) {
    const part = partByNumber(int(req.params.n));
    if (!part) fail(400, 'bad_part');
    const family = await familyOf(req);
    const date = familyDate(family, now());
    await db.tx(async (t) => {
      const c = await t.get('SELECT * FROM part_claims WHERE family_id = ? AND local_date = ? AND part = ? AND user_id = ?', family.id, date, part.number, req.user.id);
      if (!c) fail(409, 'part_not_yours');
      await t.run('UPDATE part_claims SET done_at = ? WHERE id = ?', done ? iso() : null, c.id);
      await syncPartCompletion(t, req.user, family.id, localDate(req.user.timezone, now()), date, iso());
    });
    if (done && notify) await celebrateIfComplete(db, notify.send, family.id, date, now()).catch((e) => console.error('celebrate', e));
    return todayParts(req);
  }
  app.post('/api/parts/:n/done', route((req) => setPartDone(req, true)));
  app.delete('/api/parts/:n/done', route((req) => setPartDone(req, false)));

  app.post('/api/completions/today', route(async (req) => {
    try {
      const r = await db.tx((t) => markComplete(t, req.user, req.user.family_id, now()));
      return { ok: true, ...r };
    } catch (e) {
      // A double tap can race to insert the same day twice; the unique key keeps one, so report it as done.
      if (/UNIQUE/i.test(String(e.message))) return { ok: true, already: true };
      throw e;
    }
  }));

  app.delete('/api/completions/today', route(async (req) => {
    const ok = await db.tx((t) => undoComplete(t, req.user, now()));
    if (!ok) fail(404, 'not_completed_today');
    return { ok: true };
  }));

  app.get('/api/history', route(async (req) => {
    const [rows, bookmarks, stats] = await Promise.all([
      db.all('SELECT local_date, from_verse, to_verse FROM daily_completions WHERE user_id = ? ORDER BY local_date DESC LIMIT 400', req.user.id),
      db.all('SELECT verse, created_at FROM bookmarks WHERE user_id = ? ORDER BY verse', req.user.id),
      personalStats(db, req.user, req.user.joined_at, now()),
    ]);
    return { completions: rows, bookmarks, stats };
  }));

  app.post('/api/bookmarks', route(async (req) => {
    const verse = int(req.body.verse);
    if (!(verse >= 1 && verse <= TOTAL_VERSES)) fail(400, 'bad_verse');
    await db.run('INSERT OR IGNORE INTO bookmarks (user_id, verse, created_at) VALUES (?, ?, ?)', req.user.id, verse, iso());
    return { ok: true };
  }));

  app.delete('/api/bookmarks/:verse', route(async (req) => {
    await db.run('DELETE FROM bookmarks WHERE user_id = ? AND verse = ?', req.user.id, int(req.params.verse));
    return { ok: true };
  }));

  // ---------- family dashboard ----------
  app.get('/api/family/dashboard', route(async (req) => {
    const fid = req.user.family_id;
    const family = await db.get('SELECT * FROM families WHERE id = ?', fid);
    const members = await db.all(
      `SELECT u.*, m.role, m.status, m.joined_at FROM family_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = ? ORDER BY m.sort_order, m.id`, fid);
    const t = now();
    const familyToday = localDate(family.timezone, t);
    const active = members.filter((m) => m.status === 'active');
    const list = await Promise.all(members.map(async (m) => {
      if (m.status !== 'active') return { id: m.id, displayName: m.display_name, avatar: m.avatar, avatarColor: m.avatar_color, status: 'invited' };
      const s = await personalStats(db, m, m.joined_at, t);
      return {
        id: m.id, displayName: m.display_name, avatar: m.avatar, avatarColor: m.avatar_color, status: 'active', role: m.role,
        doneToday: s.doneToday, portionPercent: s.portion.percent, position: s.position,
      };
    }));

    // Family history by calendar day: how many members marked that day (each in their own zone).
    const since = addDays(familyToday, -34);
    const [countRows, totals, completionDays, together, cycles] = await Promise.all([
      db.all('SELECT local_date, COUNT(*) AS n FROM daily_completions WHERE family_id = ? AND local_date >= ? GROUP BY local_date', fid, since),
      db.get('SELECT COALESCE(SUM(p.total_verses_read), 0) AS verses FROM family_memberships m LEFT JOIN reading_progress p ON p.user_id = m.user_id WHERE m.family_id = ?', fid),
      db.get('SELECT COUNT(*) AS n FROM daily_completions WHERE family_id = ?', fid),
      db.get('SELECT COUNT(*) AS n FROM (SELECT local_date FROM daily_completions WHERE family_id = ? GROUP BY local_date HAVING COUNT(*) >= ?)', fid, Math.max(1, active.length)),
      db.get('SELECT COALESCE(SUM(p.cycles_completed),0) AS n FROM family_memberships m JOIN reading_progress p ON p.user_id = m.user_id WHERE m.family_id = ?', fid),
    ]);
    const counts = new Map(countRows.map((r) => [r.local_date, r.n]));
    // Shared reading: today's parts, which of the 48 pages are read, and days the whole Surah was read together.
    const [parts, ranges, wholeDates] = await Promise.all([partsForDay(db, fid, familyToday), rangesForDay(db, fid, familyToday), wholeSurahDates(db, fid)]);
    const todayCov = coverage(ranges);
    const days = (n) => Array.from({ length: n }, (_, i) => addDays(familyToday, i - n + 1)).map((d) => ({ date: d, count: counts.get(d) ?? 0 }));

    return {
      family: { name: family.name, timezone: family.timezone, today: familyToday },
      members: list,
      today: { done: list.filter((m) => m.doneToday).length, active: active.length },
      week: days(7),
      month: days(30),
      shared: {
        parts,
        totalPages: 48,
        pagesReadToday: todayCov.pagesRead,
        wholeSurahToday: todayCov.wholeSurah,
        wholeSurahDays: wholeDates.length,
        wholeSurahThisWeek: days(7).map((d) => ({ date: d.date, whole: wholeDates.includes(d.date) })),
        wholeSurahStreak: (() => { let n = 0; let d = wholeDates.includes(familyToday) ? familyToday : addDays(familyToday, -1); while (wholeDates.includes(d)) { n++; d = addDays(d, -1); } return n; })(),
      },
      totals: { readingDays: completionDays.n, versesRead: totals.verses, daysAllTogether: together.n, surahCompletions: cycles.n },
    };
  }));

  // ---------- notifications ----------
  const publicReminder = (r) => ({
    enabled: Boolean(r.enabled), time: r.time_local, message: r.message, quietDays: r.quiet_days,
    followup: Boolean(r.followup_enabled), followupTime: r.followup_time, celebrate: Boolean(r.celebrate),
  });

  app.get('/api/push/key', route(() => {
    if (!notify) fail(503, 'push_unavailable');
    return { publicKey: notify.publicKey };
  }));

  app.post('/api/push/subscribe', route(async (req) => {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000
      || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') fail(400, 'bad_subscription');
    // One device belongs to one person: re-subscribing a shared phone moves it to whoever is signed in.
    await db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`,
      req.user.id, endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), iso());
    return { ok: true };
  }));

  app.post('/api/push/unsubscribe', route(async (req) => {
    await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, String(req.body?.endpoint || ''));
    return { ok: true };
  }));

  app.post('/api/push/test', route(async (req) => {
    if (!notify) fail(503, 'push_unavailable');
    const delivered = await sendToUser(db, notify.send, req.user.id, testPayload(req.user.locale));
    if (!delivered) fail(409, 'no_devices');
    return { ok: true, delivered };
  }));

  // ---------- administrator ----------
  app.put('/api/admin/reminders', requireAdmin, route(async (req) => {
    const b = req.body || {};
    const cur = await familyReminder(db, req.user.family_id, iso());
    const time = b.time !== undefined ? (isTime(b.time) ? b.time : fail(400, 'bad_time')) : cur.time_local;
    const followupTime = b.followupTime !== undefined ? (isTime(b.followupTime) ? b.followupTime : fail(400, 'bad_time')) : cur.followup_time;
    const quiet = b.quietDays !== undefined ? (isQuietDays(b.quietDays) ? b.quietDays : fail(400, 'bad_days')) : cur.quiet_days;
    const message = b.message !== undefined ? str(b.message, 140) : cur.message;
    const bool = (v, d) => (v === undefined ? d : v ? 1 : 0);
    await db.run(
      `UPDATE family_reminders SET enabled = ?, time_local = ?, message = ?, quiet_days = ?, followup_enabled = ?, followup_time = ?, celebrate = ?,
         updated_at = ? WHERE family_id = ?`,
      bool(b.enabled, cur.enabled), time, message, quiet, bool(b.followup, cur.followup_enabled), followupTime, bool(b.celebrate, cur.celebrate),
      iso(), req.user.family_id);
    return { ok: true };
  }));

  app.get('/api/admin/reminders', requireAdmin, route(async (req) => {
    const devices = (await db.get(
      'SELECT COUNT(DISTINCT s.user_id) AS n FROM push_subscriptions s JOIN family_memberships m ON m.user_id = s.user_id WHERE m.family_id = ?', req.user.family_id)).n;
    return { ...publicReminder(await familyReminder(db, req.user.family_id, iso())), membersWithNotifications: devices };
  }));

  app.get('/api/admin/wakeup', requireAdmin, route(async (req) => {
    if (!notify) fail(503, 'push_unavailable');
    const last = (await db.get("SELECT value FROM app_settings WHERE key = 'last_wakeup'"))?.value ?? null;
    return { url: `${req.protocol}://${req.get('host')}/api/cron/tick?key=${notify.cronKey}`, lastWakeup: last };
  }));

  app.get('/api/admin/members', requireAdmin, route(async (req) => {
    const [rows, f] = await Promise.all([
      db.all(
        `SELECT u.id, u.display_name, u.login_name, u.avatar, u.avatar_color, m.role, m.status, m.joined_at,
                (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
           FROM family_memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? ORDER BY m.sort_order, m.id`, req.user.family_id),
      db.get('SELECT max_members FROM families WHERE id = ?', req.user.family_id),
    ]);
    return { members: rows, maxMembers: f.max_members };
  }));

  app.post('/api/admin/members', requireAdmin, route(async (req) => {
    const displayName = str(req.body.displayName, 40);
    if (!displayName) fail(400, 'name_required');
    const fid = req.user.family_id;
    return db.tx(async (t) => {
      const f = await t.get('SELECT * FROM families WHERE id = ?', fid);
      const n = (await t.get('SELECT COUNT(*) AS n FROM family_memberships WHERE family_id = ?', fid)).n;
      if (n >= f.max_members) fail(409, 'family_full');
      const order = (await t.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS o FROM family_memberships WHERE family_id = ?', fid)).o;
      const u = await t.run('INSERT INTO users (display_name, avatar_color, timezone, created_at) VALUES (?, ?, ?, ?)',
        displayName, AVATAR_COLORS[order % AVATAR_COLORS.length], f.timezone, iso());
      await t.run("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order) VALUES (?, ?, 'member', 'invited', ?)", fid, u.lastInsertRowid, order);
      return { userId: u.lastInsertRowid, invite: await createInvite(t, fid, u.lastInsertRowid, 'join') };
    });
  }));

  app.patch('/api/admin/members/:id', requireAdmin, route(async (req) => {
    const m = await memberOfMyFamily(req, int(req.params.id));
    if (req.body.displayName !== undefined) {
      const name = str(req.body.displayName, 40);
      if (!name) fail(400, 'name_required');
      await db.run('UPDATE users SET display_name = ? WHERE id = ?', name, m.user_id);
    }
    if (req.body.role !== undefined) {
      if (!['admin', 'member'].includes(req.body.role)) fail(400, 'bad_role');
      if (m.user_id === req.user.id && req.body.role !== 'admin') fail(409, 'last_admin');
      await db.run('UPDATE family_memberships SET role = ? WHERE id = ?', req.body.role, m.id);
    }
    return { ok: true };
  }));

  app.post('/api/admin/members/:id/invite', requireAdmin, route(async (req) => {
    const m = await memberOfMyFamily(req, int(req.params.id));
    return { invite: await createInvite(db, req.user.family_id, m.user_id, m.status === 'active' ? 'reset' : 'join') };
  }));

  app.delete('/api/admin/members/:id', requireAdmin, route(async (req) => {
    const m = await memberOfMyFamily(req, int(req.params.id));
    if (m.user_id === req.user.id) fail(409, 'cannot_remove_self');
    await deleteUserData(db, m.user_id);
    return { ok: true };
  }));

  app.patch('/api/admin/family', requireAdmin, route(async (req) => {
    const f = await db.get('SELECT * FROM families WHERE id = ?', req.user.family_id);
    const name = req.body.name !== undefined ? str(req.body.name) : f.name;
    if (!name) fail(400, 'name_required');
    const tz = req.body.timezone !== undefined ? (isValidTimeZone(req.body.timezone) ? req.body.timezone : fail(400, 'bad_timezone')) : f.timezone;
    await db.run('UPDATE families SET name = ?, timezone = ? WHERE id = ?', name, tz, f.id);
    return { ok: true };
  }));

  /** Family backup for safekeeping: everyone's reading data, never PINs or session tokens. */
  app.get('/api/admin/backup', requireAdmin, route(async (req, res) => {
    const fid = req.user.family_id;
    const family = await db.get('SELECT name, timezone, created_at FROM families WHERE id = ?', fid);
    const members = await db.all(
      `SELECT u.*, m.role, m.status, m.joined_at FROM family_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = ? ORDER BY m.sort_order, m.id`, fid);
    const people = await Promise.all(members.map(async (m) => ({ role: m.role, status: m.status, joinedAt: m.joined_at, ...(await personalExport(m)) })));
    res.set('Content-Disposition', `attachment; filename="family-backup-${localDate(req.user.timezone, now())}.json"`);
    return { backupOf: 'Baqarah Together', exportedAt: iso(), family, members: people };
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // ---------- static client ----------
  const dist = path.join(ROOT, 'dist');
  if (serveClient && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));
    app.get('*', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
