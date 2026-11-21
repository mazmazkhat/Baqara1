import { randomInt } from 'node:crypto';
import { openDb } from './db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const prod = process.env.NODE_ENV === 'production';

const dbUrl = (process.env.DATABASE_URL || '').trim();
if (dbUrl && !/^(libsql|https|wss?|file):/.test(dbUrl)) {
  console.error(`\n  DATABASE_URL looks wrong. It should start with libsql:// (copy it from your database page on turso.tech).\n  It currently starts with: "${dbUrl.slice(0, 12)}…"\n`);
  process.exit(1);
}
if (dbUrl.startsWith('libsql:') && !process.env.DATABASE_AUTH_TOKEN) {
  console.error('\n  DATABASE_AUTH_TOKEN is empty. Create a token on turso.tech (Create Token) and paste it into Render → Environment.\n');
  process.exit(1);
}
let db;
try {
  db = await openDb(dbUrl || undefined, (process.env.DATABASE_AUTH_TOKEN || '').trim() || undefined);
} catch (e) {
  console.error('\n  Could not connect to the database.');
  console.error('  Check DATABASE_URL and DATABASE_AUTH_TOKEN in Render → Environment (no spaces, token not expired).');
  console.error(`  Details: ${e.message}\n`);
  process.exit(1);
}
const needsSetup = (await db.get('SELECT COUNT(*) AS n FROM families')).n === 0;
// The first family can only be created with this one-time code, so a freshly deployed
// server cannot be claimed by a stranger. Set SETUP_CODE yourself or read it from the log.
const setupCode = needsSetup ? process.env.SETUP_CODE || String(randomInt(100000, 999999)) + String(randomInt(100000, 999999)) : null;

const app = createApp({ db, setupCode, secureCookies: prod || process.env.SECURE_COOKIES === '1', serveClient: true });
app.listen(PORT, () => {
  const where = (process.env.DATABASE_URL || 'file:var/baqara.db').replace(/\?.*$/, '');
  console.log(`Baqarah Together listening on port ${PORT} (database: ${where.startsWith('libsql:') ? 'Turso' : where})`);
  if (setupCode) console.log(`\n  First-time setup: open /setup and enter setup code ${setupCode}\n`);
});
