import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const H = { 'X-Requested-With': 'baqara' };
let clock = new Date('2026-11-21T10:00:00Z');
const setClock = (iso) => { clock = new Date(iso); };

const TMP = mkdtempSync(path.join(tmpdir(), 'baqara-api-'));
let dbCount = 0;
async function makeApp() {
  const db = await openDb(`file:${path.join(TMP, `t${++dbCount}.db`)}`);
  const app = createApp({ db, now: () => clock, setupCode: 'SETUP-123' });
  return { db, app };
}
const post = (agent, url, body) => agent.post(url).set(H).send(body);
const patch = (agent, url, body) => agent.patch(url).set(H).send(body);
const put = (agent, url, body) => agent.put(url).set(H).send(body);
const del = (agent, url, body) => agent.delete(url).set(H).send(body ?? {});
const tokenOf = (res) => res.body.invite.path.split('/').pop();

async function setupFamily(app, name = 'Al-Rahman Family', login = 'yusuf') {
  const admin = request.agent(app);
  const r = await post(admin, '/api/setup', { setupCode: 'SETUP-123', familyName: name, displayName: 'Yusuf', loginName: login, pin: '482915', timezone: 'Europe/London' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return admin;
}
async function inviteAndJoin(app, admin, displayName, login, pin = '2580', timezone = 'Europe/London') {
  const inv = await post(admin, '/api/admin/members', { displayName });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  const agent = request.agent(app);
  const acc = await post(agent, `/api/invite/${tokenOf(inv)}/accept`, { loginName: login, pin, timezone });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return { agent, userId: inv.body.userId };
}

describe('setup, registration and login', () => {
  let app;
  before(async () => { ({ app } = await makeApp()); });

  test('setup requires the one-time code', async () => {
    assert.equal((await request(app).get('/api/setup/status')).body.needsSetup, true);
    const bad = await post(request(app), '/api/setup', { setupCode: 'nope', familyName: 'X', displayName: 'Y', loginName: 'yyy', pin: '482915' });
    assert.equal(bad.status, 403);
  });

  test('admin PIN must be 6 digits and not trivial', async () => {
    const r = await post(request(app), '/api/setup', { setupCode: 'SETUP-123', familyName: 'F', displayName: 'Y', loginName: 'yusuf', pin: '1234' });
    assert.equal(r.body.error, 'pin_length_admin');
    const r2 = await post(request(app), '/api/setup', { setupCode: 'SETUP-123', familyName: 'F', displayName: 'Y', loginName: 'yusuf', pin: '123456' });
    assert.equal(r2.body.error, 'pin_too_simple');
  });

  test('setup creates family + signed-in admin, and only once', async () => {
    const admin = await setupFamily(app);
    const me = await admin.get('/api/me');
    assert.equal(me.body.user.role, 'admin');
    assert.equal(me.body.family.name, 'Al-Rahman Family');
    const again = await post(request(app), '/api/setup', { setupCode: 'SETUP-123', familyName: 'F2', displayName: 'Z', loginName: 'zzz', pin: '482915' });
    assert.equal(again.status, 409);
  });

  test('login works, cookie is httpOnly, wrong PIN gives a generic error', async () => {
    const ok = await post(request(app), '/api/auth/login', { loginName: 'YUSUF', pin: '482915' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers['set-cookie'][0], /HttpOnly/);
    assert.match(ok.headers['set-cookie'][0], /SameSite=Lax/);
    const bad = await post(request(app), '/api/auth/login', { loginName: 'yusuf', pin: '000001' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'bad_credentials');
    const unknown = await post(request(app), '/api/auth/login', { loginName: 'nobody', pin: '000001' });
    assert.equal(unknown.body.error, 'bad_credentials');
  });

  test('account locks after 5 wrong PINs and unlocks after 15 minutes', async () => {
    for (let i = 0; i < 4; i++) await post(request(app), '/api/auth/login', { loginName: 'yusuf', pin: '999998' });
    const locked = await post(request(app), '/api/auth/login', { loginName: 'yusuf', pin: '482915' });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error, 'account_locked');
    setClock(new Date(clock.getTime() + 16 * 60000).toISOString());
    const ok = await post(request(app), '/api/auth/login', { loginName: 'yusuf', pin: '482915' });
    assert.equal(ok.status, 200);
  });

  test('logout ends the session', async () => {
    const a = request.agent(app);
    await post(a, '/api/auth/login', { loginName: 'yusuf', pin: '482915' });
    assert.equal((await a.get('/api/me')).status, 200);
    await post(a, '/api/auth/logout', {});
    assert.equal((await a.get('/api/me')).status, 401);
  });

  test('state-changing requests without the CSRF header are rejected', async () => {
    const r = await request(app).post('/api/auth/login').send({ loginName: 'yusuf', pin: '482915' });
    assert.equal(r.status, 403);
  });
});

describe('invitations and the six-member family', () => {
  let app;
  let admin;
  before(async () => { ({ app } = await makeApp()); setClock('2026-11-21T10:00:00Z'); admin = await setupFamily(app); });

  test('invite link shows who it is for, then can be used exactly once', async () => {
    const inv = await post(admin, '/api/admin/members', { displayName: 'Maryam' });
    const t = tokenOf(inv);
    const info = await request(app).get(`/api/invite/${t}`);
    assert.deepEqual([info.body.displayName, info.body.familyName, info.body.purpose], ['Maryam', 'Al-Rahman Family', 'join']);
    const a = request.agent(app);
    assert.equal((await post(a, `/api/invite/${t}/accept`, { loginName: 'maryam', pin: '7391', timezone: 'Asia/Riyadh' })).status, 200);
    const me = await a.get('/api/me');
    assert.equal(me.body.user.role, 'member');
    assert.equal(me.body.user.timezone, 'Asia/Riyadh');
    assert.equal((await request(app).get(`/api/invite/${t}`)).status, 404);
    assert.equal((await post(request(app), `/api/invite/${t}/accept`, { loginName: 'other', pin: '7391' })).status, 404);
  });

  test('login names must be unique', async () => {
    const inv = await post(admin, '/api/admin/members', { displayName: 'Ibrahim' });
    const r = await post(request(app), `/api/invite/${tokenOf(inv)}/accept`, { loginName: 'maryam', pin: '7391' });
    assert.equal(r.body.error, 'login_name_taken');
    assert.equal((await post(request(app), `/api/invite/${tokenOf(inv)}/accept`, { loginName: 'ibrahim', pin: '7391' })).status, 200);
  });

  test('invite links expire after 7 days', async () => {
    const inv = await post(admin, '/api/admin/members', { displayName: 'Aisha' });
    setClock('2026-11-29T10:00:01Z');
    assert.equal((await request(app).get(`/api/invite/${tokenOf(inv)}`)).status, 404);
    const fresh = await post(admin, `/api/admin/members/${inv.body.userId}/invite`, {});
    assert.equal((await post(request(app), `/api/invite/${tokenOf(fresh)}/accept`, { loginName: 'aisha', pin: '1470' })).status, 200);
    setClock('2026-11-21T10:00:00Z');
  });

  test('family is capped at six members', async () => {
    await post(admin, '/api/admin/members', { displayName: 'Zaynab' });
    await post(admin, '/api/admin/members', { displayName: 'Omar' });
    const seventh = await post(admin, '/api/admin/members', { displayName: 'Guest' });
    assert.equal(seventh.status, 409);
    assert.equal(seventh.body.error, 'family_full');
    const list = await admin.get('/api/admin/members');
    assert.equal(list.body.members.length, 6);
  });

  test('invited-but-not-joined members appear on the dashboard as invited', async () => {
    const d = await admin.get('/api/family/dashboard');
    assert.equal(d.body.members.length, 6);
    assert.equal(d.body.members.filter((m) => m.status === 'invited').length, 2);
    assert.equal(d.body.today.active, 4);
  });

  test('admin can rename and remove; cannot remove self', async () => {
    const list = (await admin.get('/api/admin/members')).body.members;
    const omar = list.find((m) => m.display_name === 'Omar');
    assert.equal((await patch(admin, `/api/admin/members/${omar.id}`, { displayName: 'Grandpa Omar' })).status, 200);
    assert.equal((await del(admin, `/api/admin/members/${omar.id}`)).status, 200);
    const self = list.find((m) => m.role === 'admin');
    assert.equal((await del(admin, `/api/admin/members/${self.id}`)).body.error, 'cannot_remove_self');
  });

  test('PIN reset link signs the member out elsewhere and sets a new PIN', async () => {
    const m = await inviteAndJoin(app, admin, 'Omar', 'omar', '3692');
    const reset = await post(admin, `/api/admin/members/${m.userId}/invite`, {});
    assert.equal(reset.body.invite.path.length > 20, true);
    const info = await request(app).get(`/api/invite/${tokenOf(reset)}`);
    assert.equal(info.body.purpose, 'reset');
    await post(request(app), `/api/invite/${tokenOf(reset)}/accept`, { pin: '8642' });
    assert.equal((await m.agent.get('/api/me')).status, 401);
    assert.equal((await post(request(app), '/api/auth/login', { loginName: 'omar', pin: '8642' })).status, 200);
  });
});

describe('permissions and privacy', () => {
  let app;
  let adminA, member, adminB, memberB;
  before(async () => {
    ({ app } = await makeApp());
    setClock('2026-11-21T10:00:00Z');
    adminA = await setupFamily(app);
    member = (await inviteAndJoin(app, adminA, 'Maryam', 'maryam')).agent;
  });

  test('members cannot use admin endpoints', async () => {
    assert.equal((await member.get('/api/admin/members')).status, 403);
    assert.equal((await post(member, '/api/admin/members', { displayName: 'X' })).status, 403);
    assert.equal((await patch(member, '/api/admin/family', { name: 'Hacked' })).status, 403);
  });

  test('signed-out visitors see nothing, including the reader text', async () => {
    for (const url of ['/api/me', '/api/family/dashboard', '/api/quran', '/api/history', '/api/progress']) {
      assert.equal((await request(app).get(url)).status, 401, url);
    }
  });

  test('families are isolated from one another', async () => {
    // Create family B directly via a second app sharing the same DB is not possible after setup,
    // so insert it the way setup would, then sign in through the API.
    const { db, app: app2 } = await makeApp();
    adminA = await setupFamily(app2, 'Family A', 'adama');
    const mA = await inviteAndJoin(app2, adminA, 'Maryam', 'maryama');
    const { hashPin } = await import('../server/auth.js');
    const f = await db.run("INSERT INTO families (name, timezone, created_at) VALUES ('Family B', 'UTC', 'x')");
    const u = await db.run("INSERT INTO users (display_name, login_name, pin_hash, created_at) VALUES ('Bilal', 'bilal', ?, 'x')", hashPin('482915'));
    await db.run("INSERT INTO family_memberships (family_id, user_id, role, status, joined_at) VALUES (?, ?, 'admin', 'active', 'x')", f.lastInsertRowid, u.lastInsertRowid);
    adminB = request.agent(app2);
    await post(adminB, '/api/auth/login', { loginName: 'bilal', pin: '482915' });
    memberB = adminB;

    const dashB = await memberB.get('/api/family/dashboard');
    assert.deepEqual(dashB.body.members.map((m) => m.displayName), ['Bilal']);
    // B's admin cannot touch A's members.
    assert.equal((await patch(adminB, `/api/admin/members/${mA.userId}`, { displayName: 'x' })).status, 404);
    assert.equal((await del(adminB, `/api/admin/members/${mA.userId}`)).status, 404);
    assert.equal((await post(adminB, `/api/admin/members/${mA.userId}/invite`, {})).status, 404);
    // A's dashboard does not include Bilal.
    const dashA = await adminA.get('/api/family/dashboard');
    assert.equal(dashA.body.members.some((m) => m.displayName === 'Bilal'), false);
  });

  test('a member can export their data and delete their account', async () => {
    await put(member, '/api/progress', { verse: 12 });
    await post(member, '/api/bookmarks', { verse: 255 });
    const ex = await member.get('/api/me/export');
    assert.equal(ex.body.profile.loginName, 'maryam');
    assert.deepEqual(ex.body.bookmarks.map((b) => b.verse), [255]);
    assert.equal(ex.body.profile.pin_hash, undefined);
    assert.equal(JSON.stringify(ex.body).includes('scrypt'), false);
    assert.equal((await del(member, '/api/me', { pin: '0000' })).body.error, 'current_pin_wrong');
    assert.equal((await del(member, '/api/me', { pin: '2580' })).status, 200);
    assert.equal((await member.get('/api/me')).status, 401);
    assert.equal((await post(request(app), '/api/auth/login', { loginName: 'maryam', pin: '2580' })).status, 401);
  });

  test('family backup is admin-only and never contains PINs or session tokens', async () => {
    const { app: a3 } = await makeApp();
    const adm = await setupFamily(a3);
    const m2 = (await inviteAndJoin(a3, adm, 'Ibrahim', 'ibrahim2')).agent;
    await put(m2, '/api/progress', { verse: 7 });
    assert.equal((await m2.get('/api/admin/backup')).status, 403);
    const b = await adm.get('/api/admin/backup');
    assert.equal(b.status, 200);
    assert.match(b.headers['content-disposition'], /family-backup-/);
    assert.ok(b.body.members.some((m) => m.profile.loginName === 'ibrahim2' && m.progress.current_verse === 7));
    const text = JSON.stringify(b.body);
    assert.equal(/scrypt|pin_hash|token/i.test(text), false);
  });

  test('the only administrator cannot delete their own account', async () => {
    assert.equal((await del(adminA, '/api/me', { pin: '482915' })).body.error, 'last_admin');
  });
});

describe('reading progress, completion and time zones', () => {
  let app;
  let admin, maryam, ibrahim;
  before(async () => {
    ({ app } = await makeApp());
    setClock('2026-11-21T10:00:00Z');
    admin = await setupFamily(app);
    maryam = (await inviteAndJoin(app, admin, 'Maryam', 'maryam', '2580', 'Asia/Riyadh')).agent;
    ibrahim = (await inviteAndJoin(app, admin, 'Ibrahim', 'ibrahim', '2580', 'America/Los_Angeles')).agent;
  });

  test('Quran text is served verbatim with source attribution', async () => {
    const q = await maryam.get('/api/quran');
    assert.equal(q.body.verses.length, 286);
    assert.match(q.body.source.text, /Tanzil/);
    assert.match(q.body.license, /CHANGING IT IS NOT ALLOWED/);
    assert.equal(q.body.verses[254].n, 255);
  });

  test('reading position autosaves and "continue" returns it', async () => {
    await put(maryam, '/api/progress', { verse: 40, seen: 44 });
    const p = await maryam.get('/api/progress');
    assert.equal(p.body.position, 40);
    const me = await maryam.get('/api/me');
    assert.equal(me.body.stats.versesRead, 44);
    assert.equal(me.body.stats.surahPercent, 15);
  });

  test('invalid verse numbers are rejected', async () => {
    for (const v of [0, 287, -1, 'abc', 3.5]) assert.equal((await put(maryam, '/api/progress', { verse: v })).status, 400, String(v));
  });

  test('marking today complete is idempotent and moves position on (free pace)', async () => {
    const r = await post(maryam, '/api/completions/today', {});
    assert.equal(r.body.completion.local_date, '2026-11-21');
    assert.equal(r.body.completion.to_verse, 44);
    assert.equal((await post(maryam, '/api/completions/today', {})).body.already, true);
    const me = await maryam.get('/api/me');
    assert.equal(me.body.stats.doneToday, true);
    assert.equal(me.body.stats.streak, 1);
    assert.equal(me.body.stats.position, 45);
  });

  test('undo restores the previous position', async () => {
    assert.equal((await del(maryam, '/api/completions/today')).status, 200);
    const me = await maryam.get('/api/me');
    assert.equal(me.body.stats.doneToday, false);
    assert.equal(me.body.stats.position, 40);
    await post(maryam, '/api/completions/today', {});
  });

  test('"today" follows each member\'s own time zone', async () => {
    // 2026-11-21 22:30 UTC = 22 Nov 01:30 in Riyadh, but still 21 Nov 14:30 in Los Angeles.
    setClock('2026-11-21T22:30:00Z');
    const m = await maryam.get('/api/me');
    assert.equal(m.body.stats.today, '2026-11-22');
    assert.equal(m.body.stats.doneToday, false);
    assert.equal(m.body.stats.streak, 1, 'yesterday still counts while today is open');
    const i = await ibrahim.get('/api/me');
    assert.equal(i.body.stats.today, '2026-11-21');
    await post(ibrahim, '/api/completions/today', {});
    assert.equal((await ibrahim.get('/api/history')).body.completions[0].local_date, '2026-11-21');
  });

  test('streaks continue across days and reset gently after a gap', async () => {
    await post(maryam, '/api/completions/today', {}); // 22 Nov in Riyadh
    assert.equal((await maryam.get('/api/me')).body.stats.streak, 2);
    setClock('2026-11-25T10:00:00Z'); // missed 23 & 24
    const s = (await maryam.get('/api/me')).body.stats;
    assert.equal(s.streak, 0);
    assert.equal(s.totalDays, 2);
    assert.equal(s.notMarkedLast30, 2);
  });

  test('changing time zone is validated', async () => {
    assert.equal((await patch(maryam, '/api/me', { timezone: 'Mars/Olympus' })).status, 400);
    assert.equal((await patch(maryam, '/api/me', { timezone: 'Asia/Karachi' })).status, 200);
  });

  test('verse-count plan gives a daily portion and continues next day', async () => {
    setClock('2026-12-01T10:00:00Z');
    assert.equal((await put(ibrahim, '/api/plan', { planType: 'verses', versesPerDay: 20 })).status, 200);
    let p = await ibrahim.get('/api/progress');
    const start = p.body.portion.from; // Ibrahim already marked verse 1 earlier
    assert.equal(p.body.portion.to, start + 19);
    await put(ibrahim, '/api/progress', { verse: start + 17, seen: start + 19 });
    assert.equal((await ibrahim.get('/api/progress')).body.portion.percent, 100);
    await post(ibrahim, '/api/completions/today', {});
    p = await ibrahim.get('/api/progress');
    assert.deepEqual([p.body.portion.from, p.body.portion.to, p.body.position], [start + 20, start + 39, start + 20]);
  });

  test('days plan divides the Surah evenly', async () => {
    await put(ibrahim, '/api/plan', { planType: 'days', daysTotal: 7 });
    const p = await ibrahim.get('/api/progress');
    assert.equal(p.body.portion.to - p.body.portion.from + 1, 41);
    assert.equal((await put(ibrahim, '/api/plan', { planType: 'days', daysTotal: 0 })).status, 400);
  });

  test('finishing verse 286 counts a full reading and starts again at verse 1', async () => {
    setClock('2026-12-02T10:00:00Z');
    await put(ibrahim, '/api/plan', { planType: 'free' });
    await put(ibrahim, '/api/progress', { verse: 280, seen: 286 });
    const r = await post(ibrahim, '/api/completions/today', {});
    assert.equal(r.body.finishedSurah, true);
    const me = (await ibrahim.get('/api/me')).body.stats;
    assert.equal(me.cyclesCompleted, 1);
    assert.equal(me.position, 1);
  });

  test('whole-Surah plan restarts at verse 1 every day', async () => {
    setClock('2026-12-03T10:00:00Z');
    await put(maryam, '/api/plan', { planType: 'whole' });
    await put(maryam, '/api/progress', { verse: 100 });
    await post(maryam, '/api/completions/today', {});
    assert.equal((await maryam.get('/api/progress')).body.position, 1);
  });

  test('bookmarks are personal', async () => {
    await post(maryam, '/api/bookmarks', { verse: 255 });
    await post(maryam, '/api/bookmarks', { verse: 255 });
    assert.deepEqual((await maryam.get('/api/progress')).body.bookmarks, [255]);
    assert.deepEqual((await ibrahim.get('/api/progress')).body.bookmarks, []);
    await del(maryam, '/api/bookmarks/255');
    assert.deepEqual((await maryam.get('/api/progress')).body.bookmarks, []);
  });

  test('dashboard counts today, shows no ranking fields, and reports days together', async () => {
    setClock('2026-12-04T12:00:00Z');
    await post(admin, '/api/completions/today', {});
    await post(maryam, '/api/completions/today', {});
    let d = (await maryam.get('/api/family/dashboard')).body;
    assert.deepEqual(d.today, { done: 2, active: 3 });
    assert.equal(d.week.length, 7);
    assert.equal(d.month.length, 30);
    for (const m of d.members) {
      assert.equal('streak' in m, false);
      assert.equal('rank' in m, false);
    }
    // Members stay in fixed (join) order, never sorted by activity.
    assert.deepEqual(d.members.map((m) => m.displayName), ['Yusuf', 'Maryam', 'Ibrahim']);
    await post(ibrahim, '/api/completions/today', {});
    d = (await maryam.get('/api/family/dashboard')).body;
    assert.deepEqual(d.today, { done: 3, active: 3 });
    assert.equal(d.totals.daysAllTogether >= 1, true);
  });

  test('two taps on "complete" at the same moment record the day once', async () => {
    setClock('2026-12-05T12:00:00Z');
    const rs = await Promise.all([1, 2, 3].map(() => post(maryam, '/api/completions/today', {})));
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    const h = (await maryam.get('/api/history')).body;
    assert.equal(h.completions.filter((c) => c.local_date === '2026-12-05').length, 1);
  });

  test('removing a member deletes all of their rows', async () => {
    const { db, app: a2 } = await makeApp();
    const adm = await setupFamily(a2);
    const m = await inviteAndJoin(a2, adm, 'Temp', 'tempuser');
    await put(m.agent, '/api/progress', { verse: 9 });
    await post(m.agent, '/api/bookmarks', { verse: 9 });
    await post(m.agent, '/api/completions/today', {});
    await del(adm, `/api/admin/members/${m.userId}`);
    for (const t of ['sessions', 'invitations', 'reading_progress', 'daily_completions', 'bookmarks', 'family_memberships']) {
      assert.equal((await db.get(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, m.userId)).n, 0, t);
    }
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', m.userId)).n, 0);
  });

  test('malformed JSON gets a clean 400', async () => {
    const r = await maryam.put('/api/progress').set(H).set('Content-Type', 'application/json').send('{bad');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_json');
  });
});

describe('family parts (fixed 6-6-9-9-9-9 page split) and page view', () => {
  let app, admin, a, b;
  before(async () => {
    setClock('2026-12-10T12:00:00Z');
    ({ app } = await makeApp());
    admin = await setupFamily(app);
    a = (await inviteAndJoin(app, admin, 'Maryam', 'maryam')).agent;
    b = (await inviteAndJoin(app, admin, 'Ibrahim', 'ibrahim')).agent;
  });

  test('the six parts cover pages 2-49 as 6,6,9,9,9,9 pages', async () => {
    const { parts } = (await a.get('/api/family/parts')).body;
    assert.deepEqual(parts.map((p) => [p.pageFrom, p.pageTo, p.pages]), [[2, 7, 6], [8, 13, 6], [14, 22, 9], [23, 31, 9], [32, 40, 9], [41, 49, 9]]);
    assert.equal(parts[0].from, 1);
    assert.equal(parts[5].to, 286);
    for (let i = 1; i < 6; i++) assert.equal(parts[i].from, parts[i - 1].to + 1, 'no gaps or overlaps');
    assert.ok(parts.every((p) => p.owner === null));
  });

  test('choosing a part sets today\'s portion to those pages; a part belongs to one person', async () => {
    assert.equal((await put(a, '/api/plan', { planType: 'pages', part: 2 })).status, 200);
    const p = (await a.get('/api/progress')).body;
    assert.deepEqual([p.portion.from, p.portion.to, p.portion.pageFrom, p.portion.pageTo, p.position], [49, 88, 8, 13, 49]);
    assert.equal((await a.get('/api/me')).body.stats.part, 2);
    const taken = await put(b, '/api/plan', { planType: 'pages', part: 2 });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'part_taken');
    assert.equal((await put(b, '/api/plan', { planType: 'pages', part: 7 })).body.error, 'bad_part');
    assert.equal((await put(a, '/api/plan', { planType: 'pages', part: 2 })).status, 200, 'keeping my own part is fine');
    const { parts } = (await b.get('/api/family/parts')).body;
    assert.equal(parts[1].owner.displayName, 'Maryam');
  });

  test('completing a part records exactly its verses and stays on the same part tomorrow', async () => {
    await put(a, '/api/progress', { verse: 60, seen: 70 });
    const r = await post(a, '/api/completions/today', {});
    assert.deepEqual([r.body.completion.from_verse, r.body.completion.to_verse], [49, 88]);
    setClock('2026-12-11T12:00:00Z');
    const p = (await a.get('/api/progress')).body;
    assert.deepEqual([p.portion.from, p.portion.to, p.position, p.portion.percent], [49, 88, 49, 0]);
  });

  test('dashboard shows pages read today and celebrates when the whole Surah is read together', async () => {
    // Admin takes parts 1 and 3-6 is not allowed (one part each), so use a "whole Surah" reader to fill the rest.
    await put(b, '/api/plan', { planType: 'pages', part: 1 });
    await post(a, '/api/completions/today', {});
    await post(b, '/api/completions/today', {});
    let d = (await admin.get('/api/family/dashboard')).body.shared;
    assert.deepEqual(d.pagesReadToday, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    assert.equal(d.wholeSurahToday, false);
    assert.equal(d.parts[0].owner.doneToday, true);
    assert.equal(d.parts[2].owner, null);
    await put(admin, '/api/plan', { planType: 'whole' });
    await put(admin, '/api/progress', { verse: 280, seen: 286 });
    await post(admin, '/api/completions/today', {});
    d = (await admin.get('/api/family/dashboard')).body.shared;
    assert.equal(d.pagesReadToday.length, 48);
    assert.equal(d.wholeSurahToday, true);
    assert.equal(d.wholeSurahDays, 1);
  });

  test('removing a member frees their part', async () => {
    const m = await inviteAndJoin(app, admin, 'Aisha', 'aisha');
    await put(m.agent, '/api/plan', { planType: 'pages', part: 4 });
    await del(admin, `/api/admin/members/${m.userId}`);
    assert.equal((await put(a, '/api/plan', { planType: 'pages', part: 4 })).status, 200);
  });

  test('reader layout preference (verse list or full page) is saved', async () => {
    assert.equal((await a.get('/api/me')).body.user.readerLayout, 'list');
    assert.equal((await patch(a, '/api/me', { readerLayout: 'page' })).status, 200);
    assert.equal((await a.get('/api/me')).body.user.readerLayout, 'page');
    assert.equal((await patch(a, '/api/me', { readerLayout: 'scroll' })).status, 400);
  });
});

describe('upgrading an existing database', () => {
  test('an older reading_plans table is rebuilt to allow family parts, keeping existing plans', async () => {
    const { createClient } = await import('@libsql/client');
    const file = path.join(TMP, 'old.db');
    const c = createClient({ url: `file:${file}` });
    await c.executeMultiple(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, login_name TEXT UNIQUE, pin_hash TEXT, avatar TEXT NOT NULL DEFAULT '',
        avatar_color TEXT NOT NULL DEFAULT 'green', locale TEXT NOT NULL DEFAULT 'en', timezone TEXT NOT NULL DEFAULT 'UTC', theme TEXT NOT NULL DEFAULT 'system',
        font_scale REAL NOT NULL DEFAULT 1.0, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL);
      CREATE TABLE reading_plans (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan_type TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','whole','verses','days')), verses_per_day INTEGER, days_total INTEGER, updated_at TEXT NOT NULL);
      INSERT INTO users (id, display_name, created_at) VALUES (1, 'Old', 'x');
      INSERT INTO reading_plans VALUES (1, 'verses', 15, NULL, 'x');`);
    c.close();
    const db = await openDb(`file:${file}`);
    assert.deepEqual(await db.get('SELECT plan_type, verses_per_day FROM reading_plans WHERE user_id = 1'), { plan_type: 'verses', verses_per_day: 15 });
    await db.run("UPDATE reading_plans SET plan_type = 'pages', page_from = 2, page_to = 7 WHERE user_id = 1");
    assert.equal((await db.get('SELECT reader_layout FROM users WHERE id = 1')).reader_layout, 'list');
    // Opening again is a no-op.
    await openDb(`file:${file}`);
  });
});
