// Offline integrity check: confirms data/al-baqarah.json has not been altered since it was fetched.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/al-baqarah.json', import.meta.url), 'utf8'));
const hash = createHash('sha256').update(data.verses.map((v) => v.text).join('\n'), 'utf8').digest('hex');
const ok = hash === data.sha256 && data.verses.length === 286 && data.verses.every((v, i) => v.n === i + 1);
console.log(ok ? `OK: 286 verses, sha256 ${hash}` : `FAILED: expected ${data.sha256}, got ${hash}`);
process.exit(ok ? 0 : 1);
