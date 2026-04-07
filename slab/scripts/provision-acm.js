#!/usr/bin/env node
/**
 * Slab — Provision the "acm" tenant (ACM Hospitality & Restaurant Group)
 * Creates acm.madladslab.com tenant with ACM's dark theme.
 *
 * Restaurants: The Nook (Celina), Heyday (Celina), Graffiti Pasta (Denton)
 *
 * Usage: node scripts/provision-acm.js
 *
 * Idempotent — safe to re-run (skips if tenant already exists).
 * Does NOT copy sessions or modify Apache configs.
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net';
const SLAB_DB   = 'slab';
const ACM_DB    = 'acm';           // existing ACM database
const TENANT_DB = 'slab_acm';      // new slab tenant database

// ── ACM Dark Design (mapped from ACM's CSS) ──────────────────────────────────

const ACM_DESIGN = [
  { key: 'color_primary',       value: '#f5f0eb' },  // warm white — primary text/UI
  { key: 'color_primary_deep',  value: '#0a0a0a' },  // near-black background
  { key: 'color_primary_mid',   value: '#1a1a2e' },  // hero gradient mid-tone
  { key: 'color_accent',        value: '#66b094' },   // Nook green — brand accent
  { key: 'color_accent_light',  value: '#bbb174' },   // Heyday gold — secondary accent
  { key: 'color_bg',            value: '#0a0a0a' },   // dark background
  { key: 'font_heading',        value: 'Playfair Display' },
  { key: 'font_body',           value: 'Inter' },
  { key: 'landing_layout',      value: 'dark' },
  { key: 'vis_hero',            value: 'true' },
  { key: 'vis_services',        value: 'true' },
  { key: 'vis_portfolio',       value: 'true' },
  { key: 'vis_about',           value: 'true' },
  { key: 'vis_process',         value: 'false' },
  { key: 'vis_reviews',         value: 'true' },
  { key: 'vis_contact',         value: 'true' },
  { key: 'vis_blog',            value: 'false' },
  { key: 'agent_name',          value: 'ACM Concierge' },
  { key: 'agent_greeting',      value: 'Welcome to ACM Hospitality. How can I help you today?' },
];

// ── ACM Copy (from ACM index.ejs content) ────────────────────────────────────

const ACM_COPY = [
  { key: 'hero_eyebrow',         value: 'ACM' },
  { key: 'hero_heading',         value: 'Hospitality &' },
  { key: 'hero_heading_em',      value: 'Restaurant Group' },
  { key: 'hero_sub',             value: 'Crafting community through food, drink & atmosphere' },
  { key: 'hero_cta_primary',     value: 'Our Restaurants' },
  { key: 'hero_cta_primary_link', value: '#services' },
  { key: 'hero_cta_secondary',   value: 'Franchise Inquiries' },
  { key: 'hero_cta_secondary_link', value: 'mailto:info@graffitipasta.com' },
  { key: 'services_label',       value: 'Our Concepts' },
  { key: 'services_heading',     value: 'The' },
  { key: 'services_heading_em',  value: 'Restaurants' },
  { key: 'services_sub',         value: 'Three unique dining experiences across North Texas.' },
  { key: 'service1_title',       value: 'The Nook' },
  { key: 'service1_desc',        value: 'A Cocktail Kitchen & Market Cafe built for the community of Celina. Light Farms, Celina.' },
  { key: 'service1_link',        value: 'https://www.thenookckmc.com' },
  { key: 'service2_title',       value: 'Heyday' },
  { key: 'service2_desc',        value: 'A cocktail bar & kitchen — fresh, comfortable flavors with a fun twist. Downtown, Celina.' },
  { key: 'service2_link',        value: 'https://heydaycelina.com' },
  { key: 'service3_title',       value: 'Graffiti Pasta' },
  { key: 'service3_desc',        value: 'Tuscan inspired with graffitied fusions. Think of the pastabilities. Denton, TX.' },
  { key: 'service3_link',        value: 'https://www.graffitipasta.com' },
  { key: 'about_quote',          value: 'Crafting community through food, drink & atmosphere.' },
  { key: 'about_desc',           value: 'ACM Hospitality manages a growing portfolio of restaurant concepts across North Texas, each with its own identity but united by a commitment to community, quality ingredients, and memorable dining experiences.' },
  { key: 'contact_sub',          value: 'For franchise inquiries and partnerships' },
  { key: 'contact_location',     value: 'North Texas' },
  { key: 'contact_serving',      value: 'Celina, Denton & beyond' },
  { key: 'contact_services',     value: 'Restaurant Management, Franchise Opportunities, Hospitality Consulting' },
  { key: 'footer_legal',         value: '© ACM Hospitality & Restaurant Group' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

const client = new MongoClient(MONGO_URI);

try {
  await client.connect();
  console.log('[acm] MongoDB connected');

  const slabDb   = client.db(SLAB_DB);
  const acmDb    = client.db(ACM_DB);
  const tenantDb = client.db(TENANT_DB);

  // ── 1. Check if tenant already exists ──────────────────────────────────────
  const existing = await slabDb.collection('tenants').findOne({
    $or: [
      { domain: 'acm.madladslab.com' },
      { 'meta.subdomain': 'acm' },
    ],
  });

  if (existing) {
    console.log('[acm] Tenant "acm" already exists — skipping provisioning.');
    console.log('[acm] To re-provision, delete the tenant from slab.tenants first.');
    process.exit(0);
  }

  // ── 2. Create tenant document in slab.tenants ──────────────────────────────
  const now = new Date();
  const tenantDoc = {
    domain: 'acm.madladslab.com',
    db: TENANT_DB,
    status: 'active',
    brand: {
      name: 'ACM Hospitality',
      location: 'North Texas',
      tagline: 'Crafting community through food, drink & atmosphere',
      businessType: 'Restaurant Group',
      industry: 'Hospitality / Food & Beverage',
      description: 'ACM Hospitality manages The Nook, Heyday, and Graffiti Pasta — three unique restaurant concepts across North Texas.',
      serviceArea: 'Celina, Denton, North Texas',
      phone: '',
      email: 'info@graffitipasta.com',
      ownerName: '',
      services: [
        'Restaurant Management',
        'Franchise Opportunities',
        'Hospitality Consulting',
        'Event Hosting',
        'Catering',
      ],
      pricingNotes: '',
      targetAudience: 'Diners, franchise investors, and hospitality partners in North Texas',
      brandVoice: 'Warm, inviting, community-focused, upscale-casual',
      socialLinks: {
        thenook: 'https://www.thenookckmc.com',
        heyday: 'https://heydaycelina.com',
        graffitipasta: 'https://www.graffitipasta.com',
      },
    },
    s3Prefix: 'acm',
    public: {},
    secrets: {},
    meta: {
      subdomain: 'acm',
      customDomain: null,
      ownerEmail: 'snoryder8019@gmail.com',
      stripeCustomerId: null,
      plan: 'pro',
      provisionedAt: now,
      previewExpiresAt: null,   // pro plan — no preview expiry
    },
    createdAt: now,
  };

  await slabDb.collection('tenants').insertOne(tenantDoc);
  console.log('[acm] Tenant document created: acm.madladslab.com');

  // ── 3. Seed tenant database collections ────────────────────────────────────

  // Create all standard slab collections
  const COLLECTIONS = [
    'design', 'copy', 'blog', 'portfolio', 'clients', 'pages',
    'custom_sections', 'section_media', 'invoices', 'themes',
    'brand_images', 'brand_models', 'assets', 'contacts',
    'onboarding_forms', 'onboarding_responses',
  ];

  for (const col of COLLECTIONS) {
    await tenantDb.createCollection(col).catch(() => {});
  }
  console.log('[acm] Collections created in slab_acm');

  // ── 3a. Seed design ────────────────────────────────────────────────────────
  const designOps = ACM_DESIGN.map(d =>
    tenantDb.collection('design').updateOne(
      { key: d.key },
      { $set: { key: d.key, value: d.value, updatedAt: now } },
      { upsert: true }
    )
  );
  await Promise.all(designOps);
  console.log('[acm] Design seeded (dark theme, Playfair Display + Inter)');

  // ── 3b. Seed copy ─────────────────────────────────────────────────────────
  const copyOps = ACM_COPY.map(c =>
    tenantDb.collection('copy').updateOne(
      { key: c.key },
      { $set: { key: c.key, value: c.value, updatedAt: now } },
      { upsert: true }
    )
  );
  await Promise.all(copyOps);
  console.log('[acm] Copy seeded (hero, services, about, contact)');

  // ── 3c. Copy admin users from acm DB (skip sessions) ─────────────────────
  const acmUsers = await acmDb.collection('users').find({
    $or: [{ isAdmin: true }, { role: 'admin' }],
  }).toArray();

  if (acmUsers.length > 0) {
    const cleanUsers = acmUsers.map(u => {
      const { _id, sessions, ...rest } = u;
      return {
        ...rest,
        isAdmin: true,
        isOwner: true,
        provider: 'migrated-from-acm',
        migratedAt: now,
        createdAt: u.createdAt || now,
      };
    });

    for (const user of cleanUsers) {
      await tenantDb.collection('users').updateOne(
        { email: user.email },
        { $set: user },
        { upsert: true }
      );
    }
    console.log(`[acm] Migrated ${cleanUsers.length} admin user(s) from acm database`);
  } else {
    // No admin users found — create the superadmin as fallback
    await tenantDb.collection('users').insertOne({
      email: 'snoryder8019@gmail.com',
      displayName: 'ACM Hospitality',
      isAdmin: true,
      isOwner: true,
      provider: 'provisioned',
      createdAt: now,
    });
    console.log('[acm] No admin users found in acm DB — created default superadmin');
  }

  // ── 3d. Save ACM Dark as a reusable theme ─────────────────────────────────
  await tenantDb.collection('themes').updateOne(
    { name: 'ACM Dark' },
    {
      $set: {
        name: 'ACM Dark',
        settings: Object.fromEntries(
          ACM_DESIGN
            .filter(d => d.key.startsWith('color_') || d.key.startsWith('font_') || d.key === 'landing_layout')
            .map(d => [d.key, d.value])
        ),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  console.log('[acm] ACM Dark theme saved');

  // ── 4. Print Apache config suggestion ──────────────────────────────────────
  console.log(`
=== Apache Config Suggestion (acm.madladslab.com) ===

Since Slab uses a wildcard *.madladslab.com Apache config pointing to port 3602,
acm.madladslab.com should already be handled by the existing wildcard conf at:
  /etc/apache2/sites-available/slab-wildcard.conf
  /etc/apache2/sites-available/slab-wildcard-le-ssl.conf

The wildcard conf routes all *.madladslab.com traffic to Slab (port 3602),
and Slab's tenant middleware resolves 'acm' from the Host header to load slab_acm.

No additional Apache config is needed unless ACM gets a custom domain.

If a custom domain is added later (e.g., acmhospitality.com), use:

<VirtualHost *:80>
    ServerName acmhospitality.com
    ServerAlias www.acmhospitality.com

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    ProxyPass / http://127.0.0.1:3602/
    ProxyPassReverse / http://127.0.0.1:3602/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:3602/$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/acmhospitality-error.log
    CustomLog \${APACHE_LOG_DIR}/acmhospitality-access.log combined
</VirtualHost>

Then: a2ensite acmhospitality.com.conf && certbot --apache -d acmhospitality.com
=============================================================
`);

  console.log('[acm] Provisioning complete!');
  console.log(`  Tenant:  acm.madladslab.com`);
  console.log(`  DB:      slab_acm`);
  console.log(`  Admin:   https://acm.madladslab.com/admin`);
  console.log(`  Site:    https://acm.madladslab.com`);
  console.log(`  Theme:   ACM Dark`);
  console.log(`  Plan:    pro`);

} catch (err) {
  console.error('[acm] Provisioning failed:', err.message);
  process.exit(1);
} finally {
  await client.close();
}

process.exit(0);
