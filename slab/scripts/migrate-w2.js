#!/usr/bin/env node
/**
 * Migrate w2Marketing data from madLadsLab DB → Slab tenant (slab_w2marketing)
 *
 * What this does:
 *   1. Creates tenant document in slab.tenants (lifetime plan, active)
 *   2. Creates slab_w2marketing database
 *   3. Copies all w2_ collections (stripping prefix)
 *   4. Copies users collection
 *   5. Creates custom domain alias for w2marketing.biz
 *
 * What it does NOT do:
 *   - Copy API keys (you input those via admin settings panel)
 *   - Move S3 files (same bucket, same prefix — no change needed)
 *   - Copy sessions (they regenerate)
 *
 * Usage:
 *   node scripts/migrate-w2.js              # dry run (preview only)
 *   node scripts/migrate-w2.js --execute    # actually migrate
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const DRY_RUN = !process.argv.includes('--execute');

// ── Config ───────────────────────────────────────────────────────────────────

const SOURCE_DB    = 'madLadsLab';
const TARGET_DB    = 'slab_w2marketing';
const SLAB_DB      = process.env.SLAB_DB || 'slab';
const SUBDOMAIN    = 'w2marketing';
const CUSTOM_DOMAIN = 'w2marketing.biz';

// Collections to migrate: source → target
const COLLECTION_MAP = {
  'w2_design':           'design',
  'w2_copy':             'copy',
  'w2_blog':             'blog',
  'w2_portfolio':        'portfolio',
  'w2_clients':          'clients',
  'w2_pages':            'pages',
  'w2_custom_sections':  'custom_sections',
  'w2_section_media':    'section_media',
  'w2_invoices':         'invoices',
  'w2_invoice_counter':  'invoice_counter',
  'w2_themes':           'themes',
  'w2_brand_images':     'brand_images',
  'w2_assets':           'assets',
  'w2_asset_folders':    'asset_folders',
  'w2_contacts':         'contacts',
  'w2_campaigns':        'campaigns',
  'w2_campaign_events':  'campaign_events',
  'w2_client_emails':    'client_emails',
  'w2_meetings':         'meetings',
  'w2_reviews_cache':    'reviews_cache',
  'w2_social_presets':   'social_presets',
  'w2_files':            'files',
};

// Also copy users (no prefix)
const EXTRA_COLLECTIONS = {
  'users': 'users',
};

// ── Build brand profile from w2 copy & design tokens ─────────────────────────

function buildBrandFromData(copyDocs, designDocs) {
  const copy = {};
  for (const doc of copyDocs) copy[doc.key] = doc.value;

  const design = {};
  for (const doc of designDocs) design[doc.key] = doc.value;

  return {
    name:           'W2 Marketing',
    businessType:   'Marketing Agency',
    industry:       'Digital Marketing',
    tagline:        copy.hero_heading_em || 'Drive Your Success',
    description:    copy.about_desc || '',
    location:       copy.contact_location || 'Greeley, Colorado',
    serviceArea:    copy.contact_serving || 'Northern Colorado & surrounding areas',
    phone:          '',
    email:          'candace@w2marketing.biz',
    ownerName:      'Candace Wallace',
    services: [
      copy.service1_title,
      copy.service2_title,
      copy.service3_title,
    ].filter(Boolean),
    pricingNotes:   '',
    targetAudience: 'Local businesses in Northern Colorado',
    brandVoice:     'Professional, empowering, approachable',
    socialLinks:    {},
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function migrate() {
  console.log(DRY_RUN
    ? '\n=== DRY RUN — no changes will be made ===\n'
    : '\n=== EXECUTING MIGRATION ===\n');

  const client = new MongoClient(process.env.DB_URL);
  await client.connect();

  const sourceDb = client.db(SOURCE_DB);
  const targetDb = client.db(TARGET_DB);
  const slabDb   = client.db(SLAB_DB);

  // ── Pre-flight checks ───────────────────────────────────────────────────

  // Check if tenant already exists
  const existing = await slabDb.collection('tenants').findOne({
    $or: [
      { domain: `${SUBDOMAIN}.madladslab.com` },
      { domain: CUSTOM_DOMAIN },
      { 'meta.subdomain': SUBDOMAIN },
    ],
  });
  if (existing) {
    console.error(`Tenant "${SUBDOMAIN}" already exists in slab.tenants (domain: ${existing.domain})`);
    console.error('To re-run migration, first delete the tenant document and drop the slab_w2marketing database.');
    process.exit(1);
  }

  // Check target DB doesn't exist with data
  const targetCols = await targetDb.listCollections().toArray();
  if (targetCols.length > 0) {
    console.error(`Target database "${TARGET_DB}" already has ${targetCols.length} collections.`);
    console.error('Drop it first if you want to re-migrate: db.dropDatabase()');
    process.exit(1);
  }

  // ── Step 1: Read source data for brand profile ──────────────────────────

  const copyDocs   = await sourceDb.collection('w2_copy').find({}).toArray();
  const designDocs = await sourceDb.collection('w2_design').find({}).toArray();
  const brand = buildBrandFromData(copyDocs, designDocs);

  console.log('Brand profile:');
  console.log(`  Name:     ${brand.name}`);
  console.log(`  Location: ${brand.location}`);
  console.log(`  Email:    ${brand.email}`);
  console.log(`  Services: ${brand.services.join(', ')}`);

  // ── Step 2: Create tenant document ──────────────────────────────────────

  const now = new Date();
  const domain = `${SUBDOMAIN}.madladslab.com`;

  const tenantDoc = {
    domain,
    db: TARGET_DB,
    status: 'active',
    brand,
    s3Prefix: SUBDOMAIN,    // matches existing S3 paths
    public: {},              // user fills via admin panel
    secrets: {},             // user fills via admin panel (encrypted)
    meta: {
      subdomain: SUBDOMAIN,
      customDomain: CUSTOM_DOMAIN,
      ownerEmail: 'candace@w2marketing.biz',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'lifetime',
      provisionedAt: now,
      activatedAt: now,
      expiresAt: null,       // lifetime = no expiry
    },
    createdAt: now,
    updatedAt: now,
  };

  // Custom domain alias document (points to same DB)
  const aliasDoc = {
    domain: CUSTOM_DOMAIN,
    db: TARGET_DB,
    status: 'active',
    brand,
    s3Prefix: SUBDOMAIN,
    public: {},
    secrets: {},
    meta: {
      ...tenantDoc.meta,
      isPrimaryAlias: false,
    },
    createdAt: now,
    updatedAt: now,
  };

  console.log(`\nTenant: ${domain} → ${TARGET_DB}`);
  console.log(`Alias:  ${CUSTOM_DOMAIN} → ${TARGET_DB}`);
  console.log(`Plan:   lifetime (no expiry)`);
  console.log(`Status: active\n`);

  if (!DRY_RUN) {
    await slabDb.collection('tenants').insertOne(tenantDoc);
    console.log('[OK] Tenant document created');
    await slabDb.collection('tenants').insertOne(aliasDoc);
    console.log('[OK] Custom domain alias created');
  }

  // ── Step 3: Migrate collections ─────────────────────────────────────────

  let totalDocs = 0;

  for (const [srcCol, tgtCol] of Object.entries(COLLECTION_MAP)) {
    const count = await sourceDb.collection(srcCol).countDocuments().catch(() => 0);
    if (count === 0) {
      // Still create the empty collection
      if (!DRY_RUN) await targetDb.createCollection(tgtCol).catch(() => {});
      console.log(`  ${srcCol} → ${tgtCol}  (empty — collection created)`);
      continue;
    }

    const docs = await sourceDb.collection(srcCol).find({}).toArray();

    if (!DRY_RUN) {
      await targetDb.createCollection(tgtCol).catch(() => {});
      await targetDb.collection(tgtCol).insertMany(docs);
    }

    console.log(`  ${srcCol} → ${tgtCol}  (${count} docs)`);
    totalDocs += count;
  }

  // Copy users
  for (const [srcCol, tgtCol] of Object.entries(EXTRA_COLLECTIONS)) {
    const docs = await sourceDb.collection(srcCol).find({}).toArray();
    const count = docs.length;

    if (!DRY_RUN && count > 0) {
      await targetDb.createCollection(tgtCol).catch(() => {});
      await targetDb.collection(tgtCol).insertMany(docs);
    }

    console.log(`  ${srcCol} → ${tgtCol}  (${count} docs)`);
    totalDocs += count;
  }

  // ── Step 4: Create sessions collection (empty, for connect-mongo) ───────

  if (!DRY_RUN) {
    await targetDb.createCollection('sessions').catch(() => {});
  }
  console.log(`  (sessions collection created empty)`);

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Migration ${DRY_RUN ? 'preview' : 'complete'}!`);
  console.log(`  Collections: ${Object.keys(COLLECTION_MAP).length + Object.keys(EXTRA_COLLECTIONS).length}`);
  console.log(`  Documents:   ${totalDocs}`);
  console.log(`  Tenant:      ${domain} (lifetime, active)`);
  console.log(`  Custom:      ${CUSTOM_DOMAIN}`);
  console.log(`  Database:    ${TARGET_DB}`);

  if (DRY_RUN) {
    console.log(`\nRun with --execute to perform the actual migration:`);
    console.log(`  node scripts/migrate-w2.js --execute`);
  } else {
    console.log(`\nNext steps:`);
    console.log(`  1. Visit https://${domain}/admin/settings`);
    console.log(`  2. Input API keys (Stripe, Zoho, PayPal, Google) through admin panel`);
    console.log(`     → Keys will be encrypted via AES-256-GCM automatically`);
    console.log(`  3. Update Apache config for ${CUSTOM_DOMAIN} to proxy to Slab (port 3602)`);
    console.log(`  4. Test the site at https://${domain}`);
  }

  await client.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
