import { localDate, addDays, streak, daysBetween } from './time.js';
import { verseRangeOfPages, FIRST_PAGE, LAST_PAGE } from './quran.js';

export const TOTAL_VERSES = 286;

export async function getPlan(db, userId) {
  return (
    (await db.get('SELECT plan_type, verses_per_day, days_total, page_from, page_to FROM reading_plans WHERE user_id = ?', userId)) ?? {
      plan_type: 'free', // continue from where I stopped, at my own pace
      verses_per_day: null,
      days_total: null,
      page_from: null,
      page_to: null,
    }
  );
}

export function portionSize(plan) {
  if (plan.plan_type === 'verses') return Math.max(1, Math.min(TOTAL_VERSES, plan.verses_per_day || 20));
  if (plan.plan_type === 'days') return Math.ceil(TOTAL_VERSES / Math.max(1, Math.min(365, plan.days_total || 7)));
  return TOTAL_VERSES;
}

export async function getProgress(db, userId, nowIso) {
  let p = await db.get('SELECT * FROM reading_progress WHERE user_id = ?', userId);
  if (!p) {
    await db.run('INSERT OR IGNORE INTO reading_progress (user_id, updated_at) VALUES (?, ?)', userId, nowIso);
    p = await db.get('SELECT * FROM reading_progress WHERE user_id = ?', userId);
  }
  return p;
}

/** Autosave: `verse` is where the reader is now; `seen` is the furthest verse that appeared on screen. */
export async function saveProgress(db, userId, verse, seen, nowIso) {
  const p = await getProgress(db, userId, nowIso);
  const furthestCandidate = Math.max(verse, seen ?? verse);
  let furthest = p.furthest_verse;
  let total = p.total_verses_read;
  // Only count forward reading inside the current cycle.
  if (furthestCandidate > furthest && furthestCandidate >= p.cycle_start_verse) {
    const from = Math.max(furthest, p.cycle_start_verse - 1);
    total += furthestCandidate - from;
    furthest = furthestCandidate;
  }
  await db.run('UPDATE reading_progress SET current_verse = ?, furthest_verse = ?, total_verses_read = ?, updated_at = ? WHERE user_id = ?',
    verse, furthest, total, nowIso, userId);
}

/** Where a plan's daily reading starts (used when a plan is chosen or a day is completed). */
export function planStartVerse(plan, currentVerse) {
  if (plan.plan_type === 'pages') return verseRangeOfPages(plan.page_from, plan.page_to).from;
  if (plan.plan_type === 'whole') return 1;
  return currentVerse;
}

export function todayPortion(plan, progress) {
  if (plan.plan_type === 'pages') {
    // My fixed part of the family's daily reading: the same pages every day.
    const { from, to } = verseRangeOfPages(plan.page_from, plan.page_to);
    const reached = Math.min(to, Math.max(progress.furthest_verse, from - 1));
    const pct = Math.round((Math.max(0, reached - from + 1) / (to - from + 1)) * 100);
    return { from, to, pageFrom: plan.page_from, pageTo: plan.page_to, percent: Math.max(0, Math.min(100, pct)) };
  }
  const from = progress.cycle_start_verse;
  const to = Math.min(TOTAL_VERSES, from + portionSize(plan) - 1);
  const reached = Math.min(to, Math.max(progress.furthest_verse, from - 1));
  const pct = Math.round(((reached - from + 1) / (to - from + 1)) * 100);
  return { from, to, percent: Math.max(0, Math.min(100, pct)) };
}

export async function markComplete(db, user, familyId, now) {
  const nowIso = now.toISOString();
  const today = localDate(user.timezone, now);
  const existing = await db.get('SELECT * FROM daily_completions WHERE user_id = ? AND local_date = ?', user.id, today);
  if (existing) return { already: true, completion: existing };

  const plan = await getPlan(db, user.id);
  const p = await getProgress(db, user.id, nowIso);
  const portion = todayPortion(plan, p);
  const isPart = plan.plan_type === 'pages';
  // A family part counts as read in full when marked; other plans record how far the reader got.
  const toVerse = isPart ? portion.to : Math.max(portion.from, Math.min(TOTAL_VERSES, Math.max(p.furthest_verse, p.current_verse)));
  const finishedSurah = !isPart && toVerse >= TOTAL_VERSES;
  const nextStart = isPart ? portion.from : plan.plan_type === 'whole' || finishedSurah ? 1 : toVerse + 1;

  await db.run(
    'INSERT INTO daily_completions (user_id, family_id, local_date, from_verse, to_verse, completed_at, prev_state) VALUES (?, ?, ?, ?, ?, ?, ?)',
    user.id, familyId, today, portion.from, toVerse, nowIso, JSON.stringify(p),
  );
  await db.run(
    `UPDATE reading_progress SET cycle_start_verse = ?, current_verse = ?, furthest_verse = ?,
       cycles_completed = cycles_completed + ?, updated_at = ? WHERE user_id = ?`,
    nextStart, nextStart, nextStart - 1, finishedSurah ? 1 : 0, nowIso, user.id,
  );
  return { already: false, finishedSurah, completion: { local_date: today, from_verse: portion.from, to_verse: toVerse } };
}

export async function undoComplete(db, user, now) {
  const today = localDate(user.timezone, now);
  const c = await db.get('SELECT * FROM daily_completions WHERE user_id = ? AND local_date = ?', user.id, today);
  if (!c || c.prev_state === 'part') return false; // part readings are undone from the part itself
  if (c.prev_state) {
    const s = JSON.parse(c.prev_state);
    await db.run(
      `UPDATE reading_progress SET current_verse = ?, cycle_start_verse = ?, furthest_verse = ?, cycles_completed = ?,
         updated_at = ? WHERE user_id = ?`,
      s.current_verse, s.cycle_start_verse, s.furthest_verse, s.cycles_completed, now.toISOString(), user.id,
    );
  }
  await db.run('DELETE FROM daily_completions WHERE id = ?', c.id);
  return true;
}

export async function completionDates(db, userId) {
  return new Set((await db.all('SELECT local_date FROM daily_completions WHERE user_id = ?', userId)).map((r) => r.local_date));
}

/** Personal summary used by Home, Read, History and the family dashboard. */
export async function personalStats(db, user, joinedAt, now) {
  const nowIso = now.toISOString();
  const today = localDate(user.timezone, now);
  const [dates, plan, progress] = await Promise.all([completionDates(db, user.id), getPlan(db, user.id), getProgress(db, user.id, nowIso)]);
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

/** Which pages a set of completions covers (a page counts when every verse on it was read). */
export function coverage(completions) {
  const read = new Uint8Array(TOTAL_VERSES + 2);
  for (const c of completions) for (let v = c.from_verse; v <= c.to_verse; v++) read[v] = 1;
  const pagesRead = [];
  for (let p = FIRST_PAGE; p <= LAST_PAGE; p++) {
    const { from, to } = verseRangeOfPages(p, p);
    let all = true;
    for (let v = from; v <= to; v++) if (!read[v]) { all = false; break; }
    if (all) pagesRead.push(p);
  }
  return { pagesRead, wholeSurah: pagesRead.length === LAST_PAGE - FIRST_PAGE + 1 };
}
