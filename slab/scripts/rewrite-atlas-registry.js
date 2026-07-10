/**
 * Companion to rewrite-asset-urls.js — rewrites Linode->CDN asset URLs in the
 * ATLAS slab registry/platform DB (getSlabDb), which the tenant-only script skips.
 * Same pure host-prefix swap, same deep-walk, dry-run + revert supported.
 *   node scripts/rewrite-atlas-registry.js [--dry-run] [--revert]
 */
import { connectDB, getSlabDb } from '../plugins/mongo.js';

const LINODE = 'https://madladslab.us-ord-1.linodeobjects.com/';
const CDN = 'https://cdn.madladslab.com/';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const revert = args.includes('--revert');
const FROM = revert ? CDN : LINODE;
const TO = revert ? LINODE : CDN;

function deepReplace(val) {
  if (typeof val === 'string') {
    return val.includes(FROM) ? { v: val.split(FROM).join(TO), changed: true } : { v: val, changed: false };
  }
  if (Array.isArray(val)) {
    let changed = false;
    const out = val.map(x => { const r = deepReplace(x); if (r.changed) changed = true; return r.v; });
    return { v: out, changed };
  }
  if (val && val.constructor === Object) {
    let changed = false;
    const out = {};
    for (const [k, x] of Object.entries(val)) { const r = deepReplace(x); if (r.changed) changed = true; out[k] = r.v; }
    return { v: out, changed };
  }
  return { v: val, changed: false };
}

async function main() {
  await connectDB();
  const db = getSlabDb();
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Rewriting ${FROM} -> ${TO}\nATLAS registry DB: ${db.databaseName}\n`);
  let docsChanged = 0; const byCol = {};
  for (const c of await db.listCollections().toArray()) {
    const col = db.collection(c.name);
    for (const doc of await col.find({}).toArray()) {
      const { _id, ...rest } = doc;
      const r = deepReplace(rest);
      if (!r.changed) continue;
      docsChanged++; byCol[c.name] = (byCol[c.name] || 0) + 1;
      if (!dryRun) await col.replaceOne({ _id }, { _id, ...r.v });
    }
  }
  console.log(`  by collection: ${JSON.stringify(byCol)}`);
  console.log(`\n${dryRun ? '[DRY RUN] would change' : 'changed'} ${docsChanged} docs in the atlas registry DB.`);
}
main().then(() => process.exit(0)).catch(e => { console.error('REWRITE FAILED:', e.message); process.exit(1); });
