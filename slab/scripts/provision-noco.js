/**
 * One-time script: Provision NoCo Metal Workz as a Slab tenant.
 *
 * Run from /srv/slab:  node scripts/provision-noco.js
 *
 * Idempotent — checks for existing tenant before creating.
 * Does NOT touch Apache configs or DNS (prints suggestions only).
 */
import { MongoClient } from 'mongodb';

const MONGO_URI =
  'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net';

const SLAB_DB      = 'slab';
const TENANT_DB    = 'slab_nocometalworkz';
const NOCO_DB      = 'nocometalworkz';
const SUBDOMAIN    = 'nocometalworkz';
const DOMAIN       = 'nocometalworkz.madladslab.com';
const SLAB_PORT    = 3602;

// ── NoCo brand data (extracted from /srv/nocometalworkz) ───────────────────

const BRAND = {
  name: 'NoCo Metal Workz',
  location: 'Fort Collins, Colorado',
  tagline: 'Steel Built. Colorado Strong.',
  businessType: 'Metal Fabrication & Welding',
  industry: 'Construction / Trades',
  description:
    'NoCo Metal Workz has been serving Northern Colorado since 2009. Family-run shop specializing in custom welding, fence installation, and metal fabrication.',
  serviceArea: 'Fort Collins, Loveland, Greeley & surrounding areas',
  phone: '(970) 555-0182',
  email: 'info@nocometalworkz.com',
  ownerName: '',
  services: [
    'Custom Welding',
    'Fence Installation',
    'Metal Fabrication',
    'Wrought Iron',
  ],
  pricingNotes: 'Free on-site estimates',
  targetAudience: 'Residential & Commercial property owners in Northern Colorado',
  brandVoice: 'Direct, honest, blue-collar craftsmanship',
  socialLinks: {},
};

// ── Design tokens (NoCo dark industrial theme) ─────────────────────────────

const DESIGN_SEED = [
  { key: 'color_primary',   value: '#0d0d0d'  },   // dark bg
  { key: 'color_accent',    value: '#f97316'  },    // orange
  { key: 'color_bg',        value: '#0d0d0d'  },    // dark background
  { key: 'color_text',      value: '#e5e5e5'  },    // light text
  { key: 'color_muted',     value: '#888888'  },
  { key: 'font_heading',    value: 'Bebas Neue' },
  { key: 'font_body',       value: 'Inter' },
  { key: 'landing_layout',  value: 'bold' },         // dark industrial layout
  { key: 'vis_hero',        value: 'true' },
  { key: 'vis_services',    value: 'true' },
  { key: 'vis_portfolio',   value: 'true' },
  { key: 'vis_about',       value: 'true' },
  { key: 'vis_process',     value: 'false' },
  { key: 'vis_reviews',     value: 'false' },
  { key: 'vis_contact',     value: 'true' },
  { key: 'vis_blog',        value: 'false' },
  { key: 'agent_name',      value: 'NoCo Assistant' },
  { key: 'agent_greeting',  value: 'Need a quote or have questions about metalwork? I can help!' },
];

// ── Copy content (from NoCo's data/content.json) ───────────────────────────

const COPY_SEED = [
  { key: 'hero_eyebrow',   value: "Northern Colorado's Premier Metal Shop" },
  { key: 'hero_heading',   value: 'Steel Built. Colorado Strong.' },
  { key: 'hero_sub',       value: 'Custom welding, fence installation, and metal fabrication done right the first time. No shortcuts, no excuses.' },
  { key: 'hero_cta',       value: 'Get a Free Quote' },
  { key: 'hero_cta_secondary', value: 'View Our Work' },
  { key: 'about_eyebrow',  value: 'Who We Are' },
  { key: 'about_heading',  value: 'Craftsmanship Runs in Our Blood' },
  { key: 'about_body',     value: 'NoCo Metal Workz has been serving Northern Colorado since 2009. We\'re a family-run shop that takes pride in every bead, every post, and every gate we put out. If we wouldn\'t put it on our own property, we won\'t put it on yours.' },
  { key: 'services_eyebrow', value: 'What We Do' },
  { key: 'services_heading',  value: 'Built for Every Job' },
  { key: 'services_sub',   value: 'From a single gate to a full commercial fence line, we have the skills and equipment to handle it.' },
  { key: 'contact_eyebrow', value: "Let's Talk" },
  { key: 'contact_heading', value: 'Get a Free Quote' },
  { key: 'contact_body',   value: "We'll come to your site, assess the job, and give you a straight number — no surprises." },
  {
    key: 'services_list',
    value: JSON.stringify([
      { icon: '🔥', name: 'Custom Welding', desc: 'MIG, TIG, and stick welding for structural, decorative, and industrial applications.' },
      { icon: '🏗️', name: 'Fence Installation', desc: 'Chain link, wrought iron, wood, and privacy fencing for residential and commercial.' },
      { icon: '⚙️', name: 'Metal Fabrication', desc: 'Custom gates, handrails, frames, brackets, and structural components built to spec.' },
      { icon: '🛡️', name: 'Wrought Iron', desc: 'Ornamental ironwork, railings, and decorative metalwork crafted to last a lifetime.' },
    ]),
  },
];

// ── Portfolio items (from NoCo's work section) ─────────────────────────────

const PORTFOLIO_SEED = [
  { title: 'Fencing & Automatic Gating', category: 'Fencing',     image: '/images/intro/intro_Image_1708040155030.jpg', featured: true },
  { title: 'Residential Customs',        category: 'Residential',  image: '/images/intro/intro_Image_1708207956112.jpg', featured: false },
  { title: 'Precision Laser Cutting',    category: 'Fabrication',  image: '/images/intro/intro_Image_1708283734122.jpg', featured: false },
  { title: 'Custom Auto',               category: 'Automotive',   image: '/images/intro/intro_Image_1708284583078.jpg', featured: false },
  { title: 'Custom Auto Accessories',    category: 'Automotive',   image: '/images/intro/intro_Image_1708285028651.jpg', featured: true },
];

// ── Additional seed collections (empty but created) ────────────────────────

const EMPTY_COLLECTIONS = [
  'blog', 'clients', 'pages', 'custom_sections', 'section_media',
  'invoices', 'themes', 'brand_images', 'brand_models', 'assets',
  'contacts', 'onboarding_forms', 'onboarding_responses',
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('[provision-noco] Connected to MongoDB Atlas');

    const slabDb   = client.db(SLAB_DB);
    const tenantDb = client.db(TENANT_DB);
    const nocoDb   = client.db(NOCO_DB);

    // ── 1. Check if tenant already exists ──────────────────────────────────
    const existing = await slabDb.collection('tenants').findOne({
      $or: [{ domain: DOMAIN }, { 'meta.subdomain': SUBDOMAIN }],
    });

    if (existing) {
      console.log(`[provision-noco] Tenant "${SUBDOMAIN}" already exists (id: ${existing._id}). Skipping tenant creation.`);
    } else {
      // ── 2. Create tenant document ────────────────────────────────────────
      const now = new Date();
      const tenantDoc = {
        domain: DOMAIN,
        db: TENANT_DB,
        status: 'active',
        brand: BRAND,
        s3Prefix: SUBDOMAIN,
        public: {},
        secrets: {},
        meta: {
          subdomain: SUBDOMAIN,
          customDomain: null,
          ownerEmail: 'info@nocometalworkz.com',
          stripeCustomerId: null,
          plan: 'pro',
          provisionedAt: now,
          previewExpiresAt: null,   // active immediately — no preview period
        },
        createdAt: now,
      };

      await slabDb.collection('tenants').insertOne(tenantDoc);
      console.log(`[provision-noco] Tenant doc created: ${DOMAIN}`);
    }

    // ── 3. Seed design collection ──────────────────────────────────────────
    const designCount = await tenantDb.collection('design').countDocuments();
    if (designCount === 0) {
      await tenantDb.collection('design').insertMany(DESIGN_SEED);
      console.log(`[provision-noco] Design seeded (${DESIGN_SEED.length} tokens)`);
    } else {
      console.log(`[provision-noco] Design already has ${designCount} docs — skipping`);
    }

    // ── 4. Seed copy collection ────────────────────────────────────────────
    const copyCount = await tenantDb.collection('copy').countDocuments();
    if (copyCount === 0) {
      await tenantDb.collection('copy').insertMany(COPY_SEED);
      console.log(`[provision-noco] Copy seeded (${COPY_SEED.length} entries)`);
    } else {
      console.log(`[provision-noco] Copy already has ${copyCount} docs — skipping`);
    }

    // ── 5. Seed portfolio collection ───────────────────────────────────────
    const portfolioCount = await tenantDb.collection('portfolio').countDocuments();
    if (portfolioCount === 0) {
      const now = new Date();
      const portfolioDocs = PORTFOLIO_SEED.map((p) => ({
        ...p,
        description: '',
        createdAt: now,
      }));
      await tenantDb.collection('portfolio').insertMany(portfolioDocs);
      console.log(`[provision-noco] Portfolio seeded (${portfolioDocs.length} items)`);
    } else {
      console.log(`[provision-noco] Portfolio already has ${portfolioCount} docs — skipping`);
    }

    // ── 6. Copy admin users from nocometalworkz.ncmw_users ─────────────────
    const userCount = await tenantDb.collection('users').countDocuments();
    if (userCount === 0) {
      const nocoUsers = await nocoDb
        .collection('ncmw_users')
        .find({})
        .toArray();

      if (nocoUsers.length > 0) {
        const now = new Date();
        const mappedUsers = nocoUsers.map((u) => ({
          googleId: u.googleId || null,
          email: u.email || '',
          displayName: u.displayName || BRAND.name,
          avatar: u.avatar || '',
          isAdmin: u.isAdmin === true,
          isOwner: u.isAdmin === true,   // promote existing admins to owners
          provider: 'migrated',
          migratedFrom: 'nocometalworkz',
          originalId: u._id,
          createdAt: u.createdAt || now,
        }));
        await tenantDb.collection('users').insertMany(mappedUsers);
        console.log(`[provision-noco] Users migrated: ${mappedUsers.length} (from ncmw_users)`);
      } else {
        // Fallback: create a default admin
        await tenantDb.collection('users').insertOne({
          email: 'info@nocometalworkz.com',
          displayName: BRAND.name,
          isAdmin: true,
          isOwner: true,
          provider: 'provisioned',
          createdAt: new Date(),
        });
        console.log('[provision-noco] No users found in ncmw_users — created default admin');
      }
    } else {
      console.log(`[provision-noco] Users already has ${userCount} docs — skipping`);
    }

    // ── 7. Create empty collections ────────────────────────────────────────
    const existingCols = (await tenantDb.listCollections().toArray()).map(
      (c) => c.name
    );
    for (const colName of EMPTY_COLLECTIONS) {
      if (!existingCols.includes(colName)) {
        await tenantDb.createCollection(colName);
      }
    }
    console.log(`[provision-noco] Empty collections ensured (${EMPTY_COLLECTIONS.length})`);

    // ── 8. Print Apache config suggestion ──────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('SUGGESTED APACHE CONFIG (do NOT auto-apply — review first)');
    console.log('='.repeat(70));
    console.log(`
# File: /etc/apache2/sites-available/nocometalworkz.madladslab.com.conf
#
# NoCo Metal Workz should be handled by the Slab wildcard config
# (slab-wildcard.conf / slab-wildcard-le-ssl.conf) since it is a
# *.madladslab.com subdomain proxying to port ${SLAB_PORT}.
#
# If the wildcard is already active, NO additional Apache config is needed.
#
# If you need a standalone vhost instead:

<VirtualHost *:80>
    ServerName ${DOMAIN}

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    ProxyPass / http://127.0.0.1:${SLAB_PORT}/
    ProxyPassReverse / http://127.0.0.1:${SLAB_PORT}/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:${SLAB_PORT}/$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/nocometalworkz-error.log
    CustomLog \${APACHE_LOG_DIR}/nocometalworkz-access.log combined
</VirtualHost>

# Then: a2ensite nocometalworkz.madladslab.com.conf && systemctl reload apache2
# Then: certbot --apache -d ${DOMAIN}
`);
    console.log('='.repeat(70));
    console.log('[provision-noco] Done.');
  } catch (err) {
    console.error('[provision-noco] FATAL:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
