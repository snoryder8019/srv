import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../plugins/mongo.js';
import { localizeCopyMap } from '../plugins/copyLocale.js';
import { getReviews } from '../plugins/reviews.js';
import { shareTargetPath, shareUrlFor, mintShareToken } from '../plugins/shareLink.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { CARD_TEMPLATES, CARD_SCHEMES, resolveScheme, normalizeCard } from '../plugins/cardConfig.js';
import { SERVICES, INFRA_SERVICES } from '../plugins/serviceRegistry.js';
import { recordClientError } from '../plugins/observe.js';

// Static projection of the platform stack for the "Server Harmony" orbit shown in
// the homepage About section. Built once at import — no live status/fs/tmux probing
// on a public page; this is a non-interactive showcase, not the superadmin monitor.
const HARMONY_SERVICES = [
  ...SERVICES
    .filter(s => s.category !== 'deprecated')
    .map(s => ({ name: s.name, category: s.category, description: s.description || '', domain: s.domain || null })),
  ...INFRA_SERVICES
    .map(s => ({ name: s.name, category: 'infra', description: s.description || '', domain: s.domain || null })),
];

// The Server Harmony orbit is a madladslab-only showcase — never expose the platform
// stack on other tenants' sites. Returns [] for everyone else (view hides it on empty).
function harmonyFor(req) {
  const t = req.tenant || {};
  const isMadladslab = t.db === 'slab_madladslab' || t.meta?.subdomain === 'madladslab';
  return isMadladslab ? HARMONY_SERVICES : [];
}
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { config } from '../config/config.js';
import { notifyAdmin } from '../plugins/notify.js';
import { chatBroadcast, adminAlert } from '../plugins/chatSocket.js';
import { normalizeEmail } from '../plugins/emailNormalize.js';
import { checkGlobalSpam } from '../plugins/globalSpam.js';
import { passedCaptcha } from '../plugins/captcha.js';
import { captureLead } from '../plugins/subscribe.js';
import { getPublicSocialLinks } from '../plugins/socialPublish.js';
import { buildRssFeed, buildAtomFeed } from '../plugins/feeds.js';
import { applyPipes } from '../plugins/pipes.js';
import { runSource, synthesizeLegacyBlocks } from '../plugins/pageSources.js';
import { fetchChannelUploads } from '../plugins/youtube.js';
import { FEATURES } from '../plugins/featureRegistry.js';

// Build the landing "every feature" showcase. A curated list wins
// (design.landing_features_json — JSON [{title,blurb,stage,section}]); otherwise
// seed from the feature registry so every feature shows by default, stage-badged
// (experimental flag → 'experimental', everything else → 'stable'). This is what
// lets the platform's own site advertise stable/beta/experimental features.
function buildFeatureShowcase(design = {}) {
  let curated = [];
  try {
    const raw = design.landing_features_json;
    if (raw && String(raw).trim()) curated = JSON.parse(raw);
  } catch { curated = []; }
  if (Array.isArray(curated) && curated.length) {
    return curated
      .map(f => ({
        title: String(f.title || '').trim(),
        blurb: String(f.blurb || '').trim(),
        stage: ['stable', 'beta', 'experimental'].includes(f.stage) ? f.stage : 'stable',
        section: f.section || '',
      }))
      .filter(f => f.title);
  }
  return FEATURES
    .filter(f => f.label && f.key !== 'dashboard')
    .map(f => ({
      title: f.label,
      blurb: '',
      stage: f.experimental ? 'experimental' : 'stable',
      section: f.section || '',
    }));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_VIEWS_ROOT = path.resolve(__dirname, '..', 'views', 'tenants');

const router = express.Router();

// Load nav pages + superadmin flag for all public views
router.use(async (req, res, next) => {
  try {
    if (req.db) {
      const [navPages, navLinks] = await Promise.all([
        req.db.collection('pages')
          .find({ status: 'published', showInNav: true }, { projection: { title: 1, slug: 1 } })
          .sort({ title: 1 })
          .toArray(),
        req.db.collection('nav_links').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
      ]);
      res.locals.navPages = navPages;
      res.locals.navLinks = navLinks;
    } else {
      res.locals.navPages = [];
      res.locals.navLinks = [];
    }
  } catch {
    res.locals.navPages = [];
    res.locals.navLinks = [];
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
  hero_cta_tertiary: '',
  hero_cta_tertiary_link: '',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence.',
  service1_title: 'Service One',
  service1_desc: 'Description of your first service offering.',
  service1_image: '',
  service1_link: '',
  service2_title: 'Service Two',
  service2_desc: 'Description of your second service offering.',
  service2_image: '',
  service2_link: '',
  service3_title: 'Service Three',
  service3_desc: 'Description of your third service offering.',
  service3_image: '',
  service3_link: '',
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
  contact_eyebrow: 'Get In Touch',
  contact_heading: "Let's Work",
  contact_heading_em: 'Together',
  contact_sub: "Ready to get started? Tell us about your project and we'll be in touch.",
  contact_location: '',
  contact_location_label: 'Location',
  contact_serving: '',
  contact_serving_label: 'Serving',
  contact_services: '',
  contact_services_label: 'Services',
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
  contact_optin_label: 'Yes, email me news and offers.',
  contact_optin_terms: 'Emails come from us only — we never share or sell your address, and you can unsubscribe at any time.',
};

// When a template is active, seed its block fields from the tenant's OWN copy so
// activating a template never "loses" the content they wrote on the standard layout —
// the block preview/live render consumes their current copy instead of blank defaults.
// `tc` must be the tenant's AUTHORED copy only (COPY_DEFAULTS excluded) so generic
// placeholder copy never clobbers a template's curated fields. Precedence at the call
// site is: template default < tenant copy (here) < per-block override.
function seedBlockFromCopy(type, tc) {
  const out = {};
  const put = (field, val) => { if (val != null && val !== '') out[field] = val; };
  const join = (a, b) => {
    const s = [a, b].filter(v => v != null && v !== '').join(' ');
    return s || undefined;
  };
  switch (type) {
    case 'hero':
      put('heading', join(tc.hero_heading, tc.hero_heading_em));
      put('subheading', tc.hero_sub);
      put('eyebrow', tc.hero_eyebrow);
      put('badge', tc.hero_badge);
      put('cta_text', tc.hero_cta_primary);
      put('cta_link', tc.hero_cta_primary_link);
      put('cta2_text', tc.hero_cta_secondary);
      put('cta2_link', tc.hero_cta_secondary_link);
      break;
    case 'cards':
      put('heading', join(tc.services_heading, tc.services_heading_em));
      put('subtext', tc.services_sub);
      for (let n = 1; n <= 4; n++) {
        put('card' + n + '_title', tc['service' + n + '_title']);
        put('card' + n + '_body', tc['service' + n + '_desc']);
      }
      break;
    case 'cta':
      put('heading', join(tc.contact_heading, tc.contact_heading_em));
      put('subtext', tc.contact_sub);
      put('btn_text', tc.contact_btn);
      break;
    case 'stats':
      for (let n = 1; n <= 4; n++) {
        put('stat' + n + '_num', tc['about_stat' + n + '_num']);
        put('stat' + n + '_label', tc['about_stat' + n + '_label']);
      }
      break;
    case 'text':
    case 'split':
      put('body', tc.about_desc);
      break;
    case 'pricing':
      for (let n = 1; n <= 3; n++) {
        put('tier' + n + '_name', tc['pricing_tier' + n + '_label']);
        put('tier' + n + '_price', tc['pricing_tier' + n + '_amount']);
      }
      break;
  }
  return out;
}

async function getDesign(db) {
  const rawDesign = await db.collection('design').find({}).toArray();
  const design = { ...DESIGN_DEFAULTS };
  for (const item of rawDesign) design[item.key] = item.value;
  return enrichDesignContrast(design);
}

async function getBrandLogos(db) {
  const rows = await db.collection('brand_images').find({
    slot: { $in: ['logo_primary', 'logo_white', 'logo_icon', 'share_image', 'share_square'] }
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
    header:    design.vis_header    !== 'false',
    hero:      design.vis_hero      !== 'false',
    marquee:   design.vis_marquee   !== 'false',
    services:  design.vis_services  !== 'false',
    portfolio: design.vis_portfolio !== 'false',
    about:     design.vis_about     !== 'false',
    process:   design.vis_process   !== 'false',
    pricing:   design.vis_pricing   !== 'false',
    reviews:   design.vis_reviews   !== 'false',
    contact:   design.vis_contact   !== 'false',
    blog:      design.vis_blog      === 'true',
    careers:   design.vis_careers   === 'true',
    videos:    design.vis_videos    !== 'false',
    footer:    design.vis_footer    !== 'false',
    admin_link: design.vis_admin_link !== 'false',
    qr:        design.vis_qr        === 'true',
  };
}

// Writer Feed custom sections pull content from the `blog` collection by tag /
// content type. Mutates each writer_feed section in place, adding `sec.items`.
async function attachWriterFeeds(db, customSections) {
  const feeds = (customSections || []).filter(s => s && s.type === 'writer_feed');
  if (!feeds.length) return;
  await Promise.all(feeds.map(async (sec) => {
    const f = sec.fields || {};
    const tag = (f.tag || '').trim().toLowerCase();
    const ctype = (f.content_type || 'any').trim();
    const limit = Math.min(Math.max(parseInt(f.limit, 10) || 6, 1), 24);
    const query = { status: 'published' };
    if (tag) query.tags = tag;
    if (ctype && ctype !== 'any') {
      // Legacy blog docs have no contentType field — treat them as 'blog'.
      query.contentType = ctype === 'blog' ? { $in: ['blog', null] } : ctype;
    }
    try {
      sec.items = await db.collection('blog')
        .find(query)
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch {
      sec.items = [];
    }
  }));
}

// ── Calculator config (consumed by <slab-calculator> web component) ──
router.get('/calculators/:slug.json', async (req, res) => {
  try {
    const db = req.db;
    if (!db) return res.status(404).json({ error: 'no_tenant' });
    const calc = await db.collection('calculators').findOne({ slug: req.params.slug, enabled: { $ne: false } });
    if (!calc) return res.status(404).json({ error: 'not_found' });
    // Strip Mongo _id and expose only public-safe shape
    res.json({
      slug: calc.slug,
      title: calc.title,
      description: calc.description || '',
      noteText: calc.noteText || '',
      baseFields: calc.baseFields || [],
      multiplierFields: calc.multiplierFields || [],
      addOns: calc.addOns || [],
      primaryCta: calc.primaryCta || null,
    });
  } catch (err) {
    console.error('[calculators] config error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

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

// ── Universal content share links ─────────────────────────────────────────
// `/s/:token` is the one short link the Share modal hands out for any content
// type. Tokens live in the tenant db, so resolution is automatically scoped to
// the tenant whose Host resolved this request. We 302 to the canonical public
// permalink — that page already emits full OG/Twitter meta, and social
// crawlers follow the redirect, so previews render correctly.
router.get('/s/:token', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const link = await req.db.collection('share_links').findOne({ token: req.params.token });
    const target = shareTargetPath(link);
    if (!link || !target) return res.status(404).send('This share link is no longer available.');
    req.db.collection('share_links').updateOne(
      { _id: link._id },
      { $inc: { clicks: 1 }, $set: { lastClickAt: new Date() } },
    ).catch(() => {});
    res.redirect(302, target);
  } catch (err) {
    console.error('[share] redirect error:', err);
    res.status(500).send('Error resolving link.');
  }
});

// QR for a share link — encodes the `/s/:token` URL (so scans count as clicks).
router.get('/s/:token/qr', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const link = await req.db.collection('share_links').findOne({ token: req.params.token });
    if (!link) return res.status(404).send('Not found');
    const png = await QRCode.toBuffer(shareUrlFor(req, link.token), {
      width: 600, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#0F1B30', light: '#FFFFFF' },
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (err) {
    res.status(500).send('Error generating QR.');
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
    // Pull every published Writer item once, then bucket into the public types
    // (blog / newsletter / help). Snippets are embed-only — excluded.
    const [pages, allContent] = await Promise.all([
      db.collection('pages').find({ status: 'published' }).toArray(),
      db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1 }).toArray(),
    ]);
    const domain = (req.tenant?.domain ? `https://${req.tenant.domain}` : 'http://localhost').replace(/\/$/, '');
    const fmt = d => d ? new Date(d).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url><loc>${domain}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;
    for (const pg of pages) {
      xml += `  <url><loc>${domain}/${pg.slug}</loc><lastmod>${fmt(pg.updatedAt)}</lastmod><changefreq>${pg.sitemapChangefreq || 'monthly'}</changefreq><priority>${pg.sitemapPriority ?? 0.5}</priority></url>\n`;
    }
    for (const ct of PUBLIC_CONTENT) {
      const items = allContent.filter(c => (ct.type === 'blog' ? (!c.contentType || c.contentType === 'blog') : c.contentType === ct.type));
      if (!items.length && ct.type !== 'blog') continue; // always list /blog; others only when they have content
      xml += `  <url><loc>${domain}${ct.base}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
      for (const post of items) {
        xml += `  <url><loc>${domain}${ct.base}/${post.slug}</loc><lastmod>${fmt(post.updatedAt || post.publishedAt)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
      }
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
// ── Public support chat — the guest-facing ✦ concierge ────────────────────────
// assist-only: brand-aware Q&A + lead nudge. NO mutating tools (it only informs
// and invites contact), ephemeral (client-held short history — nothing
// persisted), rate-limited, and gated by the tenant chatbot toggle + the Support
// agent in the matrix. Uses the matrix Support config (engine/model/greeting).
const supportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, reply: 'You’re sending messages quickly — give it a moment and try again.' },
});
// Polling is frequent by nature (every few seconds while the bubble is open), so
// it gets its own generous window rather than sharing the send limiter.
const supportPollLimiter = rateLimit({
  windowMs: 60 * 1000, max: 90,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, messages: [] },
});

// Map a stored chat message to what a guest may see, tagging its source so the
// widget renders it correctly: 'me' (visitor) · 'ai' · 'staff' (a human) ·
// 'notice' (the green join/leave line). Anything else (contactSaved, honeypot
// notes) is hidden from the guest.
function guestView(m) {
  const meta = m.meta || {};
  if (m.authorType === 'system') {
    if (meta.event === 'admin-join' || meta.event === 'admin-leave') {
      return { id: String(m._id), at: m.createdAt, kind: 'notice', event: meta.event, body: m.body || '' };
    }
    return null;
  }
  if (m.authorType === 'agent') return { id: String(m._id), at: m.createdAt, kind: 'ai', name: m.authorName || 'Assistant', body: m.body || '' };
  if (m.authorType === 'user') {
    if (m.authorId) return { id: String(m._id), at: m.createdAt, kind: 'staff', name: m.authorName || 'Team', body: m.body || '' };
    return { id: String(m._id), at: m.createdAt, kind: 'me', body: m.body || '' };
  }
  return null;
}
const SUPPORT_THREAD_FILTER = (sid) => ({ kind: 'support', 'context.module': 'support', 'context.refId': sid, status: { $ne: 'archived' } });

// Chat-style contact harvest: pull an email (+ name/phone if present) out of what
// a visitor typed, so the support bot can capture a lead conversationally instead
// of forcing a form. Returns null when there's no email to anchor on.
const SB_EMAIL_RE = /[^\s@<>()]{1,80}@[^\s@<>()]{1,80}\.[a-z]{2,24}/i;
const SB_PHONE_RE = /\+?\d[\d\-().\s]{7,}\d/;
function harvestContact(text, history) {
  const emailM = String(text || '').match(SB_EMAIL_RE);
  if (!emailM) return null;
  const email = emailM[0].toLowerCase();
  let phone = '';
  const phoneM = String(text || '').replace(SB_EMAIL_RE, '').match(SB_PHONE_RE);
  if (phoneM && (phoneM[0].replace(/\D/g, '').length >= 10)) phone = phoneM[0].trim().slice(0, 40);
  // Name: an explicit "I'm X" / "my name is X" anywhere in the conversation wins;
  // otherwise the leading capitalized words of this message (email/phone stripped).
  let name = '';
  const joined = [...(history || []).map((m) => m && m.content), text].filter(Boolean).join('  ');
  // Case-insensitive trigger, but the captured name must be Capitalized — that
  // filters false hits like "i am looking for…" while catching "Im Sarah".
  const nm = joined.match(/(?:[Mm]y name is|[Ii] am|[Ii]'?[Mm]|[Tt]his is|[Ii]t'?s|[Nn]ame'?s?:?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (nm) name = nm[1].trim();
  if (!name) {
    const rest = String(text || '').replace(SB_EMAIL_RE, '').replace(SB_PHONE_RE, '').replace(/[,;:|]/g, ' ').trim();
    const words = rest.split(/\s+/).filter(Boolean);
    if (words.length && words.length <= 3 && /^[A-Za-z][A-Za-z'.-]{1,}$/.test(words[0]) && words.join('').length <= 40) {
      name = words.slice(0, 3).join(' ');
    }
  }
  return { email, phone, name: name.slice(0, 120) };
}

// Alert the tenant when a visitor leaves contact / a CTA in the support chat: a
// platform event + an email to the tenant's configured recipient (their own
// mailbox when connected, else the platform mailbox). Fire-and-forget; mirrors
// the contact-form forwarder. (In-panel flash will hang off the socket presence
// layer once that lands — this email is the always-on channel.)
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function notifySupportLead({ tenant, thread, contact }) {
  const brandName = tenant?.brand?.name || tenant?.domain || 'your site';
  const name = contact?.name || 'Website visitor';
  const email = contact?.email || '';
  const notes = String(contact?.notes || '').trim();
  notifyAdmin({ type: 'contact', app: 'slab', email, name,
    data: { Brand: brandName, Domain: tenant?.domain || '', Source: 'Support chat', Phone: contact?.phone || '', Notes: notes.slice(0, 300) } }).catch(() => {});

  const recipient = tenant?.meta?.contactEmail || tenant?.meta?.ownerEmail || tenant?.brand?.email;
  if (!recipient) return;
  try {
    const { resolveSmtp, getTenantTransporter } = await import('../plugins/mailer.js');
    const smtp = resolveSmtp(tenant);
    const useTenantMailer = smtp.authMode === 'oauth' ? !!smtp.user : !!(smtp.user && smtp.pass);
    const havePlatform = !!(process.env.ZOHO_USER && process.env.ZOHO_PASS);
    if (!useTenantMailer && !havePlatform) return;
    const fromUser = useTenantMailer ? smtp.user : process.env.ZOHO_USER;
    let t;
    if (useTenantMailer) { t = await getTenantTransporter(tenant); }
    else { const nm = await import('nodemailer'); t = nm.default.createTransport({ host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN', auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS } }); }
    const chatUrl = `https://${tenant?.domain || 'slab.madladslab.com'}/admin/chat`;
    const fromLabel = useTenantMailer ? `"${brandName}" <${fromUser}>` : `"${brandName} (via MadLadsLab)" <${fromUser}>`;
    await t.sendMail({
      from: fromLabel, to: recipient, replyTo: email || undefined,
      subject: `New lead from your support chat: ${name}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:500px;padding:24px;background:#fff;color:#111">
        <h2 style="font-size:18px;margin-bottom:6px">New support-chat lead</h2>
        <p style="color:#666;font-size:13px;margin:0 0 16px">A visitor left their details in your website chat.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px;color:#666;width:90px">Name</td><td style="padding:6px"><strong>${_esc(name)}</strong></td></tr>
          <tr><td style="padding:6px;color:#666">Email</td><td style="padding:6px"><a href="mailto:${_esc(email)}">${_esc(email)}</a></td></tr>
          ${contact?.phone ? `<tr><td style="padding:6px;color:#666">Phone</td><td style="padding:6px">${_esc(contact.phone)}</td></tr>` : ''}
          ${notes ? `<tr><td style="padding:6px;color:#666;vertical-align:top">Notes / needs</td><td style="padding:6px">${_esc(notes.slice(0, 1200))}</td></tr>` : ''}
        </table>
        <p style="margin-top:18px"><a href="${chatUrl}" style="color:#1C2B4A;font-weight:600;text-decoration:none">Review the conversation →</a></p>
        ${!useTenantMailer ? `<p style="margin-top:14px;font-size:11px;color:#999">Sent via the MadLadsLab platform mailer. Connect your mailbox in <a href="${chatUrl.replace('/admin/chat', '/admin/settings')}">Settings</a> to send from your own domain.</p>` : ''}
      </div>`,
    });
  } catch (e) { console.error('[support-lead] email error:', e.message); }
}
router.post('/support-chat', supportLimiter, async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const chat = await import('../plugins/chat.js');
    if (!chat.chatbotEnabled(tenant)) return res.status(403).json({ ok: false, error: 'Support chat is off.' });
    const matrix = await chat.getChatFlowMatrix(db);
    const sup = matrix.support || {};
    if (sup.enabled === false) return res.status(403).json({ ok: false, error: 'Support chat is off.' });

    const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-6) : [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const text = String(lastUser?.content || req.body.message || '').trim().slice(0, 1000);
    if (!text) return res.json({ ok: true, reply: 'Hi! How can I help?' });

    // Visitor session id → one persistent `support` thread per visitor, so the
    // conversation is reviewable in Chat Control. Persistence is best-effort: a DB
    // hiccup must never break the guest's chat, so every thread op is guarded.
    const sid = String(req.body.sid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    let thread = null, isNewThread = false;
    if (sid) {
      try {
        const filt = { kind: 'support', 'context.module': 'support', 'context.refId': sid, status: 'active' };
        thread = await db.collection('chat_threads').findOne(filt);
        if (!thread) {
          try { thread = await chat.createThread(db, { kind: 'support', title: 'Website visitor', context: { module: 'support', refId: sid } }); isNewThread = !!thread; }
          catch (e) { if (e && e.code === 11000) thread = await db.collection('chat_threads').findOne(filt); else throw e; }
        }
        if (thread) {
          const gmsg = await chat.postMessage(db, { threadId: thread._id, authorType: 'user', authorName: (thread.contact && thread.contact.name) || 'Visitor', role: 'user', body: text });
          chatBroadcast(thread._id, 'chat:message', gmsg); // watching admins see the guest live
          // A visitor just opened a conversation → flash whoever's on the panel.
          if (isNewThread) adminAlert(tenant?.db, { kind: 'chat', title: 'New visitor chat', body: 'A visitor just started a chat on your site.', threadId: String(thread._id) });
        }
      } catch (e) { console.warn('[support-chat] persist skipped:', e.message); thread = null; }
    }

    // Honeypot: a flagged visitor gets no harvest, no AI, no alert — their probe is
    // still shown to any watching admin (broadcast above), but the door is dead.
    if (thread && thread.honeypot) return res.json({ ok: true, sid: sid || undefined });

    // Chat-style contact harvest: if the visitor typed an email, capture the lead
    // (name/phone too when present) → inquiry + stamps the thread. Once per thread.
    let captured = null;
    if (thread && !(thread.contact && thread.contact.capturedAt)) {
      const found = harvestContact(text, messages);
      if (found) {
        try {
          // Save the visitor's own words so far as their notes/needs, so the lead
          // carries substance — not just an email.
          const notes = messages.filter((m) => m && m.role === 'user')
            .map((m) => String(m.content || '').trim()).filter(Boolean).join('  ·  ').slice(0, 2000);
          await chat.saveContactSubmission(db, { thread, values: { name: found.name || 'Website visitor', phone: found.phone, email: found.email }, notes, tenantDomain: tenant?.domain || '' });
          found.notes = notes;
          captured = found;
          if (found.name) { try { await db.collection('chat_threads').updateOne({ _id: thread._id }, { $set: { title: found.name.slice(0, 120) } }); } catch { /* non-fatal */ } }
          // Data / CTA from the visitor → in-panel flash for whoever's on the panel.
          adminAlert(tenant?.db, { kind: 'lead', title: 'New lead', body: (found.name || 'A visitor') + (found.email ? ' — ' + found.email : ''), threadId: String(thread._id) });
        } catch (e) { console.warn('[support-chat] contact save:', e.message); }
      }
    }

    // Human takeover: a staffer has the wheel — the guest message is persisted and
    // shown to them; stand the AI down. Their replies reach the guest via the poll.
    if (thread && thread.takeover && thread.takeover.active) {
      if (captured) notifySupportLead({ tenant, thread, contact: captured }).catch(() => {});
      return res.json({ ok: true, takeover: true, sid: sid || undefined });
    }

    // Always answer with a fresh, LLM-generated reply — NEVER a hardcoded line,
    // including the post-contact acknowledgement. Memory comes from the persisted
    // thread so the concierge recalls earlier answers and never re-asks.
    let brand = '';
    try { const { loadBrandContext } = await import('../plugins/brandContext.js'); brand = await loadBrandContext(tenant, db); } catch { /* non-fatal */ }
    const bizName = tenant?.brand?.name || tenant?.domain || 'this business';
    const alreadyHave = thread && thread.contact && thread.contact.capturedAt;
    const contactHint = captured
      ? `\nThe visitor JUST shared their contact details${captured.name ? ' (' + captured.name + ')' : ''}. Acknowledge it warmly and naturally IN YOUR OWN WORDS — never a templated phrase — let them know a real person will follow up, then keep helping with anything else. Don't ask for their contact again.`
      : (alreadyHave ? `\nYou already have this visitor's contact details — do NOT ask again; just keep helping.` : '');
    const isMadlads = /madlads/i.test(tenant?.domain || '') || /madlads/i.test(bizName);
    const toneNote = isMadlads
      ? `\nTone: anti-marketing and real — no hype, no buzzwords, no sales gloss. Being plainly an AI concierge is fine; if it comes up, own it honestly instead of pretending to be a person.`
      : `\nIf a visitor asks, it's fine to be honest that you're an AI concierge — don't pretend to be a human.`;
    const sys = `You are the support concierge for ${bizName}, helping a visitor on ${bizName}'s own website. Everyone here is a guest of ${bizName} — you already know this is ${bizName}'s site, so NEVER ask what business, company, or project they have. Have real personality and warmth — be genuinely curious, thoughtful, and a little creative; you are a concierge, not a form. Vary how you phrase things every time; never reuse a canned line.
Track what the visitor tells you and BUILD on it: remember their answers, connect the dots, and give tailored, specific guidance. Never re-ask something they've already answered.
You can also take down their notes, questions, and needs and SAVE them for the team — when it's useful, let the visitor know you can jot this down so nothing gets lost, and reassure them it's saved. Everything they share here is kept for ${bizName} to follow up on.
Answer using ONLY the brand context below — never invent services, prices, hours, or policies; if you don't know, say so plainly and offer to have someone follow up. Keep each reply short and human — one or two sentences, the length of a real chat message; ask at most ONE question at a time.
When it's something the team should follow up on (a quote, a booking, a question for a person), warmly ask for their name and email — but ask AT MOST ONCE. If they don't give it or decline, do NOT ask again and do NOT pressure them; gracefully keep helping. No coercion, no repeated asks, no hard upsell.${contactHint}${toneNote}
You cannot take payments, book, or change anything; you only inform and guide.
${sup.greeting ? 'Persona note: ' + sup.greeting + '\n' : ''}${brand}`.trim();

    // Context from the persisted thread when we have one — the concierge's real
    // memory. Falls back to the client-sent window if persistence was skipped.
    let hist;
    if (thread) {
      const rows = await chat.listMessages(db, thread._id, { limit: 16 });
      hist = rows.filter((m) => m.authorType !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.body || '').slice(0, 1000) }));
    } else {
      hist = messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1000) }));
    }
    const { callLLM } = await import('../plugins/agentMcp.js');
    // Tensor the concierge: warmer temperature for depth/creativity, capped tokens
    // so it still reads like a chat message, not an essay.
    const reply = await callLLM(hist.length ? hist : [{ role: 'user', content: text }], sys, 60000,
      { tenant, engine: sup.engine, model: sup.model, temperature: 0.8, maxTokens: 320 });
    // On an empty generation, surface an error so the widget shows Retry rather
    // than a fabricated stock line.
    if (!reply) return res.status(502).json({ ok: false, error: 'Chat is briefly unavailable.' });

    if (thread) {
      try {
        const amsg = await chat.postMessage(db, { threadId: thread._id, authorType: 'agent', authorName: 'Support', role: 'assistant', body: reply, meta: { engine: sup.engine || 'house', source: 'ai' } });
        chatBroadcast(thread._id, 'chat:message', amsg);
      } catch { /* non-fatal */ }
    }

    // Data / CTA from the visitor → alert the tenant (email; the same socket room
    // carries it in-panel when an admin is present).
    if (captured && thread) { notifySupportLead({ tenant, thread, contact: captured }).catch(() => {}); }

    // With a thread, the widget renders the reply via /support-poll (one source, so
    // AI and human takeover look identical). Without one (persistence down), return
    // it inline so the guest still gets an answer.
    res.json({ ok: true, sid: sid || undefined, ...(thread ? {} : { reply }) });
  } catch (err) {
    console.error('[support-chat] error:', err.message);
    res.status(500).json({ ok: false, error: 'Chat is briefly unavailable.' });
  }
});

// Full conversation for the guest to REBUILD on reload (includes their own lines)
// — this is what lets a quick refresh drop them back into the same chat.
router.get('/support-history', supportPollLimiter, async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const { chatbotEnabled, listMessages } = await import('../plugins/chat.js');
    if (!chatbotEnabled(tenant)) return res.json({ ok: false, messages: [] });
    const sid = String(req.query.sid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!sid) return res.json({ ok: true, messages: [], takeover: false });
    const thread = await db.collection('chat_threads').findOne(SUPPORT_THREAD_FILTER(sid));
    if (!thread) return res.json({ ok: true, messages: [], takeover: false });
    const rows = await listMessages(db, thread._id, { limit: 100 });
    res.json({
      ok: true, messages: rows.map(guestView).filter(Boolean),
      takeover: !!(thread.takeover && thread.takeover.active),
    });
  } catch (err) { console.error('[support-history]', err.message); res.json({ ok: false, messages: [] }); }
});

// Live delivery: new INCOMING messages (AI, staff, join/leave notices) since a
// cursor — never the visitor's own echoes. The widget polls this while open.
router.get('/support-poll', supportPollLimiter, async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const { chatbotEnabled } = await import('../plugins/chat.js');
    if (!chatbotEnabled(tenant)) return res.json({ ok: false, messages: [] });
    const sid = String(req.query.sid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!sid) return res.json({ ok: true, messages: [] });
    const thread = await db.collection('chat_threads').findOne(SUPPORT_THREAD_FILTER(sid));
    if (!thread) return res.json({ ok: true, messages: [], takeover: false });
    const after = req.query.after ? new Date(String(req.query.after)) : new Date(0);
    const rows = await db.collection('chat_messages')
      .find({ threadId: thread._id, createdAt: { $gt: isNaN(after) ? new Date(0) : after } })
      .sort({ createdAt: 1 }).limit(50).toArray();
    const messages = rows.map(guestView).filter(Boolean).filter((v) => v.kind !== 'me');
    res.json({ ok: true, messages, takeover: !!(thread.takeover && thread.takeover.active) });
  } catch (err) { console.error('[support-poll]', err.message); res.json({ ok: false, messages: [] }); }
});

// Lead capture from the support bubble → inquiries (same shape as the chat
// contact-capture, so it shows in the admin Inquiries page).
router.post('/support-inquiry', supportLimiter, async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const chat = await import('../plugins/chat.js');
    if (!chat.chatbotEnabled(tenant)) return res.status(403).json({ ok: false });
    const name = String(req.body.name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const message = String(req.body.message || '').trim().slice(0, 2000);
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ ok: false, error: 'A valid email is required.' });
    const sid = String(req.body.sid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);

    // Prefer stamping the visitor's own thread — so the lead shows inside the
    // reviewable conversation — and fall back to a plain inquiry insert.
    let thread = null;
    if (sid) { try { thread = await db.collection('chat_threads').findOne({ kind: 'support', 'context.module': 'support', 'context.refId': sid, status: 'active' }); } catch { /* non-fatal */ } }
    if (thread && !(thread.contact && thread.contact.capturedAt)) {
      try {
        if (message) { try { await chat.postMessage(db, { threadId: thread._id, authorType: 'user', authorName: name || 'Visitor', role: 'user', body: message }); } catch { /* non-fatal */ } }
        await chat.saveContactSubmission(db, { thread, values: { name: name || 'Website visitor', email, phone: '' }, tenantDomain: tenant?.domain || '' });
        if (name) { try { await db.collection('chat_threads').updateOne({ _id: thread._id }, { $set: { title: name.slice(0, 120) } }); } catch { /* non-fatal */ } }
        notifySupportLead({ tenant, thread, contact: { name: name || 'Website visitor', email, phone: '' } }).catch(() => {});
        adminAlert(tenant?.db, { kind: 'lead', title: 'New lead', body: (name || 'A visitor') + (email ? ' — ' + email : ''), threadId: String(thread._id) });
        return res.json({ ok: true });
      } catch (e) { console.warn('[support-inquiry] thread stamp failed:', e.message); }
    }
    await db.collection('inquiries').insertOne({
      name: name || '(via support chat)', email, company: '', service: '',
      message: message || 'Left contact via the support bubble.',
      customFields: {}, tenantDomain: tenant?.domain || '', source: 'support-chat',
      createdAt: new Date(),
    });
    notifySupportLead({ tenant, thread: null, contact: { name: name || 'Website visitor', email, phone: '' } }).catch(() => {});
    adminAlert(tenant?.db, { kind: 'lead', title: 'New lead', body: (name || 'A visitor') + (email ? ' — ' + email : '') });
    res.json({ ok: true });
  } catch (err) {
    console.error('[support-inquiry] error:', err.message);
    res.status(500).json({ ok: false });
  }
});

router.post('/contact', async (req, res) => {
  try {
    const db = req.db;
    const { name, firstName, lastName, email, company, service, message } = req.body;
    const contactName = name || [firstName, lastName].filter(Boolean).join(' ') || '';

    // Honeypot — a hidden field real users never fill; autofill bots trip it.
    // We do NOT hard-drop: an aggressive password manager could fill it for a
    // real person, and a silent drop would lose that lead invisibly. Instead we
    // tag the submission and let it save as status:'spam' below, so a human
    // false-positive is recoverable from the admin Spam tab (and bots just pile
    // up there to be deleted). Logged so trips are visible in the journal.
    const honeypotTripped = !!(req.body.website || req.body._hp || '').trim();
    if (honeypotTripped) {
      console.warn('[honeypot] contact trap tripped', {
        tenant: req.tenant?.domain || '', ip: req.ip, email: (email || '').slice(0, 120),
      });
    }

    // Proof-of-work CAPTCHA — blocks scripted POSTs that skip the browser
    // widget. Responds/redirects itself on failure, so bail out here.
    if (!passedCaptcha(req, res, { redirectTo: '/#contact' })) return;

    if (!email) return res.redirect('/#contact');

    // Spam blocklist check — sender (or a normalized variant) has been flagged
    // by an admin. Silently drop: redirect like a normal submission so the
    // sender gets no signal that their address is blocked.
    const emailLower = email.toLowerCase().trim();
    const emailNorm = normalizeEmail(email);
    const blocked = await db.collection('spam_emails').findOne({
      $or: [{ email: emailLower }, { emailNormalized: emailNorm }],
    });
    if (blocked) return res.redirect('/?contacted=1#contact');

    // Global (cross-tenant) spam filter — unlike the per-tenant blocklist above,
    // a global match is NOT dropped: it's saved as status 'spam' so this tenant
    // sees it in their Spam tab and deletes it themselves.
    const globalFlag = await checkGlobalSpam({ email: emailLower, message, service }).catch(() => ({ hit: false }));

    // Collect any custom fields the tenant added via the admin contact form builder.
    // These come in alongside the stock keys but use tenant-chosen names; preserve them.
    const STOCK_KEYS = new Set(['name', 'firstName', 'lastName', 'email', 'company', 'service', 'message', 'marketingOptIn']);
    const customFields = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (STOCK_KEYS.has(k) || k.startsWith('_')) continue;
      if (typeof v === 'string' && v.trim()) customFields[k] = v.trim().slice(0, 2000);
    }

    // Marketing opt-in — an unticked box is NOT consent, so the checkbox has to
    // come back with a value for us to treat it as one. The consent text is read
    // from the tenant's own copy (not a posted hidden field) so the stored proof
    // is what the site actually renders, and can't be spoofed by the submitter.
    const optedIn = ['yes', 'on', 'true', '1'].includes(String(req.body.marketingOptIn || '').toLowerCase());
    let consentText = '';
    if (optedIn) {
      const copyRows = await db.collection('copy')
        .find({ key: { $in: ['contact_optin_label', 'contact_optin_terms'] } }).toArray().catch(() => []);
      const byKey = Object.fromEntries(copyRows.map(r => [r.key, r.value]));
      consentText = [
        byKey.contact_optin_label || COPY_DEFAULTS.contact_optin_label,
        byKey.contact_optin_terms || COPY_DEFAULTS.contact_optin_terms,
      ].filter(Boolean).join(' ');
    }

    const inquiry = {
      name: contactName.trim(),
      email: email.toLowerCase().trim(),
      company: company?.trim() || '',
      service: service?.trim() || '',
      message: message?.trim() || '',
      customFields,
      marketingOptIn: optedIn,
      tenantDomain: req.tenant?.domain || '',
      createdAt: new Date(),
    };
    if (optedIn) inquiry.marketingConsent = { text: consentText, ip: req.ip, at: new Date() };
    if (globalFlag.hit) {
      inquiry.status = 'spam';
      inquiry.spamFiltered = { scope: 'global', type: globalFlag.type, key: globalFlag.key, at: new Date() };
    } else if (honeypotTripped) {
      inquiry.status = 'spam';
      inquiry.spamFiltered = { scope: 'honeypot', type: 'honeypot', at: new Date() };
    }
    await db.collection('inquiries').insertOne(inquiry);

    // Spam-tagged submissions (global filter or honeypot) land in the Spam tab
    // silently — don't ping the admin or forward to the tenant mailbox.
    if (globalFlag.hit || honeypotTripped) return res.redirect('/?contacted=1#contact');

    // Opted in → add to THIS tenant's marketing list only (contacts is a
    // per-tenant collection, so a tick here never leaks the address to another
    // tenant or to the platform). Single opt-in: the visitor ticked an explicit
    // box on a form they submitted themselves, and the consent text + IP are
    // stored as proof. Unsubscribing is one click from every marketing send
    // (plugins/mailer.js injects /t/unsubscribe). Best-effort — a list failure
    // must never lose the inquiry itself.
    if (optedIn) {
      captureLead({
        db, tenant: req.tenant, email: inquiry.email, name: inquiry.name,
        funnel: 'lead', tags: ['contact-form'], source: 'contact-form',
        optIn: 'single',
        consent: { text: consentText, ip: req.ip, userAgent: req.get('user-agent') || '' },
      }).catch(err => console.warn('[contact] opt-in capture failed:', err.message));
    }

    // Notify admin + forward to tenant email if configured
    const brand = res.locals.brand || {};
    notifyAdmin({ type: 'contact', app: 'slab', email: inquiry.email, name: inquiry.name, ip: req.ip,
      data: { 'Brand': brand.name || req.tenant?.domain || 'sLab tenant', 'Domain': req.tenant?.domain || '', 'Company': inquiry.company, 'Service': inquiry.service, 'Message': inquiry.message?.slice(0, 200) } }).catch(() => {});

    // Forward to tenant's configured recipient. Prefer tenant's own Zoho (so it
    // comes from their domain). Fall back to the platform Zoho so delivery
    // never silently fails when a tenant hasn't connected their own mailbox yet.
    try {
      const tenant = await import('../plugins/mongo.js').then(m => m.getSlabDb()).then(sdb => sdb.collection('tenants').findOne({ _id: req.tenant?._id }));
      const recipient = tenant?.meta?.contactEmail || tenant?.meta?.ownerEmail || tenant?.brand?.email;
      if (recipient) {
        // Use req.tenant (decrypted secrets) for credentials/provider — supports
        // password OR OAuth; the re-fetched `tenant` doc only supplies the
        // plaintext recipient. Falls back to the platform mailbox.
        const { resolveSmtp, getTenantTransporter } = await import('../plugins/mailer.js');
        const smtp = resolveSmtp(req.tenant);
        const useTenantMailer = smtp.authMode === 'oauth' ? !!smtp.user : !!(smtp.user && smtp.pass);
        const fromUser = useTenantMailer ? smtp.user : process.env.ZOHO_USER;
        const havePlatform = !!(process.env.ZOHO_USER && process.env.ZOHO_PASS);
        if (useTenantMailer || havePlatform) {
          let t;
          if (useTenantMailer) {
            t = await getTenantTransporter(req.tenant);
          } else {
            const nodemailer = await import('nodemailer');
            t = nodemailer.default.createTransport({ host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN', auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS } });
          }
          const fromLabel = useTenantMailer
            ? `"${brand.name || 'Your Site'}" <${fromUser}>`
            : `"${brand.name || req.tenant?.domain || 'sLab'} (via MadLadsLab)" <${fromUser}>`;
          await t.sendMail({
            from: fromLabel,
            to: recipient,
            replyTo: inquiry.email,
            subject: `New Contact: ${inquiry.name}${inquiry.service ? ' — ' + inquiry.service : ''}`,
            html: `<div style="font-family:Inter,sans-serif;max-width:500px;padding:24px;background:#fff;color:#111">
              <h2 style="font-size:18px;margin-bottom:16px">New Contact Form Submission</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px;color:#666;width:100px">Site</td><td style="padding:6px">${req.tenant?.domain || ''}</td></tr>
                <tr><td style="padding:6px;color:#666">Name</td><td style="padding:6px"><strong>${inquiry.name}</strong></td></tr>
                <tr><td style="padding:6px;color:#666">Email</td><td style="padding:6px"><a href="mailto:${inquiry.email}">${inquiry.email}</a></td></tr>
                ${inquiry.company ? `<tr><td style="padding:6px;color:#666">Company</td><td style="padding:6px">${inquiry.company}</td></tr>` : ''}
                ${inquiry.service ? `<tr><td style="padding:6px;color:#666">Service</td><td style="padding:6px">${inquiry.service}</td></tr>` : ''}
                ${Object.entries(inquiry.customFields || {}).map(([k, v]) =>
                  `<tr><td style="padding:6px;color:#666;text-transform:capitalize">${k.replace(/[_-]/g, ' ')}</td><td style="padding:6px">${v}</td></tr>`
                ).join('')}
                <tr><td style="padding:6px;color:#666;vertical-align:top">Message</td><td style="padding:6px">${inquiry.message || '—'}</td></tr>
                <tr><td style="padding:6px;color:#666">Email opt-in</td><td style="padding:6px">${inquiry.marketingOptIn ? '✓ Yes — added to your marketing list' : 'No — reply only, do not add to marketing'}</td></tr>
              </table>
              ${!useTenantMailer ? `<p style="margin-top:18px;font-size:11px;color:#999">Sent via the MadLadsLab platform mailer. Connect Zoho in <a href="https://${req.tenant?.domain || ''}/admin/settings">Settings</a> to send these from your own domain.</p>` : ''}
            </div>`,
          });
        }
      }
    } catch (emailErr) { console.error('[contact] Forward email error:', emailErr.message); }

    res.redirect('/?contacted=1#contact');
  } catch (err) {
    console.error('[contact] error:', err);
    res.redirect('/#contact');
  }
});

// Terms & Conditions
router.get('/terms', async (req, res) => {
  const brand = res.locals.brand || {};
  if (req.db) {
    const doc = await req.db.collection('copy').findOne({ key: 'terms_content' });
    if (doc?.value) return res.render('legal/custom', { brand, title: 'Terms & Conditions', content: doc.value });
  }
  res.render('legal/terms', { brand });
});

// Privacy Policy
router.get('/privacy', async (req, res) => {
  const brand = res.locals.brand || {};
  if (req.db) {
    const doc = await req.db.collection('copy').findOne({ key: 'privacy_content' });
    if (doc?.value) return res.render('legal/custom', { brand, title: 'Privacy Policy', content: doc.value });
  }
  res.render('legal/privacy', { brand });
});

// ── Data Deletion ──────────────────────────────────────────────────────────
// Meta (Facebook/Instagram) requires a Data Deletion Request callback URL.
// It POSTs a `signed_request`; we verify it (with the tenant's FB app secret if
// configured), record the request, and return { url, confirmation_code }.
// The same path served as GET is the user-facing status + manual request page.

function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseSignedRequest(signedRequest, appSecret) {
  const [encSig, encPayload] = String(signedRequest).split('.');
  if (!encPayload) throw new Error('malformed signed_request');
  const data = JSON.parse(b64urlDecode(encPayload).toString('utf8'));
  if (appSecret) {
    const expected = crypto.createHmac('sha256', appSecret).update(encPayload).digest();
    const sig = b64urlDecode(encSig);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
      throw new Error('bad signature');
    }
    data._verified = true;
  }
  return data;
}

async function tenantFbAppSecret(db) {
  try {
    const acct = await db.collection('social_accounts').findOne({ platform: 'facebook' });
    const blob = acct?.secrets?.appSecret;
    if (!blob) return null;
    const { decrypt } = await import('../plugins/crypto.js');
    return decrypt(blob);
  } catch { return null; }
}

function newDeletionCode() {
  return crypto.randomBytes(9).toString('hex');
}

function publicBase(req) {
  const host = req.tenant?.domain || req.hostname;
  return `https://${host}`;
}

// Meta callback
router.post('/data-deletion', async (req, res) => {
  try {
    const signed = req.body?.signed_request;
    const code = newDeletionCode();
    let userId = null, verified = false;

    if (signed && req.db) {
      const secret = await tenantFbAppSecret(req.db);
      try {
        const data = parseSignedRequest(signed, secret);
        userId = data.user_id || null;
        verified = !!data._verified;
      } catch (e) {
        // Still acknowledge so Meta gets a valid response; flag as unverified.
        console.warn('[data-deletion] signed_request parse:', e.message);
      }
    }

    if (req.db) {
      await req.db.collection('deletion_requests').insertOne({
        code, source: 'meta', platform: 'facebook',
        externalUserId: userId, verified,
        status: 'received', email: null,
        createdAt: new Date(), completedAt: null, ip: req.ip,
      });
    }

    res.json({ url: `${publicBase(req)}/data-deletion?code=${code}`, confirmation_code: code });
  } catch (err) {
    console.error('[data-deletion] callback error:', err);
    res.status(200).json({ url: `${publicBase(req)}/data-deletion`, confirmation_code: 'error' });
  }
});

// Status page + manual request form
router.get('/data-deletion', async (req, res) => {
  const brand = res.locals.brand || {};
  const baseUrl = publicBase(req);
  let request = null;
  if (req.query.code && req.db) {
    try { request = await req.db.collection('deletion_requests').findOne({ code: String(req.query.code) }); } catch { /* ignore */ }
  }
  res.render('legal/data-deletion', { brand, request, submitted: null, baseUrl });
});

// Manual (non-Meta) deletion request
router.post('/data-deletion/request', async (req, res) => {
  const brand = res.locals.brand || {};
  const baseUrl = publicBase(req);
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.render('legal/data-deletion', { brand, request: null, submitted: null, baseUrl });
  }
  const code = newDeletionCode();
  if (req.db) {
    await req.db.collection('deletion_requests').insertOne({
      code, source: 'manual', platform: null,
      externalUserId: null, verified: false,
      status: 'received', email,
      createdAt: new Date(), completedAt: null, ip: req.ip,
    });
  }
  res.render('legal/data-deletion', { brand, request: null, submitted: code, baseUrl });
});

// Home page
router.get('/', async (req, res) => {
  try {
    const db = req.db;

    // ── Resolve homepage source ── (two-value model: 'slab' | 'custom')
    //   'custom' → tenant's bespoke views/tenants/<sub>/home.ejs
    //   'slab'   → activated Slab template if present, else the standard layout
    // Legacy rows (auto/layout/template) and a 'custom' row whose EJS file is
    // missing all resolve to slab rendering, so the homepage never blanks.
    const sub = req.tenant?.meta?.subdomain;
    const tenantHome = sub ? path.join(TENANT_VIEWS_ROOT, sub, 'home.ejs') : null;
    const hasCustomEjs = !!(tenantHome && fs.existsSync(tenantHome));
    const rawSource = (await db.collection('design').findOne({ key: 'home_source' }))?.value || 'slab';

    // Custom wins only when the bespoke file actually exists. ('auto' is honored
    // for legacy tenants not yet migrated — same "prefer EJS if present" rule.)
    const wantCustom   = hasCustomEjs && (rawSource === 'custom' || rawSource === 'auto');
    const wantTemplate = !wantCustom; // slab path: template-or-standard-layout

    // ── Tenant-specific home.ejs override ──
    if (wantCustom && hasCustomEjs) {
      const [design, logos, brandModels, rawCopy] = await Promise.all([
        getDesign(db),
        getBrandLogos(db),
        getBrandModels(db),
        db.collection('copy').find({}).toArray(),
      ]);
      const _copyMap = { ...COPY_DEFAULTS };
      for (const item of rawCopy) _copyMap[item.key] = item.value;
      const copy = localizeCopyMap(_copyMap, res.locals.locale);
      await applyPipes({ db, tenant: req.tenant, design, copy });

      // Auto-feed latest uploads from the tenant's YouTube channel (keyless RSS).
      // Only when a channel is configured; failures degrade to an empty feed so a
      // flaky YouTube response never takes down the homepage.
      const ytChannel = String(design.youtube_channel || '').trim();
      const ytLimit = parseInt(design.youtube_limit || '6', 10) || 6;
      const ytTag = String(design.youtube_tag || '').trim();
      let youtube = { ok: false, videos: [] };
      if (ytChannel) {
        try { youtube = await fetchChannelUploads({ channel: ytChannel, limit: ytLimit, tag: ytTag }); }
        catch (e) { youtube = { ok: false, videos: [], error: e.message }; }
      }
      const features = buildFeatureShowcase(design);

      return res.render(`tenants/${sub}/home`, {
        design, logos, brandModels, copy,
        brand: res.locals.brand || {},
        tenant: req.tenant,
        visibility: buildVisibility(design),
        centralAuthUrl: config.DOMAIN + '/auth/login',
        youtube, features,
      });
    }

    // ── Slab path: activated template if present, else fall through to layout ──
    if (wantTemplate) {
      const activeTemplate = await db.collection('active_template').findOne({});
      if (activeTemplate) {
        const tpl = await db.collection('templates').findOne({ _id: activeTemplate.templateId });
        if (tpl) {
          const [baseDesign, logos, brandModels, rawCopy, navLinks] = await Promise.all([
            getDesign(db),
            getBrandLogos(db),
            getBrandModels(db),
            db.collection('copy').find({}).toArray(),
            db.collection('nav_links').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
          ]);
          // Each template carries its own designSnapshot (the palette + fonts it was
          // built with). Apply it over the tenant base so every template renders in
          // its OWN look — otherwise all templates collapse to one tenant palette and
          // look identical. Re-enrich so contrast vars (_on_*) match the new colors.
          const design = (tpl.designSnapshot && Object.keys(tpl.designSnapshot).length)
            ? enrichDesignContrast({ ...baseDesign, ...tpl.designSnapshot })
            : baseDesign;
          const _copyMap = { ...COPY_DEFAULTS };
          const tenantCopy = {}; // authored copy only — seeds template blocks (no defaults)
          for (const item of rawCopy) {
            _copyMap[item.key] = item.value;
            if (item.value != null && item.value !== '') tenantCopy[item.key] = item.value;
          }
          const copy = localizeCopyMap(_copyMap, res.locals.locale);
          const blocks = (tpl.blocks || []).map(b => {
            const overrides = activeTemplate.contentOverrides?.[b.id] || {};
            const seeded = seedBlockFromCopy(b.type, tenantCopy);
            // template default < tenant's own copy < per-block override
            return { ...b, fields: { ...b.fields, ...seeded, ...overrides } };
          });
          await applyPipes({ db, tenant: req.tenant, design, copy, nodes: [blocks] });
          // blog blocks render the newest published posts (same query as the
          // standard layout's home blog section)
          let latestPosts = [];
          const blogBlock = blocks.find(b => b && b.type === 'blog');
          if (blogBlock) {
            const n = Math.min(6, Math.max(1, parseInt(blogBlock.fields?.count, 10) || 3));
            latestPosts = await db.collection('blog')
              .find({ status: 'published', contentType: { $in: ['blog', null] } })
              .sort({ publishedAt: -1 }).limit(n).toArray();
          }
          return res.render('template-live', {
            design, blocks, tpl, logos, brandModels, copy, navLinks, latestPosts,
            brand: res.locals.brand || {},
            visibility: buildVisibility(design),
            centralAuthUrl: config.DOMAIN + '/auth/login',
          });
        }
      }
    }

    const [rawCopy, reviews, portfolio, design, rawMedia, customSections, logos, brandModels, bookingSettingsDoc] = await Promise.all([
      db.collection('copy').find({}).toArray(),
      getReviews(db, req.tenant),
      db.collection('portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray(),
      getDesign(db),
      db.collection('section_media').find({}).toArray(),
      db.collection('custom_sections').find({ visible: { $ne: false } }).sort({ order: 1, createdAt: 1 }).toArray(),
      getBrandLogos(db),
      getBrandModels(db),
      db.collection('booking_settings').findOne({ key: 'config' }),
    ]);
    const bookingEnabled = bookingSettingsDoc?.value?.enabled === true;
    const _copyMap = { ...COPY_DEFAULTS };
    for (const item of rawCopy) _copyMap[item.key] = item.value;
    const copy = localizeCopyMap(_copyMap, res.locals.locale);
    const media = {};
    const mediaAlts = {};
    const mediaCaptions = {};
    for (const item of rawMedia) {
      media[item.key] = item.url;
      if (item.altText) mediaAlts[item.key] = item.altText;
      if (item.caption) mediaCaptions[item.key] = item.caption;
    }

    // Hydrate any Writer Feed sections with their tagged content before render.
    await attachWriterFeeds(db, customSections);

    // Resolve {{ }} content pipes across copy + custom sections (form embeds,
    // brand/design vars, etc). Mutates copy values + section strings in place.
    await applyPipes({ db, tenant: req.tenant, design, copy, nodes: [customSections, portfolio] });

    // Latest 3 blog posts for home page blog section
    const latestPosts = design.vis_blog === 'true'
      ? await db.collection('blog').find({ status: 'published', contentType: { $in: ['blog', null] } }).sort({ publishedAt: -1 }).limit(3).toArray()
      : [];

    // Allow preview_layout query param to override without saving
    const effectiveLayout = req.query.preview_layout || design.landing_layout;

    // Startup layout → use the templatized landing page (same data scope as index)
    const centralAuthUrl = config.DOMAIN + '/auth/login';

    if (effectiveLayout === 'startup') {
      return res.render('landing', {
        design: { ...design, landing_layout: effectiveLayout },
        copy, logos, brandModels, media, mediaAlts, mediaCaptions,
        reviews, portfolio, customSections,
        latestPosts, visibility: buildVisibility(design),
        contacted: req.query.contacted,
        centralAuthUrl,
        bookingEnabled: bookingEnabled || false,
      });
    }

    res.render('index', {
      copy, reviews, portfolio,
      design: { ...design, landing_layout: effectiveLayout },
      media, mediaAlts, mediaCaptions,
      visibility: buildVisibility(design),
      latestPosts, customSections, logos, brandModels,
      centralAuthUrl,
      bookingEnabled: bookingEnabled || false,
      harmonyServices: harmonyFor(req),
    });
  } catch (err) {
    console.error(err);
    res.render('index', {
      copy: COPY_DEFAULTS, reviews: null, portfolio: [],
      design: DESIGN_DEFAULTS, media: {}, mediaAlts: {}, mediaCaptions: {},
      visibility: buildVisibility(DESIGN_DEFAULTS),
      latestPosts: [], customSections: [], logos: {}, brandModels: {},
      centralAuthUrl: config.DOMAIN + '/auth/login',
      harmonyServices: harmonyFor(req),
    });
  }
});

// ── PUBLIC WRITER CONTENT (blog / newsletter / help) ────────────────────────
// Each public content type gets a parallel set of routes: an archive listing, a
// permalink page, RSS + Atom feeds, and a per-type email subscribe endpoint.
// Snippets are intentionally excluded — they're embed-only (see Writer Feed
// sections) and have no standalone page or feed.
const PUBLIC_CONTENT = [
  { type: 'blog',       base: '/blog',       label: 'Blog',        title: 'Insights & Resources', subtitle: 'Articles, guides, and updates.' },
  { type: 'newsletter', base: '/newsletter', label: 'Newsletter',  title: 'Newsletter',           subtitle: 'Issues and announcements — subscribe to get them in your inbox.' },
  { type: 'help',       base: '/help',       label: 'Help Center', title: 'Help & Guides',        subtitle: 'Answers, how-tos, and documentation.' },
];
// Legacy blog docs predate the contentType field — treat them as 'blog'.
const ctFilter = (type) => (type === 'blog' ? { $in: ['blog', null] } : type);
const absBase = (req, ct) => `${req.protocol}://${req.hostname}${ct.base}`;

function contentArchiveHandler(ct) {
  return async (req, res) => {
    try {
      const db = req.db;
      const [posts, design, rawCopy, logos, brandModels] = await Promise.all([
        db.collection('blog').find({ status: 'published', contentType: ctFilter(ct.type) }).sort({ publishedAt: -1 }).toArray(),
        getDesign(db),
        db.collection('copy').find({}).toArray(),
        getBrandLogos(db),
        getBrandModels(db),
      ]);
      const _copyMap = { ...COPY_DEFAULTS };
      for (const item of rawCopy) _copyMap[item.key] = item.value;
      const copy = localizeCopyMap(_copyMap, res.locals.locale);
      const brandName = req.tenant?.brand?.name || 'Home';
      const base = absBase(req, ct);
      res.setSeo?.({
        title: `${ct.label} — ${brandName}`,
        description: ct.subtitle,
        ogType: 'website',
        jsonLd: [{
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: `${brandName} ${ct.label}`,
          url: base,
          blogPost: posts.slice(0, 20).map(p => ({
            '@type': 'BlogPosting',
            headline: p.title,
            url: `${base}/${p.slug}`,
            datePublished: p.publishedAt || p.createdAt,
            ...(p.excerpt ? { description: p.excerpt } : {}),
          })),
        }],
      });
      res.render('blog/index', {
        posts, design, copy, logos, brandModels, ct,
        subscribed: req.query.subscribed, suberror: req.query.suberror,
        visibility: buildVisibility(design), centralAuthUrl: config.DOMAIN + '/auth/login',
      });
    } catch (err) {
      console.error(err);
      res.status(500).send(`Error loading ${ct.label}`);
    }
  };
}

function contentPermalinkHandler(ct) {
  return async (req, res, next) => {
    try {
      const db = req.db;
      const [post, design, rawCopy, logos, brandModels] = await Promise.all([
        db.collection('blog').findOne({ slug: req.params.slug, status: 'published', contentType: ctFilter(ct.type) }),
        getDesign(db),
        db.collection('copy').find({}).toArray(),
        getBrandLogos(db),
        getBrandModels(db),
      ]);
      // No matching item — fall through to the app-level 404 handler (no 404 view exists).
      if (!post) return next();
      const _copyMap = { ...COPY_DEFAULTS };
      for (const item of rawCopy) _copyMap[item.key] = item.value;
      const copy = localizeCopyMap(_copyMap, res.locals.locale);
      // Resolve {{ }} content pipes in the post body (e.g. {{youtube "…"}} embeds).
      await applyPipes({ db, tenant: req.tenant, design, copy, nodes: [post] });
      const brandName = req.tenant?.brand?.name || '';
      const postUrl = `${absBase(req, ct)}/${post.slug}`;
      res.setSeo?.({
        title: brandName ? `${post.title} — ${brandName}` : post.title,
        description: post.excerpt || post.metaDescription || '',
        canonical: postUrl,
        ogType: 'article',
        ogImage: post.ogImage || post.coverImage || post.heroImage || post.featuredImageUrl || (logos && (logos.logo_primary || logos.logo_white)) || '',
        jsonLd: [{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          url: postUrl,
          ...(post.excerpt ? { description: post.excerpt } : {}),
          ...((post.coverImage || post.heroImage || post.featuredImageUrl) ? { image: post.coverImage || post.heroImage || post.featuredImageUrl } : {}),
          datePublished: post.publishedAt || post.createdAt,
          dateModified: post.updatedAt || post.publishedAt || post.createdAt,
          ...(post.author ? { author: { '@type': 'Person', name: post.author } } : {}),
          publisher: {
            '@type': 'Organization',
            name: brandName || 'Slab',
            ...(logos && logos.logo_primary ? { logo: { '@type': 'ImageObject', url: logos.logo_primary } } : {}),
          },
          mainEntityOfPage: postUrl,
        }],
      });
      // Mint (or reuse) the short share link so the public Share button has a
      // stable, trackable URL. Best-effort — a share button is a bonus, never a
      // reason to fail the page.
      let shareUrl = postUrl;
      try {
        const link = await mintShareToken(db, {
          collection: 'blog', docId: post._id, slug: post.slug,
          contentType: ct.type, title: post.title,
          image: post.coverImage || post.heroImage || post.featuredImageUrl || post.ogImage || '',
        });
        if (link?.token) shareUrl = shareUrlFor(req, link.token);
      } catch (e) { console.warn('[share] mint failed (non-fatal):', e.message); }
      // Slides — a post can be wired to an asset folder; its images render as a
      // carousel/grid on the page. Best-effort: a slide-fetch failure never
      // blocks the post.
      let slides = [];
      if (post.slidesFolder) {
        try {
          const docs = await db.collection('assets')
            .find({ fileType: 'image', $or: [{ folders: post.slidesFolder }, { folder: post.slidesFolder }] })
            .sort({ uploadedAt: 1 }).toArray();
          slides = docs.map(a => ({ url: a.publicUrl, thumb: a.thumbUrl || a.publicUrl, alt: a.altText || a.title || '', caption: a.caption || '' }));
        } catch (e) { console.warn('[blog] slides fetch failed (non-fatal):', e.message); }
      }
      res.render('blog/post', { post, design, copy, logos, brandModels, ct, shareUrl, slides, visibility: buildVisibility(design), centralAuthUrl: config.DOMAIN + '/auth/login' });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading post');
    }
  };
}

function contentFeedHandler(ct, fmt) {
  return async (req, res) => {
    try {
      const db = req.db;
      const posts = await db.collection('blog')
        .find({ status: 'published', contentType: ctFilter(ct.type) })
        .sort({ publishedAt: -1 })
        .limit(50)
        .toArray();
      const brandName = req.tenant?.brand?.name || 'Home';
      const siteUrl = absBase(req, ct);
      const feedUrl = `${siteUrl}/feed.${fmt}`;
      const items = posts.map(p => ({
        title: p.title,
        url: `${siteUrl}/${p.slug}`,
        excerpt: p.excerpt || '',
        content: p.content || '',
        category: p.category || '',
        publishedAt: p.publishedAt || p.createdAt,
        updatedAt: p.updatedAt || p.publishedAt || p.createdAt,
      }));
      const opts = { title: `${brandName} ${ct.label}`, description: ct.subtitle, siteUrl, feedUrl, authorName: brandName, items };
      const xml = fmt === 'atom' ? buildAtomFeed(opts) : buildRssFeed(opts);
      res.type(fmt === 'atom' ? 'application/atom+xml' : 'application/rss+xml').send(xml);
    } catch (err) {
      console.error('[feed] error:', err);
      res.status(500).send('Error generating feed');
    }
  };
}

function contentSubscribeHandler(ct) {
  return async (req, res) => {
    const wantsJson = (req.get('accept') || '').includes('application/json')
      || req.xhr || req.get('x-requested-with') === 'XMLHttpRequest';
    try {
      // Honeypot — pretend success.
      if ((req.body._hp || req.body.website || '').trim()) {
        return wantsJson ? res.json({ ok: true, status: 'ignored', message: 'Thanks!' }) : res.redirect(`${ct.base}?subscribed=1`);
      }
      if (!req.db) {
        const m = 'Subscription is not available here.';
        return wantsJson ? res.json({ ok: false, status: 'error', message: m }) : res.redirect(`${ct.base}?suberror=1`);
      }
      const result = await captureLead({
        db: req.db, tenant: req.tenant,
        email: req.body.email, name: (req.body.name || '').trim(),
        funnel: 'subscriber', tags: [ct.type], source: `${ct.type}-archive`, optIn: 'double',
      });
      const ok = result.status !== 'invalid';
      if (wantsJson) return res.json({ ok, status: result.status, message: result.message });
      return res.redirect(`${ct.base}?${ok ? 'subscribed' : 'suberror'}=1`);
    } catch (err) {
      console.error(`[subscribe:${ct.type}] error:`, err);
      if (wantsJson) return res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
      return res.redirect(`${ct.base}?suberror=1`);
    }
  };
}

// Register routes per type. Feed + subscribe routes are registered BEFORE the
// `:slug` permalink so "feed.rss" / "subscribe" aren't swallowed as a slug.
for (const ct of PUBLIC_CONTENT) {
  router.get(ct.base, contentArchiveHandler(ct));
  router.get(`${ct.base}/feed.rss`, contentFeedHandler(ct, 'rss'));
  router.get(`${ct.base}/feed.atom`, contentFeedHandler(ct, 'atom'));
  router.post(`${ct.base}/subscribe`, contentSubscribeHandler(ct));
  router.get(`${ct.base}/:slug`, contentPermalinkHandler(ct));
}

// ── Digital Business Card ─────────────────────────────────────────────────
router.get('/card/:slug', async (req, res, next) => {
  try {
    const db = req.db;
    const link = await db.collection('qr_links').findOne({ slug: req.params.slug, type: 'business-card' });
    if (!link) return next();

    // Track scan
    db.collection('qr_links').updateOne({ _id: link._id }, { $inc: { scanCount: 1 } }).catch(() => {});

    const [design, logoRow] = await Promise.all([
      getDesign(db),
      db.collection('brand_images').findOne({ slot: 'logo_primary' }),
    ]);

    const brand = req.tenant?.brand || {};
    const logo = logoRow?.url || '';
    const domain = req.hostname;
    const websiteUrl = `https://${domain}`;

    // Resolve the card's chosen template + color scheme (saved on the link),
    // with ?tpl=/?scheme= query overrides so the admin can live-preview.
    const saved = normalizeCard(link.card || {});
    const template = CARD_TEMPLATES[req.query.tpl] ? req.query.tpl : saved.template;
    const schemeKey = CARD_SCHEMES[req.query.scheme] ? req.query.scheme : saved.scheme;
    const scheme = resolveScheme(schemeKey, design);

    // Generate QR code in the card's primary color
    const qrDataUrl = await QRCode.toDataURL(websiteUrl, {
      width: 300, margin: 2,
      color: { dark: scheme.primary, light: '#ffffff' },
    });

    res.render('card', {
      brand, design, logo, qrDataUrl, websiteUrl,
      slug: req.params.slug, template, scheme,
    });
  } catch (err) {
    console.error('[Card] render error:', err);
    next();
  }
});

// Card scan tracker (fire-and-forget from client JS)
router.post('/card/:slug/scan', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('qr_links').updateOne(
      { slug: req.params.slug },
      { $inc: { scanCount: 1 } },
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

// PWA manifest for add-to-home-screen
router.get('/card/:slug/manifest.json', async (req, res) => {
  try {
    const db = req.db;
    const brand = req.tenant?.brand || {};
    const design = await getDesign(db);
    const logoRow = await db.collection('brand_images').findOne({ slot: 'logo_primary' });
    const icons = logoRow ? [{ src: logoRow.url, sizes: '192x192', type: 'image/png' }] : [];

    res.json({
      name: brand.name || 'Business Card',
      short_name: (brand.name || 'Card').slice(0, 12),
      description: brand.tagline || brand.businessType || '',
      start_url: `/card/${req.params.slug}`,
      display: 'standalone',
      background_color: design.color_primary_deep || '#0F1B30',
      theme_color: design.color_primary || '#1C2B4A',
      icons,
    });
  } catch {
    res.status(500).json({ error: 'manifest error' });
  }
});

// ── Newsletter signup (footer signup bar) ──────────────────────────────────
// Double opt-in by default. Accepts both AJAX (returns JSON) and plain-form
// (redirects) submissions. The footer bar posts via fetch and shows the message
// inline; a no-JS fallback redirects home with a flash query.
router.post('/api/newsletter', async (req, res) => {
  const wantsJson = (req.get('accept') || '').includes('application/json')
    || req.xhr || req.get('x-requested-with') === 'XMLHttpRequest';
  try {
    // Honeypot: real users never fill a hidden field. Pretend success.
    if ((req.body._hp || req.body.website || '').trim()) {
      return wantsJson ? res.json({ ok: true, status: 'ignored', message: 'Thanks!' })
                       : res.redirect('/?subscribed=1#footer');
    }
    if (!req.db) {
      const m = 'Newsletter signup is not available here.';
      return wantsJson ? res.json({ ok: false, status: 'error', message: m }) : res.redirect('/?suberror=1#footer');
    }
    const result = await captureLead({
      db: req.db, tenant: req.tenant,
      email: req.body.email, name: (req.body.name || '').trim(),
      funnel: 'lead', tags: ['newsletter'], source: 'site-footer', optIn: 'double',
    });
    const ok = result.status !== 'invalid';
    if (wantsJson) return res.json({ ok, status: result.status, message: result.message });
    return res.redirect(`/?${ok ? 'subscribed' : 'suberror'}=1#footer`);
  } catch (err) {
    console.error('[newsletter] signup error:', err);
    if (wantsJson) return res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
    return res.redirect('/?suberror=1#footer');
  }
});

// ── Footer QR links API (for public views) ─────────────────────────────────
router.get('/api/footer-qr', async (req, res) => {
  try {
    const db = req.db;
    const links = await db.collection('qr_links').find({ showInFooter: true }).toArray();
    const design = {};
    const rows = await db.collection('design').find({ key: 'color_primary' }).toArray();
    for (const r of rows) design[r.key] = r.value;

    const results = await Promise.all(links.map(async (link) => {
      const dataUrl = await QRCode.toDataURL(link.url, {
        width: 120, margin: 1,
        color: { dark: '#ffffff', light: 'rgba(0,0,0,0)' },
      });
      return { label: link.label, url: link.url, slug: link.slug, type: link.type, dataUrl };
    }));

    res.json({ links: results });
  } catch { res.json({ links: [] }); }
});

// Connected-social "follow us" links for the tenant footer. One icon per social
// account the tenant has linked (with a resolvable public profile URL). Fetched
// client-side by partials/footer.ejs so every render path gets them for free.
router.get('/api/footer-social', async (req, res) => {
  try {
    const links = await getPublicSocialLinks(req.db);
    res.json({ links });
  } catch { res.json({ links: [] }); }
});

// Front-end error sink — the browser posts uncaught JS errors here (see
// public/js/errorReporter.js). Public + unauthenticated (errors happen on public
// tenant sites too), rate-limited to blunt abuse, always 204 so the reporter
// never retries or surfaces anything to the visitor.
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: false, legacyHeaders: false,
  handler: (req, res) => res.status(204).end(),
});
router.post('/api/client-error', clientErrorLimiter, express.json({ limit: '16kb' }), (req, res) => {
  recordClientError(req.body || {}, req);
  res.status(204).end();
});

// Dynamic pages — must be last
router.get('/:slug', async (req, res, next) => {
  // No tenant db (scanner/probe traffic, unresolved host, or a tenant DB that's
  // momentarily unavailable) → there is no page to serve. Skip straight to 404
  // instead of throwing on db.collection and dumping a stack trace per hit.
  if (!req.db) return next();
  try {
    const db = req.db;
    const [pg, design, logos] = await Promise.all([
      db.collection('pages').findOne({ slug: req.params.slug, status: 'published' }),
      getDesign(db),
      getBrandLogos(db),
    ]);
    if (!pg) return next();

    // Resolve {{ }} content pipes in the page body (e.g. {{youtube "…"}} embeds).
    await applyPipes({ db, tenant: req.tenant, design, nodes: [pg] });

    const brandName = req.tenant?.brand?.name || '';
    const pgUrl = `${req.protocol}://${req.hostname}/${pg.slug}`;
    res.setSeo?.({
      title: brandName
        ? `${pg.metaTitle || pg.title} — ${brandName}`
        : (pg.metaTitle || pg.title),
      description: pg.metaDescription || '',
      canonical: pg.canonicalUrl || pgUrl,
      robots: pg.robotsMeta || undefined,
      ogImage: pg.ogImage || '',
      ogType: 'website',
      jsonLd: [{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: pg.title,
        url: pgUrl,
        ...(pg.metaDescription ? { description: pg.metaDescription } : {}),
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${req.protocol}://${req.hostname}/` },
            { '@type': 'ListItem', position: 2, name: pg.title, item: pgUrl },
          ],
        },
      }],
    });

    // Unified render: a page is always a block stack. Legacy content/data-list
    // pages are migrated in memory so there is one render path. applyPipes (above)
    // already resolved {{ }} in html-block text; hydrate data BELOW that so items'
    // Date/ObjectId values never reach the pipe scanner.
    pg.blocks = synthesizeLegacyBlocks(pg);

    // Build a query-string helper the view uses for pagination links: clone the
    // full query, override one param, drop empties — so paginating one datalist
    // block preserves every OTHER block's page.
    const pageHref = (param, value) => {
      const q = { ...req.query, [param]: value };
      const qs = Object.entries(q)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      return qs ? `?${qs}` : '?';
    };

    // Hydrate every datalist block. Multiple lists paginate independently: the
    // first uses ?p= (preserves existing bookmarks), the rest ?p2=, ?p3=, …
    const portfolioModalItems = [];
    let datalistOrdinal = 0;
    for (const block of pg.blocks) {
      if (!block || block.type !== 'datalist') continue;
      const f = block.fields || {};
      const paginate = f.paginate === 'true' || f.paginate === true;
      const pageParam = datalistOrdinal === 0 ? 'p' : `p${datalistOrdinal + 1}`;
      datalistOrdinal++;
      const perPage = Math.min(Math.max(parseInt(f.pageSize) || 9, 1), 100);
      const p = paginate ? Math.max(1, parseInt(req.query[pageParam]) || 1) : 1;
      try {
        const { items, total, source } = await runSource(db, f.source, { page: p, perPage, group: f.group || '' });
        const totalPages = paginate ? Math.ceil(total / perPage) : 1;
        block._data = { items, p, totalPages, perPage, source, pageParam, paginate, kind: items[0]?.kind || 'link' };
        for (const it of items) if (it.kind === 'modal') portfolioModalItems.push(it.raw);
      } catch (e) {
        console.warn('[pages] datalist hydrate failed:', e.message);
        block._data = { items: [], p: 1, totalPages: 1, perPage, source: f.source, pageParam, paginate, kind: 'link' };
      }
    }

    res.render('page', {
      pg, design, logos,
      pageHref, portfolioModalItems,
      visibility: buildVisibility(design),
      centralAuthUrl: config.DOMAIN + '/auth/login',
    });
  } catch (err) {
    console.error(err);
    next();
  }
});

export default router;
