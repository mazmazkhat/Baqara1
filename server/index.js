import { randomInt } from 'node:crypto';
import { openDb, cleanSetting } from './db.js';
import { createApp } from './app.js';
import { diagnoseTurso } from './turso-diagnose.js';
import { ensureNotifyKeys, webPushSender, runReminders } from './notify.js';

const PORT = Number(process.env.PORT || 3000);
const prod = process.env.NODE_ENV === 'production';

const dbUrl = cleanSetting(process.env.DATABASE_URL || '') || '';
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
  console.error(`  Details: ${e.message}`);
  if (e.cause) console.error(`  Cause: ${e.cause.message || e.cause}`);
  console.error(`  Database host: ${dbUrl.replace(/^\w+:\/\//, '').split(/[/?]/)[0]}\n`);
  if (dbUrl && !dbUrl.startsWith('file:')) await diagnoseTurso(dbUrl, cleanSetting(process.env.DATABASE_AUTH_TOKEN || ''));
  process.exit(1);
}
const needsSetup = (await db.get('SELECT COUNT(*) AS n FROM families')).n === 0;
// The first family can only be created with this one-time code, so a freshly deployed
// server cannot be claimed by a stranger. Set SETUP_CODE yourself or read it from the log.
const setupCode = needsSetup ? process.env.SETUP_CODE || String(randomInt(100000, 999999)) + String(randomInt(100000, 999999)) : null;

// Push notifications: keys are created once and stored in the database.
const keys = await ensureNotifyKeys(db);
const subject = process.env.VAPID_SUBJECT || process.env.RENDER_EXTERNAL_URL || 'mailto:family-reading@example.org';
const notify = { ...keys, send: webPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject }) };

const app = createApp({ db, setupCode, secureCookies: prod || process.env.SECURE_COOKIES === '1', serveClient: true, notify });

// While the server is awake, check for due reminders every minute. (On a free host that sleeps,
// an outside wake-up service calls /api/cron/tick every 15 minutes — see Settings → Family administration.)
let running = false;
setInterval(() => {
  if (running) return;
  running = true;
  runReminders(db, notify.send, new Date()).catch((e) => console.error('reminders', e.message)).finally(() => { running = false; });
}, 60_000).unref();
app.listen(PORT, () => {
  const where = (process.env.DATABASE_URL || 'file:var/baqara.db').replace(/\?.*$/, '');
  console.log(`Baqarah Together listening on port ${PORT} (database: ${where.startsWith('libsql:') ? 'Turso' : where})`);
  if (setupCode) console.log(`\n  First-time setup: open /setup and enter setup code ${setupCode}\n`);
});
