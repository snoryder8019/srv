#!/usr/bin/env node
/**
 * One-time: grandfather every tenant that exists TODAY so the new recurring-
 * billing enforcement can never restrict anything currently live. Only NEW
 * subscriptions created after this runs are subject to renewal/lapse.
 *
 * Sets meta.billingGrandfathered = true on all tenants. Idempotent — safe to
 * re-run. Lifetime/pro/one-time tenants are covered too (belt and suspenders;
 * the sweep already skips non-recurring tenants).
 *
 *   node scripts/grandfather-tenants.mjs           # dry run — lists what it would set
 *   node scripts/grandfather-tenants.mjs --apply    # actually set the flag
 */
import { connectDB, getSlabDb } from '../plugins/mongo.js';

const APPLY = process.argv.includes('--apply');

await connectDB();
const slab = getSlabDb();

const all = await slab.collection('tenants')
  .find({}, { projection: { domain: 1, status: 1, 'meta.plan': 1, 'meta.billingGrandfathered': 1, 'meta.recurring': 1 } })
  .toArray();

const already = all.filter((t) => t.meta?.billingGrandfathered);
const toSet = all.filter((t) => !t.meta?.billingGrandfathered);

console.log(`Total tenants: ${all.length}`);
console.log(`Already grandfathered: ${already.length}`);
console.log(`Will grandfather: ${toSet.length}`);
for (const t of toSet) {
  console.log(`  • ${t.domain}  [${t.status}/${t.meta?.plan || 'free'}${t.meta?.recurring ? '/recurring' : ''}]`);
}

if (!APPLY) {
  console.log('\nDry run — re-run with --apply to set meta.billingGrandfathered = true.');
  process.exit(0);
}

const r = await slab.collection('tenants').updateMany(
  { 'meta.billingGrandfathered': { $ne: true } },
  { $set: { 'meta.billingGrandfathered': true, 'meta.grandfatheredAt': new Date(), updatedAt: new Date() } },
);
console.log(`\nApplied — matched ${r.matchedCount}, modified ${r.modifiedCount}.`);
process.exit(0);
