import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const H = { 'X-Requested-With': 'baqara' };
let clock = new Date('2026-11-21T10:00:00Z');
const setClock = (iso) => { clock = new Date(iso); };

function makeApp() {
  const db = openDb(':memory:');
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
  const { app } = makeApp();

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
  const { app } = makeApp();
  let admin;
  before(async () => { setClock('2026-11-21T10:00:00Z'); admin = await setupFamily(app); });

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
  const { app } = makeApp();
  let adminA, member, adminB, memberB;
  before(async () => {
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
    const { db, app: app2 } = makeApp();
    adminA = await setupFamily(app2, 'Family A', 'adama');
    const mA = await inviteAndJoin(app2, adminA, 'Maryam', 'maryama');
    const { hashPin } = await import('../server/auth.js');
    const f = db.prepare("INSERT INTO families (name, timezone, created_at) VALUES ('Family B', 'UTC', 'x')").run();
    const u = db.prepare("INSERT INTO users (display_name, login_name, pin_hash, created_at) VALUES ('Bilal', 'bilal', ?, 'x')").run(hashPin('482915'));
    db.prepare("INSERT INTO family_memberships (family_id, user_id, role, status, joined_at) VALUES (?, ?, 'admin', 'active', 'x')").run(f.lastInsertRowid, u.lastInsertRowid);
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

  test('the only administrator cannot delete their own account', async () => {
    assert.equal((await del(adminA, '/api/me', { pin: '482915' })).body.error, 'last_admin');
  });
});

describe('reading progress, completion and time zones', () => {
  const { app } = makeApp();
  let admin, maryam, ibrahim;
  before(async () => {
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

  test('malformed JSON gets a clean 400', async () => {
    const r = await maryam.put('/api/progress').set(H).set('Content-Type', 'application/json').send('{bad');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_json');
  });
});
