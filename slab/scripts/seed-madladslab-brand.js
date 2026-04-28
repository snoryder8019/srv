/**
 * seed-madladslab-brand.js
 * Updates the madladslab tenant design doc + seeds a branded template.
 * Run from /srv/slab: node scripts/seed-madladslab-brand.js
 */

import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

const DB_URL = config.DB_URL;
const TENANT_DB = 'slab_madladslab';

const design = {
  // ── Brand Identity ──────────────────────────────────────────────
  color_primary:       '#0A0A0F',      // near-black with blue undertone
  color_primary_deep:  '#050508',
  color_primary_mid:   '#13131F',
  color_accent:        '#FFD700',      // gold
  color_accent_light:  '#FFE966',
  color_bg:            '#0D0D14',      // deep dark background
  color_text:          '#E8E8F0',
  color_text_muted:    '#8888AA',

  // ── Derived dark-theme tokens (used by page.ejs CSS vars) ───────
  _surface:           '#151520',      // card/surface bg (dark)
  _on_surface:        '#E8E8F0',      // text on surface
  _on_surface_muted:  '#8888AA',      // muted text on surface
  _border:            '#2A2A3A',      // subtle border for dark theme
  _border_focus:      '#FFD700',      // gold focus ring
  _on_bg:             '#E8E8F0',      // text on bg
  _on_bg_muted:       '#8888AA',      // muted text on bg
  _on_primary:        '#E8E8F0',      // text on primary
  _on_primary_deep:   '#E8E8F0',      // text on primary-deep
  _placeholder:       '#555570',      // input placeholder

  // ── Typography ──────────────────────────────────────────────────
  font_heading: 'Sora',               // modern, geometric, techy
  font_body:    'DM Sans',            // clean readable sans

  // ── Layout & Style ──────────────────────────────────────────────
  landing_layout:     'agency',
  card_border_radius: '4',
  section_animation:  'fade',

  updatedAt: new Date(),
};

const template = {
  name:        'MadLadsLab — Agency Flagship',
  slug:        'madladslab-flagship-v1',
  description: 'The official MadLadsLab brand template. Dark, gold-accented, agency-forward. Built for closing deals with Greeley local businesses.',
  category:    'landing',
  tags:        ['madladslab', 'agency', 'dark', 'flagship'],
  source:      'brand',
  authorName:  'MadLadsLab',
  authorEmail: 'scott@madladslab.com',
  isPublic:    false,

  designSnapshot: { ...design },

  blocks: [
    {
      id:   'hero-mll',
      type: 'hero',
      fields: {
        heading:    'Greeley\'s Tech Partner. Built Different.',
        subheading: 'We design, build, and launch web platforms for local businesses — with real infrastructure, real AI, and a team that shows up.',
        cta_text:   'Let\'s Talk',
        cta_link:   '#contact',
      },
      images: {},
    },
    {
      id:   'stats-mll',
      type: 'stats',
      fields: {
        heading:     'The Numbers Behind the Brand',
        stat1_num:   '10+',  stat1_label: 'Live Products in Production',
        stat2_num:   '3',    stat2_label: 'Local Businesses on Platform',
        stat3_num:   '100%', stat3_label: 'Greeley-Owned & Operated',
        stat4_num:   '24/7', stat4_label: 'Infrastructure Monitoring',
      },
      images: {},
    },
    {
      id:   'cards-mll',
      type: 'cards',
      fields: {
        heading: 'What We Build For You',
        subtext: 'Not templates. Not drag-and-drop. Real software, real results.',
        card1_title: 'Web Platforms',
        card1_body:  'Custom-built sites on our Slab platform — branded to you, launched fast, managed by us.',
        card2_title: 'AI Integration',
        card2_body:  'We wire AI directly into your business workflows — booking, content, customer response.',
        card3_title: 'Local SEO & Visibility',
        card3_body:  'Your storefront, your Google ranking, your reputation — we build the digital presence that drives foot traffic.',
        card4_title: 'Ongoing Partnership',
        card4_body:  'We don\'t disappear after launch. Monthly support, updates, and strategy — we grow with you.',
      },
      images: {},
    },
    {
      id:   'split-mll',
      type: 'split',
      fields: {
        heading:  'A Real Tech Studio in Downtown Greeley',
        body:     '<p>We\'re not a freelancer working from a coffee shop. MadLadsLab is a full-stack technology studio with live servers, production-grade infrastructure, and a glass-front presence in the heart of Greeley.</p><p>When you work with us, you\'re working with a team that has built and runs its own products — games platforms, SaaS tools, AI agents, and more. That experience works for your business.</p>',
        cta_text: 'See Our Work',
        cta_link: '#portfolio',
      },
      images: {},
    },
    {
      id:   'testimonials-mll',
      type: 'testimonials',
      fields: {
        heading: 'Local Businesses Trust MadLadsLab',
        subtext: 'From metal fabrication to mobile RV repair — we build for real industries.',
        t1_quote: 'They built exactly what we needed and kept it simple for our team to manage. Night and day from what we had before.',
        t1_name:  'Noco Metal Workz',
        t1_role:  'Metal Fabrication, Greeley CO',
        t2_quote: 'Our booking inquiries doubled after the new site launched. It actually represents what we do.',
        t2_name:  'Mobile Meadows',
        t2_role:  'RV & Motorhome Repair, Branson MO',
        t3_quote: 'We wanted something that looked professional without feeling corporate. MadLadsLab nailed it.',
        t3_name:  'ACM Creative Concepts',
        t3_role:  'Creative Services',
      },
      images: {},
    },
    {
      id:   'pricing-mll',
      type: 'pricing',
      fields: {
        heading: 'Straight-Forward Pricing',
        subtext: 'No hidden fees. No mystery invoices. Pick what fits and we build from there.',
        tier1_name:     'Presence',
        tier1_price:    '$149/mo',
        tier1_features: 'Branded website on Slab platform\nMobile-optimized\nContact form + Google Maps\nMonthly content updates\nHosting & monitoring included',
        tier1_cta:      'Get Started',
        tier2_name:     'Growth',
        tier2_price:    '$349/mo',
        tier2_features: 'Everything in Presence\nSEO optimization\nBlog & content engine\nBooking or inquiry system\nMonthly strategy call\nAI-powered chat widget',
        tier2_cta:      'Most Popular',
        tier3_name:     'Partner',
        tier3_price:    'Custom',
        tier3_features: 'Everything in Growth\nCustom software features\nAI workflow integration\nDedicated support channel\nQuarterly in-person review\nPriority on new products',
        tier3_cta:      'Let\'s Talk',
      },
      images: {},
    },
    {
      id:   'faq-mll',
      type: 'faq',
      fields: {
        heading: 'Common Questions',
        q1: 'Do I own my website?',
        a1: 'Yes. Your content, your brand, your data. We build and host on our platform but you retain full ownership of everything.',
        q2: 'How long does it take to launch?',
        a2: 'Most sites go live within 5–10 business days from kickoff. We move fast without cutting corners.',
        q3: 'What if I already have a website?',
        a3: 'We\'ll audit what you have, migrate any useful content, and upgrade the whole experience.',
        q4: 'Do you work with businesses outside Greeley?',
        a4: 'Yes — we\'re Greeley-based but serve businesses across Colorado and beyond. Remote collaboration is no problem.',
        q5: 'What makes you different from a typical web agency?',
        a5: 'We run our own production software every day. We\'re not reselling templates or outsourcing. When something breaks, we fix it — because it\'s our infrastructure too.',
      },
      images: {},
    },
    {
      id:   'cta-mll',
      type: 'cta',
      fields: {
        heading:  'Ready to Build Something Real?',
        subtext:  'Come visit us downtown or drop us a message. We\'ll show you exactly what we can do for your business — no pressure, no jargon.',
        btn_text: 'Start the Conversation',
        btn_link: 'mailto:scott@madladslab.com',
      },
      images: {},
    },
  ],

  createdAt: new Date(),
  updatedAt: new Date(),
};

async function main() {
  const client = new MongoClient(DB_URL);
  await client.connect();
  console.log('[seed] Connected to MongoDB');

  const db = client.db(TENANT_DB);

  // ── 1. Upsert design doc ──────────────────────────────────────────
  const designResult = await db.collection('design').updateOne(
    {},
    { $set: design },
    { upsert: true }
  );
  console.log(`[seed] Design — ${designResult.upsertedCount ? 'inserted' : 'updated'}`);

  // ── 2. Upsert template ───────────────────────────────────────────
  const tmplResult = await db.collection('templates').updateOne(
    { slug: template.slug },
    { $set: template },
    { upsert: true }
  );
  console.log(`[seed] Template "${template.name}" — ${tmplResult.upsertedCount ? 'inserted' : 'updated'}`);

  await client.close();
  console.log('[seed] Done. Restart slab if it caches design at boot.');
}

main().catch(err => { console.error('[seed] Error:', err); process.exit(1); });
