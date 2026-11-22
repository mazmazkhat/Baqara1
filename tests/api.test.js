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
const pushed = []; // notifications "delivered" by the fake push sender in tests
async function makeApp() {
  const db = await openDb(`file:${path.join(TMP, `t${++dbCount}.db`)}`);
  const notify = { publicKey: 'test-public-key', cronKey: 'wake-key-123', send: async (sub, payload) => { pushed.push({ endpoint: sub.endpoint, ...payload }); return sub.endpoint.includes('gone') ? 'gone' : 'ok'; } };
  const app = createApp({ db, now: () => clock, setupCode: 'SETUP-123', notify });
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

describe('daily family parts (6-6-9-9-9-9 pages, chosen each day) and page view', () => {
  let app, admin, a, b;
  before(async () => {
    setClock('2026-12-10T12:00:00Z');
    ({ app } = await makeApp());
    admin = await setupFamily(app); // family time zone: Europe/London
    a = (await inviteAndJoin(app, admin, 'Maryam', 'maryam')).agent;
    b = (await inviteAndJoin(app, admin, 'Ibrahim', 'ibrahim', '2580', 'America/Los_Angeles')).agent;
  });

  test('six parts cover pages 2-49 as 6,6,9,9,9,9 pages and all start free', async () => {
    const r = (await a.get('/api/parts/today')).body;
    assert.equal(r.date, '2026-12-10');
    assert.deepEqual(r.parts.map((p) => [p.pageFrom, p.pageTo, p.pages]), [[2, 7, 6], [8, 13, 6], [14, 22, 9], [23, 31, 9], [32, 40, 9], [41, 49, 9]]);
    assert.equal(r.parts[0].from, 1);
    assert.equal(r.parts[5].to, 286);
    for (let i = 1; i < 6; i++) assert.equal(r.parts[i].from, r.parts[i - 1].to + 1, 'no gaps or overlaps');
    assert.ok(r.parts.every((p) => p.claim === null));
  });

  test('taking a part shows it as taken to everyone; nobody else can take it', async () => {
    const r = (await post(a, '/api/parts/2/claim', {})).body;
    assert.deepEqual(r.mine, [2]);
    const seen = (await b.get('/api/parts/today')).body;
    assert.equal(seen.parts[1].claim.user.displayName, 'Maryam');
    assert.equal(seen.parts[1].claim.done, false);
    const taken = await post(b, '/api/parts/2/claim', {});
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'part_taken');
    assert.equal((await post(b, '/api/parts/7/claim', {})).body.error, 'bad_part');
    // A member may take more than one part (e.g. when someone is away).
    assert.deepEqual((await post(b, '/api/parts/3/claim', {})).body.mine, [3]);
    assert.deepEqual((await post(b, '/api/parts/4/claim', {})).body.mine, [3, 4]);
  });

  test('giving a part back; others cannot release it, the administrator can', async () => {
    assert.equal((await del(a, '/api/parts/4/claim')).status, 403);
    assert.deepEqual((await del(b, '/api/parts/4/claim')).body.mine, [3]);
    await post(b, '/api/parts/4/claim', {});
    assert.equal((await del(admin, '/api/parts/4/claim')).status, 200);
    assert.equal((await b.get('/api/parts/today')).body.parts[3].claim, null);
  });

  test('marking a part read counts for streaks and the family coverage; undo works; a read part cannot be given back', async () => {
    assert.equal((await post(a, '/api/parts/3/done', {})).body.error, 'part_not_yours');
    const r = (await post(a, '/api/parts/2/done', {})).body;
    assert.deepEqual(r.pagesReadToday, [8, 9, 10, 11, 12, 13]);
    let me = (await a.get('/api/me')).body.stats;
    assert.equal(me.doneToday, true);
    assert.equal(me.streak, 1);
    assert.equal((await del(a, '/api/parts/2/claim')).body.error, 'part_done');
    await del(a, '/api/parts/2/done');
    me = (await a.get('/api/me')).body.stats;
    assert.equal(me.doneToday, false);
    await post(a, '/api/parts/2/done', {});
  });

  test('the whole Surah read together is celebrated on the dashboard', async () => {
    await post(b, '/api/parts/3/done', {});
    for (const n of [1, 4, 5, 6]) await post(admin, `/api/parts/${n}/claim`, {});
    let d = (await a.get('/api/family/dashboard')).body.shared;
    assert.equal(d.wholeSurahToday, false);
    assert.equal(d.parts[0].claim.user.displayName, 'Yusuf');
    for (const n of [1, 4, 5, 6]) await post(admin, `/api/parts/${n}/done`, {});
    d = (await a.get('/api/family/dashboard')).body.shared;
    assert.equal(d.pagesReadToday.length, 48);
    assert.equal(d.wholeSurahToday, true);
    assert.equal(d.wholeSurahDays, 1);
    assert.equal(d.wholeSurahStreak, 1);
  });

  test('parts are free again the next family day (family time zone), and yesterday\'s choice is remembered', async () => {
    setClock('2026-12-11T00:30:00Z'); // 00:30 in London: a new family day (still 10 Dec in Los Angeles)
    const r = (await a.get('/api/parts/today')).body;
    assert.equal(r.date, '2026-12-11');
    assert.ok(r.parts.every((p) => p.claim === null));
    assert.deepEqual(r.myYesterday, [2]);
    assert.equal((await post(a, '/api/parts/2/claim', {})).status, 200);
  });

  test('the old "mark today complete" cannot undo a part reading', async () => {
    setClock('2026-12-12T12:00:00Z');
    await post(b, '/api/parts/5/claim', {});
    await post(b, '/api/parts/5/done', {});
    assert.equal((await del(b, '/api/completions/today')).status, 404);
  });

  test('reader layout preference (verse list or full page) is saved', async () => {
    assert.equal((await a.get('/api/me')).body.user.readerLayout, 'list');
    assert.equal((await patch(a, '/api/me', { readerLayout: 'page' })).status, 200);
    assert.equal((await a.get('/api/me')).body.user.readerLayout, 'page');
    assert.equal((await patch(a, '/api/me', { readerLayout: 'scroll' })).status, 400);
  });

  test('removing a member deletes their part choices', async () => {
    const { db, app: a2 } = await makeApp();
    const adm = await setupFamily(a2);
    const m = await inviteAndJoin(a2, adm, 'Temp', 'tempuser');
    await post(m.agent, '/api/parts/1/claim', {});
    await del(adm, `/api/admin/members/${m.userId}`);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM part_claims')).n, 0);
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

describe('notifications (gentle reminders, set by the family administrator)', () => {
  let app, db, admin, maryam, ibrahim;
  const sub = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'BPk', auth: 'aa' } });
  const tick = (key = 'wake-key-123') => request(app).get(`/api/cron/tick?key=${key}`);
  const sentTo = (name) => pushed.filter((p) => p.endpoint.endsWith(`/${name}`));
  before(async () => {
    setClock('2026-12-14T10:00:00Z'); // Monday
    ({ app, db } = await makeApp());
    admin = await setupFamily(app); // Europe/London
    maryam = (await inviteAndJoin(app, admin, 'Maryam', 'maryam', '2580', 'Europe/London')).agent;
    ibrahim = (await inviteAndJoin(app, admin, 'Ibrahim', 'ibrahim', '2580', 'Asia/Riyadh')).agent;
  });

  test('devices subscribe; a test notification reaches them; no devices gives a clear error', async () => {
    assert.equal((await post(ibrahim, '/api/push/test', {})).body.error, 'no_devices');
    assert.equal((await post(maryam, '/api/push/subscribe', { endpoint: 'http://insecure', keys: {} })).status, 400);
    assert.equal((await post(maryam, '/api/push/subscribe', sub('maryam'))).status, 200);
    assert.equal((await post(ibrahim, '/api/push/subscribe', sub('ibrahim'))).status, 200);
    pushed.length = 0;
    assert.equal((await post(maryam, '/api/push/test', {})).body.delivered, 1);
    assert.equal(pushed[0].title, 'Notifications are on');
    assert.equal((await maryam.get('/api/push/key')).body.publicKey, 'test-public-key');
    assert.equal((await admin.get('/api/admin/reminders')).body.membersWithNotifications, 2);
  });

  test('members have no reminder settings; only the administrator changes them', async () => {
    assert.equal((await maryam.get('/api/reminders')).status, 404);
    assert.equal((await put(maryam, '/api/reminders/me', { enabled: false })).status, 404);
    assert.equal((await maryam.get('/api/admin/reminders')).status, 403);
    assert.equal((await put(maryam, '/api/admin/reminders', { time: '20:00' })).status, 403);
    assert.equal((await put(admin, '/api/admin/reminders', { time: '7pm' })).status, 400);
    assert.equal((await put(admin, '/api/admin/reminders', { quietDays: '9' })).status, 400);
  });

  test('the wake-up link needs the secret key', async () => {
    assert.equal((await tick('wrong')).status, 403);
    assert.equal((await request(app).get('/api/cron/tick')).status, 403);
    assert.equal((await tick()).status, 200);
    assert.match((await admin.get('/api/admin/wakeup')).body.url, /\/api\/cron\/tick\?key=wake-key-123$/);
  });

  test('daily reminder goes out at the family time in each person\'s own time zone, once', async () => {
    pushed.length = 0;
    setClock('2026-12-14T15:30:00Z'); // 15:30 London, 18:30 Riyadh: before 19:00 for both
    await tick();
    assert.equal(pushed.length, 0);
    setClock('2026-12-14T16:05:00Z'); // 19:05 in Riyadh
    await tick();
    assert.equal(sentTo('ibrahim').length, 1);
    assert.equal(sentTo('maryam').length, 0);
    assert.match(sentTo('ibrahim')[0].body, /It is time for today’s family Quran reading\. 0 of 6 parts taken · 0 of 48 pages read today\. Part 1 is still free\./);
    setClock('2026-12-14T19:02:00Z'); // 19:02 London
    await tick();
    await tick();
    assert.equal(sentTo('maryam').length, 1, 'never twice in a day');
    assert.equal(sentTo('ibrahim').length, 1);
  });

  test('no reminder for someone who has already read today', async () => {
    pushed.length = 0;
    setClock('2026-12-15T10:00:00Z');
    await post(maryam, '/api/parts/2/claim', {});
    await post(maryam, '/api/parts/2/done', {});
    setClock('2026-12-15T19:10:00Z');
    await tick();
    assert.equal(sentTo('maryam').length, 0);
  });

  test('family time, message, quiet days and switching reminders off apply to everyone', async () => {
    pushed.length = 0;
    await put(admin, '/api/admin/reminders', { time: '06:30', message: 'Time for our Baqarah reading 🌿', quietDays: '3' }); // Wednesday quiet
    setClock('2026-12-16T03:40:00Z'); // Wed 06:40 Riyadh
    await tick();
    assert.equal(sentTo('ibrahim').length, 0, 'quiet day');
    setClock('2026-12-17T03:40:00Z'); // Thu 06:40 Riyadh
    await tick();
    assert.equal(sentTo('ibrahim').length, 1, 'new family time');
    assert.match(sentTo('ibrahim')[0].body, /^Time for our Baqarah reading 🌿/);
    await put(admin, '/api/admin/reminders', { enabled: false });
    setClock('2026-12-18T03:40:00Z');
    await tick();
    assert.equal(sentTo('ibrahim').length, 1, 'switched off');
    await put(admin, '/api/admin/reminders', { enabled: true, time: '19:00', message: '', quietDays: '' });
    const r = (await admin.get('/api/admin/reminders')).body;
    assert.deepEqual([r.enabled, r.time, r.quietDays, r.followup, r.celebrate], [true, '19:00', '', false, true]);
  });

  test('a reminder is not sent more than 4 hours late (e.g. if the server was asleep)', async () => {
    pushed.length = 0;
    setClock('2026-12-19T20:30:00Z'); // 23:30 Riyadh: 4.5 h after 19:00
    await tick();
    assert.equal(sentTo('ibrahim').length, 0);
  });

  test('optional evening follow-up (family setting) only when a taken part is unread', async () => {
    pushed.length = 0;
    await put(admin, '/api/admin/reminders', { followup: true, followupTime: '21:30' });
    setClock('2026-12-20T10:00:00Z');
    await post(maryam, '/api/parts/4/claim', {});
    setClock('2026-12-20T19:00:00Z');
    await tick(); // daily
    setClock('2026-12-20T21:35:00Z');
    await tick(); // follow-up
    await tick();
    const m = sentTo('maryam');
    assert.deepEqual(m.map((x) => x.tag), ['daily', 'followup']);
    assert.match(m[1].body, /Part 4/);
    assert.equal(m[1].url, '/read?part=4');
    assert.equal(sentTo('ibrahim').filter((x) => x.tag === 'followup').length, 0, 'no part taken, no follow-up');
    await put(admin, '/api/admin/reminders', { followup: false });
  });

  test('celebration when the whole Surah is completed, once a day; the administrator can switch it off', async () => {
    pushed.length = 0;
    setClock('2026-12-21T10:00:00Z');
    for (const n of [1, 2, 3, 4, 5]) { await post(admin, `/api/parts/${n}/claim`, {}); await post(admin, `/api/parts/${n}/done`, {}); }
    assert.equal(pushed.length, 0);
    await post(maryam, '/api/parts/6/claim', {});
    await post(maryam, '/api/parts/6/done', {});
    assert.equal(sentTo('maryam').filter((x) => x.tag === 'whole').length, 1);
    assert.equal(sentTo('ibrahim').filter((x) => x.tag === 'whole').length, 1);
    await del(maryam, '/api/parts/6/done');
    await post(maryam, '/api/parts/6/done', {});
    assert.equal(sentTo('maryam').filter((x) => x.tag === 'whole').length, 1, 'only once a day');
    pushed.length = 0;
    await put(admin, '/api/admin/reminders', { celebrate: false });
    setClock('2026-12-22T10:00:00Z');
    for (const n of [1, 2, 3, 4, 5, 6]) { await post(admin, `/api/parts/${n}/claim`, {}); await post(admin, `/api/parts/${n}/done`, {}); }
    assert.equal(pushed.filter((x) => x.tag === 'whole').length, 0, 'switched off');
    await put(admin, '/api/admin/reminders', { celebrate: true });
  });

  test('Arabic speakers get Arabic reminders', async () => {
    pushed.length = 0;
    await patch(ibrahim, '/api/me', { locale: 'ar' });
    setClock('2026-12-23T16:10:00Z'); // 19:10 Riyadh
    await tick();
    assert.match(sentTo('ibrahim')[0].body, /حان وقت قراءة العائلة اليومية/);
    assert.match(sentTo('ibrahim')[0].body, /من ٦ أجزاء/);
  });

  test('expired devices are forgotten', async () => {
    await post(maryam, '/api/push/subscribe', sub('gone-phone'));
    await post(maryam, '/api/push/test', {});
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%gone%'")).n, 0);
  });
});

describe('web push delivery (real encryption, local stand-in push service)', () => {
  test('payload is encrypted and signed; an expired subscription is reported as gone', async () => {
    const https = await import('node:https');
    const crypto = await import('node:crypto');
    const { execFileSync } = await import('node:child_process');
    const keyFile = path.join(TMP, 'push.key');
    const certFile = path.join(TMP, 'push.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const { readFileSync } = await import('node:fs');
    const { webPushSender } = await import('../server/notify.js');
    const wp = await import('web-push');
    const got = [];
    const srv = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
      let n = 0;
      req.on('data', (c) => { n += c.length; });
      req.on('end', () => { got.push({ url: req.url, auth: req.headers.authorization, enc: req.headers['content-encoding'], ttl: req.headers.ttl, bytes: n }); res.writeHead(req.url.includes('expired') ? 410 : 201); res.end(); });
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const keys = wp.generateVAPIDKeys();
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const subKeys = { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    const agent = new https.Agent({ ca: readFileSync(certFile), keepAlive: false });
    const send = webPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.org', agent });
    assert.equal(await send({ endpoint: `https://localhost:${port}/push/abc`, keys: subKeys }, { title: 'Hi', body: 'x' }), 'ok');
    assert.equal(await send({ endpoint: `https://localhost:${port}/expired`, keys: subKeys }, { title: 'Hi' }), 'gone');
    agent.destroy();
    srv.closeAllConnections?.();
    srv.close();
    assert.match(got[0].auth, /^vapid t=.+, k=/);
    assert.equal(got[0].enc, 'aes128gcm');
    assert.equal(got[0].ttl, String(6 * 3600));
    assert.ok(got[0].bytes > 50, 'encrypted body sent');
  });
});
