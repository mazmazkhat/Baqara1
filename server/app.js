import express from 'express';
import helmet from 'helmet';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tx } from './db.js';
import {
  SESSION_COOKIE, SESSION_DAYS, MAX_FAILED_BEFORE_LOCK, sha256, newToken, hashPin, verifyPin,
  pinProblem, loginNameProblem, IpLimiter, parseCookies,
} from './auth.js';
import { isValidTimeZone, localDate, addDays } from './time.js';
import {
  TOTAL_VERSES, getPlan, getProgress, saveProgress, markComplete, undoComplete, personalStats, todayPortion,
} from './reading.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const QURAN = JSON.parse(readFileSync(path.join(ROOT, 'data', 'al-baqarah.json'), 'utf8'));
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
 * @param {import('node:sqlite').DatabaseSync} o.db
 * @param {() => Date} [o.now] injectable clock (tests)
 * @param {string|null} [o.setupCode] one-time code required to create the first family
 * @param {boolean} [o.secureCookies]
 */
export function createApp({ db, now = () => new Date(), setupCode = null, secureCookies = false, serveClient = false }) {
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
        },
      },
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

  // ---------- session helpers ----------
  const iso = () => now().toISOString();

  function startSession(res, userId) {
    const token = newToken();
    const t = now();
    const expires = new Date(t.getTime() + SESSION_DAYS * 86400000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
      sha256(token), userId, t.toISOString(), expires.toISOString(), t.toISOString(),
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/', maxAge: SESSION_DAYS * 86400000,
    });
  }

  function loadSessionUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.*, s.token_hash, s.expires_at AS session_expires, m.family_id, m.role, m.status, m.joined_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           JOIN family_memberships m ON m.user_id = u.id
          WHERE s.token_hash = ?`,
      )
      .get(sha256(token));
    if (!row || row.session_expires < iso() || row.status !== 'active') return null;
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(iso(), row.token_hash);
    return row;
  }

  const requireUser = (req, res, next) => {
    const u = loadSessionUser(req);
    if (!u) return res.status(401).json({ error: 'not_signed_in' });
    req.user = u;
    next();
  };
  const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_only' }));

  /** Ensure the target user belongs to the requesting admin's family. */
  function memberOfMyFamily(req, userId) {
    const m = db
      .prepare('SELECT m.*, u.display_name FROM family_memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.family_id = ?')
      .get(userId, req.user.family_id);
    if (!m) fail(404, 'member_not_found');
    return m;
  }

  function createInvite(familyId, userId, purpose) {
    const token = newToken();
    db.prepare('UPDATE invitations SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(iso(), userId); // revoke older links
    db.prepare('INSERT INTO invitations (family_id, user_id, token_hash, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      familyId, userId, sha256(token), purpose, iso(), new Date(now().getTime() + INVITE_DAYS * 86400000).toISOString(),
    );
    return { token, path: `/invite/${token}`, expiresInDays: INVITE_DAYS };
  }

  function findInvite(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const inv = db
      .prepare(
        `SELECT i.*, u.display_name, u.login_name, f.name AS family_name, m.role
           FROM invitations i JOIN users u ON u.id = i.user_id JOIN families f ON f.id = i.family_id
           JOIN family_memberships m ON m.user_id = i.user_id AND m.family_id = i.family_id
          WHERE i.token_hash = ?`,
      )
      .get(sha256(token));
    if (!inv || inv.used_at || inv.expires_at < iso()) return null;
    return inv;
  }

  function publicUser(u) {
    return {
      id: u.id, displayName: u.display_name, loginName: u.login_name, avatar: u.avatar, avatarColor: u.avatar_color,
      locale: u.locale, timezone: u.timezone, theme: u.theme, fontScale: u.font_scale, role: u.role,
    };
  }

  const wrap = (fn) => (req, res, next) => {
    try {
      const r = fn(req, res);
      if (r !== undefined && !res.headersSent) res.json(r);
    } catch (e) {
      next(e);
    }
  };

  // ---------- setup (first family) ----------
  const familyCount = () => db.prepare('SELECT COUNT(*) AS n FROM families').get().n;

  app.get('/api/setup/status', wrap(() => ({ needsSetup: familyCount() === 0 })));

  app.post('/api/setup', wrap((req, res) => {
    if (familyCount() > 0) fail(409, 'already_set_up');
    if (!setupCode || req.body.setupCode !== setupCode) fail(403, 'bad_setup_code');
    const familyName = str(req.body.familyName);
    const displayName = str(req.body.displayName, 40);
    const loginName = str(req.body.loginName, 30).toLowerCase();
    const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : 'UTC';
    const locale = req.body.locale === 'ar' ? 'ar' : 'en';
    if (!familyName || !displayName) fail(400, 'name_required');
    const lp = loginNameProblem(loginName); if (lp) fail(400, lp);
    const pp = pinProblem(req.body.pin, { minLength: 6 }); if (pp) fail(400, pp);
    const userId = tx(db, () => {
      const f = db.prepare('INSERT INTO families (name, timezone, created_at) VALUES (?, ?, ?)').run(familyName, tz, iso());
      const u = db.prepare(
        'INSERT INTO users (display_name, login_name, pin_hash, locale, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(displayName, loginName, hashPin(req.body.pin), locale, tz, iso());
      db.prepare("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order, joined_at) VALUES (?, ?, 'admin', 'active', 0, ?)").run(
        f.lastInsertRowid, u.lastInsertRowid, iso(),
      );
      return Number(u.lastInsertRowid);
    });
    startSession(res, userId);
    return { ok: true };
  }));

  // ---------- invitations ----------
  app.get('/api/invite/:token', wrap((req) => {
    const inv = findInvite(req.params.token);
    if (!inv) fail(404, 'invite_invalid');
    return { displayName: inv.display_name, familyName: inv.family_name, purpose: inv.purpose, loginName: inv.login_name, role: inv.role };
  }));

  app.post('/api/invite/:token/accept', wrap((req, res) => {
    const inv = findInvite(req.params.token);
    if (!inv) fail(404, 'invite_invalid');
    const pp = pinProblem(req.body.pin, { minLength: inv.role === 'admin' ? 6 : 4 }); if (pp) fail(400, pp);
    let loginName = inv.login_name;
    if (inv.purpose === 'join') {
      loginName = str(req.body.loginName, 30).toLowerCase();
      const lp = loginNameProblem(loginName); if (lp) fail(400, lp);
      const taken = db.prepare('SELECT id FROM users WHERE login_name = ? AND id != ?').get(loginName, inv.user_id);
      if (taken) fail(409, 'login_name_taken');
    }
    const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : null;
    tx(db, () => {
      db.prepare('UPDATE users SET login_name = ?, pin_hash = ?, failed_logins = 0, locked_until = NULL, timezone = COALESCE(?, timezone), locale = ? WHERE id = ?').run(
        loginName, hashPin(req.body.pin), inv.purpose === 'join' ? tz : null, req.body.locale === 'ar' ? 'ar' : 'en', inv.user_id,
      );
      db.prepare("UPDATE family_memberships SET status = 'active', joined_at = COALESCE(joined_at, ?) WHERE user_id = ?").run(iso(), inv.user_id);
      db.prepare('UPDATE invitations SET used_at = ? WHERE id = ?').run(iso(), inv.id);
      if (inv.purpose === 'reset') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(inv.user_id); // sign out other devices
    });
    startSession(res, inv.user_id);
    return { ok: true };
  }));

  // ---------- login / logout ----------
  app.post('/api/auth/login', wrap((req, res) => {
    const ip = req.ip;
    const t = now().getTime();
    if (ipLimiter.blocked(ip, t)) fail(429, 'too_many_attempts');
    const loginName = str(req.body.loginName, 30).toLowerCase();
    const u = db
      .prepare("SELECT u.* FROM users u JOIN family_memberships m ON m.user_id = u.id WHERE u.login_name = ? AND m.status = 'active'")
      .get(loginName);
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
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failed, until, u.id);
      }
      fail(401, 'bad_credentials');
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
    ipLimiter.reset(ip);
    startSession(res, u.id);
    return { ok: true };
  }));

  app.post('/api/auth/logout', wrap((req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- everything below requires a signed-in family member ----------
  app.use('/api', requireUser);

  app.get('/api/quran', (req, res) => {
    res.set('Cache-Control', 'private, max-age=86400');
    res.json(QURAN);
  });

  app.get('/api/me', wrap((req) => {
    const f = db.prepare('SELECT id, name, timezone, max_members FROM families WHERE id = ?').get(req.user.family_id);
    return {
      user: publicUser(req.user),
      family: { id: f.id, name: f.name, timezone: f.timezone, maxMembers: f.max_members },
      stats: personalStats(db, req.user, req.user.joined_at, now()),
    };
  }));

  app.patch('/api/me', wrap((req) => {
    const b = req.body;
    const u = req.user;
    const displayName = b.displayName !== undefined ? str(b.displayName, 40) : u.display_name;
    if (!displayName) fail(400, 'name_required');
    const avatar = b.avatar !== undefined ? (AVATARS.includes(b.avatar) ? b.avatar : fail(400, 'bad_avatar')) : u.avatar;
    const avatarColor = b.avatarColor !== undefined ? (AVATAR_COLORS.includes(b.avatarColor) ? b.avatarColor : fail(400, 'bad_color')) : u.avatar_color;
    const locale = b.locale !== undefined ? (['en', 'ar'].includes(b.locale) ? b.locale : fail(400, 'bad_locale')) : u.locale;
    const theme = b.theme !== undefined ? (['system', 'light', 'dark'].includes(b.theme) ? b.theme : fail(400, 'bad_theme')) : u.theme;
    const timezone = b.timezone !== undefined ? (isValidTimeZone(b.timezone) ? b.timezone : fail(400, 'bad_timezone')) : u.timezone;
    let fontScale = u.font_scale;
    if (b.fontScale !== undefined) {
      fontScale = Number(b.fontScale);
      if (!(fontScale >= 0.8 && fontScale <= 2.2)) fail(400, 'bad_font_scale');
    }
    db.prepare('UPDATE users SET display_name = ?, avatar = ?, avatar_color = ?, locale = ?, theme = ?, timezone = ?, font_scale = ? WHERE id = ?').run(
      displayName, avatar, avatarColor, locale, theme, timezone, fontScale, u.id,
    );
    return { ok: true };
  }));

  app.post('/api/me/pin', wrap((req) => {
    if (!verifyPin(String(req.body.currentPin ?? ''), req.user.pin_hash)) fail(400, 'current_pin_wrong');
    const pp = pinProblem(req.body.newPin, { minLength: req.user.role === 'admin' ? 6 : 4 }); if (pp) fail(400, pp);
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(req.body.newPin), req.user.id);
    return { ok: true };
  }));

  app.get('/api/me/export', (req, res) => {
    const id = req.user.id;
    const data = {
      exportedAt: iso(),
      profile: publicUser(req.user),
      plan: getPlan(db, id),
      progress: db.prepare('SELECT current_verse, furthest_verse, cycles_completed, total_verses_read, updated_at FROM reading_progress WHERE user_id = ?').get(id) ?? null,
      completions: db.prepare('SELECT local_date, from_verse, to_verse, completed_at FROM daily_completions WHERE user_id = ? ORDER BY local_date').all(id),
      bookmarks: db.prepare('SELECT verse, created_at FROM bookmarks WHERE user_id = ? ORDER BY verse').all(id),
      reflections: db.prepare('SELECT local_date, verse_from, verse_to, body, visibility, created_at, updated_at FROM reflections WHERE user_id = ?').all(id),
    };
    res.set('Content-Disposition', 'attachment; filename="my-baqarah-reading.json"');
    res.json(data);
  });

  app.delete('/api/me', wrap((req, res) => {
    if (!verifyPin(String(req.body?.pin ?? ''), req.user.pin_hash)) fail(400, 'current_pin_wrong');
    if (req.user.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM family_memberships WHERE family_id = ? AND role = 'admin' AND status = 'active'").get(req.user.family_id).n;
      if (admins <= 1) fail(409, 'last_admin');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // cascades to all personal data
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- reading ----------
  app.get('/api/progress', wrap((req) => {
    const p = getProgress(db, req.user.id, iso());
    const bookmarks = db.prepare('SELECT verse FROM bookmarks WHERE user_id = ? ORDER BY verse').all(req.user.id).map((r) => r.verse);
    return { position: p.current_verse, portion: todayPortion(getPlan(db, req.user.id), p), bookmarks };
  }));

  app.put('/api/progress', wrap((req) => {
    const verse = int(req.body.verse);
    const seen = req.body.seen === undefined ? verse : int(req.body.seen);
    if (!(verse >= 1 && verse <= TOTAL_VERSES) || !(seen >= 1 && seen <= TOTAL_VERSES)) fail(400, 'bad_verse');
    saveProgress(db, req.user.id, verse, seen, iso());
    return { ok: true };
  }));

  app.put('/api/plan', wrap((req) => {
    const type = req.body.planType;
    if (!['free', 'whole', 'verses', 'days'].includes(type)) fail(400, 'bad_plan');
    const vpd = type === 'verses' ? int(req.body.versesPerDay) : null;
    const days = type === 'days' ? int(req.body.daysTotal) : null;
    if (type === 'verses' && !(vpd >= 1 && vpd <= TOTAL_VERSES)) fail(400, 'bad_plan');
    if (type === 'days' && !(days >= 1 && days <= 365)) fail(400, 'bad_plan');
    db.prepare(
      `INSERT INTO reading_plans (user_id, plan_type, verses_per_day, days_total, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET plan_type = excluded.plan_type, verses_per_day = excluded.verses_per_day,
         days_total = excluded.days_total, updated_at = excluded.updated_at`,
    ).run(req.user.id, type, vpd, days, iso());
    return { ok: true };
  }));

  app.post('/api/completions/today', wrap((req) => {
    const r = tx(db, () => markComplete(db, req.user, req.user.family_id, now()));
    return { ok: true, ...r };
  }));

  app.delete('/api/completions/today', wrap((req) => {
    const ok = tx(db, () => undoComplete(db, req.user, now()));
    if (!ok) fail(404, 'not_completed_today');
    return { ok: true };
  }));

  app.get('/api/history', wrap((req) => {
    const rows = db
      .prepare('SELECT local_date, from_verse, to_verse FROM daily_completions WHERE user_id = ? ORDER BY local_date DESC LIMIT 400')
      .all(req.user.id);
    const bookmarks = db.prepare('SELECT verse, created_at FROM bookmarks WHERE user_id = ? ORDER BY verse').all(req.user.id);
    return { completions: rows, bookmarks, stats: personalStats(db, req.user, req.user.joined_at, now()) };
  }));

  app.post('/api/bookmarks', wrap((req) => {
    const verse = int(req.body.verse);
    if (!(verse >= 1 && verse <= TOTAL_VERSES)) fail(400, 'bad_verse');
    db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, verse, created_at) VALUES (?, ?, ?)').run(req.user.id, verse, iso());
    return { ok: true };
  }));

  app.delete('/api/bookmarks/:verse', wrap((req) => {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND verse = ?').run(req.user.id, int(req.params.verse));
    return { ok: true };
  }));

  // ---------- family dashboard ----------
  app.get('/api/family/dashboard', wrap((req) => {
    const fid = req.user.family_id;
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(fid);
    const members = db
      .prepare(
        `SELECT u.*, m.role, m.status, m.joined_at FROM family_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.family_id = ? ORDER BY m.sort_order, m.id`,
      )
      .all(fid);
    const t = now();
    const familyToday = localDate(family.timezone, t);
    const active = members.filter((m) => m.status === 'active');
    const list = members.map((m) => {
      if (m.status !== 'active') return { id: m.id, displayName: m.display_name, avatar: m.avatar, avatarColor: m.avatar_color, status: 'invited' };
      const s = personalStats(db, m, m.joined_at, t);
      return {
        id: m.id, displayName: m.display_name, avatar: m.avatar, avatarColor: m.avatar_color, status: 'active', role: m.role,
        doneToday: s.doneToday, portionPercent: s.portion.percent, position: s.position,
      };
    });

    // Family history by family calendar day: how many members marked that day (each in their own zone).
    const since = addDays(familyToday, -34);
    const counts = new Map(
      db.prepare('SELECT local_date, COUNT(*) AS n FROM daily_completions WHERE family_id = ? AND local_date >= ? GROUP BY local_date').all(fid, since)
        .map((r) => [r.local_date, r.n]),
    );
    const days = (n) => Array.from({ length: n }, (_, i) => addDays(familyToday, i - n + 1)).map((d) => ({ date: d, count: counts.get(d) ?? 0 }));
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS days, COALESCE(SUM(p.total_verses_read), 0) AS verses FROM family_memberships m
           LEFT JOIN reading_progress p ON p.user_id = m.user_id WHERE m.family_id = ?`,
      )
      .get(fid);
    const completionDays = db.prepare('SELECT COUNT(*) AS n FROM daily_completions WHERE family_id = ?').get(fid).n;
    const togetherDays = db
      .prepare('SELECT COUNT(*) AS n FROM (SELECT local_date FROM daily_completions WHERE family_id = ? GROUP BY local_date HAVING COUNT(*) >= ?)')
      .get(fid, Math.max(1, active.length)).n;
    const cycles = db
      .prepare('SELECT COALESCE(SUM(p.cycles_completed),0) AS n FROM family_memberships m JOIN reading_progress p ON p.user_id = m.user_id WHERE m.family_id = ?')
      .get(fid).n;

    return {
      family: { name: family.name, timezone: family.timezone, today: familyToday },
      members: list,
      today: { done: list.filter((m) => m.doneToday).length, active: active.length },
      week: days(7),
      month: days(30),
      totals: { readingDays: completionDays, versesRead: totals.verses, daysAllTogether: togetherDays, surahCompletions: cycles },
    };
  }));

  // ---------- administrator ----------
  app.get('/api/admin/members', requireAdmin, wrap((req) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.display_name, u.login_name, u.avatar, u.avatar_color, m.role, m.status, m.joined_at,
                (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
           FROM family_memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? ORDER BY m.sort_order, m.id`,
      )
      .all(req.user.family_id);
    const f = db.prepare('SELECT max_members FROM families WHERE id = ?').get(req.user.family_id);
    return { members: rows, maxMembers: f.max_members };
  }));

  app.post('/api/admin/members', requireAdmin, wrap((req) => {
    const displayName = str(req.body.displayName, 40);
    if (!displayName) fail(400, 'name_required');
    const fid = req.user.family_id;
    const f = db.prepare('SELECT * FROM families WHERE id = ?').get(fid);
    return tx(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM family_memberships WHERE family_id = ?').get(fid).n;
      if (n >= f.max_members) fail(409, 'family_full');
      const color = AVATAR_COLORS[n % AVATAR_COLORS.length];
      const u = db.prepare('INSERT INTO users (display_name, avatar_color, timezone, created_at) VALUES (?, ?, ?, ?)').run(displayName, color, f.timezone, iso());
      const uid = Number(u.lastInsertRowid);
      db.prepare("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order) VALUES (?, ?, 'member', 'invited', ?)").run(fid, uid, n);
      return { userId: uid, invite: createInvite(fid, uid, 'join') };
    });
  }));

  app.patch('/api/admin/members/:id', requireAdmin, wrap((req) => {
    const m = memberOfMyFamily(req, int(req.params.id));
    if (req.body.displayName !== undefined) {
      const name = str(req.body.displayName, 40);
      if (!name) fail(400, 'name_required');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, m.user_id);
    }
    if (req.body.role !== undefined) {
      if (!['admin', 'member'].includes(req.body.role)) fail(400, 'bad_role');
      if (m.user_id === req.user.id && req.body.role !== 'admin') fail(409, 'last_admin');
      db.prepare('UPDATE family_memberships SET role = ? WHERE id = ?').run(req.body.role, m.id);
    }
    return { ok: true };
  }));

  app.post('/api/admin/members/:id/invite', requireAdmin, wrap((req) => {
    const m = memberOfMyFamily(req, int(req.params.id));
    return { invite: createInvite(req.user.family_id, m.user_id, m.status === 'active' ? 'reset' : 'join') };
  }));

  app.delete('/api/admin/members/:id', requireAdmin, wrap((req) => {
    const m = memberOfMyFamily(req, int(req.params.id));
    if (m.user_id === req.user.id) fail(409, 'cannot_remove_self');
    db.prepare('DELETE FROM users WHERE id = ?').run(m.user_id);
    return { ok: true };
  }));

  app.patch('/api/admin/family', requireAdmin, wrap((req) => {
    const f = db.prepare('SELECT * FROM families WHERE id = ?').get(req.user.family_id);
    const name = req.body.name !== undefined ? str(req.body.name) : f.name;
    if (!name) fail(400, 'name_required');
    const tz = req.body.timezone !== undefined ? (isValidTimeZone(req.body.timezone) ? req.body.timezone : fail(400, 'bad_timezone')) : f.timezone;
    db.prepare('UPDATE families SET name = ?, timezone = ? WHERE id = ?').run(name, tz, f.id);
    return { ok: true };
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
