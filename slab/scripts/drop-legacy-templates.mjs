/**
 * Drop the weak legacy 'migration' templates fleetwide — they're unused (0 active)
 * and superseded by the new skins + upgraded classic. REVERSIBLE: each template is
 * copied to `templates_legacy_archive` (in its own tenant DB) before deletion.
 *
 * Safety: NEVER deletes a template that is currently the active_template.
 * Routes via getTenantDb (correct cluster). Idempotent (re-run finds nothing left).
 *
 *   node scripts/drop-legacy-templates.mjs [--dry]
 */
import 'dotenv/config';
import { connectDB, getSlabDb, getTenantDb, loadTenantHostMap } from '../plugins/mongo.js';

const DRY = process.argv.includes('--dry');

await connectDB();
await loadTenantHostMap().catch(() => {});
const tenants = await getSlabDb().collection('tenants').find({ status: 'active' }).toArray();

console.log(`${DRY ? '[DRY RUN] ' : ''}dropping legacy 'migration' templates across ${tenants.length} tenants\n`);
let archived = 0, deleted = 0, skippedActive = 0, failed = 0;
for (const t of tenants) {
  const label = (t.meta?.subdomain || t.db).padEnd(20);
  try {
    const db = getTenantDb(t.db, t.dbHost);
    const at = await db.collection('active_template').findOne({});
    const activeId = at?.templateId ? at.templateId.toString() : null;

    const legacy = await db.collection('templates').find({ source: 'migration' }).toArray();
    const droppable = legacy.filter(tp => tp._id.toString() !== activeId);
    const keptActive = legacy.length - droppable.length;
    skippedActive += keptActive;

    if (!droppable.length) { console.log(`${label} — ${legacy.length} legacy, ${keptActive} active-kept, nothing to drop`); continue; }

    if (!DRY) {
      const now = new Date();
      await db.collection('templates_legacy_archive').insertMany(
        droppable.map(tp => ({ ...tp, _archivedAt: now, _archivedFrom: 'templates' })),
      );
      const res = await db.collection('templates').deleteMany({ _id: { $in: droppable.map(tp => tp._id) } });
      archived += droppable.length;
      deleted += res.deletedCount;
    }
    console.log(`${label} ✓ ${DRY ? 'would archive+drop' : 'archived+dropped'} ${droppable.length}${keptActive ? ` (kept ${keptActive} active)` : ''}`);
  } catch (e) {
    console.log(`${label} ✗ ${String(e.message).slice(0, 70)}`);
    failed++;
  }
}
console.log(`\nDone. ${DRY ? 'would archive/delete' : `archived ${archived}, deleted ${deleted}`}, kept ${skippedActive} active, ${failed} failed.${DRY ? ' (dry run)' : ''}`);
console.log('Restore any tenant later from its templates_legacy_archive collection.');
process.exit(0);
