/**
 * Migrate a tenant's database from the Atlas shared cluster to the self-hosted
 * GPU mongod (over the tunnel). Non-destructive: copies + verifies, then flips
 * the registry `dbHost` pointer. The Atlas copy is left intact as a fallback.
 *
 * Usage:
 *   node scripts/migrate-tenant-db.js <slug> [--no-flip] [--force]
 *
 *   <slug>      tenant subdomain, e.g. "greeality" (db = slab_<slug>)
 *   --no-flip   copy + verify only; do NOT change dbHost (dry cutover)
 *   --force     allow copying even if the destination already has data
 *
 * After a real flip, RESTART slab so its in-memory host map + tenant cache
 * pick up the new routing.
 */
import { connectDB, getSlabDb, getTenantDb, tenantClusterReady, registerTenantHost } from '../plugins/mongo.js';

const slug = process.argv[2];
const noFlip = process.argv.includes('--no-flip');
const force = process.argv.includes('--force');

if (!slug || slug.startsWith('--')) {
  console.error('Usage: node scripts/migrate-tenant-db.js <slug> [--no-flip] [--force]');
  process.exit(1);
}

const dbName = `slab_${slug}`;

async function main() {
  await connectDB();
  if (!tenantClusterReady()) throw new Error('GPU tenant cluster not connected — check the tunnel (127.0.0.1:27117).');

  const slab = getSlabDb();
  const tenantDocs = await slab.collection('tenants').find({ db: dbName }).toArray();
  if (!tenantDocs.length) throw new Error(`No tenant registry docs reference db "${dbName}".`);
  console.log(`Registry docs for ${dbName}: ${tenantDocs.map(d => `${d.domain}[${d.dbHost || 'atlas'}]`).join(', ')}`);

  const src = getTenantDb(dbName, 'atlas');
  const dest = getTenantDb(dbName, 'gpu');

  const destCols = await dest.listCollections().toArray();
  const destNonEmpty = [];
  for (const c of destCols) {
    if (await dest.collection(c.name).countDocuments() > 0) destNonEmpty.push(c.name);
  }
  if (destNonEmpty.length && !force) {
    throw new Error(`Destination ${dbName} on GPU already has data in: ${destNonEmpty.join(', ')}. Re-run with --force to overwrite those collections.`);
  }

  const cols = await src.listCollections().toArray();
  console.log(`\nCopying ${cols.length} collections: ${dbName} (atlas → gpu)\n`);

  const report = [];
  for (const c of cols) {
    const name = c.name;
    const srcCol = src.collection(name);
    const destCol = dest.collection(name);
    const docs = await srcCol.find({}).toArray();

    if (force) await destCol.deleteMany({}); // clean overwrite of this collection

    if (docs.length) {
      await destCol.insertMany(docs, { ordered: false }).catch(e => {
        // ignore dup-key on re-run (_id preserved); surface anything else
        if (!String(e.message).includes('E11000')) throw e;
      });
    } else {
      await dest.createCollection(name).catch(() => {});
    }

    // Recreate non-_id indexes
    const idx = await srcCol.indexes();
    for (const ix of idx) {
      if (ix.name === '_id_') continue;
      const { key, name: ixName, v, ns, background, ...opts } = ix;
      await destCol.createIndex(key, { name: ixName, ...opts }).catch(e =>
        console.warn(`   index ${ixName} on ${name}: ${e.message}`));
    }

    const destCount = await destCol.countDocuments();
    const ok = destCount === docs.length;
    report.push({ name, src: docs.length, dest: destCount, ok });
    console.log(`  ${ok ? 'OK ' : 'XX '} ${name.padEnd(22)} src=${docs.length} dest=${destCount}`);
  }

  const mismatches = report.filter(r => !r.ok);
  console.log(`\nTotal: src=${report.reduce((a, r) => a + r.src, 0)} dest=${report.reduce((a, r) => a + r.dest, 0)} | mismatches=${mismatches.length}`);

  if (mismatches.length) {
    throw new Error(`Count mismatch in: ${mismatches.map(m => m.name).join(', ')}. NOT flipping dbHost.`);
  }

  if (noFlip) {
    console.log('\n--no-flip: copy verified, registry left on atlas. No cutover performed.');
    return;
  }

  // Flip the pointer on EVERY registry doc that references this db (subdomain + custom-domain aliases)
  const r = await slab.collection('tenants').updateMany(
    { db: dbName },
    { $set: { dbHost: 'gpu', 'meta.dbMigratedAt': new Date() } },
  );
  registerTenantHost(dbName, 'gpu');
  console.log(`\nFlipped dbHost → gpu on ${r.modifiedCount} registry doc(s).`);
  console.log('Atlas copy left intact as fallback (revert: set dbHost back to "atlas").');
  console.log('\n>>> RESTART slab now so its host map + tenant cache pick up the change.');
}

main().then(() => process.exit(0)).catch(e => { console.error('\nMIGRATION FAILED:', e.message); process.exit(1); });
