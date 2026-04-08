#!/usr/bin/env node
/**
 * seed-v1-templates.js
 * Generates v1.0 template documents from the 13 built-in landing layout variants.
 * Run: node scripts/seed-v1-templates.js [tenantDbName]
 * If no tenant specified, seeds all active tenants.
 */

import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';
import { BLOCK_DEFAULTS } from '../config/blocks.js';

const DB_URL = config.DB_URL || 'mongodb://127.0.0.1:27017';
const SLAB_DB = config.SLAB_DB || 'slab';

const LAYOUTS = [
  { key: 'classic',    name: 'Classic',    desc: 'Traditional business layout with balanced typography and clean sections.' },
  { key: 'bold',       name: 'Bold',       desc: 'High-impact design with strong contrast and large headings.' },
  { key: 'minimal',    name: 'Minimal',    desc: 'Clean, whitespace-focused layout that lets content breathe.' },
  { key: 'magazine',   name: 'Magazine',   desc: 'Editorial-inspired layout with rich typography and content blocks.' },
  { key: 'dark',       name: 'Dark',       desc: 'Dark-themed design with vibrant accent colors.' },
  { key: 'startup',    name: 'Startup',    desc: 'Modern SaaS-style landing page with gradient hero and feature cards.' },
  { key: 'showcase',   name: 'Showcase',   desc: 'Portfolio-forward layout highlighting visual work.' },
  { key: 'industrial', name: 'Industrial', desc: 'Service-industry layout with structured sections and grid patterns.' },
  { key: 'split',      name: 'Split',      desc: 'Two-column hero layout with side-by-side content and imagery.' },
  { key: 'editorial',  name: 'Editorial',  desc: 'Long-form content layout with emphasis on readability.' },
  { key: 'agency',     name: 'Agency',     desc: 'Creative agency layout with bold typography and case studies.' },
  { key: 'clean',      name: 'Clean',      desc: 'Ultra-minimal layout with soft colors and rounded elements.' },
  { key: 'brutalist',  name: 'Brutalist',  desc: 'Raw, high-contrast design with sharp edges and monospace type.' },
];

/** Build standard homepage blocks for each layout */
function buildBlocks(layoutKey) {
  return [
    {
      id: 'hero-' + layoutKey,
      type: 'hero',
      fields: {
        heading: BLOCK_DEFAULTS.hero.heading,
        subheading: BLOCK_DEFAULTS.hero.subheading,
        cta_text: BLOCK_DEFAULTS.hero.cta_text,
        cta_link: BLOCK_DEFAULTS.hero.cta_link,
      },
      images: {},
    },
    {
      id: 'cards-' + layoutKey,
      type: 'cards',
      fields: {
        heading: BLOCK_DEFAULTS.cards.heading,
        subtext: BLOCK_DEFAULTS.cards.subtext,
        card1_title: BLOCK_DEFAULTS.cards.card1_title,
        card1_body: BLOCK_DEFAULTS.cards.card1_body,
        card2_title: BLOCK_DEFAULTS.cards.card2_title,
        card2_body: BLOCK_DEFAULTS.cards.card2_body,
        card3_title: BLOCK_DEFAULTS.cards.card3_title,
        card3_body: BLOCK_DEFAULTS.cards.card3_body,
      },
      images: {},
    },
    {
      id: 'split-' + layoutKey,
      type: 'split',
      fields: {
        heading: BLOCK_DEFAULTS.split.heading,
        body: BLOCK_DEFAULTS.split.body,
        cta_text: BLOCK_DEFAULTS.split.cta_text,
        cta_link: BLOCK_DEFAULTS.split.cta_link,
      },
      images: {},
    },
    {
      id: 'testimonials-' + layoutKey,
      type: 'testimonials',
      fields: { ...BLOCK_DEFAULTS.testimonials },
      images: {},
    },
    {
      id: 'cta-' + layoutKey,
      type: 'cta',
      fields: {
        heading: BLOCK_DEFAULTS.cta.heading,
        subtext: BLOCK_DEFAULTS.cta.subtext,
        btn_text: BLOCK_DEFAULTS.cta.btn_text,
        btn_link: BLOCK_DEFAULTS.cta.btn_link,
      },
      images: {},
    },
  ];
}

/** Design snapshot per layout variant */
function getDesignSnapshot(layoutKey) {
  const base = {
    color_primary: '#1C2B4A',
    color_primary_deep: '#0F1B30',
    color_primary_mid: '#2E4270',
    color_accent: '#C9A848',
    color_accent_light: '#E8D08A',
    color_bg: '#F5F3EF',
    font_heading: 'Cormorant Garamond',
    font_body: 'Jost',
    landing_layout: layoutKey,
    card_border_radius: '2',
    section_animation: 'fade',
  };

  const overrides = {
    dark:       { color_primary: '#0A0A0A', color_primary_deep: '#000000', color_bg: '#121212', color_accent: '#FFD700', font_heading: 'Space Grotesk', font_body: 'Inter' },
    minimal:    { color_accent: '#333333', font_heading: 'Inter', font_body: 'Inter', card_border_radius: '8' },
    brutalist:  { color_primary: '#000000', color_accent: '#FF0000', font_heading: 'Bebas Neue', font_body: 'IBM Plex Sans', card_border_radius: '0' },
    startup:    { color_primary: '#1A1A2E', color_accent: '#6C63FF', font_heading: 'Sora', font_body: 'DM Sans', card_border_radius: '8' },
    agency:     { color_accent: '#FF6B35', font_heading: 'Playfair Display', font_body: 'Raleway' },
    magazine:   { font_heading: 'DM Serif Display', font_body: 'Source Sans 3' },
    editorial:  { font_heading: 'Lora', font_body: 'Source Sans 3' },
    clean:      { color_bg: '#FFFFFF', color_accent: '#4A90D9', font_heading: 'Outfit', font_body: 'Nunito', card_border_radius: '12' },
    industrial: { color_accent: '#E8A838', font_heading: 'Oswald', font_body: 'Barlow' },
  };

  return { ...base, ...(overrides[layoutKey] || {}) };
}

async function seedTenant(client, tenantDbName) {
  const db = client.db(tenantDbName);

  // Check if already seeded
  const existing = await db.collection('templates').findOne({ source: 'migration' });
  if (existing) {
    console.log(`  [skip] ${tenantDbName} — already seeded (${existing.name})`);
    return 0;
  }

  const now = new Date();
  const docs = LAYOUTS.map(layout => ({
    name: `${layout.name} Layout`,
    slug: `v1-${layout.key}`,
    description: layout.desc,
    category: 'landing',
    tags: [layout.key, 'built-in', 'v1'],
    blocks: buildBlocks(layout.key),
    designSnapshot: getDesignSnapshot(layout.key),
    thumbnail: '',
    isPublic: false,
    source: 'migration',
    sourceLayoutKey: layout.key,
    authorName: 'Slab Platform',
    authorEmail: '',
    createdAt: now,
    updatedAt: now,
  }));

  const result = await db.collection('templates').insertMany(docs);
  console.log(`  [done] ${tenantDbName} — seeded ${result.insertedCount} templates`);
  return result.insertedCount;
}

async function main() {
  const client = new MongoClient(DB_URL);
  await client.connect();
  console.log('Connected to MongoDB');

  const targetTenant = process.argv[2];

  if (targetTenant) {
    await seedTenant(client, targetTenant);
  } else {
    const slab = client.db(SLAB_DB);
    const tenants = await slab.collection('tenants').find({ status: { $in: ['active', 'preview'] } }).toArray();
    console.log(`Found ${tenants.length} tenants`);
    let total = 0;
    for (const t of tenants) {
      total += await seedTenant(client, t.db);
    }
    console.log(`\nTotal: ${total} templates seeded across ${tenants.length} tenants`);
  }

  await client.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
