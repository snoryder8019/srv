/**
 * Align every tenant to the two-value homepage-source model (slab | custom).
 *
 *   auto + custom EJS present → custom
 *   auto (no EJS)             → slab
 *   layout / template / slab  → slab
 *   custom                    → custom
 *
 * Invariant: each tenant's CURRENT effective render is preserved. The one edge
 * case is a tenant on 'layout' that also has an active_template (deliberately
 * ignoring it) — under slab semantics that template would start rendering, so we
 * DEACTIVATE it (active_template cleared, the template doc itself kept). Today
 * that's only madladslab.
 *
 * Every tenant's design + copy + active_template is dumped to JSON before any
 * write. Dry-run by default.
 *
 *   node scripts/migrate-home-source.mjs            # DRY RUN — writes nothing
 *   node scripts/migrate-home-source.mjs --commit   # apply
 *   node scripts/migrate-home-source.mjs --commit --only noco,w2marketing
 *
 * Run from /srv/slab.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB, getSlabDb, getTenantDb, tenantClusterReady } from '../plugins/mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_VIEWS_ROOT = path.resolve(__dirname, '..', 'views', 'tenants');
const BACKUP_DIR = path.resolve(__dirname, '..', 'design-migration-backups');

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const onlyArg = (() => { const i = argv.indexOf('--only'); return i >= 0 ? (argv[i + 1] || '') : ''; })();
const onlyList = onlyArg ? onlyArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;

const hasEjsFor = (sub) => !!sub && fs.existsSync(path.join(TENANT_VIEWS_ROOT, sub, 'home.ejs'));

// Effective renderer under the OLD (4-value) logic — mirrors the pre-change index.js.
function effectiveOld(source, hasEjs, hasActiveTpl) {
  if (hasEjs && (source === 'custom' || source === 'auto')) return 'custom';
  if (hasActiveTpl && (source === 'template' || (source === 'auto' && !hasEjs))) return 'template';
  return 'layout';
}
// New source under the two-value model.
function mapSource(source, hasEjs) {
  if (source === 'custom') return 'custom';
  if (source === 'auto') return hasEjs ? 'custom' : 'slab';
  return 'slab'; // layout | template | slab | anything else
}
// Effective renderer under the NEW logic, given whether the template stays active.
function effectiveNew(newSource, hasEjs, tplStaysActive) {
  if (newSource === 'custom') return hasEjs ? 'custom' : 'layout';
  return tplStaysActive ? 'template' : 'layout';
}

await connectDB();
if (!tenantClusterReady()) await new Promise(r => setTimeout(r, 1500));
const slab = getSlabDb();

let tenants = await slab.collection('tenants').find({}).sort({ 'meta.subdomain': 1 }).toArray();
// Dedupe duplicate registry docs by tenant DB name (noco/greeality/lawrie appear twice).
const seenDb = new Set();
tenants = tenants.filter(t => { if (seenDb.has(t.db)) return false; seenDb.add(t.db); return true; });
if (onlyList) tenants = tenants.filter(t => onlyList.some(o => (t.meta?.subdomain || '').toLowerCase().includes(o) || (t.db || '').toLowerCase().includes(o)));

if (COMMIT && !fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

console.log(`\n${COMMIT ? '*** COMMIT ***' : '--- DRY RUN (no writes) ---'}  ${tenants.length} tenant(s)`);
console.log(COMMIT ? `backups → ${BACKUP_DIR}\n` : '(pass --commit to apply; backups written then)\n');

const plan = [];
for (const t of tenants) {
  const sub = t.meta?.subdomain || '(none)';
  const host = t.dbHost || 'atlas';
  const hasEjs = hasEjsFor(sub);
  try {
    const db = getTenantDb(t.db, host);
    const [srcDoc, at, designRows, copyRows] = await Promise.all([
      db.collection('design').findOne({ key: 'home_source' }),
      db.collection('active_template').findOne({}),
      db.collection('design').find({}).toArray(),
      db.collection('copy').find({}).toArray(),
    ]);
    const source = srcDoc?.value || 'auto';
    const hasActiveTpl = !!at?.templateId;

    const effBefore = effectiveOld(source, hasEjs, hasActiveTpl);
    const newSource = mapSource(source, hasEjs);
    // Clear the active template only when it would otherwise HIJACK a layout render.
    const clearActiveTpl = newSource === 'slab' && hasActiveTpl && effBefore === 'layout';
    const tplStaysActive = hasActiveTpl && !clearActiveTpl;
    const effAfter = effectiveNew(newSource, hasEjs, tplStaysActive);

    const preserved = effAfter === effBefore;
    const sourceChanged = source !== newSource;

    plan.push({ t, db, sub, host, source, newSource, hasEjs, hasActiveTpl, clearActiveTpl, effBefore, effAfter, preserved, designRows, copyRows, at, sourceChanged });

    const flag = preserved ? '✓' : '⚠ RENDER CHANGE';
    const tplNote = clearActiveTpl ? '  [deactivate template]' : '';
    console.log(`${sub.padEnd(18)} ${source.padEnd(9)}→ ${newSource.padEnd(7)} render ${effBefore}→${effAfter} ${flag}${tplNote}`);
  } catch (e) {
    console.log(`${sub.padEnd(18)} ERROR: ${e.message}`);
  }
}

const changes = plan.filter(p => p.sourceChanged || p.clearActiveTpl);
const risky = plan.filter(p => !p.preserved);
console.log(`\n${changes.length} tenant(s) to change · ${risky.length} with render changes`);
if (risky.length) {
  console.log('⚠ tenants whose render would change (NOT expected — investigate before commit):');
  for (const p of risky) console.log('   ' + p.sub + ` ${p.effBefore}→${p.effAfter}`);
}

if (!COMMIT) { console.log('\nDRY RUN complete — nothing written.'); process.exit(0); }

if (risky.length) {
  console.log('\nABORTING commit: render-preservation invariant violated. No writes made.');
  process.exit(2);
}

console.log('\nApplying…');
const now = new Date();
for (const p of changes) {
  // 1. Backup full design + copy + active_template to JSON.
  const backup = {
    tenant: { db: p.t.db, dbHost: p.host, subdomain: p.sub, domain: p.t.domain },
    capturedAt: now.toISOString(),
    home_source_before: p.source,
    active_template_before: p.at || null,
    design: p.designRows,
    copy: p.copyRows,
  };
  fs.writeFileSync(path.join(BACKUP_DIR, `${p.t.db}.json`), JSON.stringify(backup, null, 2));

  // 2. Write the normalized home_source row.
  await p.db.collection('design').updateOne(
    { key: 'home_source' },
    { $set: { key: 'home_source', value: p.newSource, updatedAt: now } },
    { upsert: true },
  );

  // 3. Deactivate template if it would hijack a layout render (backed up above).
  if (p.clearActiveTpl) await p.db.collection('active_template').deleteMany({});

  console.log(`  ✓ ${p.sub}: home_source=${p.newSource}${p.clearActiveTpl ? ' + active_template cleared' : ''} (backup: ${p.t.db}.json)`);
}

console.log(`\nDone. ${changes.length} tenant(s) migrated. Backups in ${BACKUP_DIR}`);
console.log('Restore a tenant with: node scripts/restore-home-source.mjs <db>   (design+copy+active_template)');
process.exit(0);
