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
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'baqara-e2e-'));
  const dbFile = path.join(dir, 'e2e.db');
  execFileSync(process.execPath, ['scripts/seed-demo.js'], { env: { ...process.env, DB_FILE: dbFile }, stdio: 'ignore' });
  const app = createApp({ db: openDb(dbFile), serveClient: true });
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

test('marking today complete updates the family dashboard', async () => {
  const page = await phone();
  await signIn(page, 'aisha', '2468');
  await page.waitForSelector('text=4 of 6 have read today');
  await page.click('text=Mark today complete');
  await page.waitForSelector('text=Completed today');
  await page.waitForSelector('text=5 of 6 have read today');
  await page.click('nav >> text=Family');
  await page.waitForSelector('.member');
  const aisha = page.locator('.member', { hasText: 'Aisha' });
  assert.match(await aisha.textContent(), /Read today/);
  // Undo returns to the earlier state.
  await page.click('nav >> text=Home');
  await page.click('button:has-text("Undo")');
  await page.waitForSelector('text=Mark today complete');
  await page.context().close();
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
  const link = await admin.inputValue('.linkbox input');
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
