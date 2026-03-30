import express from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../plugins/mongo.js';
import { getReviews } from '../plugins/reviews.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { config } from '../config/config.js';

const router = express.Router();

// Load nav pages + superadmin flag for all public views
router.use(async (req, res, next) => {
  try {
    if (req.db) {
      const navPages = await req.db.collection('pages')
        .find({ status: 'published', showInNav: true }, { projection: { title: 1, slug: 1 } })
        .sort({ title: 1 })
        .toArray();
      res.locals.navPages = navPages;
    } else {
      res.locals.navPages = [];
    }
  } catch {
    res.locals.navPages = [];
  }
  // Check if current user is superadmin (from slab_token JWT email)
  try {
    const token = req.cookies?.slab_token;
    if (token) {
      const { isSuperAdminEmail } = await import('../middleware/superadmin.js');
      const decoded = jwt.verify(token, config.JWT_SECRET);
      res.locals.isSuperAdmin = isSuperAdminEmail(decoded.email);
    }
  } catch { /* expired or invalid — ignore */ }
  next();
});

const COPY_DEFAULTS = {
  hero_eyebrow: 'Welcome',
  hero_heading: 'Grow your brand',
  hero_heading_em: 'online.',
  hero_sub: 'Professional services tailored to your business needs.',
  hero_badge: '',
  hero_cta_primary: 'Start a Project',
  hero_cta_primary_link: '#contact',
  hero_cta_secondary: 'Our Services',
  hero_cta_secondary_link: '#services',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence.',
  service1_title: 'Service One',
  service1_desc: 'Description of your first service offering.',
  service2_title: 'Service Two',
  service2_desc: 'Description of your second service offering.',
  service3_title: 'Service Three',
  service3_desc: 'Description of your third service offering.',
  about_quote: '',
  about_desc: '',
  about_sig: '',
  about_eyebrow: 'About Us',
  about_initial: '',
  about_stat1_num: '50+',
  about_stat1_label: 'Clients Served',
  about_stat2_num: '3x',
  about_stat2_label: 'Avg. Engagement Lift',
  about_stat3_num: '5',
  about_stat3_label: 'Years Active',
  about_stat4_num: '100%',
  about_stat4_label: 'Local Focus',
  process_label: 'How It Works',
  process_heading: 'Simple',
  process_heading_em: 'Process',
  process1_title: 'Discovery',
  process1_desc: 'We learn your goals, audience, and vision.',
  process2_title: 'Strategy',
  process2_desc: 'We build a custom plan tailored to your needs.',
  process3_title: 'Create',
  process3_desc: 'We produce and review deliverables with you.',
  process4_title: 'Launch & Grow',
  process4_desc: 'We go live, track results, and optimize.',
  contact_sub: "Ready to get started? Tell us about your project and we'll be in touch.",
  contact_location: '',
  contact_serving: '',
  contact_services: '',
  contact_btn: 'Send Message',
  contact_fname_label: 'First Name',
  contact_fname_placeholder: 'Jane',
  contact_lname_label: 'Last Name',
  contact_lname_placeholder: 'Smith',
  contact_email_label: 'Email',
  contact_email_placeholder: 'jane@yourbusiness.com',
  contact_company_label: 'Business Name',
  contact_company_placeholder: 'Your Business LLC',
  contact_service_label: 'Service Interested In',
  contact_service_placeholder: 'Select a service...',
  contact_message_label: 'Tell Us About Your Needs',
  contact_message_placeholder: 'A quick idea of your needs — what are you trying to achieve?',
  contact_service_fallback: 'General Inquiry',
  contact_service_extra: 'Full Package',
};

async function getDesign(db) {
  const rawDesign = await db.collection('design').find({}).toArray();
  const design = { ...DESIGN_DEFAULTS };
  for (const item of rawDesign) design[item.key] = item.value;
  return enrichDesignContrast(design);
}

async function getBrandLogos(db) {
  const rows = await db.collection('brand_images').find({
    slot: { $in: ['logo_primary', 'logo_white', 'logo_icon'] }
  }).toArray();
  const logos = {};
  for (const r of rows) logos[r.slot] = r.url;
  return logos;
}

async function getBrandModels(db) {
  const rows = await db.collection('brand_models').find({}).toArray();
  const models = {};
  for (const r of rows) models[r.slot] = r.url;
  return models;
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

// Public asset share
router.get('/assets/share/:token', async (req, res) => {
  try {
    const db = req.db;
    const asset = await db.collection('assets').findOne({ shareToken: req.params.token });
    if (!asset) return res.status(404).send('Asset not found or link has been revoked.');
    res.redirect(asset.publicUrl);
  } catch (err) {
    res.status(500).send('Error loading asset.');
  }
});

// ── Client Onboarding (public) ─────────────────────────────────────────────
router.get('/onboard', async (req, res) => {
  try {
    const db = req.db;
    const design = await getDesign(db);
    res.render('onboard', { design, error: null, formData: {} });
  } catch {
    res.render('onboard', { design: {}, error: null, formData: {} });
  }
});

router.post('/onboard', async (req, res) => {
  const { name, email, company, phone, website, address,
          businessType, budget, timeline, socialPlatforms, goals,
          currentWebsite, brandNotes, notes } = req.body;

  if (!name || !email) {
    const db = req.db;
    const design = await getDesign(db);
    return res.render('onboard', { design, error: 'Name and email are required.', formData: req.body });
  }

  try {
    const db = req.db;
    const now = new Date();

    // Check if client email already exists — update instead of duplicate
    const existing = await db.collection('clients').findOne({ email: email.toLowerCase().trim() });

    const clientData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      company: company?.trim() || '',
      phone: phone?.trim() || '',
      website: website?.trim() || '',
      address: address?.trim() || '',
      status: 'prospect',
      notes: notes?.trim() || '',
      onboarding: {
        complete: false,
        step: 1,
        data: {
          businessType: businessType?.trim() || '',
          goals: goals?.trim() || '',
          budget: budget || '',
          timeline: timeline || '',
          socialPlatforms: socialPlatforms?.trim() || '',
          currentWebsite: currentWebsite?.trim() || '',
          brandNotes: brandNotes?.trim() || '',
        },
        updatedAt: now,
        source: 'public-form',
      },
      updatedAt: now,
    };

    let clientId;
    if (existing) {
      await db.collection('clients').updateOne({ _id: existing._id }, { $set: clientData });
      clientId = existing._id.toString();
    } else {
      clientData.createdAt = now;
      clientData.brandColors = [];
      const result = await db.collection('clients').insertOne(clientData);
      clientId = result.insertedId.toString();
    }

    const design = await getDesign(db);
    res.render('onboard-success', { design, clientName: name.trim(), clientId });
  } catch (err) {
    console.error('[onboard] error:', err);
    const db = req.db;
    const design = await getDesign(db);
    res.render('onboard', { design, error: 'Something went wrong. Please try again.', formData: req.body });
  }
});

router.get('/onboard/account-linked', async (req, res) => {
  try {
    const db = req.db;
    const design = await getDesign(db);
    res.render('onboard-linked', { design });
  } catch {
    res.render('onboard-linked', { design: {} });
  }
});

// Sitemap
router.get('/sitemap.xml', async (req, res) => {
  try {
    const db = req.db;
    const [pages, posts] = await Promise.all([
      db.collection('pages').find({ status: 'published' }).toArray(),
      db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1 }).toArray(),
    ]);
    const domain = (req.tenant?.domain ? `https://${req.tenant.domain}` : 'http://localhost').replace(/\/$/, '');
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

// ── Contact form submission ────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  try {
    const db = req.db;
    const { name, firstName, lastName, email, company, service, message } = req.body;
    const contactName = name || [firstName, lastName].filter(Boolean).join(' ') || '';

    if (!email) return res.redirect('/#contact');

    await db.collection('inquiries').insertOne({
      name: contactName.trim(),
      email: email.toLowerCase().trim(),
      company: company?.trim() || '',
      service: service?.trim() || '',
      message: message?.trim() || '',
      createdAt: new Date(),
    });

    res.redirect('/?contacted=1#contact');
  } catch (err) {
    console.error('[contact] error:', err);
    res.redirect('/#contact');
  }
});

// Home page
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [rawCopy, reviews, portfolio, design, rawMedia, customSections, logos, brandModels] = await Promise.all([
      db.collection('copy').find({}).toArray(),
      getReviews(db, req.tenant),
      db.collection('portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray(),
      getDesign(db),
      db.collection('section_media').find({}).toArray(),
      db.collection('custom_sections').find({ visible: { $ne: false } }).sort({ order: 1, createdAt: 1 }).toArray(),
      getBrandLogos(db),
      getBrandModels(db),
    ]);
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    const media = {};
    for (const item of rawMedia) media[item.key] = item.url;

    // Latest 3 blog posts for home page blog section
    const latestPosts = design.vis_blog === 'true'
      ? await db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1 }).limit(3).toArray()
      : [];

    // Startup layout → use the templatized landing page (same data scope as index)
    if (design.landing_layout === 'startup') {
      return res.render('landing', {
        design, copy, logos, brandModels, media,
        reviews, portfolio, customSections,
        latestPosts, visibility: buildVisibility(design),
        contacted: req.query.contacted,
      });
    }

    res.render('index', {
      copy, reviews, portfolio, design, media,
      visibility: buildVisibility(design),
      latestPosts, customSections, logos, brandModels,
    });
  } catch (err) {
    console.error(err);
    res.render('index', {
      copy: COPY_DEFAULTS, reviews: null, portfolio: [],
      design: DESIGN_DEFAULTS, media: {},
      visibility: buildVisibility(DESIGN_DEFAULTS),
      latestPosts: [], customSections: [], logos: {}, brandModels: {},
    });
  }
});

// Blog listing
router.get('/blog', async (req, res) => {
  try {
    const db = req.db;
    const [posts, design, rawCopy, logos, brandModels] = await Promise.all([
      db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1 }).toArray(),
      getDesign(db),
      db.collection('copy').find({}).toArray(),
      getBrandLogos(db),
      getBrandModels(db),
    ]);
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('blog/index', { posts, design, copy, logos, brandModels });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading blog');
  }
});

// Blog post
router.get('/blog/:slug', async (req, res) => {
  try {
    const db = req.db;
    const [post, design, rawCopy, logos, brandModels] = await Promise.all([
      db.collection('blog').findOne({ slug: req.params.slug, status: 'published' }),
      getDesign(db),
      db.collection('copy').find({}).toArray(),
      getBrandLogos(db),
      getBrandModels(db),
    ]);
    if (!post) return res.status(404).render('404', { message: 'Post not found', design });
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('blog/post', { post, design, copy, logos, brandModels });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading post');
  }
});

// Dynamic pages — must be last
router.get('/:slug', async (req, res, next) => {
  try {
    const db = req.db;
    const [pg, design, logos] = await Promise.all([
      db.collection('pages').findOne({ slug: req.params.slug, status: 'published' }),
      getDesign(db),
      getBrandLogos(db),
    ]);
    if (!pg) return next();

    // Data-list pages: fetch paginated collection
    if (pg.pageType === 'data-list') {
      const ALLOWED = ['blog', 'portfolio'];
      const col     = ALLOWED.includes(pg.dataCollection) ? pg.dataCollection : 'blog';
      const perPage = Math.min(Math.max(parseInt(pg.dataPageSize) || 9, 1), 100);
      const p       = Math.max(1, parseInt(req.query.p) || 1);
      const skip    = (p - 1) * perPage;
      const query   = { status: 'published' };
      const [total, items] = await Promise.all([
        db.collection(col).countDocuments(query),
        db.collection(col).find(query).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(perPage).toArray(),
      ]);
      const totalPages = Math.ceil(total / perPage);
      return res.render('page', { pg, design, logos, items, p, totalPages, perPage, col });
    }

    res.render('page', { pg, design, logos, items: null, p: 1, totalPages: 1, perPage: 9, col: null });
  } catch (err) {
    console.error(err);
    next();
  }
});

export default router;
