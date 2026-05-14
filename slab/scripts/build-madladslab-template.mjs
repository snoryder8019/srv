/**
 * Build a new Slab template from madladslab's current copy + design state,
 * then delete the old "MadLadsLab — Agency Flagship" template.
 *
 * One-shot maintenance script — run from /srv/slab via:
 *   node scripts/build-madladslab-template.mjs
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { DESIGN_DEFAULTS, THEME_KEYS } from '../routes/admin/design.js';

const OLD_TEMPLATE_ID = '69debe86e25b2a882092e52c';
const TENANT_DB = 'slab_madladslab';

const cli = new MongoClient(process.env.DB_URL);
await cli.connect();
const db = cli.db(TENANT_DB);

const copyRows = await db.collection('copy').find({}).toArray();
const designRows = await db.collection('design').find({}).toArray();
const copy = {};
for (const r of copyRows) copy[r.key] = r.value;
const design = { ...DESIGN_DEFAULTS };
for (const r of designRows) design[r.key] = r.value;

const designSnapshot = {};
for (const k of THEME_KEYS) designSnapshot[k] = design[k];

const blocks = [];
const rid = () => Math.random().toString(36).slice(2, 12);

// ── 1. Hero ──
blocks.push({
  id: rid(),
  type: 'hero',
  fields: {
    heading: [copy.hero_heading, copy.hero_heading_em].filter(Boolean).join(' '),
    subheading: copy.hero_sub || '',
    cta_text: copy.hero_cta_primary || 'Get Started',
    cta_link: copy.hero_cta_primary_link || '/#contact',
  },
  images: {},
});

// ── 2. Ticker (captures current global ticker as a placed block) ──
blocks.push({
  id: rid(),
  type: 'ticker',
  fields: {
    items: design.ticker_items || '',
    direction: design.ticker_direction || 'left',
    speed: design.ticker_speed || '22',
    bg: design.ticker_bg || '',
    text_color: design.ticker_text_color || '',
    sticky: 'false',
  },
  images: {},
});

// ── 3. Services as cards ──
const cardFields = {
  heading: [copy.services_heading, copy.services_heading_em].filter(Boolean).join(' ') || 'Our Solutions',
  subtext: copy.services_sub || '',
};
for (let n = 1; n <= 4; n++) {
  if (copy[`service${n}_title`]) cardFields[`card${n}_title`] = copy[`service${n}_title`];
  if (copy[`service${n}_desc`])  cardFields[`card${n}_body`]  = copy[`service${n}_desc`];
}
blocks.push({ id: rid(), type: 'cards', fields: cardFields, images: {} });

// ── 4. Process / How it works → faq-style or text ──
const processFields = {
  heading: [copy.process_heading, copy.process_heading_em].filter(Boolean).join(' — ') || 'Our Process',
  subtext: copy.process_label || '',
};
for (let n = 1; n <= 4; n++) {
  if (copy[`process${n}_title`]) processFields[`card${n}_title`] = copy[`process${n}_title`];
  if (copy[`process${n}_desc`])  processFields[`card${n}_body`]  = copy[`process${n}_desc`];
}
blocks.push({ id: rid(), type: 'cards', fields: processFields, images: {} });

// ── 5. About as text block (quote + desc) ──
if (copy.about_quote || copy.about_desc) {
  blocks.push({
    id: rid(),
    type: 'text',
    fields: {
      heading: copy.about_quote || 'About Us',
      subheading: copy.about_eyebrow || '',
      body: copy.about_desc || '',
    },
    images: {},
  });
}

// ── 6. Contact CTA ──
blocks.push({
  id: rid(),
  type: 'cta',
  fields: {
    heading: copy.contact_heading
      ? [copy.contact_heading, copy.contact_heading_em].filter(Boolean).join(' ')
      : "Let's Build Something",
    subtext: copy.contact_sub || [copy.contact_location, copy.contact_serving].filter(Boolean).join(' · '),
    btn_text: copy.contact_btn || 'Contact Us',
    btn_link: '/#contact',
  },
  images: {},
});

const toSlug = s => s.toLowerCase().trim()
  .replace(/['"]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const now = new Date();
const name = 'MadLadsLab — Live Snapshot';
const slug = toSlug(name) + '-' + Date.now().toString(36);
const newDoc = {
  name,
  slug,
  description: 'Captured from the live madLadsLab homepage — copy + ticker + design tokens at ' + now.toISOString(),
  category: 'landing',
  tags: ['snapshot', 'madladslab', 'agency'],
  blocks,
  designSnapshot,
  thumbnail: '',
  isPublic: false,
  source: 'snapshot',
  authorName: 'Scott',
  authorEmail: 'snoryder8019@gmail.com',
  createdAt: now,
  updatedAt: now,
};

const insertRes = await db.collection('templates').insertOne(newDoc);
console.log('[new template inserted]', insertRes.insertedId.toString(), '| blocks:', blocks.length);

// Delete the old template
const oldOid = new ObjectId(OLD_TEMPLATE_ID);
const oldDoc = await db.collection('templates').findOne({ _id: oldOid });
if (oldDoc) {
  const at = await db.collection('active_template').findOne({});
  if (at?.templateId?.toString() === OLD_TEMPLATE_ID) {
    await db.collection('active_template').deleteMany({});
    console.log('[old template was active — active_template cleared]');
  }
  await db.collection('templates').deleteOne({ _id: oldOid });
  console.log('[old template deleted]', OLD_TEMPLATE_ID, '|', oldDoc.name);
} else {
  console.log('[old template not found — nothing to delete]');
}

console.log('--- new template summary ---');
console.log('  id:    ', insertRes.insertedId.toString());
console.log('  name:  ', name);
console.log('  slug:  ', slug);
console.log('  blocks:', blocks.map(b => b.type).join(', '));

await cli.close();
