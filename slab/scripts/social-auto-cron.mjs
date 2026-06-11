#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// social-auto-cron.mjs — Auto social-suggestion cron
//
// Opt-in: with --all, only processes tenants whose registry doc has
// autoSocial.enabled === true. Default mode = suggest (creates review drafts in
// the admin Suggestions dashboard — does NOT post). Use --mode=publish to fire.
// Core generation lives in plugins/autoSocial.js (shared with the admin
// "Generate now" button). Stays on the Ollama discipline.
//
// Usage:
//   node scripts/social-auto-cron.mjs --all                       # suggestions for opted-in tenants
//   node scripts/social-auto-cron.mjs --tenant=slab_madladslab --count=5
//   node scripts/social-auto-cron.mjs --tenant=slab_madladslab --mode=publish --platforms=instagram
// ─────────────────────────────────────────────────────────────────────────────
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { generateForTenant } from '../plugins/autoSocial.js';
import { runListeners, trendSummary, listKeywords } from '../plugins/socialListen.js';

process.on('unhandledRejection', e => console.log('[auto-social] unhandledRejection:', e?.message || e));

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const COUNT = parseInt(args.count, 10) || 5;
const MODE = args.mode === 'publish' ? 'publish' : 'suggest';
const PLATFORMS = typeof args.platforms === 'string' ? args.platforms.split(',').map(s => s.trim()).filter(Boolean) : null;
const LISTEN_ONLY = !!args['listen-only'];
const NO_LISTEN = !!args['no-listen'];
const log = (...a) => console.log('[auto-social]', ...a);

async function main() {
  await connectDB();
  const slab = getSlabDb();
  let tenants;
  if (args.all) {
    tenants = LISTEN_ONLY
      ? await slab.collection('tenants').find({ status: 'active' }).toArray()
      : await slab.collection('tenants').find({ status: 'active', 'autoSocial.enabled': true }).toArray();
    log(`${LISTEN_ONLY ? 'Listener' : 'Opt-in'} tenants: ${tenants.length}`);
  } else if (args.tenant) {
    tenants = await slab.collection('tenants').find({ db: args.tenant }).toArray();
  } else { console.error('Specify --tenant=<db> or --all'); process.exit(1); }
  if (!tenants.length) { log('No matching tenants — nothing to do.'); process.exit(0); }

  log(`mode=${MODE} count=${COUNT} platforms=${PLATFORMS ? PLATFORMS.join(',') : 'all-connected'}`);
  for (const t of tenants) {
    try {
      const db = getTenantDb(t.db);
      // Listener automation: refresh the trend digest for any tenant with keywords.
      let trends = '';
      if (!NO_LISTEN) {
        try {
          const kws = await listKeywords(db);
          if (kws.length) {
            const lr = await runListeners(db, t);
            trends = await trendSummary(db, { days: 10, limit: 20 });
            log(`↻ ${t.db}: listeners refreshed (${lr.keywords} kw, +${lr.items} items)`);
          }
        } catch (e) { log(`  ${t.db}: listener refresh failed: ${e.message}`); }
      }
      if (LISTEN_ONLY) continue;
      const perTenantCount = t.autoSocial?.count || COUNT;
      // Per-tenant auto-publish: when the tenant approved auto-posting, the cron
      // publishes live; otherwise it only drops review suggestions.
      const tenantMode = t.autoSocial?.autoPublish ? 'publish' : MODE;
      const res = await generateForTenant(t, db, { count: perTenantCount, mode: tenantMode, platforms: PLATFORMS, trends, createdBy: 'social-auto-cron' });
      log(`✓ ${res.tenant}: created ${res.created} | published ${res.published} | failed ${res.failed}${res.note ? ' | ' + res.note : ''}`);
    } catch (e) { log(`✗ ${t.db}: ${e.message}`); }
  }
  log('DONE');
  process.exit(0);
}
main().catch(e => { console.error('[auto-social] FATAL', e); process.exit(1); });
