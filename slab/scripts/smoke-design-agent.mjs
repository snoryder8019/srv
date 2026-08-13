/**
 * Smoke test for the design agent (throttle step, field catalog, undo, feedback).
 *
 * Part A (server): hits the real route with a real admin session. The throttle
 * branch returns BEFORE any LLM call, so it's fully deterministic — no GPU.
 * Part B (browser): loads the real /admin/design DOM in Chrome and exercises the
 * client pieces (field collection, per-field AI buttons, throttle UI, undo).
 *
 * Read-only against tenant design data. The one write (agent_feedback) is
 * cleaned up at the end.
 */
import http from 'node:http';
import puppeteer from 'puppeteer';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const HOST = 'madladslab.madladslab.com';
const PORT = 3602;

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`); };
const bad = (n, e) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n      \x1b[31m${e}\x1b[0m`); };
async function check(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message); }
}

function req(path, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Host: HOST };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const run = async () => {
  await connectDB();
  const tenant = await getSlabDb().collection('tenants').findOne({ domain: HOST });
  if (!tenant) throw new Error(`tenant ${HOST} not found`);
  const owner = await getTenantDb(tenant.db, tenant.dbHost).collection('users').findOne({ isAdmin: true });
  if (!owner) throw new Error('admin user missing');

  const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, tenant.db, '24h');
  const ex = await req('/admin?token=' + token);
  const m = /(?:^|,\s*)slab_token=([^;]+)/.exec(ex.headers['set-cookie'] || '');
  if (!m) throw new Error('no session cookie issued');
  const cookie = `slab_token=${m[1]}`;

  console.log('\n\x1b[1mA. Server — throttle step & feedback\x1b[0m \x1b[2m(no LLM involved)\x1b[0m');

  await check('Broad request with no throttle returns the throttle question', async () => {
    const r = await req('/admin/design/agent', { method: 'POST', cookie, body: {
      messages: [{ role: 'user', content: 'redesign the whole site, top to bottom' }],
      scope: 'design', fields: [], currentDesign: {},
    }});
    if (r.status !== 200) throw new Error(`status ${r.status}: ${r.body.slice(0, 200)}`);
    const j = JSON.parse(r.body);
    if (j.ask !== 'throttle') throw new Error(`expected ask=throttle, got ${JSON.stringify(j).slice(0, 200)}`);
    if (!Array.isArray(j.options) || j.options.length !== 3) throw new Error('expected 3 throttle options');
    const keys = j.options.map(o => o.key).join(',');
    if (keys !== 'light,balanced,full') throw new Error(`unexpected option keys: ${keys}`);
    if (!Object.keys(j.fill || {}).length === false) throw new Error('throttle ask must not carry fills');
    return keys;
  });

  await check('A field-focused request skips the throttle question', async () => {
    const r = await req('/admin/design/agent', { method: 'POST', cookie, body: {
      messages: [{ role: 'user', content: 'refresh everything here' }],
      scope: 'design', focusField: 'color_primary', fields: [], currentDesign: {},
    }});
    const j = JSON.parse(r.body);
    // Focused asks go to the model; we only assert it did NOT stop to ask.
    if (j.ask === 'throttle') throw new Error('focused request should not ask for throttle');
    return 'went straight to the agent';
  });

  await check('A narrow request skips the throttle question', async () => {
    const r = await req('/admin/design/agent', { method: 'POST', cookie, body: {
      messages: [{ role: 'user', content: 'make the accent slightly warmer' }],
      scope: 'design', fields: [], currentDesign: {},
    }});
    const j = JSON.parse(r.body);
    if (j.ask === 'throttle') throw new Error('narrow request should not ask for throttle');
    return 'no throttle gate';
  });

  await check('Feedback endpoint records a thumbs-down', async () => {
    const r = await req('/admin/design/agent/feedback', { method: 'POST', cookie, body: {
      rating: 'down', prompt: '__verify__ probe', reply: 'probe reply',
      fill: { color_primary: '#123456' }, throttle: 'light', scope: 'design',
    }});
    if (r.status !== 200) throw new Error(`status ${r.status}: ${r.body.slice(0, 200)}`);
    const doc = await getSlabDb().collection('agent_feedback').findOne({ prompt: '__verify__ probe' });
    if (!doc) throw new Error('feedback row not written');
    if (doc.rating !== 'down' || doc.fillCount !== 1) throw new Error(`bad row: ${JSON.stringify(doc)}`);
    await getSlabDb().collection('agent_feedback').deleteMany({ prompt: '__verify__ probe' });
    return `stored (tenant ${doc.tenantDomain}, throttle ${doc.throttle}), cleaned up`;
  });

  console.log('\n\x1b[1mB. Browser — real /admin/design DOM\x1b[0m');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${HOST}:80 127.0.0.1:${PORT}`,
    ],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
    await page.setCookie({ name: 'slab_token', value: m[1], domain: HOST, path: '/' });
    const resp = await page.goto(`http://${HOST}/admin/design`, { waitUntil: 'networkidle2', timeout: 60000 });

    await check('Design panel loads for an authed admin', async () => {
      if (resp.status() !== 200) throw new Error(`status ${resp.status()}`);
      const t = await page.$('#dpTabs');
      if (!t) throw new Error('tab strip missing — not the design panel');
      return `HTTP 200`;
    });

    await check('Page loads with no JS errors', async () => {
      // Ignore noise from external/asset fetches; we care about script crashes.
      const real = errors.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
      if (real.length) throw new Error(real.slice(0, 3).join(' | '));
      return 'clean';
    });

    await check('Field catalog covers all three tabs', async () => {
      const r = await page.evaluate(() => {
        const secs = document.querySelectorAll('.editor-panel .editor-section[data-tab]');
        const out = {}; const seen = {};
        secs.forEach(s => {
          s.querySelectorAll('input, select, textarea').forEach(el => {
            if (!el.name || seen[el.name]) return;
            if (el.type === 'file' || el.type === 'submit') return;
            if (!el.form || el.form.id !== 'designForm') return;
            if (/_spec$/.test(el.name)) return;
            if (el.name.charAt(0) === '_' || !/^[a-zA-Z0-9_]+$/.test(el.name)) return;
            seen[el.name] = 1;
            out[s.dataset.tab] = (out[s.dataset.tab] || 0) + 1;
          });
        });
        return out;
      });
      const tabs = Object.keys(r);
      for (const t of ['design', 'copy', 'source']) {
        if (!r[t]) throw new Error(`tab "${t}" contributed no fields (got ${JSON.stringify(r)})`);
      }
      return `design ${r.design}, copy ${r.copy}, source ${r.source} (${Object.values(r).reduce((a, b) => a + b, 0)} fields)`;
    });

    await check('Agent buttons are pulled back to sections + textareas', async () => {
      const r = await page.evaluate(() => {
        const secs = [...document.querySelectorAll('.ai-sec-btn')];
        const flds = [...document.querySelectorAll('.ai-field-btn')];
        // Every field button must sit on a textarea's field box, never a small input.
        const badField = flds.filter(b => !b.closest('.ep-field')?.querySelector('textarea')).length;
        // Section buttons must live inside the section body, not the header.
        const badSec = secs.filter(b => !b.closest('.editor-section-body')).length;
        // No button may hang off a label any more, and small inputs get none.
        const onLabels = document.querySelectorAll('label > .ai-focus-btn').length;
        const smallInputs = [...document.querySelectorAll('.ep-field')].filter(w =>
          !w.querySelector('textarea') && w.querySelector('.ai-field-btn')).length;
        return { secs: secs.length, flds: flds.length, badField, badSec, onLabels, smallInputs,
                 total: document.querySelectorAll('.ai-focus-btn').length };
      });
      if (r.onLabels) throw new Error(`${r.onLabels} buttons still attached to labels`);
      if (r.smallInputs) throw new Error(`${r.smallInputs} small inputs still carry their own button`);
      if (r.badField) throw new Error(`${r.badField} field buttons are not on a textarea`);
      if (r.badSec) throw new Error(`${r.badSec} section buttons are outside the section body`);
      if (!r.secs) throw new Error('no section buttons injected');
      if (!r.flds) throw new Error('no textarea buttons injected');
      // The whole point: far fewer buttons than the ~300 per-field version.
      if (r.total > 120) throw new Error(`${r.total} buttons — pullback did not take effect`);
      return `${r.secs} section + ${r.flds} textarea = ${r.total} total (was ~300)`;
    });

    await check('Textarea button focuses the agent on that field', async () => {
      const r = await page.evaluate(() => {
        const b = document.querySelector('.ai-field-btn');
        b.click();
        const chip = document.getElementById('apFocus');
        return {
          open: document.getElementById('agentPanel').classList.contains('open'),
          chip: chip && chip.style.display !== 'none' ? chip.textContent.trim() : null,
          name: b.dataset.name,
          isTextarea: !!b.closest('.ep-field').querySelector('textarea'),
        };
      });
      if (!r.open) throw new Error('agent panel did not open');
      if (!r.chip) throw new Error('focus chip not shown');
      if (!r.isTextarea) throw new Error('field button was not on a textarea');
      return `focused ${r.name}, chip: "${r.chip.replace(/\s+/g, ' ')}"`;
    });

    await check('Section button focuses the agent on that section', async () => {
      const r = await page.evaluate(() => {
        const b = document.querySelector('.ai-sec-btn');
        b.click();
        const chip = document.getElementById('apFocus');
        return {
          open: document.getElementById('agentPanel').classList.contains('open'),
          chip: chip && chip.style.display !== 'none' ? chip.textContent.trim() : null,
          section: b.dataset.section,
          placeholder: document.getElementById('agentInput').placeholder,
        };
      });
      if (!r.open) throw new Error('agent panel did not open');
      if (!r.chip) throw new Error('focus chip not shown');
      if (!/section/i.test(r.placeholder)) throw new Error(`placeholder not section-scoped: ${r.placeholder}`);
      return `section "${r.section}", chip: "${r.chip.replace(/\s+/g, ' ')}"`;
    });

    await check('Section focus is sent as focusSection, not focusField', async () => {
      const r = await page.evaluate(async () => {
        let captured = null;
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (String(url).includes('/admin/design/agent')) captured = JSON.parse(opts.body);
          return { json: async () => ({ message: 'ok', fill: {}, throttle: 'light' }) };
        };
        document.querySelector('.ai-sec-btn').click();
        const input = document.getElementById('agentInput');
        input.value = 'tidy this up';
        document.getElementById('agentSend').click();
        await new Promise(r => setTimeout(r, 400));
        window.fetch = realFetch;
        return { focusSection: captured?.focusSection, focusField: captured?.focusField };
      });
      if (!r.focusSection) throw new Error('focusSection not sent');
      if (r.focusField) throw new Error(`focusField wrongly set to ${r.focusField}`);
      return `focusSection="${r.focusSection}", focusField=null`;
    });

    await check('Shipped collectFields reports picker-backed fields to the server', async () => {
      const r = await page.evaluate(async () => {
        // Capture the real request body the panel sends — this exercises the
        // shipped collectFields(), not a copy of it.
        let captured = null;
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (String(url).includes('/admin/design/agent')) captured = JSON.parse(opts.body);
          return { json: async () => ({ message: 'ok', fill: {}, throttle: 'light' }) };
        };
        document.getElementById('apFocusClear')?.click();
        const input = document.getElementById('agentInput');
        input.value = 'probe';
        document.getElementById('agentSend').click();
        await new Promise(r => setTimeout(r, 400));
        window.fetch = realFetch;
        const names = (captured?.fields || []).map(f => f.name);
        return {
          total: names.length,
          hasFontHeading: names.includes('font_heading'),
          hasFontBody: names.includes('font_body'),
          hasHeroMedia: names.includes('hero_bg_media_url'),
          leakedSpec: names.filter(n => /_spec$/.test(n)),
          leakedPlumbing: names.filter(n => ['slot', 'label', '_id', 'look'].includes(n)),
          scope: captured?.scope,
        };
      });
      if (!r.hasFontHeading || !r.hasFontBody) throw new Error('font picker fields still missing from the catalog');
      if (!r.hasHeroMedia) throw new Error('hero media fields missing from the catalog');
      if (r.leakedSpec.length) throw new Error(`derived _spec fields leaked: ${r.leakedSpec.join(', ')}`);
      if (r.leakedPlumbing.length) throw new Error(`upload plumbing leaked: ${r.leakedPlumbing.join(', ')}`);
      return `${r.total} fields sent, fonts+hero media in, no _spec/plumbing leak (scope=${r.scope})`;
    });

    await check('Throttle question renders pickable options', async () => {
      const r = await page.evaluate(async () => {
        // Stub the network so we exercise the UI branch, not the model.
        const realFetch = window.fetch;
        window.fetch = async () => ({ json: async () => ({
          ask: 'throttle', message: 'How hard do you want me to hit the throttle?',
          options: [
            { key: 'light', label: 'Light', hint: 'one dimension' },
            { key: 'balanced', label: 'Balanced', hint: 'a few dimensions' },
            { key: 'full', label: 'Full send', hint: 'everything' },
          ], fill: {},
        })});
        document.getElementById('apFocusClear')?.click();   // clear focus first
        const input = document.getElementById('agentInput');
        input.value = 'redesign the whole site';
        document.getElementById('agentSend').click();
        await new Promise(r => setTimeout(r, 400));
        const btns = [...document.querySelectorAll('.ap-throttle-btn')];
        const labels = btns.map(b => b.querySelector('.ap-throttle-lbl').textContent);
        // Pick one and confirm the UI collapses to the chosen level.
        let picked = null;
        if (btns.length) {
          window.fetch = async () => ({ json: async () => ({ message: 'done', fill: {}, throttle: 'full' }) });
          btns[2].click();
          await new Promise(r => setTimeout(r, 300));
          picked = document.querySelector('.ap-throttle-picked')?.textContent || null;
        }
        window.fetch = realFetch;
        return { labels, picked };
      });
      if (r.labels.length !== 3) throw new Error(`expected 3 throttle buttons, got ${r.labels.length}`);
      if (!r.picked) throw new Error('picking a throttle level did not confirm in the UI');
      return `${r.labels.join(' / ')} → "${r.picked}"`;
    });

    await check('Agent fills apply, and Undo restores the previous values', async () => {
      const r = await page.evaluate(async () => {
        const el = document.querySelector('[name="color_primary"]');
        const original = el.value;
        const realFetch = window.fetch;
        window.fetch = async () => ({ json: async () => ({
          message: 'Warmed up the palette.',
          fill: { color_primary: '#8B3A2F' },
          throttle: 'light',
        })});
        const input = document.getElementById('agentInput');
        input.value = 'warmer primary';
        document.getElementById('agentSend').click();
        await new Promise(r => setTimeout(r, 500));
        const afterFill = el.value;
        const undoBtn = document.querySelector('.slab-flash-act');
        const flashText = document.querySelector('.slab-flash-msg')?.textContent || '';
        const hadThumbs = !!document.querySelector('.ap-fb-btn');
        if (undoBtn) undoBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const afterUndo = el.value;
        window.fetch = realFetch;
        return { original, afterFill, afterUndo, hasUndo: !!undoBtn, flashText, hadThumbs };
      });
      if (!r.hasUndo) throw new Error('no Undo affordance in the flash');
      if (r.afterFill.toLowerCase() !== '#8b3a2f') throw new Error(`fill did not apply (got ${r.afterFill})`);
      if (r.afterUndo !== r.original) throw new Error(`undo failed: ${r.original} → ${r.afterFill} → ${r.afterUndo}`);
      if (!r.hadThumbs) throw new Error('no thumbs up/down row rendered');
      return `${r.original} → ${r.afterFill} → undo → ${r.afterUndo}; flash: "${r.flashText}"`;
    });

  } finally {
    await browser.close();
  }

  console.log(`\n\x1b[1mResult:\x1b[0m \x1b[32m${pass} passed\x1b[0m${fail ? `, \x1b[31m${fail} failed\x1b[0m` : ''}\n`);
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('\x1b[31mHarness error:\x1b[0m', e); process.exit(1); });
