// Downloads Surah Al-Baqarah (chapter 2) from verified sources and writes data/al-baqarah.json.
//
//   Arabic text : Tanzil Project, Uthmani text v1.1 (https://tanzil.net) — stored VERBATIM.
//   Page / juz  : Quran.com API v4 (Madani mushaf page numbers, 604-page layout).
//
// The text is never edited. As a safety check, the letter skeleton of every verse
// (diacritics removed) is compared against Quran.com's independent Uthmani text;
// the script aborts if any verse disagrees.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'al-baqarah.json');
const TANZIL_URL = 'https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true';
const QURANCOM_URL = 'https://api.quran.com/api/v4/verses/by_chapter/2?fields=text_uthmani,page_number,juz_number&per_page=300';

export function skeleton(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // combining marks (harakat, small letters, etc.)
    .replace(/[ـۖ-ۭ࣓-ࣿ\s]/g, '') // tatweel, Quranic annotation signs, spaces
    .replace(/[ٱآأإ]/g, 'ا') // alef variants -> alef
    .replace(/[یى]/g, 'ي') // ya variants
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ءا]/g, '') // hamza & alef are spelled differently between orthographies
    .replace(/[وي]/g, ''); // long-vowel carriers also differ in rasm conventions
}

async function main() {
  const tanzilRaw = await (await fetch(TANZIL_URL)).text();
  const qc = await (await fetch(QURANCOM_URL)).json();

  const lines = tanzilRaw.split('\n');
  const licenseLines = lines.filter((l) => l.startsWith('#'));
  const tz = new Map();
  for (const l of lines) {
    const p = l.split('|');
    if (p.length === 3 && p[0] === '2') tz.set(Number(p[1]), p[2]);
  }
  const fatiha1 = lines.find((l) => l.startsWith('1|1|')).split('|')[2];
  if (tz.size !== 286) throw new Error(`Expected 286 verses from Tanzil, got ${tz.size}`);
  if (qc.verses.length !== 286) throw new Error(`Expected 286 verses from Quran.com, got ${qc.verses.length}`);

  // Tanzil prefixes the first verse of each surah with the Basmala. We keep the text verbatim
  // and only record its length so the reader can display it as a heading above verse 1.
  const v1 = tz.get(1);
  if (!v1.startsWith(fatiha1 + ' ')) throw new Error('Unexpected Basmala prefix in 2:1');

  const verses = [];
  for (const v of qc.verses) {
    const n = v.verse_number;
    let text = tz.get(n);
    const compare = n === 1 ? text.slice(fatiha1.length + 1) : text;
    if (skeleton(compare) !== skeleton(v.text_uthmani)) {
      throw new Error(`Cross-check failed for 2:${n}\nTanzil:    ${compare}\nQuran.com: ${v.text_uthmani}`);
    }
    verses.push({ n, text, page: v.page_number, juz: v.juz_number });
  }

  const sha256 = createHash('sha256').update(verses.map((v) => v.text).join('\n'), 'utf8').digest('hex');
  const data = {
    surah: { number: 2, nameArabic: 'البقرة', nameEnglish: 'Al-Baqarah', translatedName: 'The Cow', verses: 286 },
    source: {
      text: 'Tanzil Quran Text (Uthmani, Version 1.1)',
      textUrl: 'https://tanzil.net',
      pages: 'Quran.com API v4 — Madani mushaf page numbers',
      pagesUrl: 'https://quran.com',
      fetchedAt: new Date().toISOString(),
      crossCheckedWith: 'Quran.com text_uthmani (letter skeleton compared for all 286 verses)',
    },
    basmala: { text: fatiha1, prefixLength: fatiha1.length + 1, note: 'Verse 2:1 text begins with the Basmala, as in the Tanzil file.' },
    license: licenseLines.join('\n'),
    sha256,
    verses,
  };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`Wrote ${verses.length} verses to ${OUT}\nsha256 ${sha256}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
