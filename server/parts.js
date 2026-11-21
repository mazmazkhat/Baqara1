// Daily family parts: the family's shared goal is the whole of Al-Baqarah every day.
import { PARTS, partByNumber } from './quran.js';
import { localDate, addDays } from './time.js';
import { coverage } from './reading.js';

export const familyDate = (family, now) => localDate(family.timezone, now);

/** Today's six parts with who took each one and whether it has been read. */
export async function partsForDay(db, familyId, date) {
  const claims = await db.all(
    `SELECT c.part, c.user_id, c.done_at, u.display_name, u.avatar, u.avatar_color
       FROM part_claims c JOIN users u ON u.id = c.user_id WHERE c.family_id = ? AND c.local_date = ?`, familyId, date);
  return PARTS.map((p) => {
    const c = claims.find((x) => x.part === p.number);
    return {
      ...p,
      pages: p.pageTo - p.pageFrom + 1,
      claim: c ? { user: { id: c.user_id, displayName: c.display_name, avatar: c.avatar, avatarColor: c.avatar_color }, done: Boolean(c.done_at) } : null,
    };
  });
}

/** Ranges read on a family day: parts marked read plus any other completed reading. */
export async function rangesForDay(db, familyId, date) {
  const doneParts = await db.all('SELECT part FROM part_claims WHERE family_id = ? AND local_date = ? AND done_at IS NOT NULL', familyId, date);
  const completions = await db.all("SELECT from_verse, to_verse FROM daily_completions WHERE family_id = ? AND local_date = ? AND (prev_state IS NULL OR prev_state != 'part')", familyId, date);
  return [...doneParts.map((r) => ({ from_verse: partByNumber(r.part).from, to_verse: partByNumber(r.part).to })), ...completions];
}

/** Every family day on which the whole Surah was read together. */
export async function wholeSurahDates(db, familyId) {
  const parts = await db.all('SELECT local_date, part FROM part_claims WHERE family_id = ? AND done_at IS NOT NULL', familyId);
  const comps = await db.all("SELECT local_date, from_verse, to_verse FROM daily_completions WHERE family_id = ? AND (prev_state IS NULL OR prev_state != 'part')", familyId);
  const byDate = new Map();
  const add = (d, r) => (byDate.get(d) ?? byDate.set(d, []).get(d)).push(r);
  for (const r of parts) add(r.local_date, { from_verse: partByNumber(r.part).from, to_verse: partByNumber(r.part).to });
  for (const r of comps) add(r.local_date, r);
  return [...byDate.entries()].filter(([, rows]) => coverage(rows).wholeSurah).map(([d]) => d).sort();
}

/** Keep the member's daily completion (used for streaks) in step with the parts they have read today. */
export async function syncPartCompletion(db, user, familyId, memberDate, familyDay, nowIso) {
  const done = await db.all('SELECT part FROM part_claims WHERE user_id = ? AND local_date = ? AND done_at IS NOT NULL ORDER BY part', user.id, familyDay);
  const row = await db.get('SELECT id, prev_state FROM daily_completions WHERE user_id = ? AND local_date = ?', user.id, memberDate);
  if (done.length && !row) {
    const p = partByNumber(done[0].part);
    await db.run("INSERT INTO daily_completions (user_id, family_id, local_date, from_verse, to_verse, completed_at, prev_state) VALUES (?, ?, ?, ?, ?, ?, 'part')",
      user.id, familyId, memberDate, p.from, p.to, nowIso);
  } else if (!done.length && row?.prev_state === 'part') {
    await db.run('DELETE FROM daily_completions WHERE id = ?', row.id);
  }
}

export const yesterday = (date) => addDays(date, -1);
