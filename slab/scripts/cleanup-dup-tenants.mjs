/**
 * Remove duplicate tenant registry docs from slab.tenants. For each db with >1
 * doc, keep the canonical (domain = *.madladslab.com wildcard, highest hits) and
 * delete the stray(s) — BUT only if the stray holds no unique data beyond the
 * benign `meta.isPrimaryAlias` marker. Also lowercases the canonical's custom
 * domain fields so case-sensitive host matching in lookupTenant can't miss.
 *
 * Full backups of every affected doc are written before any delete. Dry-run
 * by default.
 *
 *   node scripts/cleanup-dup-tenants.mjs            # DRY RUN
 *   node scripts/cleanup-dup-tenants.mjs --commit
 *
 * After --commit: the running server caches tenants for 5 min (keyed by host);
 * deletions are invisible today (canonical already serves), but restart
 * srv-slab.service if you want the registry cache cleared immediately.
 *
 * Run from /srv/slab.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB, getSlabDb } from '../plugins/mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', 'registry-dup-backups');

const COMMIT = process.argv.includes('--commit');
const WILDCARD = /\.madladslab\.com$/i;
const BENIGN_STRAY_ONLY = new Set(['meta.isPrimaryAlias']); // markers safe to discard

const isLeaf = (v) => v === null || typeof v !== 'object';
function leafPaths(obj, prefix, out) {
  if (isLeaf(obj)) { out[prefix] = obj; return out; }
  for (const k of Object.keys(obj)) leafPaths(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}
// Paths where stray has a non-empty value that the canonical lacks entirely.
function strayOnlyPaths(canonical, stray) {
  const c = {}, s = {};
  for (const sub of ['brand', 'public', 'meta', 'secrets']) {
    leafPaths(canonical[sub] || {}, sub, c);
    leafPaths(stray[sub] || {}, sub, s);
  }
  const out = [];
  for (const [p, v] of Object.entries(s)) {
    const cv = c[p];
    const strayHasValue = v !== undefined && v !== '' && v !== null && v !== false;
    if ((cv === undefined) && strayHasValue && !BENIGN_STRAY_ONLY.has(p)) out.push({ path: p, value: v });
  }
  return out;
}

await connectDB();
const slab = getSlabDb();
const all = await slab.collection('tenants').find({}).toArray();
const byDb = new Map();
for (const t of all) { const k = t.db; if (!byDb.has(k)) byDb.set(k, []); byDb.get(k).push(t); }

if (COMMIT && !fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
console.log(`\n${COMMIT ? '*** COMMIT ***' : '--- DRY RUN (no writes) ---'}`);

const toDelete = [];
const casingFixes = [];
let unsafe = 0;

for (const [db, docs] of byDb) {
  if (docs.length < 2) continue;
  const canonical = docs.slice().sort((a, b) =>
    (WILDCARD.test(b.domain || '') - WILDCARD.test(a.domain || '')) ||
    ((b.meta?.hitsTotal || 0) - (a.meta?.hitsTotal || 0)))[0];
  const strays = docs.filter(d => d !== canonical);

  console.log('═'.repeat(80));
  console.log(`${db}\n  KEEP  ${canonical._id} (${canonical.domain}) hits=${canonical.meta?.hitsTotal ?? 0}`);

  for (const s of strays) {
    const blockers = strayOnlyPaths(canonical, s);
    if (blockers.length) {
      unsafe++;
      console.log(`  SKIP  ${s._id} (${s.domain}) — has ${blockers.length} unique value(s), NOT deleting:`);
      for (const b of blockers) console.log(`          ${b.path} = ${JSON.stringify(b.value)}`);
    } else {
      toDelete.push({ db, canonical, stray: s });
      console.log(`  DROP  ${s._id} (${s.domain}) hits=${s.meta?.hitsTotal ?? 0} — no unique data`);
    }
  }

  // Casing hygiene on the canonical's custom-domain fields.
  const md = canonical.meta?.customDomain, pd = canonical.public?.customDomain;
  const set = {};
  if (md && md !== md.toLowerCase()) set['meta.customDomain'] = md.toLowerCase();
  if (pd && pd !== pd.toLowerCase()) set['public.customDomain'] = pd.toLowerCase();
  if (Object.keys(set).length) {
    casingFixes.push({ _id: canonical._id, db, set });
    console.log(`  FIX   ${canonical._id} casing → ${JSON.stringify(set)}`);
  }
}

console.log('═'.repeat(80));
console.log(`\n${toDelete.length} stray(s) to delete · ${casingFixes.length} casing fix(es) · ${unsafe} skipped (unsafe)`);

if (!COMMIT) { console.log('\nDRY RUN — nothing written. Add --commit to apply.'); process.exit(0); }

// Backup every doc of every affected db first.
const affected = new Set([...toDelete.map(x => x.db), ...casingFixes.map(x => x.db)]);
for (const db of affected) {
  fs.writeFileSync(path.join(BACKUP_DIR, `${db}.json`),
    JSON.stringify(byDb.get(db), null, 2));
}
console.log(`\nBackups → ${BACKUP_DIR}`);

for (const f of casingFixes) {
  await slab.collection('tenants').updateOne({ _id: f._id }, { $set: f.set });
  console.log(`  ✓ casing fixed: ${f.db}`);
}
for (const d of toDelete) {
  await slab.collection('tenants').deleteOne({ _id: d.stray._id });
  console.log(`  ✓ deleted stray ${d.stray._id} (${d.stray.domain})`);
}

console.log(`\nDone. ${toDelete.length} deleted, ${casingFixes.length} fixed. Backups in ${BACKUP_DIR}`);
process.exit(0);
