// Creates a demo family with six sample members and ~6 weeks of gentle, realistic history.
// Usage: npm run seed:demo  (writes to DATABASE_URL, default file:var/baqara.db; refuses if a family exists unless --force)
// To use the app for your real family, simply start with an empty database and follow /setup instead.
import { existsSync, rmSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { hashPin } from '../server/auth.js';
import { localDate, addDays } from '../server/time.js';
import { PARTS } from '../server/quran.js';

const URL_ = process.env.DATABASE_URL || 'file:var/baqara.db';
if (!URL_.startsWith('file:')) {
  console.error('Demo data can only be written to a local file database, never to a hosted (Turso) database.');
  process.exit(1);
}
const force = process.argv.includes('--force');
if (force && URL_.startsWith('file:')) for (const s of ['', '-wal', '-shm']) if (existsSync(URL_.slice(5) + s)) rmSync(URL_.slice(5) + s);
const db = await openDb(URL_);
if ((await db.get('SELECT COUNT(*) AS n FROM families')).n > 0) {
  console.error('A family already exists in this database. Use --force to replace it with demo data.');
  process.exit(1);
}

export const DEMO_MEMBERS = [
  { name: 'Yusuf', login: 'yusuf', role: 'admin', pin: '482915', tz: 'Europe/London', avatar: '🌳', color: 'green', rate: 0.95 },
  { name: 'Maryam', login: 'maryam', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '🌸', color: 'rose', rate: 0.95 },
  { name: 'Ibrahim', login: 'ibrahim', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '⭐', color: 'navy', rate: 0.9 },
  { name: 'Aisha', login: 'aisha', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '🌙', color: 'plum', rate: 0.85 },
  { name: 'Grandma Zaynab', login: 'zaynab', role: 'member', pin: '2468', tz: 'Asia/Karachi', avatar: '🕊️', color: 'teal', rate: 0.95 },
  { name: 'Uncle Omar', login: 'omar', role: 'member', pin: '2468', tz: 'America/Toronto', avatar: '', color: 'gold', rate: 0.8 },
];
const DONE_TODAY = new Set(['yusuf', 'maryam', 'zaynab', 'ibrahim']);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = new Date();
const iso = now.toISOString();

const fam = await db.run("INSERT INTO families (name, timezone, created_at) VALUES ('The Rahman Family', 'Europe/London', ?)", iso);
const fid = fam.lastInsertRowid;
const joined = new Date(now.getTime() - 42 * 86400000).toISOString();

for (const [i, m] of DEMO_MEMBERS.entries()) {
  const u = await db.run('INSERT INTO users (display_name, login_name, pin_hash, avatar, avatar_color, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    m.name, m.login, hashPin(m.pin), m.avatar, m.color, m.tz, joined);
  const uid = u.lastInsertRowid;
  await db.run("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order, joined_at) VALUES (?, ?, ?, 'active', ?, ?)", fid, uid, m.role, i, joined);
  // Each demo member reads one of the six fixed parts of the family's daily reading.
  const part = PARTS[i];
  await db.run("INSERT INTO reading_plans (user_id, plan_type, page_from, page_to, updated_at) VALUES (?, 'pages', ?, ?, ?)", uid, part.pageFrom, part.pageTo, iso);

  const today = localDate(m.tz, now);
  let count = 0;
  for (let d = 41; d >= 0; d--) {
    const date = addDays(today, -d);
    const done = d === 0 ? DONE_TODAY.has(m.login) : rand() < m.rate;
    if (!done) continue;
    count++;
    await db.run('INSERT INTO daily_completions (user_id, family_id, local_date, from_verse, to_verse, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid, fid, date, part.from, part.to, new Date(now.getTime() - d * 86400000).toISOString());
  }
  const doneToday = DONE_TODAY.has(m.login);
  const current = doneToday ? part.from : Math.min(part.to, part.from + 4);
  await db.run('INSERT INTO reading_progress (user_id, current_verse, cycle_start_verse, furthest_verse, cycles_completed, total_verses_read, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uid, current, part.from, doneToday ? part.from - 1 : current + 2, 0, count * (part.to - part.from + 1), iso);
}
await db.run('INSERT INTO bookmarks (user_id, verse, created_at) SELECT id, 255, ? FROM users WHERE login_name = ?', iso, 'yusuf');
await db.run('INSERT INTO bookmarks (user_id, verse, created_at) SELECT id, 286, ? FROM users WHERE login_name = ?', iso, 'yusuf');
db.close();

console.log(`Demo family created in ${URL_}`);
console.log('Sign in as  yusuf / 482915  (administrator)  or  maryam, ibrahim, aisha, zaynab, omar / 2468');
