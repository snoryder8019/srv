/**
 * Fleet template seeding — give EVERY live tenant a usable library:
 *   1. "<Brand> — Current Site"  → their current copy captured as a classic-skin
 *      template, so they always have a return point in the switcher.
 *   2. The 4 skin looks (lowlight/terminal/arena/gallery) as starters, if missing.
 *
 * Routes through getTenantDb (correct cluster per tenant). ADDITIVE + idempotent:
 *   - current-snapshot: replaced each run (mirrors current copy).
 *   - skin-starter: inserted per skin only if that skin isn't already present
 *     (never clobbers a tenant's edited starter).
 * NEVER activates anything — no live site changes.
 *
 *   node scripts/seed-fleet-templates.mjs [--dry] [--only=slug]
 */
import 'dotenv/config';
import { connectDB, getSlabDb, getTenantDb, loadTenantHostMap } from '../plugins/mongo.js';
import { BLOCK_DEFAULTS } from '../config/blocks.js';
import { DESIGN_DEFAULTS, THEME_KEYS } from '../routes/admin/design.js';

const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

const rid = () => Math.random().toString(36).slice(2, 12);
const toSlug = s => (s || '').toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const join = (...xs) => xs.filter(v => v != null && v !== '').join(' ');

const SKINS = [
  { skin: 'lowlight', name: 'Lowlight — Warm Studio', tags: ['dark', 'brass'] },
  { skin: 'terminal', name: 'Terminal — Dev / CRT',    tags: ['mono', 'developer'] },
  { skin: 'arena',    name: 'Arena — Esports HUD',      tags: ['neon', 'gaming'] },
  { skin: 'gallery',  name: 'Gallery — Editorial',      tags: ['light', 'serif'] },
];
const STARTER_BLOCKS = ['hero', 'stats', 'cards', 'split', 'testimonials', 'pricing', 'faq', 'cta'];

// Build a "current site" block sequence from the tenant's authored copy.
function currentSiteBlocks(copy) {
  const b = [];
  b.push({ id: rid(), type: 'hero', fields: {
    heading: join(copy.hero_heading, copy.hero_heading_em) || 'Welcome',
    subheading: copy.hero_sub || '',
    cta_text: copy.hero_cta_primary || 'Get Started',
    cta_link: copy.hero_cta_primary_link || '#contact',
  }, images: {} });

  const cards = { heading: join(copy.services_heading, copy.services_heading_em) || 'What We Do', subtext: copy.services_sub || '' };
  let anyService = false;
  for (let n = 1; n <= 4; n++) {
    if (copy['service' + n + '_title']) { cards['card' + n + '_title'] = copy['service' + n + '_title']; anyService = true; }
    if (copy['service' + n + '_desc'])  { cards['card' + n + '_body']  = copy['service' + n + '_desc']; }
  }
  if (anyService) b.push({ id: rid(), type: 'cards', fields: cards, images: {} });

  if (copy.about_quote || copy.about_desc) {
    b.push({ id: rid(), type: 'text', fields: {
      subheading: copy.about_eyebrow || '', heading: copy.about_quote || 'About', body: copy.about_desc || '',
    }, images: {} });
  }
  b.push({ id: rid(), type: 'cta', fields: {
    heading: join(copy.contact_heading, copy.contact_heading_em) || "Let's Work Together",
    subtext: copy.contact_sub || '',
    btn_text: copy.contact_btn || 'Contact Us',
    btn_link: '#contact',
  }, images: {} });
  return b;
}

await connectDB();
await loadTenantHostMap().catch(() => {});
let tenants = await getSlabDb().collection('tenants').find({ status: 'active' }).toArray();
if (ONLY) tenants = tenants.filter(t => (t.meta?.subdomain || '') === ONLY || t.db === ONLY);

console.log(`${DRY ? '[DRY RUN] ' : ''}fleet seed across ${tenants.length} active tenants\n`);
let ok = 0, failed = 0;
for (const t of tenants) {
  const label = (t.meta?.subdomain || t.db).padEnd(18);
  try {
    const db = getTenantDb(t.db, t.dbHost);
    const copyRows = await db.collection('copy').find({}).toArray();
    const copy = {}; for (const r of copyRows) if (r.value != null && r.value !== '') copy[r.key] = r.value;
    const designRows = await db.collection('design').find({}).toArray();
    const design = { ...DESIGN_DEFAULTS }; for (const r of designRows) design[r.key] = r.value;
    const designSnapshot = {}; for (const k of THEME_KEYS) designSnapshot[k] = design[k];
    const now = new Date();
    const brandName = t.brand?.name || t.meta?.subdomain || 'Your Site';

    // counts of what we'll add
    const haveSkins = new Set((await db.collection('templates').find({ source: 'skin-starter' }, { projection: { skin: 1 } }).toArray()).map(x => x.skin));
    const toAddSkins = SKINS.filter(s => !haveSkins.has(s.skin));

    if (!DRY) {
      // 1. Current Site (replace)
      await db.collection('templates').deleteMany({ source: 'current-snapshot' });
      await db.collection('templates').insertOne({
        name: `${brandName} — Current Site`, slug: toSlug(brandName) + '-current-' + Date.now().toString(36),
        description: 'Your homepage content, captured as a template — a safe return point.',
        category: 'landing', tags: ['current', 'return-point'], skin: 'classic',
        blocks: currentSiteBlocks(copy), designSnapshot, thumbnail: '', isPublic: false,
        source: 'current-snapshot', authorName: 'Slab', authorEmail: '', createdAt: now, updatedAt: now,
      });
      // 2. Missing skins
      for (const s of toAddSkins) {
        await db.collection('templates').insertOne({
          name: s.name, slug: toSlug(s.name) + '-' + Date.now().toString(36) + '-' + s.skin,
          description: `Starter template in the "${s.skin}" design world — edit the blocks to make it yours.`,
          category: 'landing', tags: s.tags, skin: s.skin,
          blocks: STARTER_BLOCKS.map(type => ({ id: rid(), type, fields: { ...(BLOCK_DEFAULTS[type] || {}) }, images: {} })),
          designSnapshot, thumbnail: '', isPublic: false, source: 'skin-starter', authorName: 'Slab', authorEmail: '', createdAt: now, updatedAt: now,
        });
      }
    }
    console.log(`${DRY ? '[dry] ' : ''}${label} ✓ current-site + ${toAddSkins.length} skin(s) added (${SKINS.length - toAddSkins.length} already present)`);
    ok++;
  } catch (e) {
    console.log(`${label} ✗ ${String(e.message).slice(0, 80)}`);
    failed++;
  }
}
console.log(`\nDone. ${ok} ok, ${failed} failed.${DRY ? ' (dry run — nothing written)' : ''}`);
process.exit(0);
