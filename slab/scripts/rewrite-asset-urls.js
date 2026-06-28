/**
 * Rewrite stored asset URLs in tenant DBs from Linode Object Storage to the
 * self-hosted MinIO CDN. Keys are identical between the two, so this is a pure
 * host-prefix swap. Deep-walks EVERY string value in every doc (covers rich-text
 * / HTML fields, not just known url columns). Relative `bucketKey` fields are
 * untouched (they don't contain the host).
 *
 *   node scripts/rewrite-asset-urls.js <slug|--all> [--dry-run] [--revert]
 *
 *   <slug>      one tenant (db = slab_<slug>);  --all = every gpu-hosted tenant
 *   --dry-run   report changes, write nothing
 *   --revert    swap direction (cdn → Linode) — undo a cutover
 *
 * PRECONDITION: objects must already be mirrored to MinIO (cdn serves them),
 * or rewritten URLs will 404. Restart slab after a real run (view caches).
 */
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';

const LINODE = 'https://madladslab.us-ord-1.linodeobjects.com/';
const CDN = 'https://cdn.madladslab.com/';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const revert = args.includes('--revert');
const all = args.includes('--all');
const slug = args.find(a => !a.startsWith('--'));

const FROM = revert ? CDN : LINODE;
const TO = revert ? LINODE : CDN;

if (!slug && !all) {
  console.error('Usage: node scripts/rewrite-asset-urls.js <slug|--all> [--dry-run] [--revert]');
  process.exit(1);
}

/** Recursively replace FROM→TO in every string, preserving non-string types. */
function deepReplace(val) {
  if (typeof val === 'string') {
    return val.includes(FROM) ? { v: val.split(FROM).join(TO), changed: true } : { v: val, changed: false };
  }
  if (Array.isArray(val)) {
    let changed = false;
    const out = val.map(x => { const r = deepReplace(x); if (r.changed) changed = true; return r.v; });
    return { v: out, changed };
  }
  // Plain objects only — leave ObjectId/Date/Buffer/etc. as-is.
  if (val && val.constructor === Object) {
    let changed = false;
    const out = {};
    for (const [k, x] of Object.entries(val)) { const r = deepReplace(x); if (r.changed) changed = true; out[k] = r.v; }
    return { v: out, changed };
  }
  return { v: val, changed: false };
}

async function rewriteDb(dbName) {
  const db = getTenantDb(dbName, 'gpu');
  let docsChanged = 0, fieldsTouched = 0;
  const sample = [];
  for (const c of await db.listCollections().toArray()) {
    const col = db.collection(c.name);
    for (const doc of await col.find({}).toArray()) {
      const { _id, ...rest } = doc;
      const r = deepReplace(rest);
      if (!r.changed) continue;
      docsChanged++;
      fieldsTouched++;
      if (sample.length < 3) {
        const before = JSON.stringify(rest).match(new RegExp(FROM.replace(/[.\/]/g, '\\$&') + '[^"\\\\]*'));
        if (before) sample.push(`${c.name}: ${before[0]} → ${before[0].replace(FROM, TO)}`);
      }
      if (!dryRun) await col.replaceOne({ _id }, { _id, ...r.v });
    }
  }
  return { dbName, docsChanged, sample };
}

async function main() {
  await connectDB();
  const slab = getSlabDb();
  let dbs;
  if (all) {
    const t = await slab.collection('tenants').find({ dbHost: 'gpu' }).project({ db: 1 }).toArray();
    dbs = [...new Set(t.map(x => x.db))];
  } else {
    dbs = [`slab_${slug}`];
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Rewriting ${FROM} → ${TO}\nTenant DBs: ${dbs.join(', ')}\n`);
  let grand = 0;
  for (const dbName of dbs) {
    const r = await rewriteDb(dbName);
    grand += r.docsChanged;
    console.log(`  ${dbName.padEnd(24)} docs changed: ${r.docsChanged}`);
    r.sample.forEach(s => console.log(`       e.g. ${s}`));
  }
  console.log(`\n${dryRun ? '[DRY RUN] would change' : 'changed'} ${grand} docs total.`);
  if (!dryRun) console.log('>>> Restart slab so view caches pick up the new URLs.');
}

main().then(() => process.exit(0)).catch(e => { console.error('REWRITE FAILED:', e.message); process.exit(1); });
