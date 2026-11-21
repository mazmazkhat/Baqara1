import { randomInt } from 'node:crypto';
import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), 'var', 'baqara.db');
const prod = process.env.NODE_ENV === 'production';

const db = openDb(DB_FILE);
const needsSetup = db.prepare('SELECT COUNT(*) AS n FROM families').get().n === 0;
// The first family can only be created with this one-time code, so a freshly deployed
// server cannot be claimed by a stranger. Set SETUP_CODE yourself or read it from the log.
const setupCode = needsSetup ? process.env.SETUP_CODE || String(randomInt(100000, 999999)) + String(randomInt(100000, 999999)) : null;

const app = createApp({ db, setupCode, secureCookies: prod || process.env.SECURE_COOKIES === '1', serveClient: true });
app.listen(PORT, () => {
  console.log(`Baqara Family listening on http://localhost:${PORT}`);
  if (setupCode) console.log(`\n  First-time setup: open /setup and enter setup code ${setupCode}\n`);
});
