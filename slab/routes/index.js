import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../plugins/mongo.js';
import { getReviews } from '../plugins/reviews.js';
import { shareTargetPath, shareUrlFor, mintShareToken } from '../plugins/shareLink.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { SERVICES, INFRA_SERVICES } from '../plugins/serviceRegistry.js';

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
import { normalizeEmail } from '../plugins/emailNormalize.js';
import { checkGlobalSpam } from '../plugins/globalSpam.js';
import { captureLead } from '../plugins/subscribe.js';
import { buildRssFeed, buildAtomFeed } from '../plugins/feeds.js';

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
};

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
router.post('/contact', async (req, res) => {
  try {
    const db = req.db;
    const { name, firstName, lastName, email, company, service, message } = req.body;
    const contactName = name || [firstName, lastName].filter(Boolean).join(' ') || '';

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
    const STOCK_KEYS = new Set(['name', 'firstName', 'lastName', 'email', 'company', 'service', 'message']);
    const customFields = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (STOCK_KEYS.has(k) || k.startsWith('_')) continue;
      if (typeof v === 'string' && v.trim()) customFields[k] = v.trim().slice(0, 2000);
    }

    const inquiry = {
      name: contactName.trim(),
      email: email.toLowerCase().trim(),
      company: company?.trim() || '',
      service: service?.trim() || '',
      message: message?.trim() || '',
      customFields,
      tenantDomain: req.tenant?.domain || '',
      createdAt: new Date(),
    };
    if (globalFlag.hit) {
      inquiry.status = 'spam';
      inquiry.spamFiltered = { scope: 'global', type: globalFlag.type, key: globalFlag.key, at: new Date() };
    }
    await db.collection('inquiries').insertOne(inquiry);

    // Globally-filtered submissions land in the Spam tab silently — don't ping
    // the admin or forward to the tenant mailbox.
    if (globalFlag.hit) return res.redirect('/?contacted=1#contact');

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

    // ── Resolve homepage source ──
    // Priority is driven by design.home_source so the /admin/design panel can
    // explicitly switch between custom EJS, slab template, and standard layout.
    const sub = req.tenant?.meta?.subdomain;
    const tenantHome = sub ? path.join(TENANT_VIEWS_ROOT, sub, 'home.ejs') : null;
    const hasCustomEjs = !!(tenantHome && fs.existsSync(tenantHome));
    const designSource = (await db.collection('design').findOne({ key: 'home_source' }))?.value || 'auto';

    const wantCustom   = designSource === 'custom'   || (designSource === 'auto' && hasCustomEjs);
    const wantTemplate = designSource === 'template' || (designSource === 'auto' && !hasCustomEjs);

    // ── Tenant-specific home.ejs override ──
    if (wantCustom && hasCustomEjs) {
      const [design, logos, brandModels, rawCopy] = await Promise.all([
        getDesign(db),
        getBrandLogos(db),
        getBrandModels(db),
        db.collection('copy').find({}).toArray(),
      ]);
      const copy = { ...COPY_DEFAULTS };
      for (const item of rawCopy) copy[item.key] = item.value;
      return res.render(`tenants/${sub}/home`, {
        design, logos, brandModels, copy,
        brand: res.locals.brand || {},
        tenant: req.tenant,
        visibility: buildVisibility(design),
        centralAuthUrl: config.DOMAIN + '/auth/login',
      });
    }

    // ── Active template override ──
    if (wantTemplate || designSource === 'template') {
      const activeTemplate = await db.collection('active_template').findOne({});
      if (activeTemplate) {
        const tpl = await db.collection('templates').findOne({ _id: activeTemplate.templateId });
        if (tpl) {
          const [design, logos, brandModels, rawCopy, navLinks] = await Promise.all([
            getDesign(db),
            getBrandLogos(db),
            getBrandModels(db),
            db.collection('copy').find({}).toArray(),
            db.collection('nav_links').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
          ]);
          const copy = { ...COPY_DEFAULTS };
          for (const item of rawCopy) copy[item.key] = item.value;
          const blocks = (tpl.blocks || []).map(b => {
            const overrides = activeTemplate.contentOverrides?.[b.id] || {};
            return { ...b, fields: { ...b.fields, ...overrides } };
          });
          return res.render('template-live', {
            design, blocks, tpl, logos, brandModels, copy, navLinks,
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
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
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
      const copy = { ...COPY_DEFAULTS };
      for (const item of rawCopy) copy[item.key] = item.value;
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
      const copy = { ...COPY_DEFAULTS };
      for (const item of rawCopy) copy[item.key] = item.value;
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

    // Generate QR code pointing to the tenant's website
    const qrDataUrl = await QRCode.toDataURL(websiteUrl, {
      width: 300, margin: 2,
      color: { dark: design.color_primary || '#1C2B4A', light: '#ffffff' },
    });

    res.render('card', {
      brand, design, logo, qrDataUrl, websiteUrl,
      slug: req.params.slug,
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

    // Data-list pages: fetch paginated collection
    if (pg.pageType === 'data-list') {
      const ALLOWED = ['blog', 'portfolio'];
      const col     = ALLOWED.includes(pg.dataCollection) ? pg.dataCollection : 'blog';
      const perPage = Math.min(Math.max(parseInt(pg.dataPageSize) || 9, 1), 100);
      const p       = Math.max(1, parseInt(req.query.p) || 1);
      const skip    = (p - 1) * perPage;
      // Portfolio items don't have a draft workflow — treat anything not explicitly drafted as visible.
      // Blog posts do have draft/published, so keep the strict filter there.
      const query   = col === 'portfolio'
        ? { status: { $ne: 'draft' } }
        : { status: 'published', contentType: { $in: ['blog', null] } };
      if (col === 'portfolio' && pg.dataGroup) query.group = pg.dataGroup;
      const [total, items] = await Promise.all([
        db.collection(col).countDocuments(query),
        db.collection(col).find(query).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(perPage).toArray(),
      ]);
      const totalPages = Math.ceil(total / perPage);
      return res.render('page', { pg, design, logos, items, p, totalPages, perPage, col, visibility: buildVisibility(design), centralAuthUrl: config.DOMAIN + '/auth/login' });
    }

    res.render('page', { pg, design, logos, items: null, p: 1, totalPages: 1, perPage: 9, col: null, visibility: buildVisibility(design), centralAuthUrl: config.DOMAIN + '/auth/login' });
  } catch (err) {
    console.error(err);
    next();
  }
});

export default router;
