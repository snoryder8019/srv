/**
 * READ-ONLY. Dump the full registry docs for tenants that have >1 doc in
 * slab.tenants, so we can see how the duplicates differ before merging.
 * Run from /srv/slab:  node scripts/inspect-dup-tenants.mjs
 */
import 'dotenv/config';
import { connectDB, getSlabDb } from '../plugins/mongo.js';

await connectDB();
const slab = getSlabDb();
const all = await slab.collection('tenants').find({}).toArray();

// Group by db (the real tenant identity).
const byDb = new Map();
for (const t of all) {
  const k = t.db || '(no-db)';
  if (!byDb.has(k)) byDb.set(k, []);
  byDb.get(k).push(t);
}

const pick = (t) => ({
  _id: String(t._id),
  domain: t.domain,
  db: t.db,
  dbHost: t.dbHost,
  status: t.status,
  'meta.subdomain': t.meta?.subdomain,
  'meta.customDomain': t.meta?.customDomain,
  'public.customDomain': t.public?.customDomain,
  createdAt: t.createdAt,
  'meta.provisionedAt': t.meta?.provisionedAt,
  'meta.lastSeenAt': t.meta?.lastSeenAt,
  'meta.hitsTotal': t.meta?.hitsTotal,
  hasSecrets: !!(t.secrets && Object.keys(t.secrets).length),
  hasOAuth: !!(t.public?.oauth || t.secrets?.oauth),
  brandName: t.brand?.name,
  topLevelKeys: Object.keys(t).length,
});

console.log(`\n${all.length} total docs · ${byDb.size} unique dbs\n`);
for (const [db, docs] of byDb) {
  if (docs.length < 2) continue;
  console.log('═'.repeat(90));
  console.log(`DB: ${db}  — ${docs.length} docs`);
  for (const d of docs) {
    console.log(JSON.stringify(pick(d), null, 2));
  }
  // Field-level diff summary
  const keysUnion = new Set(docs.flatMap(d => Object.keys(d)));
  const diffs = [];
  for (const k of keysUnion) {
    const vals = docs.map(d => JSON.stringify(d[k]));
    if (new Set(vals).size > 1) diffs.push(k);
  }
  console.log('→ top-level fields that DIFFER between docs:', diffs.join(', ') || '(none — identical)');
  console.log('');
}
process.exit(0);
