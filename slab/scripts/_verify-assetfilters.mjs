#!/usr/bin/env node
/**
 * READ-ONLY end-to-end check of the asset filter-bar work.
 * Drives the real /admin/assets page and the real picker modal in a headless
 * browser against the madladslab tenant. Uploads nothing, deletes nothing.
 */
import http from 'node:http';
import puppeteer from 'puppeteer';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const BASE = 'http://127.0.0.1:3602';
const HOST = 'madladslab.madladslab.com';
const DB = 'slab_madladslab';

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { const d = await fn(); console.log(`  PASS  ${name}${d ? ` — ${d}` : ''}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name} — ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

function raw(path, cookie) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 3602, path, method: 'GET',
      headers: { Host: HOST, ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', e => resolve({ status: 0, headers: {}, body: e.message }));
    req.end();
  });
}

await connectDB();
await getSlabDb();
const owner = await getTenantDb(DB).collection('users').findOne({ isAdmin: true });
if (!owner) { console.error('no admin user'); process.exit(1); }
const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, DB, '24h');

const ex = await raw('/admin?token=' + token);
const setCookie = ex.headers['set-cookie'] || [];
const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
if (!cookie) { console.error('no session cookie'); process.exit(1); }

console.log('\n── API ──');
await check('/admin/assets/counts returns folder + client maps', async () => {
  const r = await raw('/admin/assets/counts', cookie);
  assert(r.status === 200, `status ${r.status}`);
  const d = JSON.parse(r.body);
  assert(typeof d.total === 'number', 'no total');
  assert(d.folders && typeof d.folders === 'object', 'no folders map');
  assert(d.clients && typeof d.clients === 'object', 'no clients map');
  return `total=${d.total}, folders=${Object.keys(d.folders).length}`;
});

// Chrome forbids overriding the Host header, so map the tenant hostname to the
// local app (the :80 in the rule is required — without it Chrome refuses the
// request outright). This way the real tenant, with real assets, is exercised.
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOST}:80 127.0.0.1:3602`],
});
const ORIGIN = `http://${HOST}`;
const page = await browser.newPage();
// Desktop viewport: below 900px the folder panel collapses into a drawer and
// the panel-driven assertions below would be testing a hidden element.
await page.setViewport({ width: 1440, height: 900 });
const [k, v] = cookie.split('=');
await page.setCookie({ name: k, value: v.split(';')[0], domain: HOST, path: '/' });

const goto = async (path) => {
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#assetGrid .asset-card, #assetGrid .grid-empty', { timeout: 20000 });
};
const chips = () => page.$$eval('#assetFilterBar .saf-chip .saf-chip-val', els => els.map(e => e.textContent.trim()));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('\n── LIBRARY PAGE ──');
await goto('/admin/assets');

await check('clean load shows no filter chips', async () => {
  const c = await chips();
  assert(c.length === 0, `unexpected chips: ${c.join(', ')}`);
});

await check('result count line renders', async () => {
  const t = await page.$eval('#assetFilterBar .saf-count', e => e.textContent.trim()).catch(() => '');
  assert(/\d/.test(t), `no count rendered (got "${t}")`);
  return t;
});

await check('folder badges populated (the &limit=0 bug)', async () => {
  const stats = await page.$eval('#folderStats', e => e.textContent.trim());
  assert(!/error/i.test(stats), `folderStats says "${stats}"`);
  const all = await page.$eval('#cnt-all', e => e.textContent.trim());
  assert(all !== '—' && /\d/.test(all), `All Assets badge = "${all}"`);
  return `${stats}, All badge = ${all}`;
});

await check('selecting a folder adds a dismissable chip + updates URL', async () => {
  await page.click('.folder-item[data-folder="blog"]');
  await sleep(1200);
  const c = await chips();
  assert(c.length === 1, `expected 1 chip, got ${c.length}`);
  assert(/blog/i.test(c[0]), `chip reads "${c[0]}"`);
  assert(page.url().includes('folder=blog'), `URL missing folder: ${page.url()}`);
  return `chip "${c[0]}", url ?folder=blog`;
});

await check('adding a type filter shows both chips + Clear all', async () => {
  await page.click('.type-tab[data-type="image"]');
  await sleep(1200);
  const c = await chips();
  assert(c.length === 2, `expected 2 chips, got ${c.length} (${c.join(', ')})`);
  const clear = await page.$('#assetFilterBar .saf-clear');
  assert(clear, 'no Clear all button with 2 filters active');
  return c.join(' + ');
});

await check('dismissing one chip clears only that filter', async () => {
  await page.click('#assetFilterBar .saf-chip .saf-chip-x');
  await sleep(1200);
  const c = await chips();
  assert(c.length === 1, `expected 1 chip left, got ${c.length}`);
  assert(/image/i.test(c[0]), `wrong chip survived: ${c[0]}`);
  const activeFolder = await page.$eval('.folder-item.active', e => e.dataset.folder);
  assert(activeFolder === 'all', `folder panel not synced back to all (${activeFolder})`);
  return `left with "${c[0]}", folder panel synced to All`;
});

await check('Clear all wipes every filter and the URL', async () => {
  await page.click('.folder-item[data-folder="blog"]');
  await sleep(1000);
  await page.click('#assetFilterBar .saf-clear');
  await sleep(1200);
  const c = await chips();
  assert(c.length === 0, `chips remain: ${c.join(', ')}`);
  const t = await page.$eval('.type-tab.active', e => e.dataset.type);
  assert(t === 'all', `type tab still ${t}`);
  const f = await page.$eval('.folder-item.active', e => e.dataset.folder);
  assert(f === 'all', `folder still ${f}`);
  assert(!page.url().includes('folder='), `URL still filtered: ${page.url()}`);
  return 'chips, tabs, folder panel and URL all reset';
});

await check('deep link ?folder=blog&type=image restores both filters', async () => {
  await goto('/admin/assets?folder=blog&type=image');
  await sleep(800);
  const c = await chips();
  assert(c.length === 2, `expected 2 chips from URL, got ${c.length}`);
  const t = await page.$eval('.type-tab.active', e => e.dataset.type);
  assert(t === 'image', `type tab = ${t}`);
  return c.join(' + ');
});

console.log('\n── PICKER MODAL (the cross-surface leak) ──');

const openPicker = async (path, opts) => {
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction('typeof window.openAssetPicker === "function"', { timeout: 15000 });
  await page.evaluate((o) => window.openAssetPicker(o), opts);
  await page.waitForSelector('#assetPickerModal .apm-card, #assetPickerModal .apm-empty', { timeout: 20000 });
};
const pickerFolder = () => page.$eval('#apmFolder', e => e.value);
const pickerChips = () => page.$$eval('#apmFilterBar .saf-chip .saf-chip-val', els => els.map(e => e.textContent.trim()));

await check('picker honours caller scoping (folder: blog)', async () => {
  await openPicker('/admin/blog/new', { folder: 'blog', type: 'image' });
  const f = await pickerFolder();
  assert(f === 'blog', `picker folder = ${f}, expected blog`);
  const c = await pickerChips();
  assert(c.length === 2, `expected 2 chips, got ${c.length} (${c.join(', ')})`);
  return `folder=blog, chips: ${c.join(' + ')}`;
});

await check('caller scoping is dismissable (soft, not a hard partition)', async () => {
  await page.click('#apmFilterBar .saf-chip .saf-chip-x');
  await new Promise(r => setTimeout(r, 1200));
  const f = await pickerFolder();
  assert(f === 'all', `folder still ${f} after dismissing chip`);
  return 'chip dismissed → All Folders';
});

await check('REGRESSION: picker choice does NOT leak to another surface', async () => {
  // Scope the picker to portfolio on this surface...
  await page.select('#apmFolder', 'portfolio');
  await new Promise(r => setTimeout(r, 1200));
  assert((await pickerFolder()) === 'portfolio', 'select did not take');

  // ...then open the picker on a DIFFERENT surface asking for its own folder.
  await openPicker('/admin/pages/new', { folder: 'pages', type: 'image' });
  const f = await pickerFolder();
  assert(f === 'pages', `LEAKED: picker opened on "pages" surface showing folder "${f}"`);
  return 'pages surface opened scoped to pages, not portfolio';
});

await check('REGRESSION: no assetPicker.* keys written to localStorage', async () => {
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('assetPicker')));
  assert(keys.length === 0, `localStorage still holds: ${keys.join(', ')}`);
  return 'localStorage clean';
});

await check('picker with no caller scoping opens on the full library', async () => {
  await openPicker('/admin/pages/new', {});
  const f = await pickerFolder();
  assert(f === 'all', `folder = ${f}, expected all`);
  const c = await pickerChips();
  assert(c.length === 0, `unexpected chips: ${c.join(', ')}`);
  return 'all folders, no chips';
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
