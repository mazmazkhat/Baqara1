import { localDate, addDays, streak, daysBetween } from './time.js';

export const TOTAL_VERSES = 286;

export function getPlan(db, userId) {
  return (
    db.prepare('SELECT plan_type, verses_per_day, days_total FROM reading_plans WHERE user_id = ?').get(userId) ?? {
      plan_type: 'free', // continue from where I stopped, at my own pace
      verses_per_day: null,
      days_total: null,
    }
  );
}

export function portionSize(plan) {
  if (plan.plan_type === 'verses') return Math.max(1, Math.min(TOTAL_VERSES, plan.verses_per_day || 20));
  if (plan.plan_type === 'days') return Math.ceil(TOTAL_VERSES / Math.max(1, Math.min(365, plan.days_total || 7)));
  return TOTAL_VERSES;
}

export function getProgress(db, userId, nowIso) {
  let p = db.prepare('SELECT * FROM reading_progress WHERE user_id = ?').get(userId);
  if (!p) {
    db.prepare('INSERT INTO reading_progress (user_id, updated_at) VALUES (?, ?)').run(userId, nowIso);
    p = db.prepare('SELECT * FROM reading_progress WHERE user_id = ?').get(userId);
  }
  return p;
}

/** Autosave: `verse` is where the reader is now; `seen` is the furthest verse that appeared on screen. */
export function saveProgress(db, userId, verse, seen, nowIso) {
  const p = getProgress(db, userId, nowIso);
  const furthestCandidate = Math.max(verse, seen ?? verse);
  let furthest = p.furthest_verse;
  let total = p.total_verses_read;
  // Only count forward reading inside the current cycle.
  if (furthestCandidate > furthest && furthestCandidate >= p.cycle_start_verse) {
    const from = Math.max(furthest, p.cycle_start_verse - 1);
    total += furthestCandidate - from;
    furthest = furthestCandidate;
  }
  db.prepare('UPDATE reading_progress SET current_verse = ?, furthest_verse = ?, total_verses_read = ?, updated_at = ? WHERE user_id = ?').run(
    verse,
    furthest,
    total,
    nowIso,
    userId,
  );
}

export function todayPortion(plan, progress) {
  const from = progress.cycle_start_verse;
  const to = Math.min(TOTAL_VERSES, from + portionSize(plan) - 1);
  const reached = Math.min(to, Math.max(progress.furthest_verse, from - 1));
  const pct = Math.round(((reached - from + 1) / (to - from + 1)) * 100);
  return { from, to, percent: Math.max(0, Math.min(100, pct)) };
}

export function markComplete(db, user, familyId, now) {
  const nowIso = now.toISOString();
  const today = localDate(user.timezone, now);
  const existing = db.prepare('SELECT * FROM daily_completions WHERE user_id = ? AND local_date = ?').get(user.id, today);
  if (existing) return { already: true, completion: existing };

  const plan = getPlan(db, user.id);
  const p = getProgress(db, user.id, nowIso);
  const portion = todayPortion(plan, p);
  const toVerse = Math.max(portion.from, Math.min(TOTAL_VERSES, Math.max(p.furthest_verse, p.current_verse)));
  const finishedSurah = toVerse >= TOTAL_VERSES;
  const nextStart = plan.plan_type === 'whole' || finishedSurah ? 1 : toVerse + 1;
  const prev = JSON.stringify(p);

  db.prepare(
    'INSERT INTO daily_completions (user_id, family_id, local_date, from_verse, to_verse, completed_at, prev_state) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(user.id, familyId, today, portion.from, toVerse, nowIso, prev);
  db.prepare(
    `UPDATE reading_progress SET cycle_start_verse = ?, current_verse = ?, furthest_verse = ?,
       cycles_completed = cycles_completed + ?, updated_at = ? WHERE user_id = ?`,
  ).run(nextStart, nextStart, nextStart - 1, finishedSurah ? 1 : 0, nowIso, user.id);
  return { already: false, finishedSurah, completion: { local_date: today, from_verse: portion.from, to_verse: toVerse } };
}

export function undoComplete(db, user, now) {
  const today = localDate(user.timezone, now);
  const c = db.prepare('SELECT * FROM daily_completions WHERE user_id = ? AND local_date = ?').get(user.id, today);
  if (!c) return false;
  if (c.prev_state) {
    const s = JSON.parse(c.prev_state);
    db.prepare(
      `UPDATE reading_progress SET current_verse = ?, cycle_start_verse = ?, furthest_verse = ?, cycles_completed = ?,
         updated_at = ? WHERE user_id = ?`,
    ).run(s.current_verse, s.cycle_start_verse, s.furthest_verse, s.cycles_completed, now.toISOString(), user.id);
  }
  db.prepare('DELETE FROM daily_completions WHERE id = ?').run(c.id);
  return true;
}

export function completionDates(db, userId) {
  return new Set(db.prepare('SELECT local_date FROM daily_completions WHERE user_id = ?').all(userId).map((r) => r.local_date));
}

/** Personal summary used by Home, Read and History. */
export function personalStats(db, user, joinedAt, now) {
  const nowIso = now.toISOString();
  const today = localDate(user.timezone, now);
  const dates = completionDates(db, user.id);
  const plan = getPlan(db, user.id);
  const progress = getProgress(db, user.id, nowIso);
  const portion = todayPortion(plan, progress);

  // Gentle "days not marked" count for the last 30 days, never before the person joined.
  const joined = new Date(joinedAt);
  const joinedDate = joinedAt && !Number.isNaN(joined.getTime()) ? localDate(user.timezone, joined) : today;
  let notMarked = 0;
  for (let i = 1; i <= 30; i++) {
    const d = addDays(today, -i);
    if (daysBetween(joinedDate, d) < 0) break;
    if (!dates.has(d)) notMarked++;
  }

  return {
    today,
    doneToday: dates.has(today),
    plan,
    portion: dates.has(today) ? { ...portion, percent: 100 } : portion,
    position: progress.current_verse,
    surahPercent: Math.round((Math.max(0, progress.furthest_verse) / TOTAL_VERSES) * 100),
    versesRead: progress.total_verses_read,
    cyclesCompleted: progress.cycles_completed,
    streak: streak(dates, today),
    totalDays: dates.size,
    notMarkedLast30: notMarked,
  };
}
