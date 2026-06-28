/**
 * Provision: Greenley Colorado Lawns & Landscaping  →  sLab tenant
 *
 *   Run from /srv/slab:  node scripts/provision-greenley.js
 *
 * Idempotent — safe to re-run. Seeds only what is missing.
 * Uses the app's own configured Mongo connection (DB_URL from .env).
 * Does NOT touch Apache / DNS / SSL — prints custom-domain steps only.
 *
 * Brand spelling note: the BRAND is "Greenley" (green + ley), the CITY is
 * "Greeley, Colorado." That mismatch is intentional, matching domain greenley.co.
 */
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import '../config/config.js';

// ── Identity ────────────────────────────────────────────────────────────────
const SUBDOMAIN    = 'greenley';
const DOMAIN       = `${SUBDOMAIN}.madladslab.com`;
const CUSTOM_DOMAIN = 'greenley.co';
const TENANT_DB    = `slab_${SUBDOMAIN}`;
const OWNER_EMAIL  = 'hello@greenley.co';   // placeholder — update in /admin
const SLAB_PORT    = 3602;

// ── Brand ─────────────────────────────────────────────────────────────────
const BRAND = {
  name: 'Greenley Colorado Lawns & Landscaping',
  location: 'Greeley, Colorado',
  tagline: 'Local lawns. Low prices. Clean edges.',
  businessType: 'Lawn Care & Landscaping',
  industry: 'Home Services',
  description:
    "A grassroots, one-person lawn care business in Greeley, Colorado. It's just me, my mower, and my edger — reliable, affordable lawn care without the big-company markup.",
  serviceArea: 'Greeley, Evans, Garden City & nearby Northern Colorado',
  phone: '',                       // add your number in /admin
  email: OWNER_EMAIL,
  ownerName: '',
  services: [
    'Lawn Mowing',
    'Edging & Line Trimming',
    'Recurring Lawn Maintenance',
    'Seasonal Yard Cleanup',
  ],
  pricingNotes:
    'Low-rate pricing, $35 minimum per visit. Mow + edge always included. Final price confirmed on a quick on-site look.',
  targetAudience: 'Greeley-area homeowners who want reliable, affordable lawn care',
  brandVoice: 'Friendly, honest, local, hardworking — a real person, not a franchise.',
  socialLinks: {},
};

// ── Design tokens (fresh, green) ────────────────────────────────────────────
const DESIGN_SEED = [
  { key: 'color_primary', value: '#2F6B2F' },   // grass green
  { key: 'color_accent',  value: '#F4B400' },   // sun gold (CTA)
  { key: 'color_bg',      value: '#F6F8F2' },   // off-white
  { key: 'color_text',    value: '#1B2A1B' },
  { key: 'color_muted',   value: '#5C6B5C' },
  { key: 'color_white',   value: '#FFFFFF' },
  { key: 'font_heading',  value: 'Poppins' },
  { key: 'font_body',     value: 'Inter' },
  { key: 'vis_hero',      value: 'true'  },
  { key: 'vis_services',  value: 'true'  },
  { key: 'vis_portfolio', value: 'false' },   // solo op — no portfolio yet
  { key: 'vis_about',     value: 'true'  },
  { key: 'vis_process',   value: 'true'  },
  { key: 'vis_reviews',   value: 'false' },
  { key: 'vis_contact',   value: 'true'  },
  { key: 'vis_blog',      value: 'false' },
  { key: 'agent_name',     value: 'Greenley Helper' },
  { key: 'agent_greeting', value: 'Want a quick lawn quote or to book a mow? I can help!' },
];

// ── Copy ────────────────────────────────────────────────────────────────────
const COPY_SEED = [
  { key: 'hero_eyebrow', value: 'Greeley, Colorado' },
  { key: 'hero_heading', value: 'Low-Price Lawns, Done Right.' },
  { key: 'hero_sub',     value: "It's just me, my mower, and my edger — keeping Greeley yards sharp without the big-company price tag." },
  { key: 'hero_cta',     value: 'Get My Free Quote' },
  { key: 'hero_cta_secondary', value: 'See Pricing' },

  { key: 'about_eyebrow', value: "Who You're Hiring" },
  { key: 'about_heading', value: 'A Neighbor, Not a Franchise' },
  { key: 'about_body',    value: "I started Greenley Colorado the simplest way there is: one person, one mower, one edger, and a promise to show up and do good work. No call centers, no upsells, no crew tramping through your yard. When you book, you get me — and a lawn that looks like someone actually cared about it." },

  { key: 'services_eyebrow', value: 'What I Do' },
  { key: 'services_heading', value: 'Simple, Honest Lawn Care' },
  { key: 'services_sub',     value: 'Mowing and edging are always included. Need a little extra? Just ask.' },

  { key: 'process_eyebrow', value: 'How It Works' },
  { key: 'process_heading', value: 'Three Easy Steps' },

  { key: 'contact_eyebrow', value: "Let's Go" },
  { key: 'contact_heading', value: 'Get Your Free Quote' },
  { key: 'contact_body',    value: "Tell me your address and the best way to reach you. I personally confirm every booking by call, text, or email — whichever you prefer." },

  { key: 'pricing_note', value: 'Low-rate pricing with a $35 minimum per visit. Mow + edge always included. Final price confirmed on a quick on-site look.' },

  {
    key: 'services_list',
    value: JSON.stringify([
      { icon: '🌱', name: 'Lawn Mowing',            desc: 'Clean, even cuts on a reliable schedule. Your grass, kept the height it should be.' },
      { icon: '✂️', name: 'Edging & Line Trimming', desc: 'Crisp edges along walks, drives, and beds — the detail that makes a yard look finished.' },
      { icon: '🔁', name: 'Recurring Maintenance',  desc: 'Weekly or biweekly visits so you never think about it. Same day, same person, every time.' },
      { icon: '🍂', name: 'Seasonal Cleanup',       desc: 'Spring and fall tidy-ups — leaves, overgrowth, and that end-of-season reset.' },
    ]),
  },
  {
    key: 'process_steps',
    value: JSON.stringify([
      { step: '1', title: 'Get a quote', desc: 'Use the instant estimate or send your address — takes a minute.' },
      { step: '2', title: 'I confirm',   desc: 'I reach out by call, text, or email to lock in your day and price.' },
      { step: '3', title: 'You relax',   desc: 'I show up, mow, edge, and clean up. Done right, every time.' },
    ]),
  },
];

// ── Fractional-acreage calculator ───────────────────────────────────────────
// Engine is linear: estimate = acreage * costPerUnit (+ any add-ons).
// Rate chosen for low-price positioning with a stated $35 minimum visit.
// Reference "from" prices for the four lot sizes the owner listed:
//   1/4 acre ≈ $40   ·   1/6 acre ≈ $35 (min)   ·   1/8 acre = $35 (min)   ·   1 acre ≈ $160
// The owner reviews/edits all of this at /admin/calculators.
const CALC_RATE_PER_ACRE = 160;
const CALCULATOR = {
  slug: 'lawn-estimate',
  title: 'Instant Lawn Quote',
  description:
    'Enter your lawn size in acres for a low-rate estimate. Not sure of your acreage? Use a rough guess — common Greeley lots: 1/4 acre, 1/6 acre, 1/8 acre. Larger property? Try 1 acre.',
  noteText:
    '$35 minimum per visit. Mowing + edging always included. Estimate only — final price confirmed on a quick on-site look. Large or detailed properties may vary.',
  enabled: true,
  baseFields: [
    { id: 'acreage', label: 'Approx. lawn size (acres)', min: 0.05, max: 5, costPerUnit: CALC_RATE_PER_ACRE },
  ],
  multiplierFields: [],
  addOns: [
    { id: 'cleanup',    label: 'Add seasonal yard cleanup', type: 'checkbox', cost: 60 },
    { id: 'bush_trim',  label: 'Trim bushes / hedges',      type: 'checkbox', cost: 40 },
  ],
  primaryCta: { label: 'Book My Lawn', url: '/book' },
};

// ── Booking: service-slots mode (2 quotes/day + 4 lawns/day) ────────────────
const BOOKING_SETTINGS = {
  enabled: true,
  mode: 'service-slots',
  title: 'Book Your Lawn',
  subtitle: 'Pick an open time below. Phone number and your preferred contact method (call / text / email) are required — I personally confirm every booking before it\'s final.',
  meetingLength: 30,
  bufferMinutes: 15,
  advanceDays: 21,
  minNoticeHours: 12,
  availability: {
    1: { enabled: true, start: '08:00', end: '17:00' },
    2: { enabled: true, start: '08:00', end: '17:00' },
    3: { enabled: true, start: '08:00', end: '17:00' },
    4: { enabled: true, start: '08:00', end: '17:00' },
    5: { enabled: true, start: '08:00', end: '17:00' },
  },
  serviceTypes: [
    { slug: 'quote',        label: 'Free On-Site Quote (~20 min)', requiresVehicle: false },
    { slug: 'lawn-service', label: 'Lawn Mow & Edge',              requiresVehicle: false },
  ],
  // Custom reference fields (informational — read by the owner, not the engine)
  capacityPerDay: { quote: 2, 'lawn-service': 4 },
  updatedAt: new Date(),
};

// Daily slot template — 4 lawn jobs, then 2 quotes late afternoon.
const LAWN_SLOTS = [
  ['08:00', '09:30'],
  ['09:45', '11:15'],
  ['11:30', '13:00'],
  ['13:15', '14:45'],
];
const QUOTE_SLOTS = [
  ['16:00', '16:20'],
  ['16:45', '17:05'],
];

function nextWeekdays(count) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1); // start tomorrow
  while (out.length < count) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ── Quote request form (strict required contact info) ───────────────────────
const QUOTE_FORM = {
  name: 'Request a Free Quote',
  slug: 'request-a-free-quote',
  description: "Tell me about your lawn and the best way to reach you. I'll confirm by your preferred method.",
  status: 'active',
  assignTo: [],
  fields: [
    { key: 'name',  label: 'Your name',     type: 'text',  required: true, width: 'half' },
    { key: 'phone', label: 'Phone number',  type: 'text',  required: true, width: 'half', helpText: 'So I can confirm your booking' },
    { key: 'email', label: 'Email',         type: 'email', required: true, width: 'half' },
    { key: 'preferred_contact', label: 'Best way to reach you', type: 'radio', required: true, options: [
      { value: 'call',  label: 'Phone call' },
      { value: 'text',  label: 'Text' },
      { value: 'email', label: 'Email' },
    ] },
    { key: 'address', label: 'Property address', type: 'text', required: true, helpText: 'Street address in/near Greeley, CO' },
    { key: 'lot_size', label: 'Approx. lot size', type: 'select', required: false, options: [
      { value: '1/8',  label: '~1/8 acre (small yard)' },
      { value: '1/6',  label: '~1/6 acre' },
      { value: '1/4',  label: '~1/4 acre (typical lot)' },
      { value: '1',    label: '~1 acre (large property)' },
      { value: 'unsure', label: "Not sure — take a look" },
    ] },
    { key: 'services', label: 'What do you need?', type: 'checkbox', options: [
      { value: 'mow_edge',  label: 'Mow & edge' },
      { value: 'recurring', label: 'Recurring (weekly / biweekly)' },
      { value: 'cleanup',   label: 'Seasonal cleanup' },
      { value: 'bush_trim', label: 'Bush / hedge trim' },
    ] },
    { key: 'preferred_days', label: 'Preferred days', type: 'text', width: 'half', placeholder: 'e.g. Mondays' },
    { key: 'notes', label: 'Gate code, dogs, anything I should know', type: 'textarea' },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const EMPTY_COLLECTIONS = [
  'blog', 'clients', 'pages', 'custom_sections', 'section_media',
  'invoices', 'themes', 'brand_images', 'brand_models', 'assets',
  'contacts', 'bookings', 'meetings',
];

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  await connectDB();
  const slab = getSlabDb();
  const db = getTenantDb(TENANT_DB);
  const now = new Date();

  // 1. Tenant doc -------------------------------------------------------------
  const existing = await slab.collection('tenants').findOne({
    $or: [{ domain: DOMAIN }, { 'meta.subdomain': SUBDOMAIN }],
  });
  if (existing) {
    console.log(`[greenley] Tenant already exists (id ${existing._id}) — skipping tenant doc.`);
  } else {
    await slab.collection('tenants').insertOne({
      domain: DOMAIN,
      db: TENANT_DB,
      status: 'active',
      platform: 'slab',
      brand: BRAND,
      s3Prefix: SUBDOMAIN,
      public: { customDomain: CUSTOM_DOMAIN },
      secrets: {},
      meta: {
        subdomain: SUBDOMAIN,
        customDomain: CUSTOM_DOMAIN,
        ownerEmail: OWNER_EMAIL,
        stripeCustomerId: null,
        plan: 'free',
        provisionedAt: now,
        activatedAt: now,
        previewExpiresAt: null,
      },
      createdAt: now,
    });
    console.log(`[greenley] Tenant doc created: ${DOMAIN}  (custom domain: ${CUSTOM_DOMAIN})`);
  }

  // 2. Design -----------------------------------------------------------------
  if (await db.collection('design').countDocuments() === 0) {
    await db.collection('design').insertMany(DESIGN_SEED);
    console.log(`[greenley] Design seeded (${DESIGN_SEED.length} tokens)`);
  } else { console.log('[greenley] Design exists — skipping'); }

  // 3. Copy -------------------------------------------------------------------
  if (await db.collection('copy').countDocuments() === 0) {
    await db.collection('copy').insertMany(COPY_SEED);
    console.log(`[greenley] Copy seeded (${COPY_SEED.length} entries)`);
  } else { console.log('[greenley] Copy exists — skipping'); }

  // 4. Calculator -------------------------------------------------------------
  await db.createCollection('calculators').catch(() => {});
  if (await db.collection('calculators').countDocuments({ slug: CALCULATOR.slug }) === 0) {
    await db.collection('calculators').insertOne({ ...CALCULATOR, createdAt: now, updatedAt: now });
    console.log(`[greenley] Calculator seeded: ${CALCULATOR.slug} ($${CALC_RATE_PER_ACRE}/acre)`);
  } else { console.log('[greenley] Calculator exists — skipping'); }

  // 5. Booking settings -------------------------------------------------------
  await db.collection('booking_settings').updateOne(
    { key: 'config' },
    { $set: { key: 'config', value: BOOKING_SETTINGS } },
    { upsert: true },
  );
  console.log('[greenley] Booking settings set (service-slots: 2 quotes + 4 lawns/day)');

  // 6. Calendar slots — next 21 weekdays --------------------------------------
  await db.createCollection('calendar_slots').catch(() => {});
  const dates = nextWeekdays(21);
  let created = 0;
  for (const date of dates) {
    for (const [startTime, endTime] of LAWN_SLOTS) {
      const exists = await db.collection('calendar_slots').findOne({ date, startTime, serviceType: 'lawn-service' });
      if (!exists) {
        await db.collection('calendar_slots').insertOne({
          date, startTime, endTime, serviceType: 'lawn-service',
          location: { label: 'Your address (Greeley & nearby)', address: '', lat: null, lng: null },
          maxBookings: 1, currentBookings: 0, notes: '', createdAt: now,
        });
        created++;
      }
    }
    for (const [startTime, endTime] of QUOTE_SLOTS) {
      const exists = await db.collection('calendar_slots').findOne({ date, startTime, serviceType: 'quote' });
      if (!exists) {
        await db.collection('calendar_slots').insertOne({
          date, startTime, endTime, serviceType: 'quote',
          location: { label: 'Your address (Greeley & nearby)', address: '', lat: null, lng: null },
          maxBookings: 1, currentBookings: 0, notes: '', createdAt: now,
        });
        created++;
      }
    }
  }
  console.log(`[greenley] Calendar slots ensured for ${dates.length} weekdays (${created} new; 4 lawn + 2 quote per day)`);

  // 7. Quote request form -----------------------------------------------------
  await db.createCollection('onboarding_forms').catch(() => {});
  await db.createCollection('onboarding_responses').catch(() => {});
  if (await db.collection('onboarding_forms').countDocuments({ slug: QUOTE_FORM.slug }) === 0) {
    await db.collection('onboarding_forms').insertOne(QUOTE_FORM);
    console.log(`[greenley] Quote form seeded: /forms/${QUOTE_FORM.slug} (phone + preferred contact required)`);
  } else { console.log('[greenley] Quote form exists — skipping'); }

  // 8. Owner/admin user -------------------------------------------------------
  if (await db.collection('users').countDocuments() === 0) {
    await db.collection('users').insertOne({
      email: OWNER_EMAIL, displayName: BRAND.name,
      isAdmin: true, isOwner: true, provider: 'provisioned', createdAt: now,
    });
    console.log(`[greenley] Owner/admin user created: ${OWNER_EMAIL}`);
  } else { console.log('[greenley] Users exist — skipping'); }

  // 9. Ensure remaining collections ------------------------------------------
  const have = (await db.listCollections().toArray()).map(c => c.name);
  for (const c of EMPTY_COLLECTIONS) {
    if (!have.includes(c)) await db.createCollection(c).catch(() => {});
  }
  console.log('[greenley] Collections ensured.');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log('GREENLEY COLORADO — PROVISIONED');
  console.log('='.repeat(64));
  console.log(`  Subdomain URL : https://${DOMAIN}`);
  console.log(`  Admin         : https://${DOMAIN}/admin`);
  console.log(`  Calculator    : https://${DOMAIN}/admin/calculators`);
  console.log(`  Booking page  : https://${DOMAIN}/book`);
  console.log(`  Quote form    : https://${DOMAIN}/forms/${QUOTE_FORM.slug}`);
  console.log(`  Custom domain : ${CUSTOM_DOMAIN} (you set DNS — see steps below)`);
  console.log('-'.repeat(64));
  console.log('CUSTOM DOMAIN — after you point DNS:');
  console.log(`  1. Add a DNS A record:  greenley.co  ->  <server IP>`);
  console.log(`     (and www.greenley.co -> same IP)`);
  console.log(`  2. Then wire Apache + SSL + tenant alias via setupCustomDomain('${DOMAIN}','${CUSTOM_DOMAIN}')`);
  console.log(`     or: certbot --apache -d ${CUSTOM_DOMAIN} -d www.${CUSTOM_DOMAIN}`);
  console.log('='.repeat(64));
  process.exit(0);
}

main().catch((err) => { console.error('[greenley] FATAL:', err); process.exit(1); });
