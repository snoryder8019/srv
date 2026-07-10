/**
 * fix-cdn-urls.js — rewrite internal MinIO endpoint URLs to the public CDN.
 *
 * The MinIO cutover left `multer-s3`'s `file.location` (and anything persisted
 * from it — brand logos, portfolio images, section/client/ticket files) pointing
 * at the INTERNAL endpoint, e.g.
 *     http://winhost:9000/madladslab/<key>
 * which is unreachable from the browser. Public delivery is CDN_BASE/<key>, e.g.
 *     https://cdn.madladslab.com/<key>
 * The S3 key is identical, so this is a pure host+bucket-prefix swap on the
 * stored string. This script deep-scans every collection of every tenant DB
 * (plus the slab registry) and rewrites matching string values in place,
 * preserving ObjectId/Date/other BSON types.
 *
 * Usage:
 *   node scripts/fix-cdn-urls.js               # DRY RUN — reports counts, writes nothing
 *   node scripts/fix-cdn-urls.js --apply       # perform the rewrite
 *   node scripts/fix-cdn-urls.js --tenant=<dbName>   # limit to one tenant DB
 *   node scripts/fix-cdn-urls.js --apply --tenant=slab_w2marketing
 */
import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

const APPLY = process.argv.includes('--apply');
const TENANT_ARG = (process.argv.find(a => a.startsWith('--tenant=')) || '').split('=')[1] || null;

// Build the bad→good rewrite from config so it tracks the real environment.
const host = String(config.LINODE_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); // winhost:9000
const bucket = config.LINODE_BUCKET;                                                              // madladslab
const good = String(config.CDN_BASE || '').replace(/\/$/, '') + '/';                              // https://cdn.madladslab.com/
if (!host || !bucket || !config.CDN_BASE) {
  console.error('Missing LINODE_URL / LINODE_BUCKET / CDN_BASE in config — aborting.');
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BAD_RE = new RegExp(`https?://${esc(host)}/${esc(bucket)}/`, 'g');
console.log(`Rewrite: /https?:\\/\\/${host}\\/${bucket}\\// → ${good}   [${APPLY ? 'APPLY' : 'DRY RUN'}]`);

const fixString = (x) => x.replace(BAD_RE, good); // global replace resets lastIndex itself

// Recursively rewrite string leaves in place. Returns true if anything changed.
function fixInPlace(v) {
  let changed = false;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x === 'string') { const nx = fixString(x); if (nx !== x) { v[i] = nx; changed = true; } }
      else if (x && typeof x === 'object') { if (fixInPlace(x)) changed = true; }
    }
  } else if (v && typeof v === 'object' && (v.constructor === Object || v.constructor === undefined)) {
    for (const k in v) {
      const x = v[k];
      if (typeof x === 'string') { const nx = fixString(x); if (nx !== x) { v[k] = nx; changed = true; } }
      else if (x && typeof x === 'object') { if (fixInPlace(x)) changed = true; }
    }
  }
  return changed;
}

async function processDb(db, label) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  let dbDocs = 0, dbColls = 0;
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const coll = db.collection(name);
    let collDocs = 0;
    const cursor = coll.find({}, { noCursorTimeout: false });
    for await (const doc of cursor) {
      if (fixInPlace(doc)) {
        collDocs++;
        if (APPLY) await coll.replaceOne({ _id: doc._id }, doc);
      }
    }
    if (collDocs) { dbColls++; dbDocs += collDocs; console.log(`  ${label}.${name}: ${collDocs} doc(s)`); }
  }
  return { dbDocs, dbColls };
}

const registry = new MongoClient(config.DB_URL);
let tenantClient = null;
let totalDocs = 0, totalDbs = 0;
try {
  await registry.connect();
  const slabDb = registry.db(config.SLAB_DB);

  if (config.TENANT_DB_URL) {
    try { tenantClient = new MongoClient(config.TENANT_DB_URL, { serverSelectionTimeoutMS: 8000 }); await tenantClient.connect(); }
    catch (e) { console.warn(`gpu cluster unavailable (${e.message}) — gpu tenants will be skipped`); tenantClient = null; }
  }

  const tenants = await slabDb.collection('tenants').find({}, { projection: { db: 1, dbHost: 1, name: 1, s3Prefix: 1 } }).toArray();
  const targets = [];
  // The registry DB itself may hold platform-level asset URLs.
  if (!TENANT_ARG || TENANT_ARG === config.SLAB_DB) targets.push({ db: slabDb, label: config.SLAB_DB });
  for (const t of tenants) {
    if (!t.db) continue;
    if (TENANT_ARG && t.db !== TENANT_ARG && t.s3Prefix !== TENANT_ARG && t.name !== TENANT_ARG) continue;
    const onGpu = t.dbHost === 'gpu';
    const cli = onGpu ? tenantClient : registry;
    if (onGpu && !cli) { console.warn(`  skip ${t.db} (gpu cluster down)`); continue; }
    targets.push({ db: cli.db(t.db), label: t.db });
  }

  for (const { db, label } of targets) {
    const { dbDocs, dbColls } = await processDb(db, label);
    if (dbDocs) { totalDbs++; totalDocs += dbDocs; console.log(`→ ${label}: ${dbDocs} doc(s) in ${dbColls} collection(s)\n`); }
  }

  console.log(`\n${APPLY ? 'Rewrote' : 'Would rewrite'} ${totalDocs} doc(s) across ${totalDbs} database(s).`);
  if (!APPLY && totalDocs) console.log('Re-run with --apply to perform the rewrite.');
} finally {
  await registry.close().catch(() => {});
  if (tenantClient) await tenantClient.close().catch(() => {});
}
