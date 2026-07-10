/**
 * One-time script: Provision Upland-TS as a Slab tenant.
 *
 *   Run from /srv/slab:  node scripts/provision-upland.js
 *
 * Idempotent — safe to re-run; every write is an existence-check or an upsert.
 *
 * What it does:
 *   1. Creates the tenant (upland-ts.madladslab.com) via the shared provisioner.
 *   2. Pulls brand details from the "Chris / Upland-TS" client record that lives
 *      in the madladslab tenant DB (the prospect notes captured on 2026-07-01).
 *   3. Seeds the "Summit Granite" design + all five Meridian pitch palettes as
 *      applyable themes, and turns ON the public design switcher for this tenant.
 *   4. Approves TWO admins: snoryder8019@gmail.com and chrisandrea@upland-ts.com.
 *
 * Does NOT touch Apache/DNS (prints suggestions only) — subdomains are served by
 * the existing slab wildcard vhost, and the custom domain is set on the tenant
 * doc for a later `setupCustomDomain()` run.
 */
import { connectDB, getSlabDb, getTenantDb, registerTenantHost } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';
import { DESIGN_DEFAULTS, THEME_KEYS } from '../routes/admin/design.js';
import '../config/config.js';

const SUBDOMAIN     = 'upland-ts';
const DOMAIN        = `${SUBDOMAIN}.madladslab.com`;
const CUSTOM_DOMAIN = 'upland-ts.com';
const SLAB_PORT     = 3602;

const OWNER_EMAIL = 'snoryder8019@gmail.com';        // Scott — platform owner
const ADMIN_EMAILS = [OWNER_EMAIL, 'chrisandrea@upland-ts.com']; // both approved admins
const SOURCE_TENANT_SUB = 'madladslab';              // where the client record lives
const CLIENT_EMAIL = 'chrisandrea@upland-ts.com';    // match key for the client doc

// ── Meridian / Upland-TS pitch palettes ────────────────────────────────────
// Mirrored from mllPitches/public/css/proposal.css (.mll-pr--<id>). These are
// the same five designs the public switcher offers (design-switcher.ejs).
const PALETTES = [
  { id: 'summit',      label: 'Summit Granite',      accent: '#0F766E', accent2: '#115E59', ink: '#14181F', paper: '#F5F1E6', cream: '#E9E5DA', layout: 'classic' },
  { id: 'trailhead',   label: 'Trailhead Indigo',    accent: '#3730A3', accent2: '#1E40AF', ink: '#1A1F33', paper: '#F4F5FB', cream: '#EAECF4', layout: 'classic' },
  { id: 'ridgeline',   label: 'Ridgeline Slate',     accent: '#B45309', accent2: '#7C2D12', ink: '#1B2128', paper: '#F3F4F6', cream: '#E6E8EA', layout: 'classic' },
  { id: 'evergreen',   label: 'Evergreen Boardroom', accent: '#14532D', accent2: '#166534', ink: '#1A1F1A', paper: '#F7F3E5', cream: '#EFEBDD', layout: 'classic' },
  { id: 'highcountry', label: 'High Country Sand',   accent: '#C2410C', accent2: '#7C2D12', ink: '#20180E', paper: '#FAF3E1', cream: '#EFE7CC', layout: 'classic' },
];

// Lighten a hex toward white by `pct` (0-100) — used for color_accent_light.
function lighten(hex, pct) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = pct / 100;
  const mix = (c) => Math.round(c + (255 - c) * f);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Map a pitch palette → Slab design/theme tokens.
function paletteToTokens(p) {
  return {
    color_primary:      p.accent2,
    color_primary_deep: p.ink,
    color_primary_mid:  p.accent,
    color_accent:       p.accent,
    color_accent_light: lighten(p.accent, 55),
    color_accent_2:     p.accent,
    color_accent_3:     p.accent2,
    color_bg:           p.paper,
    color_dark:         p.ink,
    color_white:        lighten(p.paper, 60),
    font_heading:       'Fraunces',
    font_body:          'Inter',
    landing_layout:     p.layout,
  };
}

// ── Copy content (PR / editorial voice, from the client's meeting notes) ────
const COPY_SEED = {
  hero_eyebrow:        'Public Relations · Editorial · Brand Voice',
  hero_heading:        'Stories worth publishing.',
  hero_heading_em:     'publishing',
  hero_sub:            'Upland-TS writes the press releases, executive profiles, and bylined features that get you read — and get you placed.',
  hero_cta_primary:    'Start a conversation',
  hero_cta_primary_link: '/#contact',
  hero_cta_secondary:  'See the work',
  hero_cta_secondary_link: '/#portfolio',

  services_label:      'What we do',
  services_heading:    'From the first draft to the front page',
  services_heading_em: 'front page',
  services_sub:        'Editorial-grade communications for founders, executives, and growing brands.',
  service1_title:      'Press & Media Relations',
  service1_desc:       'Press releases, media lists, and pitch outreach to the publications your audience actually reads.',
  service2_title:      'Profiles & Bios',
  service2_desc:       'Executive bios, founder profiles, and about pages that set you apart — written to be quoted.',
  service3_title:      'SEO Editorial & Blogging',
  service3_desc:       'Ongoing blogging and long-form editorial built for search, credibility, and LinkedIn reach.',

  about_eyebrow:       'Who we are',
  about_quote:         'Every business has a story. We make yours press-ready.',
  about_desc:          'Upland-TS is a communications studio for founders and executives who would rather be reading — and being read — than fighting a blank page. We handle the writing, the outreach, and the publishing cadence, so your name lands where it should.',
  about_sig:           'Chris — Upland-TS',

  contact_eyebrow:     "Let's talk",
  contact_heading:     'Tell us what you want the world to read',
  contact_sub:         "Share the moment — a launch, a raise, a milestone — and we'll shape the story around it.",
  contact_btn:         'Send',
};

async function main() {
  await connectDB();
  console.log('[provision-upland] Connected to MongoDB');

  const slab = getSlabDb();
  const now = new Date();

  // ── 1. Create tenant (idempotent) ──────────────────────────────────────────
  let tenant = await slab.collection('tenants').findOne({
    $or: [{ domain: DOMAIN }, { 'meta.subdomain': SUBDOMAIN }],
  });

  if (!tenant) {
    // No customDomain here → the provisioner won't try to write /etc/apache2.
    const result = await provisionTenant({
      subdomain:  SUBDOMAIN,
      brandName:  'Upland-TS',
      ownerEmail: OWNER_EMAIL,
      platform:   'slab',
    });
    console.log(`[provision-upland] Tenant created: ${result.domain} (db: ${result.dbName} @ ${result.dbHost})`);
    tenant = await slab.collection('tenants').findOne({ domain: result.domain });
  } else {
    console.log(`[provision-upland] Tenant already exists (${tenant.domain}) — enriching.`);
  }

  const dbName = tenant.db;
  const dbHost = tenant.dbHost || 'atlas';
  registerTenantHost(dbName, dbHost);
  const tdb = getTenantDb(dbName, dbHost);

  // ── 2. Pull brand details from the "Chris / Upland-TS" client record ────────
  let client = null;
  try {
    const srcTenant = await slab.collection('tenants').findOne({ 'meta.subdomain': SOURCE_TENANT_SUB });
    if (srcTenant) {
      registerTenantHost(srcTenant.db, srcTenant.dbHost || 'atlas');
      const sdb = getTenantDb(srcTenant.db, srcTenant.dbHost || 'atlas');
      client = await sdb.collection('clients').findOne({
        $or: [
          { email: CLIENT_EMAIL },
          { name: { $regex: /chris/i }, company: { $regex: /upl.?nd/i } },
        ],
      });
    }
  } catch (err) {
    console.warn('[provision-upland] Could not read source client record:', err.message);
  }
  if (client) console.log(`[provision-upland] Sourced client: ${client.name} · ${client.company} · ${client.email}`);
  else        console.log('[provision-upland] Client record not found — using defaults for brand.');

  // ── 3. Update the tenant brand + meta ───────────────────────────────────────
  const brand = {
    name:           'Upland-TS',
    location:       '',
    tagline:        'Stories worth publishing.',
    businessType:   'Public Relations & Editorial',
    industry:       'Communications / PR / Media',
    description:    'Upland-TS is a communications studio: press releases, executive profiles, bios, and SEO editorial for founders and growing brands.',
    serviceArea:    '',
    phone:          client?.phone || '',
    email:          client?.email || CLIENT_EMAIL,
    ownerName:      client?.name || 'Chris',
    services:       ['Press & Media Relations', 'Executive Profiles & Bios', 'SEO Editorial & Blogging', 'LinkedIn & Publication Outreach'],
    pricingNotes:   '',
    targetAudience: 'Founders, executives, and growing brands who want earned media and a credible editorial presence.',
    brandVoice:     'Editorial, credible, press-ready — never breathless.',
    socialLinks:    { linkedin: '', website: `https://${CUSTOM_DOMAIN}` },
  };

  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    {
      $set: {
        brand,
        status: 'active',
        'meta.customDomain': CUSTOM_DOMAIN,
        'meta.plan': 'pro',
        'meta.ownerEmail': OWNER_EMAIL,
        'meta.previewExpiresAt': null,
        updatedAt: now,
      },
    },
  );
  console.log('[provision-upland] Tenant brand + meta updated (status: active, custom domain set).');

  // ── 4. Seed design tokens (Summit Granite default + switcher ON) ────────────
  const designSeed = {
    ...paletteToTokens(PALETTES[0]),          // Summit Granite as the published default
    el_design_switcher: 'true',               // the requested public floating dropdown
    // Full-bleed cinematic hero (Meridian imagery). The switcher swaps the image
    // per design live; this is the published default. Images must exist at
    // /srv/slab/public/images/proposal/<id>.png (copied from mllPitches).
    hero_bg_media_url:  '/images/proposal/summit.png',
    hero_bg_media_type: 'image',
    hero_text_align:    'center',
    hero_vpos:          'middle',
    hero_overlay_opacity: '45',
    vis_hero: 'true', vis_services: 'true', vis_about: 'true',
    vis_portfolio: 'true', vis_contact: 'true', vis_blog: 'true',
    vis_process: 'false', vis_reviews: 'false',
    agent_name: 'Upland Desk',
    agent_greeting: 'Need a press release, a bio, or a blog cadence? Tell me the story.',
  };
  const designOps = Object.entries(designSeed).map(([key, value]) =>
    tdb.collection('design').updateOne(
      { key },
      { $set: { key, value: String(value), updatedAt: now } },
      { upsert: true },
    ),
  );
  await Promise.all(designOps);
  console.log(`[provision-upland] Design seeded (${designOps.length} tokens · switcher ON).`);

  // ── 5. Seed the five Meridian palettes as applyable themes ──────────────────
  for (const p of PALETTES) {
    const tokens = paletteToTokens(p);
    const settings = {};
    for (const k of THEME_KEYS) {
      if (tokens[k] !== undefined) settings[k] = tokens[k];
      else if (DESIGN_DEFAULTS[k] !== undefined) settings[k] = DESIGN_DEFAULTS[k];
    }
    await tdb.collection('themes').updateOne(
      { name: p.label },
      { $set: { name: p.label, meridianId: p.id, settings, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }
  console.log(`[provision-upland] Themes seeded (${PALETTES.length} Meridian palettes).`);

  // ── 6. Seed copy (idempotent per key) ───────────────────────────────────────
  const copyOps = Object.entries(COPY_SEED).map(([key, value]) =>
    tdb.collection('copy').updateOne(
      { key },
      { $setOnInsert: { key, value, createdAt: now } },   // don't clobber later edits
      { upsert: true },
    ),
  );
  await Promise.all(copyOps);
  console.log(`[provision-upland] Copy seeded (${copyOps.length} entries, insert-only).`);

  // ── 7. Approve both admins ──────────────────────────────────────────────────
  for (const email of ADMIN_EMAILS) {
    await tdb.collection('users').updateOne(
      { email },
      {
        $set: {
          email,
          isAdmin: true,
          isOwner: true,
          displayName: email === CLIENT_EMAIL ? (client?.name || 'Chris') : 'Scott',
          updatedAt: now,
        },
        $setOnInsert: { provider: 'provisioned', createdAt: now },
      },
      { upsert: true },
    );
    console.log(`[provision-upland] Admin approved: ${email}`);
  }

  // ── 8. Infra notes (no auto-apply) ──────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('NEXT STEPS (manual — nothing below was auto-applied)');
  console.log('='.repeat(70));
  console.log(`
  • Subdomain ${DOMAIN} is served by the existing slab wildcard vhost
    (proxy → 127.0.0.1:${SLAB_PORT}). No Apache change needed.

  • Custom domain ${CUSTOM_DOMAIN} is recorded on the tenant doc. To go live:
      point ${CUSTOM_DOMAIN} A record at the VPS, then from a superadmin
      session run setupCustomDomain('${DOMAIN}', '${CUSTOM_DOMAIN}')
      (plugins/provision.js) — it verifies DNS, writes the vhost + SSL, reloads.

  • Verify:   https://${DOMAIN}   (public site — palette dropdown, bottom-left)
              https://${DOMAIN}/admin   (login as either approved admin)
`);
  console.log('[provision-upland] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[provision-upland] FATAL:', err);
  process.exit(1);
});
