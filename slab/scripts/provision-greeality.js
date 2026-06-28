/**
 * One-time script: Provision GreeAlityTV as a Slab tenant.
 *
 * Run from /srv/slab:  node scripts/provision-greeality.js
 *
 * Idempotent — checks for existing tenant before creating, and skips
 * any collection that already has documents. Re-running is safe.
 *
 * Does NOT touch Apache configs or DNS (prints suggestions only).
 * Does NOT migrate content from the standalone /srv/greealitytv app —
 * this stands up the tenant shell + brand colors. The civic feed,
 * petitions, and video modules are the planned "custom mod" retrofit.
 *
 * Uses slab's own DB connection (config.DB_URL) — no hardcoded secrets.
 */
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import '../config/config.js';

const TENANT_DB = 'slab_greeality';
const SUBDOMAIN = 'greeality';
const DOMAIN    = 'greeality.madladslab.com';
const SLAB_PORT = 3602;
const OWNER_EMAIL = 'snoryder8019@gmail.com'; // platform superadmin (see middleware/superadmin.js)

// ── GreeAlityTV brand data (from /srv/greealitytv) ─────────────────────────

const BRAND = {
  name: 'GreeAlityTV',
  location: 'Greeley, Colorado',
  tagline: 'Local voices looking up — not left and right.',
  businessType: 'Civic Community Platform',
  industry: 'Local Media / Civic Engagement',
  description:
    'A civic community platform for Greeley, CO — local voices, a community feed with comment voting, citizen video, petitions, and signups. Built for residents who want to hold local politicians and big-money influences accountable.',
  serviceArea: 'Greeley & Weld County, Colorado',
  phone: '',
  email: OWNER_EMAIL,
  ownerName: '',
  services: ['Community Feed', 'Citizen Video', 'Petitions', 'Local Blog'],
  pricingNotes: '',
  targetAudience: 'Greeley, CO residents and local civic voices',
  brandVoice: 'Grassroots, civic-minded, plain-spoken, community-first',
  socialLinks: {},
};

// ── Design tokens — GreeAlityTV palette (from public/css/style.css :root) ──
//   navy #1B3A5C  red #C62828  gold #F4A261  navy-dark #0f2340
//   off-white #F8F9FA  text #1a1a2e  font Inter
//   Extra (non-standard) keys preserve the secondary/dark/light shades for
//   the upcoming custom retrofit.

const DESIGN_SEED = [
  { key: 'color_primary',       value: '#1B3A5C' }, // navy
  { key: 'color_accent',        value: '#C62828' }, // red
  { key: 'color_secondary',     value: '#F4A261' }, // gold (extra)
  { key: 'color_primary_dark',  value: '#0f2340' }, // navy-dark (extra)
  { key: 'color_accent_light',  value: '#ef5350' }, // red-light (extra)
  { key: 'color_bg',            value: '#F8F9FA' }, // off-white
  { key: 'color_text',          value: '#1a1a2e' },
  { key: 'color_muted',         value: '#6c757d' }, // gray-600
  { key: 'font_heading',        value: 'Inter' },
  { key: 'font_body',           value: 'Inter' },
  { key: 'landing_layout',      value: 'bold' },     // dark navy hero
  { key: 'vis_hero',            value: 'true' },
  { key: 'vis_services',        value: 'true' },
  { key: 'vis_portfolio',       value: 'false' },
  { key: 'vis_about',           value: 'true' },
  { key: 'vis_process',         value: 'false' },
  { key: 'vis_reviews',         value: 'false' },
  { key: 'vis_contact',         value: 'true' },
  { key: 'vis_blog',            value: 'true' },
  { key: 'agent_name',          value: 'Greeley Assistant' },
  { key: 'agent_greeting',      value: 'Looking for local news, a petition, or want to share your voice? I can help.' },
];

// ── Additional seed collections (empty but created) ────────────────────────

const EMPTY_COLLECTIONS = [
  'copy', 'blog', 'portfolio', 'clients', 'pages', 'custom_sections',
  'section_media', 'invoices', 'themes', 'brand_images', 'brand_models',
  'assets', 'contacts', 'onboarding_forms', 'onboarding_responses',
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();
  const slabDb   = getSlabDb();
  const tenantDb = getTenantDb(TENANT_DB);

  // ── 1. Check if tenant already exists ────────────────────────────────────
  const existing = await slabDb.collection('tenants').findOne({
    $or: [{ domain: DOMAIN }, { 'meta.subdomain': SUBDOMAIN }],
  });

  if (existing) {
    console.log(`[provision-greeality] Tenant "${SUBDOMAIN}" already exists (id: ${existing._id}). Skipping tenant creation.`);
  } else {
    const now = new Date();
    const tenantDoc = {
      domain: DOMAIN,
      db: TENANT_DB,
      status: 'active',
      platform: 'slab',
      brand: BRAND,
      s3Prefix: SUBDOMAIN,
      public: {},
      secrets: {},
      meta: {
        subdomain: SUBDOMAIN,
        customDomain: null,
        ownerEmail: OWNER_EMAIL,
        stripeCustomerId: null,
        plan: 'pro',
        provisionedAt: now,
        previewExpiresAt: null, // active immediately — no preview period
      },
      createdAt: now,
    };
    await slabDb.collection('tenants').insertOne(tenantDoc);
    console.log(`[provision-greeality] Tenant doc created: ${DOMAIN}`);
  }

  // ── 2. Seed design collection (colors) ───────────────────────────────────
  const designCount = await tenantDb.collection('design').countDocuments();
  if (designCount === 0) {
    await tenantDb.collection('design').insertMany(DESIGN_SEED);
    console.log(`[provision-greeality] Design seeded (${DESIGN_SEED.length} tokens)`);
  } else {
    console.log(`[provision-greeality] Design already has ${designCount} docs — skipping`);
  }

  // ── 3. Create owner/admin user ───────────────────────────────────────────
  const ownerExists = await tenantDb.collection('users').findOne({ email: OWNER_EMAIL });
  if (!ownerExists) {
    await tenantDb.collection('users').insertOne({
      email: OWNER_EMAIL,
      displayName: 'GreeAlityTV Admin',
      isAdmin: true,
      isOwner: true,
      provider: 'provisioned',
      createdAt: new Date(),
    });
    console.log(`[provision-greeality] Owner admin created: ${OWNER_EMAIL}`);
  } else {
    console.log(`[provision-greeality] Owner ${OWNER_EMAIL} already present — skipping`);
  }

  // ── 4. Ensure empty collections exist ────────────────────────────────────
  const existingCols = (await tenantDb.listCollections().toArray()).map((c) => c.name);
  for (const colName of EMPTY_COLLECTIONS) {
    if (!existingCols.includes(colName)) {
      await tenantDb.createCollection(colName).catch(() => {});
    }
  }
  console.log(`[provision-greeality] Empty collections ensured (${EMPTY_COLLECTIONS.length})`);

  // ── 5. Apache / DNS note ─────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('APACHE / DNS — no action needed if wildcard is active');
  console.log('='.repeat(70));
  console.log(`
${DOMAIN} is a *.madladslab.com subdomain and is served by the existing
Slab wildcard vhost (slab-wildcard.conf) proxying to port ${SLAB_PORT}.
No per-tenant Apache config or certbot run is required while the wildcard
cert covers *.madladslab.com.

If DNS is not wildcard, add an A record:  ${SUBDOMAIN}  ->  (Linode IP)
`);
  console.log('='.repeat(70));
  console.log('[provision-greeality] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[provision-greeality] FATAL:', err);
  process.exit(1);
});
