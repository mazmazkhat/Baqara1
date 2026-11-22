// End-to-end tests in a real browser (Chromium via Playwright) at phone size.
// Requires `npm run build` first. Run with: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const QURAN = JSON.parse(readFileSync(new URL('../data/al-baqarah.json', import.meta.url), 'utf8'));

let server, browser, base, dir;
const pushedE2E = [];
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'baqara-e2e-'));
  const dbFile = path.join(dir, 'e2e.db');
  execFileSync(process.execPath, ['scripts/seed-demo.js'], { env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdio: 'ignore' });
  const notify = { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', cronKey: 'e2e-key', send: async (sub, payload) => { pushedE2E.push({ sub, payload }); return 'ok'; } };
  const app = createApp({ db: await openDb(`file:${dbFile}`), serveClient: true, notify });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); rmSync(dir, { recursive: true, force: true }); });

async function phone() {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}
async function signIn(page, login, pin) {
  await page.goto(base + '/');
  await page.fill('input[name=loginName]', login);
  await page.fill('#pin', pin);
  await page.click('button.primary');
  await page.waitForSelector('.tabbar');
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('signed-out visitors only see the sign-in page', async () => {
  const page = await phone();
  for (const p of ['/', '/read', '/family', '/settings']) {
    await page.goto(base + p);
    await page.waitForSelector('input[name=loginName]');
    assert.equal(await page.locator('.tabbar').count(), 0, p);
  }
  await page.fill('input[name=loginName]', 'yusuf');
  await page.fill('#pin', '000001');
  await page.click('button.primary');
  await page.waitForSelector('[role=alert]');
  assert.match(await page.textContent('[role=alert]'), /not right/);
  await page.context().close();
});

test('reader shows all 286 verses exactly as in the verified source', async () => {
  const page = await phone();
  await signIn(page, 'aisha', '2468');
  await page.click('nav >> text=Read');
  await page.waitForSelector('#v-286');
  const texts = await page.$$eval('.ayah .text', (els) => els.map((e) => e.textContent));
  assert.equal(texts.length, 286);
  const prefix = QURAN.basmala.prefixLength;
  QURAN.verses.forEach((v, i) => assert.equal(texts[i], v.n === 1 ? v.text.slice(prefix) : v.text, `verse ${v.n}`));
  assert.equal(await page.textContent('.basmala'), QURAN.basmala.text);
  assert.equal(await page.textContent('#v-255 .num'), '۝٢٥٥');
  // Arabic font loaded and right-to-left direction.
  assert.equal(await page.evaluate(() => document.fonts.check('30px "Amiri Quran"', 'بِسْمِ')), true);
  assert.equal(await page.$eval('.quran', (e) => getComputedStyle(e).direction), 'rtl');
  assert.match(await page.textContent('.attribution'), /Tanzil/);
  assert.ok(await noHorizontalScroll(page));
  await page.context().close();
});

test('reading position autosaves and "continue" resumes there after reload', async () => {
  const page = await phone();
  await signIn(page, 'omar', '2468');
  await page.click('nav >> text=Read');
  await page.waitForSelector('#v-120');
  await page.waitForTimeout(1000);
  await page.$eval('#v-120', (e) => e.scrollIntoView({ block: 'start' }));
  await page.mouse.wheel(0, 10);
  await page.waitForTimeout(2500); // debounce
  await page.goto(base + '/');
  const btn = await page.textContent('a.btn.primary');
  const v = Number(btn.match(/\d+/)[0]);
  assert.ok(v >= 118 && v <= 122, `continue button says ${btn}`);
  await page.click('a.btn.primary');
  await page.waitForSelector('text=Continued from verse');
  const top = await page.$eval(`#v-${v}`, (e) => e.getBoundingClientRect().top);
  assert.ok(top > 0 && top < 300, `verse ${v} near top (${top})`);
  await page.context().close();
});

test('bookmarking a verse', async () => {
  const page = await phone();
  await signIn(page, 'aisha', '2468');
  await page.click('nav >> text=Read');
  await page.waitForSelector('#v-3');
  await page.waitForTimeout(1000);
  await page.click('#v-3');
  await page.click('.verse-actions >> text=Bookmark');
  await page.waitForSelector('#v-3 .bm');
  await page.click('nav >> text=History');
  await page.waitForSelector('text=Verse 3');
  await page.context().close();
});

test('marking my part as read updates the family goal and dashboard', async () => {
  const page = await phone();
  await signIn(page, 'aisha', '2468'); // took part 4 today, not read yet
  await page.waitForSelector('text=4 of 6 have read today');
  const before = await page.textContent('#goal-h ~ .row');
  const row = page.locator('.part-row[data-part="4"]');
  await row.locator('button:has-text("Mark as read")').click();
  await page.waitForSelector('text=5 of 6 have read today');
  assert.notEqual(await page.textContent('#goal-h ~ .row'), before, 'pages read today went up');
  await page.click('nav >> text=Family');
  await page.waitForSelector('.member');
  assert.match(await page.locator('.member', { hasText: 'Aisha' }).textContent(), /Read today/);
  // Undo returns to the earlier state.
  await page.click('nav >> text=Home');
  await page.locator('.part-row[data-part="4"] button:has-text("Undo")').click();
  await page.waitForSelector('.part-row[data-part="4"] button:has-text("Mark as read")');
  await page.context().close();
});

test('taking a part on Home shows it as taken to the rest of the family', async () => {
  const omar = await phone();
  await signIn(omar, 'omar', '2468'); // part 6 is still free today
  const row = omar.locator('.part-row[data-part="6"]');
  await row.locator('button:has-text("Take")').click();
  await omar.waitForSelector('.part-row[data-part="6"] >> text=Uncle Omar (you)');
  const maryam = await phone();
  await signIn(maryam, 'maryam', '2468');
  const seen = maryam.locator('.part-row[data-part="6"]');
  await seen.waitFor();
  assert.match(await seen.textContent(), /Uncle Omar/);
  assert.equal(await seen.locator('button:has-text("Take")').count(), 0, 'cannot take a part someone else has');
  // Give it back: it is free again for everyone.
  await row.locator('button:has-text("Give back")').click();
  await omar.waitForSelector('.part-row[data-part="6"] button:has-text("Take")');
  await Promise.all([omar.context().close(), maryam.context().close()]);
});

test('members do not see family administration', async () => {
  const page = await phone();
  await signIn(page, 'maryam', '2468');
  await page.click('nav >> text=Settings');
  await page.waitForSelector('text=Reading pace');
  assert.equal(await page.locator('text=Family administration').count(), 0);
  const r = await page.evaluate(() => fetch('/api/admin/members').then((x) => x.status));
  assert.equal(r, 403);
  await page.context().close();
});

test('administrator removes a member, invites a new one, and they join from the link', async () => {
  const admin = await phone();
  admin.on('dialog', (d) => d.accept());
  await signIn(admin, 'yusuf', '482915');
  await admin.click('nav >> text=Settings');
  await admin.waitForSelector('text=6 of 6 members');
  await admin.locator('.member', { hasText: 'Uncle Omar' }).locator('text=Remove').click();
  await admin.waitForSelector('text=5 of 6 members');
  await admin.fill('input[placeholder="Their name"]', 'Khalid');
  await admin.click('text=Create invite link');
  const link = await admin.inputValue('input[aria-label="Invite link"]');
  assert.match(link, /\/invite\/[\w-]{20,}$/);

  const newcomer = await phone();
  await newcomer.goto(link);
  await newcomer.waitForSelector('text=Assalamu alaikum, Khalid');
  await newcomer.fill('input[autocomplete=username]', 'khalid');
  const pins = newcomer.locator('input.pin');
  await pins.nth(0).fill('3579');
  await pins.nth(1).fill('3579');
  await newcomer.click('text=Join the family');
  await newcomer.waitForSelector('text=Assalamu alaikum, Khalid');
  await newcomer.waitForSelector('.tabbar');
  // The newcomer takes today's free part straight from Home.
  await newcomer.waitForSelector('text=Today’s family goal');
  await newcomer.locator('.part-row[data-part="6"] button:has-text("Take")').click();
  await newcomer.waitForSelector('.part-row[data-part="6"] >> text=Khalid (you)');
  // Link cannot be reused.
  const again = await phone();
  await again.goto(link);
  await again.waitForSelector('text=This link can’t be used');
  await Promise.all([admin.context().close(), newcomer.context().close(), again.context().close()]);
});

test('Arabic interface switches to right-to-left, and dark mode applies', async () => {
  const page = await phone();
  await signIn(page, 'zaynab', '2468');
  await page.click('nav >> text=Settings');
  await page.click('button:has-text("العربية")');
  await page.waitForSelector('text=الإعدادات');
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  await page.click('button:has-text("داكن")');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(15, 25, 21)');
  for (const p of ['/', '/read', '/family', '/history', '/settings']) {
    await page.goto(base + p);
    await page.waitForSelector('.tabbar');
    await page.waitForTimeout(300);
    assert.ok(await noHorizontalScroll(page), `no sideways scroll on ${p} (Arabic)`);
  }
  await page.click('nav >> text=الإعدادات');
  await page.click('button:has-text("English")');
  await page.click('button:has-text("Match my phone")');
  await page.context().close();
});

test('every page fits phone, tablet and desktop widths without errors', async () => {
  for (const vp of [{ width: 320, height: 640 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, 'yusuf', '482915');
    for (const p of ['/', '/read', '/family', '/history', '/settings']) {
      await page.goto(base + p);
      await page.waitForSelector('.tabbar');
      await page.waitForTimeout(300);
      assert.ok(await noHorizontalScroll(page), `${p} at ${vp.width}px`);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('family page shows the six parts and the pages read today', async () => {
  const page = await phone();
  await signIn(page, 'maryam', '2468');
  await page.click('nav >> text=Family');
  await page.waitForSelector('text=Today’s shared reading');
  assert.equal(await page.locator('.part-row').count(), 6);
  assert.equal(await page.locator('.pages-strip i').count(), 48);
  const read = await page.locator('.pages-strip i.read').count();
  const txt = await page.textContent('#shared-h + p');
  assert.ok(txt.includes(`${read} of 48 pages read today`) || txt.includes('completed Surah Al-Baqarah'), txt);
  assert.match(await page.locator('.part-row').nth(1).textContent(), /Part 2.*Pages 8–13.*Maryam/);
  await page.context().close();
});

test('full page view fills the screen without scrolling, turns pages, and is remembered', async () => {
  const page = await phone();
  await signIn(page, 'ibrahim', '2468'); // took part 3 today: pages 14-22
  await page.locator('.part-row[data-part="3"] a:has-text("Read")').click();
  await page.waitForSelector('.ayah');
  await page.click('button[aria-label="Full page view"]');
  await page.waitForSelector('.mushaf-page');
  const pageNo = async () => Number((await page.textContent('.page-screen .reader-tools .small')).match(/Page (\d+)/)[1]);
  const fits = async () => page.evaluate(() => {
    const t = document.querySelector('.mushaf-text');
    const doc = document.scrollingElement;
    return { text: t.scrollHeight <= t.clientHeight + 1, doc: doc.scrollHeight <= window.innerHeight + 1, font: parseFloat(t.style.fontSize) };
  });
  assert.equal(await pageNo(), 14, 'opens at the start of my part');
  assert.match(await page.textContent('.mushaf-head'), /Your part/);
  await page.waitForTimeout(300);
  let f = await fits();
  assert.ok(f.text && f.doc, `page 14 fits the screen ${JSON.stringify(f)}`);
  assert.ok(f.font >= 14, `text stays readable (${f.font}px)`);
  const check = async (p) => {
    const texts = await page.$$eval('.mushaf-text .ayah-inline .text', (els) => els.map((e) => e.textContent));
    const expected = QURAN.verses.filter((v) => v.page === p).map((v) => v.text);
    assert.deepEqual(texts, expected, `page ${p} text is exact`);
  };
  await check(14);
  await page.click('button[aria-label="Next page"]');
  await page.waitForFunction(() => document.querySelector('.page-screen .reader-tools .small').textContent.includes('Page 15'));
  await check(15);
  // Swipe towards the right = next page (like an Arabic book).
  await page.evaluate(() => {
    const el = document.querySelector('.mushaf-page');
    const mk = (type, x) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 }); return new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }); };
    el.dispatchEvent(mk('touchstart', 60)); el.dispatchEvent(mk('touchend', 300));
  });
  await page.waitForFunction(() => document.querySelector('.page-screen .reader-tools .small').textContent.includes('Page 16'));
  await page.waitForTimeout(300);
  f = await fits();
  assert.ok(f.text && f.doc, `page 16 fits ${JSON.stringify(f)}`);
  await page.waitForTimeout(2500); // autosave
  await page.goto(base + '/read');
  await page.waitForSelector('.mushaf-page');
  assert.equal(await pageNo(), 16, 'reopens on the same page in page view');
  // Page 2 shows the Surah heading and Basmala, and still fits.
  await page.click('button[aria-label="Bookmarks"]');
  await page.fill('input[name=v]', '1');
  await page.click('.verse-actions button:has-text("Go")');
  await page.waitForSelector('.mushaf-opening .basmala');
  await page.click('.verse-actions button:has-text("Close")');
  assert.equal(await page.textContent('#v-1 .text'), QURAN.verses[0].text.slice(QURAN.basmala.prefixLength));
  await page.waitForTimeout(300);
  f = await fits();
  assert.ok(f.text && f.doc, `page 2 fits ${JSON.stringify(f)}`);
  await page.click('button[aria-label="Verse-by-verse view"]');
  await page.waitForSelector('.quran .ayah');
  await page.context().close();
});

test('page view fits every page on phone, tablet and desktop screens', async () => {
  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await signIn(page, 'zaynab', '2468');
    await page.evaluate(() => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'baqara' }, body: JSON.stringify({ readerLayout: 'page' }) }));
    await page.goto(base + '/read');
    await page.waitForSelector('.mushaf-page');
    const worst = { font: 99 };
    for (let p = 2; p <= 49; p++) {
      if (p > 2 || (await page.textContent('.page-screen .reader-tools .small')).match(/Page (\d+)/)[1] !== '2') {
        await page.click('button[aria-label="Bookmarks"]');
        await page.fill('input[name=v]', String(QURAN.verses.find((v) => v.page === p).n));
        await page.click('.verse-actions button:has-text("Go")');
        await page.click('.verse-actions button:has-text("Close")');
      }
      await page.waitForFunction((n) => document.querySelector('.page-screen .reader-tools .small').textContent.includes(`Page ${n} `), p);
      await page.waitForTimeout(80);
      const f = await page.evaluate(() => {
        const t = document.querySelector('.mushaf-text');
        return { text: t.scrollHeight <= t.clientHeight + 1, doc: document.scrollingElement.scrollHeight <= window.innerHeight + 1, font: parseFloat(t.style.fontSize) };
      });
      assert.ok(f.text && f.doc, `page ${p} at ${vp.width}x${vp.height}: ${JSON.stringify(f)}`);
      if (f.font < worst.font) Object.assign(worst, f, { p });
    }
    console.log(`  ${vp.width}x${vp.height}: smallest text ${worst.font}px (page ${worst.p})`);
    await ctx.close();
  }
});

test('notifications: turn on from Home, send a test, and the phone shows a pushed reminder', async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['notifications'] });
  // Headless browsers have no real push service: stand in for the browser's subscription object.
  await ctx.addInitScript(() => {
    const fake = { endpoint: 'https://push.example/device-1', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPk', auth: 'aa' } }; }, unsubscribe: async () => true };
    let subscribed = false;
    // Headless Chromium always reports notifications as blocked; act as a phone where the person allowed them.
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => perm });
    Notification.requestPermission = async () => { perm = 'granted'; return perm; };
    PushManager.prototype.getSubscription = async function () { return subscribed ? fake : null; };
    PushManager.prototype.subscribe = async function () { subscribed = true; return fake; };
  });
  const page = await ctx.newPage();
  await signIn(page, 'maryam', '2468');
  await page.waitForSelector('text=Turn on a gentle daily reminder?');
  await page.click('.notif-banner button:has-text("Turn on notifications")');
  await page.waitForSelector('.notif-banner', { state: 'detached' });
  await page.click('nav >> text=Settings');
  await page.waitForSelector('text=Notifications are on for this phone.');
  pushedE2E.length = 0;
  await page.click('button:has-text("Send a test")');
  await page.waitForSelector('text=Test sent');
  assert.equal(pushedE2E.length, 1);
  assert.equal(pushedE2E[0].sub.endpoint, 'https://push.example/device-1');
  assert.equal(pushedE2E[0].payload.title, 'Notifications are on');

  // Deliver a real push message to the service worker and check what it would show.
  // (Headless Chromium never displays notifications, so the worker's showNotification call is recorded instead.)
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(base)) || await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => {
    self.__shown = [];
    self.registration.showNotification = async (title, opts) => { self.__shown.push({ title, body: opts.body, url: opts.data.url, tag: opts.tag }); };
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const regId = await new Promise((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { const r = e.registrations.find((x) => x.scopeURL.startsWith(base)); if (r) resolve(r.registrationId); });
  });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: base, registrationId: regId, data: JSON.stringify({ title: 'Family Quran reading', body: 'It is time for today’s family Quran reading.', url: '/read?part=2', tag: 'daily' }) });
  let shown = [];
  for (let i = 0; i < 30 && !shown.length; i++) { shown = await sw.evaluate(() => self.__shown); if (!shown.length) await page.waitForTimeout(200); }
  assert.deepEqual(shown, [{ title: 'Family Quran reading', body: 'It is time for today’s family Quran reading.', url: '/read?part=2', tag: 'daily' }]);

  // Reminder settings save.
  await page.click('label:has-text("At my own time") input');
  await page.fill('input[aria-label="At my own time"]', '06:45');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => fetch('/api/reminders').then((x) => x.json()));
  assert.equal(r.mine.useFamilyTime, false);
  assert.equal(r.mine.time, '06:45');
  await ctx.close();
});
