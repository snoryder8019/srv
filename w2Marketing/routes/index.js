import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { getReviews } from '../plugins/reviews.js';
import { DESIGN_DEFAULTS } from './admin/design.js';

const router = express.Router();

const COPY_DEFAULTS = {
  hero_eyebrow: 'Greeley, Colorado — Digital Marketing Agency',
  hero_heading: 'Grow your brand',
  hero_heading_em: 'online.',
  hero_sub: "Social media management, website design, and content creation — built for local businesses ready to stand out in Greeley and beyond.",
  hero_badge: 'Greeley, CO · Local Business First',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence — from pixels to posts.',
  service1_title: 'Social Media Management',
  service1_desc: 'Strategy, scheduling, and engagement across all major platforms. We handle the day-to-day so you can focus on running your business.',
  service2_title: 'Website Design & Development',
  service2_desc: 'Custom, responsive websites that convert visitors into customers. Built for speed, SEO, and your brand identity.',
  service3_title: 'Content & Branding',
  service3_desc: "Photography, graphics, copy, and full brand identity systems — everything you need to tell your story with confidence.",
  about_quote: '"No fluff — just digital marketing that actually works for local businesses."',
  about_desc: "We're a Greeley-based marketing team that partners with local businesses to make digital marketing simple, effective, and actually enjoyable.",
  about_sig: 'W2 Marketing',
  process_label: 'How It Works',
  process_heading: 'Simple',
  process_heading_em: 'Process',
  contact_sub: "Ready to grow your brand? Tell us a bit about your business and we'll be in touch within one business day.",
  contact_location: 'Greeley, Colorado',
  contact_serving: 'Northern Colorado & surrounding areas',
};

async function getDesign(db) {
  const rawDesign = await db.collection('w2_design').find({}).toArray();
  const design = { ...DESIGN_DEFAULTS };
  for (const item of rawDesign) design[item.key] = item.value;
  return design;
}

function buildVisibility(design) {
  return {
    hero:      design.vis_hero      !== 'false',
    services:  design.vis_services  !== 'false',
    portfolio: design.vis_portfolio !== 'false',
    about:     design.vis_about     !== 'false',
    process:   design.vis_process   !== 'false',
    reviews:   design.vis_reviews   !== 'false',
    contact:   design.vis_contact   !== 'false',
    blog:      design.vis_blog      === 'true',
  };
}

// Sitemap
router.get('/sitemap.xml', async (_req, res) => {
  try {
    const db = getDb();
    const [pages, posts] = await Promise.all([
      db.collection('w2_pages').find({ status: 'published' }).toArray(),
      db.collection('w2_blog').find({ status: 'published' }).sort({ publishedAt: -1 }).toArray(),
    ]);
    const domain = (process.env.DOMAIN || 'https://w2marketing.biz').replace(/\/$/, '');
    const fmt = d => d ? new Date(d).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url><loc>${domain}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;
    xml += `  <url><loc>${domain}/blog</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
    for (const pg of pages) {
      xml += `  <url><loc>${domain}/${pg.slug}</loc><lastmod>${fmt(pg.updatedAt)}</lastmod><changefreq>${pg.sitemapChangefreq || 'monthly'}</changefreq><priority>${pg.sitemapPriority ?? 0.5}</priority></url>\n`;
    }
    for (const post of posts) {
      xml += `  <url><loc>${domain}/blog/${post.slug}</loc><lastmod>${fmt(post.updatedAt || post.publishedAt)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
    }
    xml += `</urlset>`;
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('[sitemap]', err);
    res.status(500).send('Sitemap unavailable.');
  }
});

// Home page
router.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const [rawCopy, reviews, portfolio, design, rawMedia, customSections] = await Promise.all([
      db.collection('w2_copy').find({}).toArray(),
      getReviews(),
      db.collection('w2_portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray(),
      getDesign(db),
      db.collection('w2_section_media').find({}).toArray(),
      db.collection('w2_custom_sections').find({ visible: { $ne: false } }).sort({ order: 1, createdAt: 1 }).toArray(),
    ]);
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    const media = {};
    for (const item of rawMedia) media[item.key] = item.url;

    // Latest 3 blog posts for home page blog section
    const latestPosts = design.vis_blog === 'true'
      ? await db.collection('w2_blog').find({ status: 'published' }).sort({ publishedAt: -1 }).limit(3).toArray()
      : [];

    res.render('index', {
      copy, reviews, portfolio, design, media,
      visibility: buildVisibility(design),
      latestPosts, customSections,
    });
  } catch (err) {
    console.error(err);
    res.render('index', {
      copy: COPY_DEFAULTS, reviews: null, portfolio: [],
      design: DESIGN_DEFAULTS, media: {},
      visibility: buildVisibility(DESIGN_DEFAULTS),
      latestPosts: [], customSections: [],
    });
  }
});

// Blog listing
router.get('/blog', async (_req, res) => {
  try {
    const db = getDb();
    const [posts, design, rawCopy] = await Promise.all([
      db.collection('w2_blog').find({ status: 'published' }).sort({ publishedAt: -1 }).toArray(),
      getDesign(db),
      db.collection('w2_copy').find({}).toArray(),
    ]);
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('blog/index', { posts, design, copy });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading blog');
  }
});

// Blog post
router.get('/blog/:slug', async (req, res) => {
  try {
    const db = getDb();
    const [post, design, rawCopy] = await Promise.all([
      db.collection('w2_blog').findOne({ slug: req.params.slug, status: 'published' }),
      getDesign(db),
      db.collection('w2_copy').find({}).toArray(),
    ]);
    if (!post) return res.status(404).render('404', { message: 'Post not found', design });
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('blog/post', { post, design, copy });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading post');
  }
});

// Dynamic pages — must be last
router.get('/:slug', async (req, res, next) => {
  try {
    const db = getDb();
    const [pg, design] = await Promise.all([
      db.collection('w2_pages').findOne({ slug: req.params.slug, status: 'published' }),
      getDesign(db),
    ]);
    if (!pg) return next();

    // Data-list pages: fetch paginated collection
    if (pg.pageType === 'data-list') {
      const ALLOWED = ['w2_blog', 'w2_portfolio'];
      const col     = ALLOWED.includes(pg.dataCollection) ? pg.dataCollection : 'w2_blog';
      const perPage = Math.min(Math.max(parseInt(pg.dataPageSize) || 9, 1), 100);
      const p       = Math.max(1, parseInt(req.query.p) || 1);
      const skip    = (p - 1) * perPage;
      const query   = { status: 'published' };
      const [total, items] = await Promise.all([
        db.collection(col).countDocuments(query),
        db.collection(col).find(query).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(perPage).toArray(),
      ]);
      const totalPages = Math.ceil(total / perPage);
      return res.render('page', { pg, design, items, p, totalPages, perPage, col });
    }

    res.render('page', { pg, design, items: null, p: 1, totalPages: 1, perPage: 9, col: null });
  } catch (err) {
    console.error(err);
    next();
  }
});

export default router;
