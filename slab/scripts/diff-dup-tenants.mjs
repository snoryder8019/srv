/**
 * READ-ONLY deep diff of duplicate tenant registry docs. For each db with >1
 * doc, picks canonical (domain = *.madladslab.com wildcard) vs stray (the other)
 * and reports every differing leaf path in brand/public/meta/secrets so we can
 * confirm the stray holds nothing worth keeping before deleting it.
 * Run from /srv/slab:  node scripts/diff-dup-tenants.mjs
 */
import 'dotenv/config';
import { connectDB, getSlabDb } from '../plugins/mongo.js';

await connectDB();
const slab = getSlabDb();
const all = await slab.collection('tenants').find({}).toArray();

const byDb = new Map();
for (const t of all) { const k = t.db; if (!byDb.has(k)) byDb.set(k, []); byDb.get(k).push(t); }

const WILDCARD = /\.madladslab\.com$/i;
const isLeaf = (v) => v === null || typeof v !== 'object';

// Collect differing leaf paths between two objects.
function diffPaths(a, b, prefix, out) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const pa = a ? a[k] : undefined, pb = b ? b[k] : undefined;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(pa) || isLeaf(pb)) {
      if (JSON.stringify(pa) !== JSON.stringify(pb)) out.push({ path, canonical: pa, stray: pb });
    } else {
      diffPaths(pa, pb, path, out);
    }
  }
}

for (const [db, docs] of byDb) {
  if (docs.length < 2) continue;
  const canonical = docs.find(d => WILDCARD.test(d.domain || '')) || docs[0];
  const strays = docs.filter(d => d !== canonical);
  console.log('═'.repeat(88));
  console.log(`DB: ${db}`);
  console.log(`  canonical: ${canonical._id} (${canonical.domain})  hits=${canonical.meta?.hitsTotal ?? 0} lastSeen=${canonical.meta?.lastSeenAt || '-'}`);
  for (const s of strays) {
    console.log(`  STRAY:     ${s._id} (${s.domain})  hits=${s.meta?.hitsTotal ?? 0} lastSeen=${s.meta?.lastSeenAt || '-'}`);
    for (const sub of ['brand', 'public', 'meta', 'secrets']) {
      const out = [];
      diffPaths(canonical[sub], s[sub], sub, out);
      if (!out.length) { console.log(`    ${sub}: identical`); continue; }
      console.log(`    ${sub}: ${out.length} differing path(s)`);
      for (const d of out) {
        // Redact secret values, show only presence.
        const cv = sub === 'secrets' ? (d.canonical !== undefined ? '<set>' : '(absent)') : JSON.stringify(d.canonical);
        const sv = sub === 'secrets' ? (d.stray !== undefined ? '<set>' : '(absent)') : JSON.stringify(d.stray);
        // Flag paths where the STRAY has a value the canonical lacks — the only worrying case.
        const strayOnly = (d.canonical === undefined && d.stray !== undefined && d.stray !== '' && d.stray !== null);
        console.log(`      ${strayOnly ? '⚠ STRAY-ONLY ' : '  '}${d.path}: canonical=${cv}  stray=${sv}`);
      }
    }
  }
  console.log('');
}
process.exit(0);
