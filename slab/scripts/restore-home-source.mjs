/**
 * Reverse scripts/migrate-home-source.mjs for one tenant, from its JSON backup.
 * Restores exactly what the migration touched: the home_source design row and
 * the active_template document. (The backup also contains full design+copy for
 * disaster recovery, but this script only undoes the migration's changes.)
 *
 *   node scripts/restore-home-source.mjs slab_madladslab            # DRY RUN
 *   node scripts/restore-home-source.mjs slab_madladslab --commit
 *
 * Run from /srv/slab.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB, getSlabDb, getTenantDb, tenantClusterReady } from '../plugins/mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', 'design-migration-backups');

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const dbName = argv.find(a => !a.startsWith('--'));
if (!dbName) { console.error('usage: node scripts/restore-home-source.mjs <db> [--commit]'); process.exit(1); }

const file = path.join(BACKUP_DIR, `${dbName}.json`);
if (!fs.existsSync(file)) { console.error(`no backup at ${file}`); process.exit(1); }
const bk = JSON.parse(fs.readFileSync(file, 'utf8'));

await connectDB();
if (!tenantClusterReady()) await new Promise(r => setTimeout(r, 1500));

// Resolve dbHost from the registry (backup records it too).
const slab = getSlabDb();
const treg = await slab.collection('tenants').findOne({ db: dbName });
const host = bk.tenant?.dbHost || treg?.dbHost || 'atlas';
const db = getTenantDb(dbName, host);

const curSrc = (await db.collection('design').findOne({ key: 'home_source' }))?.value || '(none)';
const curAt = await db.collection('active_template').findOne({});
console.log(`\n${COMMIT ? '*** COMMIT ***' : '--- DRY RUN ---'} restore ${dbName} (${host})`);
console.log(`  home_source:     ${curSrc}  →  ${bk.home_source_before}`);
console.log(`  active_template: ${curAt ? curAt.templateId : '(none)'}  →  ${bk.active_template_before ? bk.active_template_before.templateId : '(none)'}`);

if (!COMMIT) { console.log('\nDRY RUN — nothing written. Add --commit to apply.'); process.exit(0); }

const now = new Date();
await db.collection('design').updateOne(
  { key: 'home_source' },
  { $set: { key: 'home_source', value: bk.home_source_before, updatedAt: now } },
  { upsert: true },
);
await db.collection('active_template').deleteMany({});
if (bk.active_template_before) await db.collection('active_template').insertOne(bk.active_template_before);

console.log('\n✓ restored home_source + active_template from backup.');
process.exit(0);
