/**
 * READ-ONLY inventory of every tenant's homepage-source + design state.
 * Uses the app's own connection layer so atlas/gpu tenants resolve correctly.
 *
 * Run from /srv/slab:
 *   node scripts/inventory-design-sources.mjs
 *   node scripts/inventory-design-sources.mjs noco w2marketing   # focus subset
 *
 * Writes nothing. Safe against production.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB, getSlabDb, getTenantDb, tenantClusterReady } from '../plugins/mongo.js';
import { DESIGN_DEFAULTS } from '../routes/admin/design.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_VIEWS_ROOT = path.resolve(__dirname, '..', 'views', 'tenants');

const focus = process.argv.slice(2).map(s => s.toLowerCase());

await connectDB();
// Give the gpu tunnel a moment if it's mid-connect.
if (!tenantClusterReady()) { await new Promise(r => setTimeout(r, 1500)); }

const slab = getSlabDb();
let tenants = await slab.collection('tenants').find({}).sort({ 'meta.subdomain': 1 }).toArray();
if (focus.length) {
  tenants = tenants.filter(t => focus.some(f => (t.meta?.subdomain || '').toLowerCase().includes(f)
    || (t.domain || '').toLowerCase().includes(f)));
}

console.log(`\n[inventory] ${tenants.length} tenant(s)\n`);
console.log(
  'sub'.padEnd(18) + 'status'.padEnd(10) + 'host'.padEnd(7) + 'source'.padEnd(10) +
  'effective'.padEnd(12) + 'actTpl'.padEnd(22) + 'dRows'.padEnd(7) + 'ejs'
);
console.log('─'.repeat(104));

const rows = [];
for (const t of tenants) {
  const sub = t.meta?.subdomain || '(none)';
  const host = t.dbHost || 'atlas';
  let source = '(err)', effective = '(err)', actTplName = '', dRows = 0, hasEjs = false, overrideCount = 0;
  const ejsPath = path.join(TENANT_VIEWS_ROOT, sub, 'home.ejs');
  hasEjs = fs.existsSync(ejsPath);
  try {
    const db = getTenantDb(t.db, host);
    const [srcDoc, at, designRows] = await Promise.all([
      db.collection('design').findOne({ key: 'home_source' }),
      db.collection('active_template').findOne({}),
      db.collection('design').find({}).toArray(),
    ]);
    source = srcDoc?.value || 'auto';
    dRows = designRows.length;
    // count rows that DIFFER from schema default (real overrides that sparse-align keeps)
    for (const r of designRows) {
      if (!(r.key in DESIGN_DEFAULTS) || String(r.value) !== String(DESIGN_DEFAULTS[r.key])) overrideCount++;
    }
    let actTpl = null;
    if (at?.templateId) actTpl = await db.collection('templates').findOne({ _id: at.templateId });
    actTplName = actTpl ? (actTpl.name || '(unnamed)').slice(0, 20) : (at ? '(missing tpl)' : '');
    // Mirror index.js render decision
    const wantCustom = source === 'custom' || (source === 'auto' && hasEjs);
    if (wantCustom && hasEjs) effective = 'custom';
    else if ((source === 'template' || source === 'auto' || wantCustom) && actTpl) effective = 'template';
    else effective = 'layout';
  } catch (e) {
    source = `ERR: ${e.message.slice(0, 30)}`;
  }
  rows.push({ sub, status: t.status, host, source, effective, actTplName, dRows, overrideCount, hasEjs });
  console.log(
    sub.padEnd(18) + String(t.status || '').padEnd(10) + host.padEnd(7) +
    String(source).padEnd(10) + String(effective).padEnd(12) +
    String(actTplName).padEnd(22) + String(dRows).padEnd(7) + (hasEjs ? 'YES' : '-')
  );
}

console.log('\n[override detail] design rows that differ from schema default (sparse-align preserves these):');
for (const r of rows) {
  if (r.overrideCount != null && !String(r.source).startsWith('ERR'))
    console.log('  ' + r.sub.padEnd(18) + r.overrideCount + ' overrides / ' + r.dRows + ' rows');
}

console.log('\n[home_source → post-migration mapping]');
console.log('  auto + ejs  → custom      |  auto (no ejs) → slab');
console.log('  layout      → slab        |  template      → slab   |  custom → custom');
for (const r of rows) {
  if (String(r.source).startsWith('ERR')) continue;
  const s = r.source;
  const mapped = s === 'custom' ? 'custom'
    : s === 'auto' ? (r.hasEjs ? 'custom' : 'slab')
    : 'slab';
  const rendersSame = mapped === 'custom' ? (r.effective === 'custom')
    : (r.effective === 'template' || r.effective === 'layout'); // slab covers both
  console.log('  ' + r.sub.padEnd(18) + s.padEnd(10) + '→ ' + mapped.padEnd(8) +
    ' effective now: ' + r.effective.padEnd(10) + (rendersSame ? '✓ preserved' : '⚠ CHECK'));
}

process.exit(0);
