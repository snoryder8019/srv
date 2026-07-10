#!/usr/bin/env node
/**
 * Slab — Premium Subscription (Go Live) Smoke Test
 * Exercises the paid-upgrade + confirmation flow: a preview tenant signs up,
 * the premium pricing engine is verified, the PayPal capture is SIMULATED
 * (PayPal runs in live mode — a real order can't be auto-approved and would
 * dirty the merchant account), and we assert the tenant genuinely flips to an
 * active paid subscription that the live system serves as non-preview.
 *
 * Usage:
 *   node scripts/smoke-premium.js                 # plan: annual
 *   node scripts/smoke-premium.js --plan lifetime
 *
 * Options:
 *   --url  <base>   Base URL           (default http://127.0.0.1:3602)
 *   --host <host>   Host for /start    (default slab.madladslab.com)
 *   --plan <plan>   monthly|quarterly|annual|lifetime  (default annual)
 *   --keep          Leave the throwaway tenant in place (skip teardown)
 *
 * This provisions a real preview tenant (tenant doc + DB + Linode DNS) and fires
 * the signup emails, then deletes all of it. It does NOT call PayPal.
 */

import http from 'node:http';
import https from 'node:https';
import { config } from '../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

// Mirror of PP_PLANS in routes/onboarding.js — the confirm step (paypal-return)
// derives expiry from these. Kept in sync manually; asserted against below.
const PLAN_DAYS = { monthly: 30, quarterly: 90, annual: 365, lifetime: null };
const PLAN_AMOUNT = { monthly: '50.00', quarterly: '120.00', annual: '300.00', lifetime: '499.00' };

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const BASE = (val('--url', 'http://127.0.0.1:3602')).replace(/\/$/, '');
const HOST = val('--host', 'slab.madladslab.com');
const PLAN = val('--plan', 'annual');
const KEEP = has('--keep');

if (!PLAN_DAYS.hasOwnProperty(PLAN)) {
  console.error(`Unknown plan "${PLAN}". Use: ${Object.keys(PLAN_DAYS).join(', ')}`);
  process.exit(2);
}

// ── tiny test harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function record(ok, name, detail) {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ''}`); }
}
async function check(name, fn) {
  try { const d = await fn(); record(true, name, typeof d === 'string' ? d : ''); }
  catch (err) { record(false, name, err.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function suffix() {
  const s = process.pid + '|' + process.hrtime.bigint().toString();
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

// HTTP helper — node:http so the Host header is honored (undici drops it).
function req(path, { method = 'GET', host = HOST, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Host: host };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (cookie) headers['Cookie'] = cookie;
    const request = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method, headers, rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({
          status: res.statusCode,
          headers: { get: (n) => { const v = res.headers[n.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v; } },
          text: data, json,
        });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
function readSlabCookie(setCookie) {
  const m = /(?:^|,\s*)slab_token=([^;]+)/.exec(setCookie || '');
  return m ? `slab_token=${m[1]}` : null;
}

// ── premium flow ───────────────────────────────────────────────────────────────
async function run() {
  const sfx = suffix();
  const slug = `smokepro-${sfx}`;
  const domain = `${slug}.madladslab.com`;
  const email = `smoketest+pro-${sfx}@madladslab.com`;
  const dbName = `slab_${slug}`;

  console.log(`\n\x1b[1mPremium subscription flow\x1b[0m  \x1b[2m(tenant ${domain}, plan: ${PLAN})\x1b[0m`);

  let created = false;
  let dbHost = 'atlas';

  try {
    // 1. Provision the upgrade candidate as a free preview tenant. Done directly
    //    (not via HTTP /start/signup, which smoke-onboarding.js already covers)
    //    so the premium flow's precondition is deterministic and email-free.
    await check('Provision a preview tenant (upgrade candidate)', async () => {
      const result = await provisionTenant({ subdomain: slug, brandName: 'Smoke Premium Co', brandLocation: 'Denver, CO', ownerEmail: email });
      assert(result?.domain === domain, `provision returned ${result?.domain}`);
      created = true;
      return domain;
    });
    if (!created) return;

    // 2. Confirm the pre-payment state is a free preview.
    await check('Tenant starts as free preview', async () => {
      const t = await getSlabDb().collection('tenants').findOne({ 'meta.subdomain': slug });
      assert(t, 'tenant not found');
      dbHost = t.dbHost || 'atlas';
      assert(t.status === 'preview' && t.isPreview !== false, `expected preview, got status=${t.status}`);
      assert((t.meta?.plan || 'free') === 'free', `expected plan free, got ${t.meta?.plan}`);
      return `preview on ${dbHost}`;
    });

    // 3. Premium pricing engine — the Go Live upsell reads this.
    await check(`Pricing engine returns the ${PLAN} plan`, async () => {
      const r = await req('/start/pricing?email=' + encodeURIComponent(email));
      assert(r.status === 200 && r.json?.plans?.[PLAN], `bad pricing response ${r.status}`);
      const p = r.json.plans[PLAN];
      assert(p.baseAmount === PLAN_AMOUNT[PLAN], `base amount drift: ${p.baseAmount} vs ${PLAN_AMOUNT[PLAN]}`);
      assert(parseFloat(p.amount) > 0, `non-positive amount ${p.amount}`);
      // Discount must be a valid fraction and can only ever lower the price.
      assert(typeof p.discount === 'number' && p.discount >= 0 && p.discount < 1, `bad discount ${p.discount}`);
      assert(parseFloat(p.amount) <= parseFloat(p.baseAmount), `discounted price above base: ${p.amount} > ${p.baseAmount}`);
      return `${p.discountLabel} → $${p.amount} (base $${p.baseAmount})`;
    });

    // 4. SIMULATE the PayPal capture + activation.
    //    This mirrors the $set that routes/onboarding.js `/paypal-return` applies
    //    after a real capture. PayPal is live-mode, so we don't drive a real order.
    const activatedAt = new Date();
    const days = PLAN_DAYS[PLAN];
    const expiresAt = days ? new Date(activatedAt.getTime() + days * 86400000) : null;
    await check('Simulated payment capture activates the tenant', async () => {
      const r = await getSlabDb().collection('tenants').updateOne(
        { domain },
        { $set: {
            status: 'active',
            isPreview: false,
            'meta.plan': PLAN,
            'meta.paypalOrderId': `SIMULATED-${sfx}`,
            'meta.paypalCaptureId': `SIMULATED-CAP-${sfx}`,
            'meta.activatedAt': activatedAt,
            'meta.expiresAt': expiresAt,
            updatedAt: activatedAt,
        } },
      );
      assert(r.matchedCount === 1, `tenant not matched for activation (${r.matchedCount})`);
      bustTenantCache(domain); // force the live tenant cache to re-read
      return `plan=${PLAN}, expires=${expiresAt ? expiresAt.toISOString().slice(0, 10) : 'never (lifetime)'}`;
    });

    // 5. Assert the confirmed subscription is correct in the registry.
    await check('Registry reflects an active paid subscription', async () => {
      const t = await getSlabDb().collection('tenants').findOne({ domain });
      assert(t.status === 'active', `status ${t.status}`);
      assert(t.isPreview === false, 'isPreview still true');
      assert(t.meta.plan === PLAN, `plan ${t.meta.plan}`);
      assert(t.meta.activatedAt, 'no activatedAt');
      if (days === null) assert(!t.meta.expiresAt, 'lifetime should have no expiry');
      else {
        const gotDays = Math.round((new Date(t.meta.expiresAt) - new Date(t.meta.activatedAt)) / 86400000);
        assert(gotDays === days, `expiry span ${gotDays}d, expected ${days}d`);
      }
      return `active, ${days === null ? 'lifetime' : days + 'd term'}`;
    });

    // 6. The live payoff: the system now serves this tenant as a paid, non-preview
    //    site and the owner can still reach admin (subscription is fully functional).
    await check('Live system serves the tenant as active (non-preview)', async () => {
      const landing = await req('/', { host: domain });
      assert(landing.status === 200, `tenant landing not served: ${landing.status}`);

      const owner = await getTenantDb(dbName, dbHost).collection('users').findOne({ isOwner: true });
      assert(owner, 'owner user missing');
      const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, dbName, '24h');
      const r1 = await req('/admin?token=' + token, { host: domain });
      assert(r1.status === 302, `token exchange status ${r1.status}`);
      const cookie = readSlabCookie(r1.headers.get('set-cookie'));
      assert(cookie, 'no session cookie issued');
      const loc1 = r1.headers.get('location') || '';
      assert(!/\/admin\/login/.test(loc1), `bounced to login: ${loc1}`);

      const r2 = await req('/admin', { host: domain, cookie });
      const loc2 = r2.headers.get('location') || '';
      const ok = r2.status === 200 || (r2.status === 302 && loc2.startsWith('/admin') && !loc2.startsWith('/admin/login'));
      assert(ok, `admin not reachable post-activation: ${r2.status} → ${loc2}`);
      return 'landing 200, admin session live';
    });

  } finally {
    if (created && !KEEP) await teardown({ slug, domain, dbName, dbHost });
    else if (created && KEEP) console.log(`\n\x1b[33m--keep set: leaving ${domain} (db ${dbName}) in place.\x1b[0m`);
  }
}

// ── teardown (identical strategy to the onboarding smoke test) ─────────────────
async function teardown({ slug, domain, dbName, dbHost }) {
  console.log(`\n\x1b[1mTeardown\x1b[0m  \x1b[2m(${domain})\x1b[0m`);
  if (!dbHost || dbHost === 'atlas') {
    const t = await getSlabDb().collection('tenants').findOne({ 'meta.subdomain': slug });
    if (t?.dbHost) dbHost = t.dbHost;
  }

  await check('Drop tenant database', async () => {
    const tdb = getTenantDb(dbName, dbHost);
    try { await tdb.dropDatabase(); return `${dbName} (dropDatabase)`; }
    catch {
      const cols = await tdb.listCollections().toArray();
      for (const c of cols) { try { await tdb.collection(c.name).drop(); } catch { /* ignore */ } }
      const left = await tdb.listCollections().toArray();
      assert(left.length === 0, `${left.length} collections could not be dropped`);
      return `${dbName} (${cols.length} collections dropped)`;
    }
  });

  await check('Delete tenant registry doc', async () => {
    const r = await getSlabDb().collection('tenants').deleteOne({ 'meta.subdomain': slug });
    assert(r.deletedCount === 1, `deleted ${r.deletedCount} docs`);
    return 'ok';
  });

  await check('Delete signup + delegate records', async () => {
    await getSlabDb().collection('signups').deleteMany({ subdomain: slug });
    await getSlabDb().collection('delegate_referrals').deleteMany({ subdomain: slug });
    return 'ok';
  });

  await check('Delete Linode DNS record', async () => {
    if (!config.LINODE_API_TOKEN || !config.LINODE_DOMAIN_ID) return 'skipped (no Linode creds)';
    const base = `https://api.linode.com/v4/domains/${config.LINODE_DOMAIN_ID}/records`;
    const list = await fetch(base, { headers: { Authorization: `Bearer ${config.LINODE_API_TOKEN}` } });
    if (!list.ok) throw new Error(`Linode list failed: ${list.status}`);
    const data = await list.json();
    const rec = (data.data || []).find((r) => r.name === slug && r.type === 'A');
    if (!rec) return 'no DNS record found';
    const del = await fetch(`${base}/${rec.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.LINODE_API_TOKEN}` } });
    if (!del.ok) throw new Error(`Linode delete failed: ${del.status}`);
    return `removed A record ${rec.id}`;
  });
}

// ── main ───────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\x1b[1msLab premium subscription smoke test\x1b[0m — plan: ${PLAN}  \x1b[2m(payment simulated)\x1b[0m`);
  try {
    const r = await req('/start');
    if (r.status !== 200) { console.error(`\n\x1b[31mCannot reach ${BASE}/start (status ${r.status}). Is slab running?\x1b[0m`); process.exit(2); }
  } catch (err) {
    console.error(`\n\x1b[31mCannot reach ${BASE} — ${err.message}\x1b[0m\nHint: slab listens on 127.0.0.1:3602 locally.`);
    process.exit(2);
  }

  await connectDB();
  await run();

  console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('\n\x1b[31mSmoke test crashed:\x1b[0m', err);
  process.exit(3);
});
