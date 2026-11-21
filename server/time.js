// Time-zone helpers. All "which day is it?" questions are answered in the person's own IANA zone.

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (YYYY-MM-DD) of instant `date` in time zone `tz`. */
export function localDate(tz, date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Add n days to a YYYY-MM-DD date string (pure calendar arithmetic, DST-safe). */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Current streak: consecutive completed days ending today, or yesterday if today is not yet done. */
export function streak(dateSet, today) {
  let day = dateSet.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (dateSet.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
