/**
 * seed-template-images.js
 *
 * Seeds the `design_examples` collection in each tenant database
 * with curated Unsplash placeholder images for landing page layouts.
 *
 * Usage:  node scripts/seed-template-images.js
 */

import { MongoClient } from 'mongodb';

const MONGO_URI =
  'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net';

const TENANT_DBS = ['slab_slab', 'slab_madladslab', 'slab_w2marketing'];

const u = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?w=${w}&q=80`;

// ── Image catalog ────────────────────────────────────────────────────────────

const IMAGES = [
  // ── HERO (10) ──────────────────────────────────────────────────────────────
  { category: 'hero', title: 'Modern Office Space',           url: u('photo-1497366216548-37526070297c'),  alt: 'Open-plan modern office with natural light',        aspectRatio: '16:9', tags: ['business', 'workspace', 'office'],           layout: ['classic', 'bold', 'startup'] },
  { category: 'hero', title: 'Tech Abstract',                 url: u('photo-1504384308090-c894fdcc538d'),  alt: 'Abstract technology network visualization',         aspectRatio: '16:9', tags: ['tech', 'abstract', 'digital'],                layout: ['dark', 'startup', 'bold'] },
  { category: 'hero', title: 'Developer Workspace',           url: u('photo-1519389950473-47ba0277781c'),  alt: 'Clean developer desk with dual monitors',           aspectRatio: '16:9', tags: ['tech', 'workspace', 'development'],           layout: ['minimal', 'startup', 'classic'] },
  { category: 'hero', title: 'City Skyline Sunset',           url: u('photo-1460925895917-afdab827c52f'),  alt: 'Dramatic city skyline at golden hour',              aspectRatio: '16:9', tags: ['cityscape', 'sunset', 'urban'],               layout: ['bold', 'magazine', 'dark'] },
  { category: 'hero', title: 'Glass Tower Architecture',      url: u('photo-1486406146926-c627a92ad1ab'),  alt: 'Modern glass skyscraper looking upward',            aspectRatio: '16:9', tags: ['architecture', 'business', 'modern'],         layout: ['classic', 'bold', 'magazine'] },
  { category: 'hero', title: 'Minimalist Workspace',          url: u('photo-1497215728101-856f4ea42174'),  alt: 'Clean white desk with laptop and plant',            aspectRatio: '16:9', tags: ['workspace', 'minimal', 'clean'],              layout: ['minimal', 'classic', 'startup'] },
  { category: 'hero', title: 'Server Room',                   url: u('photo-1531297484001-80022131f5a1'),  alt: 'Data center server racks with blue lighting',       aspectRatio: '16:9', tags: ['tech', 'data', 'infrastructure'],             layout: ['dark', 'startup', 'bold'] },
  { category: 'hero', title: 'Workshop Collaboration',        url: u('photo-1517245386807-bb43f82c33c4'),  alt: 'Team working together at a whiteboard session',     aspectRatio: '16:9', tags: ['team', 'collaboration', 'workshop'],          layout: ['classic', 'magazine', 'startup'] },
  { category: 'hero', title: 'Startup Office',                url: u('photo-1551434678-e076c223a692'),  alt: 'Casual startup environment with open seating',      aspectRatio: '16:9', tags: ['startup', 'office', 'casual'],                layout: ['startup', 'bold', 'minimal'] },
  { category: 'hero', title: 'Creative Team Meeting',         url: u('photo-1522071820081-009f0129c71c'),  alt: 'Diverse team around a conference table',            aspectRatio: '16:9', tags: ['team', 'meeting', 'creative'],                layout: ['classic', 'magazine', 'bold'] },

  // ── PORTFOLIO (15) ─────────────────────────────────────────────────────────
  { category: 'portfolio', title: 'Brand Identity Design',    url: u('photo-1561070791-2526d30994b5'),   alt: 'Colorful brand identity mockup spread',             aspectRatio: '4:3', tags: ['branding', 'design', 'identity'],             layout: ['classic', 'magazine', 'bold'] },
  { category: 'portfolio', title: 'UI Dashboard Mockup',      url: u('photo-1558655146-9f40138edfeb'),   alt: 'Dark analytics dashboard interface',                aspectRatio: '4:3', tags: ['ui', 'dashboard', 'web'],                     layout: ['dark', 'startup', 'minimal'] },
  { category: 'portfolio', title: 'Portrait Photography',     url: u('photo-1507003211169-0a1dd7228f2d'),alt: 'Professional studio portrait',                      aspectRatio: '3:4', tags: ['portrait', 'photography', 'people'],           layout: ['magazine', 'classic', 'bold'] },
  { category: 'portfolio', title: 'Urban Skyline',            url: u('photo-1460925895917-afdab827c52f'),alt: 'Dramatic city skyline panoramic',                    aspectRatio: '16:9', tags: ['cityscape', 'urban', 'architecture'],         layout: ['bold', 'magazine', 'dark'] },
  { category: 'portfolio', title: 'Product Flat Lay',         url: u('photo-1586717791821-3f44a563fa4c'),alt: 'Styled product flat lay arrangement',                aspectRatio: '1:1',  tags: ['product', 'ecommerce', 'lifestyle'],          layout: ['minimal', 'magazine', 'classic'] },
  { category: 'portfolio', title: 'Interior Design',          url: u('photo-1600585154340-be6161a56a0c'),alt: 'Modern living room interior design',                 aspectRatio: '4:3',  tags: ['interior', 'design', 'architecture'],         layout: ['magazine', 'classic', 'minimal'] },
  { category: 'portfolio', title: 'Data Visualization',       url: u('photo-1555396273-367ea4eb4db5'),  alt: 'Colorful data charts on screen',                    aspectRatio: '16:9', tags: ['data', 'analytics', 'tech'],                  layout: ['startup', 'dark', 'bold'] },
  { category: 'portfolio', title: 'Food Photography',         url: u('photo-1504674900247-0877df9cc836'),alt: 'Beautifully plated gourmet dish',                    aspectRatio: '4:3',  tags: ['food', 'photography', 'restaurant'],          layout: ['magazine', 'classic', 'minimal'] },
  { category: 'portfolio', title: 'Code on Screen',           url: u('photo-1498050108023-c5249f4df085'),alt: 'Clean code editor on laptop screen',                 aspectRatio: '16:9', tags: ['code', 'development', 'tech'],                layout: ['dark', 'startup', 'minimal'] },
  { category: 'portfolio', title: 'Developer at Work',        url: u('photo-1517694712202-14dd9538aa97'),alt: 'Developer typing on laptop keyboard',                aspectRatio: '16:9', tags: ['developer', 'coding', 'workspace'],           layout: ['startup', 'minimal', 'dark'] },
  { category: 'portfolio', title: 'Mobile App Design',        url: u('photo-1542744094-24638eff58bb'),  alt: 'Mobile app screens on phone mockup',                aspectRatio: '4:3',  tags: ['mobile', 'app', 'ui'],                       layout: ['startup', 'minimal', 'bold'] },
  { category: 'portfolio', title: 'Abstract Colors',          url: u('photo-1493612276216-ee3925520721'),alt: 'Vibrant abstract color gradient',                    aspectRatio: '16:9', tags: ['abstract', 'color', 'art'],                   layout: ['bold', 'dark', 'magazine'] },
  { category: 'portfolio', title: 'Print Design',             url: u('photo-1467232004584-a241de8bcf5d'),alt: 'Printed materials and stationery mockup',            aspectRatio: '4:3',  tags: ['print', 'design', 'branding'],               layout: ['classic', 'magazine', 'minimal'] },
  { category: 'portfolio', title: 'Architecture Detail',      url: u('photo-1559028012-481c04fa702d'),  alt: 'Modern building geometric detail',                   aspectRatio: '3:4',  tags: ['architecture', 'detail', 'modern'],           layout: ['minimal', 'bold', 'dark'] },
  { category: 'portfolio', title: 'Electronics Prototype',    url: u('photo-1581291518633-83b4eef1d2fa'),alt: 'Circuit board and electronic components',            aspectRatio: '4:3',  tags: ['electronics', 'hardware', 'tech'],            layout: ['startup', 'dark', 'bold'] },

  // ── ABOUT (8) ──────────────────────────────────────────────────────────────
  { category: 'about', title: 'Team Brainstorm',              url: u('photo-1522071820081-009f0129c71c'),alt: 'Team gathered around conference table',               aspectRatio: '16:9', tags: ['team', 'meeting', 'collaboration'],            layout: ['classic', 'bold', 'magazine'] },
  { category: 'about', title: 'Office Collaboration',         url: u('photo-1600880292203-757bb62b4baf'),alt: 'Two colleagues reviewing work on screen',            aspectRatio: '16:9', tags: ['collaboration', 'office', 'people'],           layout: ['classic', 'startup', 'minimal'] },
  { category: 'about', title: 'Fist Bump Teamwork',           url: u('photo-1556761175-5973142134ac'),  alt: 'Team fist bump celebrating success',                 aspectRatio: '16:9', tags: ['team', 'celebration', 'culture'],              layout: ['bold', 'startup', 'magazine'] },
  { category: 'about', title: 'Business Handshake',           url: u('photo-1542744173-8e7e53415bb0'),  alt: 'Professional handshake in office setting',           aspectRatio: '16:9', tags: ['business', 'professional', 'trust'],           layout: ['classic', 'bold', 'minimal'] },
  { category: 'about', title: 'Remote Worker',                url: u('photo-1560250097-0b93528c311a'),  alt: 'Professional working from home office',              aspectRatio: '4:3',  tags: ['remote', 'workspace', 'individual'],           layout: ['minimal', 'startup', 'classic'] },
  { category: 'about', title: 'Woman Professional',           url: u('photo-1573497019940-1c28c88b4f3e'),alt: 'Confident professional woman portrait',              aspectRatio: '3:4',  tags: ['portrait', 'professional', 'individual'],     layout: ['magazine', 'classic', 'minimal'] },
  { category: 'about', title: 'Workshop Session',             url: u('photo-1552664730-d307ca884978'),  alt: 'Interactive workshop with sticky notes',             aspectRatio: '16:9', tags: ['workshop', 'planning', 'team'],               layout: ['startup', 'bold', 'magazine'] },
  { category: 'about', title: 'Whiteboard Strategy',          url: u('photo-1517245386807-bb43f82c33c4'),alt: 'Team strategy session at whiteboard',                aspectRatio: '16:9', tags: ['strategy', 'planning', 'team'],               layout: ['classic', 'startup', 'bold'] },

  // ── SERVICE (12) ───────────────────────────────────────────────────────────
  { category: 'service', title: 'Marketing Strategy',         url: u('photo-1460925895917-afdab827c52f'),  alt: 'Strategic marketing planning',                    aspectRatio: '16:9', tags: ['marketing', 'strategy', 'planning'],           layout: ['classic', 'bold', 'magazine'] },
  { category: 'service', title: 'Web Design Process',         url: u('photo-1558655146-9f40138edfeb'),    alt: 'Web design wireframe and UI work',                aspectRatio: '4:3',  tags: ['design', 'web', 'ui'],                        layout: ['startup', 'minimal', 'dark'] },
  { category: 'service', title: 'Software Development',       url: u('photo-1498050108023-c5249f4df085'),  alt: 'Clean code on development screen',                aspectRatio: '16:9', tags: ['development', 'code', 'tech'],                 layout: ['dark', 'startup', 'bold'] },
  { category: 'service', title: 'Business Consulting',        url: u('photo-1542744173-8e7e53415bb0'),    alt: 'Professional consulting session',                 aspectRatio: '16:9', tags: ['consulting', 'business', 'meeting'],            layout: ['classic', 'bold', 'minimal'] },
  { category: 'service', title: 'Brand Design',               url: u('photo-1561070791-2526d30994b5'),    alt: 'Brand identity design materials',                 aspectRatio: '4:3',  tags: ['branding', 'design', 'creative'],              layout: ['magazine', 'classic', 'bold'] },
  { category: 'service', title: 'Data Analytics',             url: u('photo-1555396273-367ea4eb4db5'),    alt: 'Data analytics dashboard and charts',             aspectRatio: '16:9', tags: ['analytics', 'data', 'business'],               layout: ['startup', 'dark', 'bold'] },
  { category: 'service', title: 'Cloud Infrastructure',       url: u('photo-1531297484001-80022131f5a1'),  alt: 'Server room cloud infrastructure',                aspectRatio: '16:9', tags: ['cloud', 'infrastructure', 'tech'],              layout: ['dark', 'startup', 'bold'] },
  { category: 'service', title: 'Content Creation',           url: u('photo-1504674900247-0877df9cc836'),  alt: 'Creative content photography setup',              aspectRatio: '4:3',  tags: ['content', 'photography', 'creative'],          layout: ['magazine', 'classic', 'minimal'] },
  { category: 'service', title: 'Mobile Development',         url: u('photo-1542744094-24638eff58bb'),    alt: 'Mobile app development screens',                  aspectRatio: '4:3',  tags: ['mobile', 'development', 'app'],                layout: ['startup', 'minimal', 'bold'] },
  { category: 'service', title: 'Team Training',              url: u('photo-1517245386807-bb43f82c33c4'),  alt: 'Professional team training session',              aspectRatio: '16:9', tags: ['training', 'education', 'team'],               layout: ['classic', 'startup', 'magazine'] },
  { category: 'service', title: 'Architecture Design',        url: u('photo-1486406146926-c627a92ad1ab'),  alt: 'Modern architectural design service',             aspectRatio: '16:9', tags: ['architecture', 'design', 'modern'],             layout: ['bold', 'minimal', 'magazine'] },
  { category: 'service', title: 'Product Photography',        url: u('photo-1586717791821-3f44a563fa4c'),  alt: 'Professional product photography',                aspectRatio: '1:1',  tags: ['photography', 'product', 'ecommerce'],         layout: ['magazine', 'minimal', 'classic'] },

  // ── BACKGROUND (8) ─────────────────────────────────────────────────────────
  { category: 'background', title: 'Purple Gradient',         url: u('photo-1557683316-973673baf926', 1920), alt: 'Smooth purple gradient background',             aspectRatio: '16:9', tags: ['gradient', 'purple', 'abstract'],              layout: ['dark', 'bold', 'startup'] },
  { category: 'background', title: 'Neon Lines',              url: u('photo-1558618666-fcd25c85f82e', 1920), alt: 'Neon colored light lines',                      aspectRatio: '16:9', tags: ['neon', 'lines', 'abstract'],                   layout: ['dark', 'bold', 'startup'] },
  { category: 'background', title: 'Blue Gradient',           url: u('photo-1557682250-33bd709cbe85', 1920), alt: 'Deep blue gradient texture',                    aspectRatio: '16:9', tags: ['gradient', 'blue', 'abstract'],                layout: ['dark', 'bold', 'classic'] },
  { category: 'background', title: 'Pink Purple Blend',       url: u('photo-1557682224-5b8590cd9ec5', 1920), alt: 'Pink to purple color blend',                    aspectRatio: '16:9', tags: ['gradient', 'pink', 'purple'],                  layout: ['bold', 'dark', 'magazine'] },
  { category: 'background', title: 'Warm Gradient',           url: u('photo-1557682260-96773eb01377', 1920), alt: 'Warm orange to red gradient',                   aspectRatio: '16:9', tags: ['gradient', 'warm', 'orange'],                  layout: ['bold', 'magazine', 'startup'] },
  { category: 'background', title: 'Cool Gradient',           url: u('photo-1557682268-e3955ed5d83f', 1920), alt: 'Cool teal to blue gradient',                    aspectRatio: '16:9', tags: ['gradient', 'cool', 'teal'],                   layout: ['dark', 'minimal', 'startup'] },
  { category: 'background', title: 'Starry Night Sky',        url: u('photo-1519681393784-d120267933ba', 1920), alt: 'Starry mountain night sky',                  aspectRatio: '16:9', tags: ['night', 'stars', 'nature'],                    layout: ['dark', 'bold', 'magazine'] },
  { category: 'background', title: 'Misty Mountains',         url: u('photo-1506905925346-21bda4d32df4', 1920), alt: 'Misty mountain layers at dawn',              aspectRatio: '16:9', tags: ['nature', 'mountains', 'serene'],               layout: ['minimal', 'classic', 'magazine'] },

  // ── TESTIMONIAL (6) ────────────────────────────────────────────────────────
  { category: 'testimonial', title: 'Professional Man',       url: u('photo-1507003211169-0a1dd7228f2d', 400), alt: 'Professional male headshot',                  aspectRatio: '1:1', tags: ['headshot', 'male', 'professional'],              layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
  { category: 'testimonial', title: 'Professional Woman',     url: u('photo-1573497019940-1c28c88b4f3e', 400), alt: 'Professional female headshot',                aspectRatio: '1:1', tags: ['headshot', 'female', 'professional'],            layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
  { category: 'testimonial', title: 'Business Executive',     url: u('photo-1560250097-0b93528c311a', 400), alt: 'Business executive portrait',                    aspectRatio: '1:1', tags: ['headshot', 'executive', 'business'],             layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
  { category: 'testimonial', title: 'Creative Director',      url: u('photo-1542744173-8e7e53415bb0', 400), alt: 'Creative professional headshot',                 aspectRatio: '1:1', tags: ['headshot', 'creative', 'professional'],          layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
  { category: 'testimonial', title: 'Tech Lead',              url: u('photo-1556761175-5973142134ac', 400), alt: 'Tech team leader portrait',                      aspectRatio: '1:1', tags: ['headshot', 'tech', 'team'],                     layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
  { category: 'testimonial', title: 'Marketing Manager',      url: u('photo-1600880292203-757bb62b4baf', 400), alt: 'Marketing professional headshot',             aspectRatio: '1:1', tags: ['headshot', 'marketing', 'professional'],         layout: ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup'] },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('[seed] Connected to MongoDB Atlas');

    for (const dbName of TENANT_DBS) {
      try {
        const db = client.db(dbName);
        const col = db.collection('design_examples');

        // Check if collection already exists — if not, Atlas free tier may
        // block creation when at the 500-collection limit.
        const collections = await db.listCollections({ name: 'design_examples' }).toArray();
        if (collections.length === 0) {
          // Try to create it explicitly so we get a clear error
          try {
            await db.createCollection('design_examples');
          } catch (createErr) {
            if (createErr.code === 8000 || /already using/.test(createErr.message)) {
              console.warn(`[seed] ${dbName}: SKIPPED — collection limit reached on Atlas. Drop an unused collection first.`);
              continue;
            }
            throw createErr;
          }
        }

        // Drop existing examples so we get a clean seed
        await col.deleteMany({});

        const docs = IMAGES.map((img) => ({
          ...img,
          seededAt: new Date(),
        }));

        const result = await col.insertMany(docs);
        console.log(`[seed] ${dbName}: inserted ${result.insertedCount} design examples`);

        // Create useful indexes
        await col.createIndex({ category: 1 });
        await col.createIndex({ layout: 1 });
        await col.createIndex({ tags: 1 });
      } catch (dbErr) {
        console.error(`[seed] ${dbName}: ERROR — ${dbErr.message}`);
      }
    }

    console.log('[seed] Done.');
  } catch (err) {
    console.error('[seed] Error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
