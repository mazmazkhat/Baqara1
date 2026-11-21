// Creates a demo family with six sample members and ~6 weeks of gentle, realistic history.
// Usage: npm run seed:demo  (writes to DB_FILE, default var/baqara.db; refuses if a family exists unless --force)
// To use the app for your real family, simply start with an empty database and follow /setup instead.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { hashPin } from '../server/auth.js';
import { localDate, addDays } from '../server/time.js';

const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), 'var', 'baqara.db');
if (process.argv.includes('--force')) for (const s of ['', '-wal', '-shm']) if (existsSync(DB_FILE + s)) rmSync(DB_FILE + s);
const db = openDb(DB_FILE);
if (db.prepare('SELECT COUNT(*) AS n FROM families').get().n > 0) {
  console.error('A family already exists in this database. Use --force to replace it with demo data.');
  process.exit(1);
}

export const DEMO_MEMBERS = [
  { name: 'Yusuf', login: 'yusuf', role: 'admin', pin: '482915', tz: 'Europe/London', avatar: '🌳', color: 'green', plan: ['free'], rate: 0.9, pos: 212 },
  { name: 'Maryam', login: 'maryam', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '🌸', color: 'rose', plan: ['days', null, 30], rate: 0.95, pos: 96 },
  { name: 'Ibrahim', login: 'ibrahim', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '⭐', color: 'navy', plan: ['verses', 15], rate: 0.75, pos: 61 },
  { name: 'Aisha', login: 'aisha', role: 'member', pin: '2468', tz: 'Europe/London', avatar: '🌙', color: 'plum', plan: ['verses', 10], rate: 0.7, pos: 34 },
  { name: 'Grandma Zaynab', login: 'zaynab', role: 'member', pin: '2468', tz: 'Asia/Karachi', avatar: '🕊️', color: 'teal', plan: ['whole'], rate: 0.85, pos: 140 },
  { name: 'Uncle Omar', login: 'omar', role: 'member', pin: '2468', tz: 'America/Toronto', avatar: '', color: 'gold', plan: ['free'], rate: 0.6, pos: 18 },
];
const DONE_TODAY = new Set(['yusuf', 'maryam', 'zaynab', 'ibrahim']);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = new Date();
const iso = now.toISOString();

const fam = db.prepare("INSERT INTO families (name, timezone, created_at) VALUES ('The Rahman Family', 'Europe/London', ?)").run(iso);
const fid = Number(fam.lastInsertRowid);
const joined = new Date(now.getTime() - 42 * 86400000).toISOString();

DEMO_MEMBERS.forEach((m, i) => {
  const u = db.prepare('INSERT INTO users (display_name, login_name, pin_hash, avatar, avatar_color, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(m.name, m.login, hashPin(m.pin), m.avatar, m.color, m.tz, joined);
  const uid = Number(u.lastInsertRowid);
  db.prepare("INSERT INTO family_memberships (family_id, user_id, role, status, sort_order, joined_at) VALUES (?, ?, ?, 'active', ?, ?)").run(fid, uid, m.role, i, joined);
  const [type, vpd = null, days = null] = m.plan;
  db.prepare('INSERT INTO reading_plans (user_id, plan_type, verses_per_day, days_total, updated_at) VALUES (?, ?, ?, ?, ?)').run(uid, type, vpd, days, iso);

  const today = localDate(m.tz, now);
  let count = 0;
  for (let d = 41; d >= 0; d--) {
    const date = addDays(today, -d);
    const done = d === 0 ? DONE_TODAY.has(m.login) : rand() < m.rate;
    if (!done) continue;
    count++;
    const from = Math.max(1, (count * 9) % 286);
    db.prepare('INSERT INTO daily_completions (user_id, family_id, local_date, from_verse, to_verse, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, fid, date, from, Math.min(286, from + 12), new Date(now.getTime() - d * 86400000).toISOString());
  }
  const start = type === 'whole' ? 1 : Math.max(1, m.pos - 12);
  db.prepare('INSERT INTO reading_progress (user_id, current_verse, cycle_start_verse, furthest_verse, cycles_completed, total_verses_read, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid, DONE_TODAY.has(m.login) ? m.pos + 1 : start + 3, DONE_TODAY.has(m.login) ? m.pos + 1 : start, DONE_TODAY.has(m.login) ? m.pos : start + 3, type === 'whole' ? 3 : i === 0 ? 1 : 0, count * 14 + m.pos, iso);
});
db.prepare('INSERT INTO bookmarks (user_id, verse, created_at) SELECT id, 255, ? FROM users WHERE login_name = ?').run(iso, 'yusuf');
db.prepare('INSERT INTO bookmarks (user_id, verse, created_at) SELECT id, 286, ? FROM users WHERE login_name = ?').run(iso, 'yusuf');

console.log(`Demo family created in ${DB_FILE}`);
console.log('Sign in as  yusuf / 482915  (administrator)  or  maryam, ibrahim, aisha, zaynab, omar / 2468');
