/**
 * Seed one starter template per visual skin so the template library shows real,
 * distinct design examples (not the single generic layout).
 *
 * Uses the app's own getTenantDb routing so it writes to the SAME cluster the app
 * reads (atlas vs gpu-via-tunnel) — a raw DB_URL client would hit the wrong one.
 * Idempotent: removes prior source:'skin-starter' templates before re-seeding.
 * Non-destructive: only ADDS library entries — never activates or edits copy/design.
 *
 *   node scripts/seed-skin-starters.mjs [tenantDbName]
 *   (default tenant DB: slab_madladslab)
 */
import 'dotenv/config';
import { connectDB, getSlabDb, getTenantDb, loadTenantHostMap } from '../plugins/mongo.js';
import { BLOCK_DEFAULTS } from '../config/blocks.js';
import { DESIGN_DEFAULTS, THEME_KEYS } from '../routes/admin/design.js';

const TENANT_DB = process.argv[2] || 'slab_madladslab';
const STARTER_BLOCKS = ['hero', 'stats', 'cards', 'split', 'testimonials', 'pricing', 'faq', 'cta'];
const SKINS = [
  { skin: 'lowlight', name: 'Lowlight — Warm Studio', tags: ['dark', 'brass', 'studio'] },
  { skin: 'terminal', name: 'Terminal — Dev / CRT',    tags: ['mono', 'developer', 'dark'] },
  { skin: 'arena',    name: 'Arena — Esports HUD',      tags: ['neon', 'gaming', 'bold'] },
  { skin: 'gallery',  name: 'Gallery — Editorial',      tags: ['light', 'serif', 'portfolio'] },
];

const rid = () => Math.random().toString(36).slice(2, 12);
const toSlug = s => s.toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

await connectDB();
await loadTenantHostMap().catch(() => {});

// Resolve the tenant's cluster the same way the app does.
const tenant = await getSlabDb().collection('tenants').findOne({ db: TENANT_DB });
const dbHost = tenant?.dbHost || 'atlas';
const db = getTenantDb(TENANT_DB, dbHost);
console.log(`[target] ${TENANT_DB} on ${dbHost} cluster`);

// designSnapshot from current tenant design tokens.
const designRows = await db.collection('design').find({}).toArray();
const design = { ...DESIGN_DEFAULTS };
for (const r of designRows) design[r.key] = r.value;
const designSnapshot = {};
for (const k of THEME_KEYS) designSnapshot[k] = design[k];

const del = await db.collection('templates').deleteMany({ source: 'skin-starter' });
if (del.deletedCount) console.log(`[reset] removed ${del.deletedCount} prior skin-starter templates`);

const now = new Date();
for (const s of SKINS) {
  const blocks = STARTER_BLOCKS.map(type => ({ id: rid(), type, fields: { ...(BLOCK_DEFAULTS[type] || {}) }, images: {} }));
  const doc = {
    name: s.name,
    slug: toSlug(s.name) + '-' + Date.now().toString(36) + '-' + s.skin,
    description: `Starter template in the "${s.skin}" design world — edit the blocks to make it yours.`,
    category: 'landing',
    tags: s.tags,
    skin: s.skin,
    blocks,
    designSnapshot,
    thumbnail: '',
    isPublic: false,
    source: 'skin-starter',
    authorName: 'Slab',
    authorEmail: '',
    createdAt: now,
    updatedAt: now,
  };
  const res = await db.collection('templates').insertOne(doc);
  console.log(`[seeded] ${s.skin.padEnd(9)} → ${res.insertedId.toString()}  (${blocks.length} blocks)`);
}

console.log(`\nDone. ${SKINS.length} skin starters in ${TENANT_DB}.templates (${dbHost})`);
process.exit(0);
