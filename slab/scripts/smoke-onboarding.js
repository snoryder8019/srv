#!/usr/bin/env node
/**
 * Slab — Onboarding Smoke Test
 * Exercises the /start funnel end-to-end and proves a fresh signup lands
 * a working, logged-in admin session inside sLab.
 *
 * Usage:
 *   node scripts/smoke-onboarding.js            # safe: read-only GET checks, no writes
 *   node scripts/smoke-onboarding.js --full     # + real signup, DB/login assertions, full teardown
 *
 * Options:
 *   --url  <base>   Base URL to hit         (default http://127.0.0.1:3602)
 *   --host <host>   Host header for /start  (default slab.madladslab.com)
 *   --keep          --full only: skip teardown (leaves the throwaway tenant behind)
 *
 * --full provisions a real preview tenant (tenant doc + tenant DB + Linode DNS record)
 * under a random `smoke-xxxxxx` subdomain, verifies it, then deletes all of it. It also
 * triggers the welcome + superadmin notify emails, so don't hammer it. The default
 * (read-only) mode is safe to run anytime, including against production.
 */

import http from 'node:http';
import https from 'node:https';
import { config } from '../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const BASE = (val('--url', 'http://127.0.0.1:3602')).replace(/\/$/, '');
const HOST = val('--host', 'slab.madladslab.com');
const FULL = has('--full');
const KEEP = has('--keep');

// ── tiny test harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];
function record(ok, name, detail) {
  results.push({ ok, name, detail });
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ''}`); }
}
async function check(name, fn) {
  try { const d = await fn(); record(true, name, typeof d === 'string' ? d : ''); }
  catch (err) { record(false, name, err.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// HTTP helper — uses node:http so we can (a) send a real Host header (undici's
// fetch drops it as a forbidden header) and (b) inspect redirects without following.
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

// ── read-only checks (safe everywhere) ─────────────────────────────────────────
async function readOnlyChecks() {
  console.log(`\n\x1b[1mRead-only funnel checks\x1b[0m  \x1b[2m(${BASE}, Host: ${HOST})\x1b[0m`);

  await check('GET /start renders signup form', async () => {
    const r = await req('/start');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(/id="subdomain"/.test(r.text), 'subdomain input not found in page');
    assert(/\/start\/signup/.test(r.text), 'signup endpoint not referenced in page');
    return '200, form present';
  });

  await check('GET /start/check-subdomain accepts a free slug', async () => {
    const slug = 'smoke-' + Math.abs(hashArgs()).toString(36).slice(0, 6);
    const r = await req('/start/check-subdomain?s=' + slug);
    assert(r.status === 200 && r.json, `bad response ${r.status}`);
    assert(r.json.available === true, `expected available:true for "${slug}", got ${JSON.stringify(r.json)}`);
    return `"${slug}" available`;
  });

  await check('GET /start/check-subdomain rejects a reserved slug', async () => {
    const r = await req('/start/check-subdomain?s=admin');
    assert(r.json && r.json.available === false, `expected available:false, got ${JSON.stringify(r.json)}`);
    return `reason: ${r.json.reason}`;
  });

  await check('GET /start/pricing returns plan matrix', async () => {
    const r = await req('/start/pricing');
    assert(r.status === 200 && r.json && r.json.plans, `bad response ${r.status}`);
    for (const k of ['monthly', 'quarterly', 'annual', 'lifetime']) {
      assert(r.json.plans[k] && r.json.plans[k].amount, `missing plan "${k}"`);
    }
    return `plans: ${Object.keys(r.json.plans).join(', ')}`;
  });

  await check('GET /start/check-ref rejects a bogus code', async () => {
    const r = await req('/start/check-ref?code=NOT-A-REAL-CODE');
    assert(r.json && r.json.valid === false, `expected valid:false, got ${JSON.stringify(r.json)}`);
    return 'valid:false';
  });
}

// deterministic-ish suffix without Math.random (kept stable within a run)
function hashArgs() {
  const s = process.pid + '|' + process.hrtime.bigint().toString();
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// ── full signup → login → teardown ─────────────────────────────────────────────
async function fullSignupCheck() {
  const suffix = Math.abs(hashArgs()).toString(36).slice(0, 6);
  const slug = `smoke-${suffix}`;
  const domain = `${slug}.madladslab.com`;
  const email = `smoketest+${suffix}@madladslab.com`;
  const dbName = `slab_${slug}`;

  console.log(`\n\x1b[1mFull signup flow\x1b[0m  \x1b[2m(tenant ${domain})\x1b[0m`);

  let created = false;
  let adminUrl = null;
  let dbHost = 'atlas'; // real cluster is read from the tenant doc below

  try {
    await check('POST /start/signup provisions a preview tenant', async () => {
      const r = await req('/start/signup', {
        method: 'POST',
        body: {
          subdomain: slug,
          brandName: 'Smoke Test Co',
          brandLocation: 'Denver, CO',
          email,
          password: 'SmokeTest123',
          design: 'classic',
          tagline: 'automated smoke test',
        },
      });
      assert(r.status === 200 && r.json && r.json.ok, `bad response ${r.status}: ${r.text.slice(0, 200)}`);
      assert(r.json.domain === domain, `domain mismatch: ${r.json.domain}`);
      assert(/\/admin\?token=/.test(r.json.adminUrl || ''), 'no auto-login adminUrl returned');
      created = true;
      adminUrl = r.json.adminUrl;
      return domain;
    });

    // If provisioning failed there is nothing else to verify.
    if (!created) return;

    await check('Tenant registry doc exists (status: preview)', async () => {
      const t = await getSlabDb().collection('tenants').findOne({ 'meta.subdomain': slug });
      assert(t, 'tenant doc not found in registry');
      assert(t.status === 'preview', `expected status preview, got ${t.status}`);
      assert(t.db === dbName, `db name mismatch: ${t.db}`);
      dbHost = t.dbHost || 'atlas';
      return `db ${t.db} on ${dbHost}`;
    });

    await check('Tenant DB is seeded (owner user + design)', async () => {
      const tdb = getTenantDb(dbName, dbHost);
      const owner = await tdb.collection('users').findOne({ email: email.toLowerCase() })
        || await tdb.collection('users').findOne({ email });
      assert(owner, 'owner user not seeded in tenant DB');
      assert(owner.isAdmin && owner.isOwner, 'owner missing admin/owner flags');
      const designCount = await tdb.collection('design').countDocuments();
      assert(designCount > 0, 'design collection empty');
      return `owner ok, ${designCount} design keys`;
    });

    await check('Signup is recorded in the funnel', async () => {
      const s = await getSlabDb().collection('signups').findOne({ subdomain: slug });
      assert(s, 'signup record not found');
      assert(s.email === email.toLowerCase(), `email mismatch: ${s.email}`);
      return `source: ${s.source}`;
    });

    // The real payoff: does the returned auto-login token actually log into sLab?
    let sessionCookie = null;
    await check('Auto-login token opens an admin session', async () => {
      const token = adminUrl.split('token=')[1];
      const r1 = await req('/admin?token=' + token, { host: domain });
      assert(r1.status === 302, `expected 302 redirect, got ${r1.status}`);
      sessionCookie = readSlabCookie(r1.headers.get('set-cookie'));
      assert(sessionCookie, 'no slab_token cookie set by token exchange');
      const loc = r1.headers.get('location') || '';
      assert(!/\/admin\/login/.test(loc), `bounced to login: ${loc}`);
      return `→ ${loc}`;
    });

    await check('Admin panel accepts the session (lands in sLab)', async () => {
      assert(sessionCookie, 'no session cookie from previous step');
      const r2 = await req('/admin', { host: domain, cookie: sessionCookie });
      const loc = r2.headers.get('location') || '';
      // Success = a 200 dashboard, or an authenticated redirect deeper into /admin
      // (a fresh tenant is sent to /admin/brand-builder). Only a bounce to
      // /admin/login means the session was rejected.
      if (r2.status === 200) return '200 admin dashboard';
      assert(r2.status === 302 && loc.startsWith('/admin') && !loc.startsWith('/admin/login'),
        `session rejected — got ${r2.status} → ${loc}`);
      return `302 → ${loc} (onboarding)`;
    });

  } finally {
    if (created && !KEEP) await teardown({ slug, domain, dbName, dbHost });
    else if (created && KEEP) console.log(`\n\x1b[33m--keep set: leaving ${domain} (db ${dbName}) in place.\x1b[0m`);
  }
}

// ── teardown: undo everything the signup created ───────────────────────────────
async function teardown({ slug, domain, dbName, dbHost }) {
  console.log(`\n\x1b[1mTeardown\x1b[0m  \x1b[2m(${domain})\x1b[0m`);

  // dbHost may not have been captured if an earlier check failed — recover it
  // from the registry doc before we delete it.
  if (!dbHost || dbHost === 'atlas') {
    const t = await getSlabDb().collection('tenants').findOne({ 'meta.subdomain': slug });
    if (t?.dbHost) dbHost = t.dbHost;
  }

  await check('Drop tenant database', async () => {
    const tdb = getTenantDb(dbName, dbHost);
    try {
      await tdb.dropDatabase();
      return `${dbName} (dropDatabase)`;
    } catch (e) {
      // The self-hosted (gpu) cluster user isn't authorized to dropDatabase.
      // Dropping every collection leaves an empty DB, which Mongo auto-removes.
      const cols = await tdb.listCollections().toArray();
      for (const c of cols) { try { await tdb.collection(c.name).drop(); } catch { /* ignore */ } }
      const left = await tdb.listCollections().toArray();
      assert(left.length === 0, `${left.length} collections could not be dropped`);
      return `${dbName} (${cols.length} collections dropped)`;
    }
  });

  await check('Delete tenant registry doc', async () => {
    const r = await getSlabDb().collection('tenants').deleteOne({ 'meta.subdomain': slug });
    assert(r.deletedCount === 1, `deleted ${r.deletedCount} tenant docs`);
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
    if (!rec) return 'no DNS record found (nothing to delete)';
    const del = await fetch(`${base}/${rec.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.LINODE_API_TOKEN}` },
    });
    if (!del.ok) throw new Error(`Linode delete failed: ${del.status}`);
    return `removed A record ${rec.id}`;
  });
}

// ── main ───────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\x1b[1msLab onboarding smoke test\x1b[0m — mode: ${FULL ? 'FULL (writes)' : 'read-only'}`);

  // reachability
  try {
    const r = await req('/start');
    if (r.status !== 200) { console.error(`\n\x1b[31mCannot reach ${BASE}/start (status ${r.status}). Is slab running?\x1b[0m`); process.exit(2); }
  } catch (err) {
    console.error(`\n\x1b[31mCannot reach ${BASE} — ${err.message}\x1b[0m\nHint: slab listens on 127.0.0.1:3602 locally, or pass --url https://slab.madladslab.com`);
    process.exit(2);
  }

  await readOnlyChecks();

  if (FULL) {
    await connectDB();
    await fullSignupCheck();
  } else {
    console.log(`\n\x1b[2mRun with --full to exercise a real signup + login + teardown.\x1b[0m`);
  }

  console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('\n\x1b[31mSmoke test crashed:\x1b[0m', err);
  process.exit(3);
});
