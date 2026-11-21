// The verified Quran text plus page lookups (Madani mushaf: Al-Baqarah spans pages 2-49).
import { readFileSync } from 'node:fs';

export const QURAN = JSON.parse(readFileSync(new URL('../data/al-baqarah.json', import.meta.url), 'utf8'));
export const FIRST_PAGE = QURAN.verses[0].page;
export const LAST_PAGE = QURAN.verses.at(-1).page;
export const PAGE_COUNT = LAST_PAGE - FIRST_PAGE + 1;

const first = new Map();
const last = new Map();
for (const v of QURAN.verses) {
  if (!first.has(v.page)) first.set(v.page, v.n);
  last.set(v.page, v.n);
}
/** First and last verse of a page (a verse belongs to the page it starts on). */
export const pageFirstVerse = (p) => first.get(p);
export const pageLastVerse = (p) => last.get(p);
export const verseRangeOfPages = (from, to) => ({ from: first.get(from), to: last.get(to) });
export const isValidPage = (p) => Number.isInteger(p) && p >= FIRST_PAGE && p <= LAST_PAGE;

/** The family's fixed daily split of Al-Baqarah: 6-6-9-9-9-9 pages (48 pages, one part per person). */
export const PART_SIZES = [6, 6, 9, 9, 9, 9];
export const PARTS = (() => {
  let p = FIRST_PAGE;
  return PART_SIZES.map((size, i) => {
    const part = { number: i + 1, pageFrom: p, pageTo: p + size - 1, ...verseRangeOfPages(p, p + size - 1) };
    p += size;
    return part;
  });
})();
if (PARTS.at(-1).pageTo !== LAST_PAGE) throw new Error('Family parts do not cover the whole Surah');
export const partByNumber = (n) => PARTS.find((p) => p.number === n);
export const partOfPlan = (plan) => (plan?.plan_type === 'pages' ? PARTS.find((p) => p.pageFrom === plan.page_from && p.pageTo === plan.page_to) ?? null : null);
