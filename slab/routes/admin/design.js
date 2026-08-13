import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { brandUpload, modelUpload } from '../../middleware/upload.js';
import { callLLM, tryParseAgentResponse, webSearch } from '../../plugins/agentMcp.js';
import { agentLLMOpts } from '../../plugins/agentRegistry.js';
import { recordAgentFeedback } from '../../plugins/observe.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { enrichDesignContrast } from '../../plugins/colorContrast.js';
import { CUSTOM_TEMPLATES } from './sections.js';
import { config } from '../../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_VIEWS_ROOT = path.resolve(__dirname, '..', '..', 'views', 'tenants');

const router = express.Router();

// Design schema (DESIGN_DEFAULTS / THEME_KEYS / COPY_SECTIONS) lives in
// config/schema.js so sections.js can import it without a cycle. Imported for
// local use and re-exported so existing `from ./design.js` /
// `from ../admin/design.js` imports keep working.
import { DESIGN_DEFAULTS, THEME_KEYS, COPY_SECTIONS } from '../../config/schema.js';
export { DESIGN_DEFAULTS, THEME_KEYS, COPY_SECTIONS };

router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [rawDesign, brandImages, themes, brandModels, rawCopy, templates, activeTemplate, navLinks, customSections] = await Promise.all([
      db.collection('design').find({}).toArray(),
      db.collection('brand_images').find({}).sort({ slot: 1, uploadedAt: -1 }).toArray(),
      db.collection('themes').find({}).sort({ createdAt: -1 }).toArray(),
      db.collection('brand_models').find({}).sort({ slot: 1 }).toArray(),
      db.collection('copy').find({}).toArray(),
      db.collection('templates').find({}).sort({ updatedAt: -1 }).toArray(),
      db.collection('active_template').findOne({}),
      db.collection('nav_links').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
      db.collection('custom_sections').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
    ]);
    const design = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) design[item.key] = item.value;
    const enriched = enrichDesignContrast(design);
    const copy = {};
    for (const item of rawCopy) copy[item.key] = item.value;
    const sub = req.tenant?.meta?.subdomain;
    const customEjsPath = sub ? path.join(TENANT_VIEWS_ROOT, sub, 'home.ejs') : null;
    const hasCustomEjs = !!(customEjsPath && fs.existsSync(customEjsPath));

    res.render('admin/design/index', {
      user: req.adminUser, page: 'design', title: 'Design & Content',
      design: enriched, brandImages, themes, brandModels, copy, copySections: COPY_SECTIONS,
      templates, activeTemplateId: activeTemplate?.templateId?.toString() || null,
      navLinks, customSections, sectionTemplates: CUSTOM_TEMPLATES,
      hasCustomEjs, tenantSubdomain: sub || '',
      saved: req.query.saved === '1', error: req.query.error === '1',
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const now = new Date();

    // Save design fields
    const designOps = Object.keys(DESIGN_DEFAULTS).map(key => {
      const isBool = key.startsWith('vis_') || key.startsWith('model_')
        || key === 'snap_enabled' || key === 'gradient_enabled'
        || key === 'cookie_consent_enabled'
        || key === 'card_hover_accent' || key === 'ticker_uppercase'
        || key === 'header_sticky' || key === 'header_blur' || key === 'header_shadow'
        || key === 'footer_show_brand' || key === 'footer_show_tagline'
        || key === 'footer_show_logo' || key === 'footer_show_social'
        || key === 'footer_show_newsletter' || key === 'footer_show_qr'
        || key === 'hero_slideshow_dots' || key === 'hero_slideshow_arrows'
        || key === 'hero_slideshow_static'
        || key === 'hero_card_shadow';
      const value = isBool
        ? ((req.body[key] === 'on' || req.body[key] === 'true') ? 'true' : 'false')
        : (req.body[key] !== undefined && req.body[key] !== '' ? req.body[key] : DESIGN_DEFAULTS[key]);
      return db.collection('design').updateOne(
        { key },
        { $set: { key, value, updatedAt: now } },
        { upsert: true }
      );
    });

    // Save copy fields. Known fixed keys from COPY_SECTIONS plus any dynamic
    // repeater keys (service{N}_*, process{N}_*, about_stat{N}_*,
    // pricing_tier{N}_*) that the UI added at runtime.
    const COPY_CHECKBOXES = ['promo_enabled', 'pricing_tier3_featured',
      'contact_fname_hidden', 'contact_lname_hidden', 'contact_email_hidden',
      'contact_company_hidden', 'contact_service_hidden', 'contact_message_hidden',
      'contact_optin_hidden'];
    const allCopyKeys = Object.values(COPY_SECTIONS).flat();
    const REPEATER_PATTERNS = [
      /^service\d+_(title|desc|link|image|hidden)$/,
      /^process\d+_(title|desc|hidden)$/,
      /^about_stat\d+_(num|label|hidden)$/,
      /^pricing_tier\d+_(amount|unit|label|equiv|cta_link|featured)$/,
      /^contact_field\d+_(name|label|placeholder|type|required|options)$/,
      /^slide\d+_(image|heading|sub|eyebrow|link|cta|tag|vpos)$/,
    ];
    const isRepeaterKey = (k) => REPEATER_PATTERNS.some(rx => rx.test(k));

    const dynamicKeys = Object.keys(req.body).filter(isRepeaterKey);

    // Per-card visibility checkboxes (service{N}_hidden, process{N}_hidden,
    // about_stat{N}_hidden) submit nothing when unchecked, so derive the active
    // card set from any present field for that index and force-write the flag.
    const VIS_TOGGLE_PREFIXES = ['service', 'process', 'about_stat'];
    const isHiddenToggle = (k) => /_hidden$/.test(k) && isRepeaterKey(k);
    const visToggleKeys = new Set();
    for (const k of Object.keys(req.body)) {
      for (const p of VIS_TOGGLE_PREFIXES) {
        const m = k.match(new RegExp('^' + p + '(\\d+)_'));
        if (m) { visToggleKeys.add(p + m[1] + '_hidden'); break; }
      }
    }

    const writeKeys = new Set([
      ...allCopyKeys.filter(k => req.body[k] !== undefined || COPY_CHECKBOXES.includes(k)),
      ...dynamicKeys,
      ...visToggleKeys,
    ]);
    const copyOps = [...writeKeys].map(key => {
      const value = isHiddenToggle(key)
        ? (req.body[key] ? 'true' : '')
        : (req.body[key] || '');
      return db.collection('copy').updateOne(
        { key },
        { $set: { key, value, updatedAt: now } },
        { upsert: true }
      );
    });

    // Explicit removals — JS appends to a hidden _keys_to_remove[] field when
    // the user clicks × on a repeater row. Defensive prefix check to avoid
    // arbitrary copy deletion through this channel.
    let removalKeys = [];
    if (Array.isArray(req.body._keys_to_remove)) removalKeys = req.body._keys_to_remove;
    else if (typeof req.body._keys_to_remove === 'string' && req.body._keys_to_remove) removalKeys = [req.body._keys_to_remove];
    const removalOps = removalKeys.filter(isRepeaterKey).map(key => db.collection('copy').deleteOne({ key }));

    await Promise.all([...designOps, ...copyOps, ...removalOps]);
    res.redirect('/admin/design?saved=1');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/design?error=1');
  }
});

// ── Upload brand image ──
router.post('/images', brandUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const slot = req.body.slot; // logo_primary, logo_white, logo_icon, banner, support
    const label = req.body.label || slot;
    const url = req.file?.location || req.file?.path;
    if (!url) return res.redirect('/admin/design?error=1');

    await db.collection('brand_images').updateOne(
      { slot },
      { $set: { slot, label, url, originalName: req.file.originalname, uploadedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[Design] Brand image uploaded: ${slot} → ${url}`);
    res.redirect('/admin/design?saved=1#brand-images');
  } catch (err) {
    console.error('Brand image upload error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ── Upload extra support image (multiple allowed) ──
router.post('/images/support', brandUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const label = req.body.label || 'Untitled';
    const url = req.file?.location || req.file?.path;
    if (!url) return res.redirect('/admin/design?error=1');

    await db.collection('brand_images').insertOne({
      slot: 'support',
      label,
      url,
      originalName: req.file.originalname,
      uploadedAt: new Date(),
    });

    console.log(`[Design] Support image uploaded: ${label} → ${url}`);
    res.redirect('/admin/design?saved=1#brand-images');
  } catch (err) {
    console.error('Support image upload error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ── Delete brand image ──
router.post('/images/:id/delete', async (req, res) => {
  try {
    const { ObjectId } = await import('mongodb');
    const db = req.db;
    await db.collection('brand_images').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/design?saved=1#brand-images');
  } catch (err) {
    console.error('Brand image delete error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ── Toggle 3D model enable/disable (AJAX) ──
router.post('/toggle-model', async (req, res) => {
  try {
    const db = req.db;
    const { key, value } = req.body;
    if (!['model_header_enabled', 'model_logo_enabled'].includes(key)) return res.status(400).json({ error: 'Invalid key' });
    await db.collection('design').updateOne(
      { key },
      { $set: { key, value: value === 'true' ? 'true' : 'false', updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Toggle model error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Save single design key (for live preview layout/vis changes) ──
router.post('/key', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || !DESIGN_DEFAULTS.hasOwnProperty(key)) return res.status(400).json({ error: 'Invalid key' });
    await req.db.collection('design').updateOne(
      { key },
      { $set: { key, value: String(value ?? ''), updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Design key save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Save single copy key (granular, for the in-preview canvas editor) ──────────
// Copy otherwise only saves via the bulk POST /admin/design form. The canvas
// editor commits one field at a time (on blur), so it needs a granular endpoint.
// Any string key is allowed (copy is free-form per tenant, incl. dynamic repeater
// keys like service5_title); value is coerced to a string and length-capped.
router.post('/copy-key', async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key || !/^[a-zA-Z0-9_]+$/.test(key) || key.length > 80) {
      return res.status(400).json({ error: 'Invalid copy key' });
    }
    const value = String(req.body.value ?? '').slice(0, 20000);
    await req.db.collection('copy').updateOne(
      { key },
      { $set: { key, value, updatedAt: new Date() } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Copy key save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Upload 3D model (header or logo slot) ──
router.post('/models', modelUpload.single('model'), async (req, res) => {
  try {
    const db = req.db;
    const slot = req.body.slot; // model_header or model_logo
    if (!['model_header', 'model_logo'].includes(slot)) return res.redirect('/admin/design?error=1');
    const label = req.body.label || slot;
    const url = req.file?.location || req.file?.path;
    if (!url) return res.redirect('/admin/design?error=1');

    await db.collection('brand_models').updateOne(
      { slot },
      { $set: { slot, label, url, originalName: req.file.originalname, uploadedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[Design] 3D model uploaded: ${slot} → ${url}`);
    res.redirect('/admin/design?saved=1#brand-models');
  } catch (err) {
    console.error('3D model upload error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ── Delete 3D model ──
router.post('/models/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('brand_models').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/design?saved=1#brand-models');
  } catch (err) {
    console.error('3D model delete error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ── API: list brand images (for campaign builder) ──
router.get('/images/api', async (req, res) => {
  const db = req.db;
  const images = await db.collection('brand_images').find({}).sort({ slot: 1, uploadedAt: -1 }).toArray();
  res.json({ images });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEMES — save / apply / delete
// ═══════════════════════════════════════════════════════════════════════════════

// Save current settings as a named theme
router.post('/themes', async (req, res) => {
  try {
    const db = req.db;
    const name = (req.body.theme_name || '').trim();
    if (!name) return res.redirect('/admin/design?error=1');

    // Read current design values
    const rawDesign = await db.collection('design').find({}).toArray();
    const current = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) current[item.key] = item.value;

    // Extract only theme-relevant keys
    const settings = {};
    for (const k of THEME_KEYS) settings[k] = current[k];

    await db.collection('themes').insertOne({
      name,
      settings,
      createdAt: new Date(),
    });

    console.log(`[Design] Theme saved: "${name}"`);
    res.redirect('/admin/design?saved=1#themes');
  } catch (err) {
    console.error('Theme save error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// Apply a saved theme
router.post('/themes/:id/apply', async (req, res) => {
  try {
    const db = req.db;
    const theme = await db.collection('themes').findOne({ _id: new ObjectId(req.params.id) });
    if (!theme) return res.redirect('/admin/design?error=1');

    const ops = Object.entries(theme.settings).map(([key, value]) =>
      db.collection('design').updateOne(
        { key },
        { $set: { key, value, updatedAt: new Date() } },
        { upsert: true }
      )
    );
    await Promise.all(ops);

    console.log(`[Design] Theme applied: "${theme.name}"`);
    res.redirect('/admin/design?saved=1');
  } catch (err) {
    console.error('Theme apply error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// Delete a saved theme
router.post('/themes/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('themes').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/design?saved=1#themes');
  } catch (err) {
    console.error('Theme delete error:', err);
    res.redirect('/admin/design?error=1');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NAV LINKS — header/footer custom links (in addition to auto-populated pages)
// Stored in tenant `nav_links` collection: { label, url, location, target, order }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/links', async (req, res) => {
  try {
    const { label, url, location, target, _id } = req.body;
    const cleanLabel = (label || '').trim().slice(0, 60);
    const cleanUrl = (url || '').trim().slice(0, 500);
    const cleanLocation = ['header', 'footer', 'both'].includes(location) ? location : 'both';
    const cleanTarget = target === '_blank' ? '_blank' : '_self';
    if (!cleanLabel || !cleanUrl) return res.redirect('/admin/design?error=1#links');

    const db = req.db;
    if (_id) {
      await db.collection('nav_links').updateOne(
        { _id: new ObjectId(_id) },
        { $set: { label: cleanLabel, url: cleanUrl, location: cleanLocation, target: cleanTarget, updatedAt: new Date() } },
      );
    } else {
      const last = await db.collection('nav_links').find({}).sort({ order: -1 }).limit(1).toArray();
      const nextOrder = last[0]?.order != null ? last[0].order + 1 : 0;
      await db.collection('nav_links').insertOne({
        label: cleanLabel, url: cleanUrl, location: cleanLocation, target: cleanTarget,
        order: nextOrder, createdAt: new Date(), updatedAt: new Date(),
      });
    }
    res.redirect('/admin/design?saved=1#links');
  } catch (err) {
    console.error('Nav link save error:', err);
    res.redirect('/admin/design?error=1#links');
  }
});

router.post('/links/:id/delete', async (req, res) => {
  try {
    await req.db.collection('nav_links').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/design?saved=1#links');
  } catch (err) {
    console.error('Nav link delete error:', err);
    res.redirect('/admin/design?error=1#links');
  }
});

router.post('/links/reorder', async (req, res) => {
  try {
    let order = [];
    try { order = JSON.parse(req.body.orderJson || '[]'); } catch {}
    const ops = order.map((id, i) =>
      req.db.collection('nav_links').updateOne({ _id: new ObjectId(id) }, { $set: { order: i } }),
    );
    await Promise.all(ops);
    res.json({ ok: true });
  } catch (err) {
    console.error('Nav link reorder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: get theme settings (for live preview)
router.get('/themes/:id/json', async (req, res) => {
  try {
    const db = req.db;
    const theme = await db.collection('themes').findOne({ _id: new ObjectId(req.params.id) });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    res.json(theme);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: current design as JSON (for preview iframe override)
router.get('/api/current', async (req, res) => {
  try {
    const db = req.db;
    const rawDesign = await db.collection('design').find({}).toArray();
    const design = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) design[item.key] = item.value;
    res.json(design);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN AGENT — specialist agent for design, content & layout
//
// The agent's field catalog is not hand-maintained here. The panel posts the
// fields it is actually rendering (name/tab/section/label/type), so the catalog
// IS the left bar — dynamic repeater rows and custom sections included, with no
// drift as the panel grows. This route's job is to scope that catalog down to
// something a 7B model can reason about, which is what the throttle controls.
// ═══════════════════════════════════════════════════════════════════════════════

const TAB_LABELS = { design: 'Design', copy: 'Content', source: 'Layout' };

// Throttle = variety AND depth of change. It sets both how much of the panel the
// agent is shown and how many fields it is allowed to touch in one pass, so a
// "light" ask can't quietly turn into a site-wide repaint.
// Catalog character budgets. The house model (qwen2.5:7b) advertises a 32k
// window but Ollama's *runtime* num_ctx defaults to 4096 and can't be set over
// the OpenAI-compatible endpoint, so an over-long prompt is silently truncated
// from the front — which would quietly lop off the response format and brand
// context and leave the agent babbling. These budgets keep the worst case
// (fixed prompt ≈ 4.3k chars + catalog + reply headroom) inside 4096 tokens.
// Raise them only alongside a verified OLLAMA_CONTEXT_LENGTH increase.
const THROTTLE_LEVELS = {
  light: {
    label: 'Light',
    maxFields: 6,
    tabs: 'active',
    budget: 2000,
    guidance: 'LIGHT THROTTLE: change ONE dimension only (e.g. just the palette, or just the headline). '
      + 'Touch at most 6 fields. Stay close to the current values — nudge, do not replace. '
      + 'Do not touch layout, section visibility, or fields outside the active tab.',
  },
  balanced: {
    label: 'Balanced',
    maxFields: 18,
    tabs: 'active+',
    budget: 4500,
    guidance: 'BALANCED THROTTLE: change 2-3 related dimensions (e.g. palette + type + the hero copy that sits on them). '
      + 'Touch at most 18 fields. Keep the existing structure — restyle and rewrite, but do not reorder or hide sections.',
  },
  full: {
    label: 'Full send',
    maxFields: 45,
    tabs: 'all',
    budget: 5500,
    guidance: 'FULL THROTTLE: make a bold, opinionated pass across Design, Content AND Layout together. '
      + 'Touch up to 45 fields. Commit to a point of view — a coherent palette, a real type pairing, rewritten copy '
      + 'in the brand voice, and section visibility/layout choices that serve the story. Half-measures are worse than nothing here.',
  },
};

// A request is "broad" when it asks for sweeping change without saying how far
// to go. Those are the ones that get the throttle question first. Detected here
// rather than asked of the model so the question is instant and costs no tokens.
const BROAD_RE = /\b(redesign|re-design|overhaul|revamp|rebrand|re-brand|makeover|make ?over|refresh|moderni[sz]e|transform|reimagine|rework|from scratch|start over|clean slate|new look|whole site|entire site|everything|all of it|full site|top to bottom)\b/i;

// Semantics a raw key name doesn't convey. Keyed by exact field name or a
// `prefix*` glob; only notes whose fields are actually in the scoped catalog get
// sent, so this can grow without inflating every prompt.
const FIELD_NOTES = {
  'color_primary': 'Main brand color — navs, headings, buttons.',
  'color_primary_deep': 'Darkest shade — hero bg, footer.',
  'color_primary_mid': 'Mid-tone — borders, hover states.',
  'color_accent': 'Accent — highlights, badges, CTA. Must contrast with primary.',
  'color_accent_light': 'Light accent — text on dark backgrounds.',
  'color_bg': 'Section backgrounds. Keep light and neutral for readability.',
  'font_heading': 'Any Google Font family, EXACT name as on fonts.google.com. Characterful serif/display works well (Cormorant Garamond, Playfair Display, Fraunces, DM Serif Display).',
  'font_body': 'Any Google Font family, EXACT name. Prefer legible sans-serifs (Jost, Inter, Poppins, DM Sans, Manrope, Work Sans).',
  'font_heading_spec': 'NEVER set this — derived automatically from the family name.',
  'font_body_spec': 'NEVER set this — derived automatically from the family name.',
  'landing_layout': 'classic, bold, minimal, magazine, dark, or startup.',
  'portfolio_layout': 'grid, masonry, carousel, or list.',
  'blog_layout': 'grid, list, masonry, or featured.',
  'nav_logo_display': 'text, image, or both.',
  'vis_*': 'Section visibility. String "true" or "false" — these show/hide whole sections on the home page.',
  'section_animation': 'none, fade, slide, zoom, flip, stagger, or blur — how sections animate in on scroll.',
  'snap_enabled': '"true"/"false" — full-page scroll-snap between sections.',
  'snap_strictness': 'proximity (gentle) or mandatory (hard lock to each section).',
  'ticker_items': 'Pipe-separated items for the scrolling ticker (e.g. "Free Shipping | 24/7 Support"). Empty auto-populates from brand services/location.',
  'ticker_speed': 'Animation duration in seconds (10=fast, 22=default, 40=slow).',
  'ticker_shape': 'straight (flat), diagonal (angled bar), or arc (text curved along an SVG path).',
  'ticker_treatment': 'bar (flat ticker) or parallax (tall layered band with a big floating marquee typeface).',
  'cookie_consent_enabled': '"true"/"false" — GDPR-style consent that gates analytics/marketing tags.',
  'cookie_consent_style': 'modal (centered dialog) or banner (docked bar).',
  'hero_heading_em': 'The italic/accent word inside the hero heading — not the whole heading.',
  'about_initial': 'Large decorative initial letter.',
  'agent_name': 'Name of the AI assistant shown to visitors.',
  'agent_greeting': 'Greeting shown in the visitor chat.',
};

const clipStr = (v, n) => (v == null ? '' : String(v).slice(0, n));

// Absolute catalog cap, above every throttle budget. The per-throttle budgets
// shape what the agent sees; this one exists so no input — an unbounded
// repeater, a focused section that grew — can push the prompt past the context
// window and get it silently truncated. See the THROTTLE_LEVELS note.
const ABS_MAX = 9000;

/** Sanitize the panel-reported field list. Untrusted input — cap hard. */
function sanitizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 900).map(f => ({
    name: clipStr(f?.name, 80),
    tab: TAB_LABELS[f?.tab] ? f.tab : 'design',
    section: clipStr(f?.section, 60),
    label: clipStr(f?.label, 60),
    type: clipStr(f?.type, 20),
    options: Array.isArray(f?.options) ? f.options.slice(0, 12).map(o => clipStr(o, 30)) : null,
  })).filter(f => f.name && /^[a-zA-Z0-9_]+$/.test(f.name));
}

/** Notes relevant to the given key set, exact matches and `prefix*` globs. */
function notesFor(keys) {
  const set = new Set(keys);
  const lines = [];
  for (const [pat, note] of Object.entries(FIELD_NOTES)) {
    const hit = pat.endsWith('*')
      ? keys.some(k => k.startsWith(pat.slice(0, -1)))
      : set.has(pat);
    if (hit) lines.push(`- ${pat}: ${note}`);
  }
  return lines.join('\n');
}

/**
 * Build the scoped catalog the model sees.
 *
 * Detail tabs get field label + type + current value; the rest are listed by key
 * name only so the agent still knows they exist (and can be asked about them)
 * without paying full freight for ~350 fields on every turn.
 */
function buildCatalog(fields, values, { scope, focusField, focusSection, tabs, budget = 4500 }) {
  const byTab = { design: [], copy: [], source: [] };
  for (const f of fields) (byTab[f.tab] || byTab.design).push(f);

  const activeTab = TAB_LABELS[scope] ? scope : 'design';
  let detailTabs;
  if (tabs === 'all') detailTabs = ['design', 'copy', 'source'];
  else if (tabs === 'active+') detailTabs = [activeTab, ...['design', 'copy', 'source'].filter(t => t !== activeTab)].slice(0, 2);
  else detailTabs = [activeTab];

  // Focus resolves to a section either way: a focused field pulls in its own
  // section for context, and a section button focuses that section directly.
  // The focused section is always expanded in full, whatever the throttle.
  const focusEntry = focusField ? fields.find(f => f.name === focusField) : null;
  const focusSec = focusEntry ? focusEntry.section : (focusSection || null);
  const focusTab = focusEntry
    ? focusEntry.tab
    : (focusSec ? (fields.find(f => f.section === focusSec)?.tab || null) : null);

  const out = [];
  const detailedKeys = [];
  let spent = 0;
  const push = (line) => { out.push(line); spent += line.length + 1; };

  // Section-level summary for anything not expanded. A tenant with 299 copy
  // fields can't have them all listed by name either (~5k chars on its own), and
  // the model doesn't need to: it needs to know the area exists so it can say
  // "open the Pricing section and ask me there".
  const summarize = (list) => {
    const counts = new Map();
    for (const f of list) counts.set(f.section || 'General', (counts.get(f.section || 'General') || 0) + 1);
    return [...counts].map(([s, n]) => `${s} (${n})`).join(', ');
  };

  // Active tab first so the budget is spent on what the tenant is looking at.
  const tabOrder = [activeTab, ...['design', 'copy', 'source'].filter(t => t !== activeTab)];

  for (const tab of tabOrder) {
    const list = byTab[tab];
    if (!list.length) continue;
    const detailed = detailTabs.includes(tab);
    const hasFocus = focusTab === tab;

    if (!detailed && !hasFocus) {
      push(`\n### ${TAB_LABELS[tab]} tab (${list.length} fields) — not expanded; sections: ${summarize(list)}`);
      continue;
    }
    push(`\n### ${TAB_LABELS[tab]} tab (${list.length} fields)`);

    // Group by the panel's own accordion sections so the model inherits the
    // panel's information architecture instead of a flat wall of keys.
    const sections = new Map();
    for (const f of list) {
      if (!sections.has(f.section)) sections.set(f.section, []);
      sections.get(f.section).push(f);
    }
    // The focused field's own section is expanded first and is never dropped.
    const secNames = [...sections.keys()];
    if (hasFocus && focusSec) secNames.sort((a, b) => (a === focusSec ? -1 : b === focusSec ? 1 : 0));

    // Hard ceiling as well as a soft budget: a single big section (Contact has
    // 31 fields) can start just under budget and blow well past it, so stop
    // mid-section too rather than letting one accordion eat the context.
    const ceiling = Math.round(budget * 1.15);
    const skipped = [];
    for (const sec of secNames) {
      const items = sections.get(sec);
      const isFocusSec = hasFocus && !!focusSec && sec === focusSec;
      if (spent > budget && !isFocusSec) { skipped.push(...items); continue; }
      push(`${sec || 'General'}:`);
      for (const f of items) {
        // ABS_MAX binds even the focused section. It gets first claim on the
        // budget (its tab and section both sort first), so this truncates the
        // tail rather than the thing the tenant asked about — but a repeater
        // that has grown unbounded still can't push us past the context window.
        if (spent > ABS_MAX) { skipped.push(f); continue; }
        if (spent > ceiling && !isFocusSec) { skipped.push(f); continue; }
        detailedKeys.push(f.name);
        const val = values && values[f.name] != null ? clipStr(values[f.name], 120) : '';
        const opts = f.options && f.options.length ? ` [${f.options.join('|')}]` : '';
        const lbl = f.label ? ` (${f.label})` : '';
        push(`  ${f.name}${lbl}${opts} = "${val}"`);
      }
    }
    if (skipped.length) {
      push(`(${skipped.length} more fields in this tab, not expanded; sections: ${summarize(skipped)})`);
    }
  }
  return { text: out.join('\n'), detailedKeys };
}

router.post('/agent', async (req, res) => {
  try {
    const { messages, currentDesign, fields: rawFields } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const scope = TAB_LABELS[req.body.scope] ? req.body.scope : 'design';
    const throttleKey = THROTTLE_LEVELS[req.body.throttle] ? req.body.throttle : null;
    const focusField = /^[a-zA-Z0-9_]{1,80}$/.test(req.body.focusField || '') ? req.body.focusField : null;
    const focusSection = clipStr(req.body.focusSection, 60) || null;

    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // ── Throttle step ──────────────────────────────────────────────────────────
    // A broad ask with no throttle chosen gets the question first. Focused asks
    // (a single field, or one panel section) are bounded by construction and
    // skip it — the focus itself is the throttle.
    if (!throttleKey && !focusField && !focusSection && BROAD_RE.test(lastMsg)) {
      return res.json({
        ask: 'throttle',
        message: "Happy to take that on — how hard do you want me to hit the throttle?",
        options: Object.entries(THROTTLE_LEVELS).map(([key, t]) => ({
          key,
          label: t.label,
          hint: key === 'light' ? 'One dimension, ~6 fields. Nudge, don\'t replace.'
            : key === 'balanced' ? 'A few related dimensions, ~18 fields. Same structure, new skin.'
            : 'Design + Content + Layout together, up to 45 fields. Bold and opinionated.',
        })),
        fill: {},
      });
    }

    const throttle = THROTTLE_LEVELS[throttleKey] || THROTTLE_LEVELS.balanced;
    const fields = sanitizeFields(rawFields);
    const brandCtx = await loadBrandContext(req.tenant, req.db);

    // Fall back to the flat currentDesign dump when the panel didn't report its
    // fields (older cached page, or a caller that isn't the panel).
    let catalogText = '';
    let knownKeys = [];
    if (fields.length) {
      const cat = buildCatalog(fields, currentDesign, { scope, focusField, focusSection, tabs: throttle.tabs, budget: throttle.budget });
      catalogText = cat.text;
      knownKeys = fields.map(f => f.name);
    } else if (currentDesign && typeof currentDesign === 'object') {
      catalogText = '\n' + Object.entries(currentDesign).map(([k, v]) => `  ${k} = "${clipStr(v, 120)}"`).join('\n');
      knownKeys = Object.keys(currentDesign);
    }

    const notes = notesFor(knownKeys);
    const focusEntry = focusField ? fields.find(f => f.name === focusField) : null;

    // Two focus modes, matching the two buttons in the panel: a long-form field
    // gets its own button, everything else is reached through its section.
    let focusBlock = '';
    if (focusField) {
      focusBlock = `\n\n=== FOCUSED FIELD ===
The user opened this conversation from a specific input in the left bar:
  ${focusField}${focusEntry?.label ? ` — "${focusEntry.label}"` : ''}${focusEntry?.section ? ` (in the ${focusEntry.section} section of the ${TAB_LABELS[focusEntry.tab]} tab)` : ''}
This is a long-form field, so give it real attention: write the actual content,
not a description of what you'd write. Change THIS field, and only touch others
when they must move with it (e.g. a heading whose emphasis word no longer
matches). Say so when you do.`;
    } else if (focusSection) {
      focusBlock = `\n\n=== FOCUSED SECTION ===
The user opened this conversation from the "${focusSection}" section of the left bar.
Center your work on the fields in THAT section — they are expanded in full above.
Treat them as one coherent group: change them together so the result is
consistent, rather than adjusting a single value in isolation. Stay out of other
sections unless something there would visibly break, and say so if it does.`;
    }

    const systemPrompt = `You are the design agent for this business's website. You drive the admin design panel directly.

${brandCtx}

=== WHAT YOU CONTROL ===
The panel's left bar has three tabs and you can set fields in ALL of them in a single response:
  • Design  — colors, typography, header/footer, nav, hero styling, motion, ticker, cookie consent
  • Content — the words on the page: hero, services, about, process, pricing, contact, footer, custom sections
  • Layout  — page layout, section visibility and ordering, template source

=== RESPONSE FORMAT ===
Respond with valid JSON, nothing else:
{
  "message": "Brief, concrete explanation of what you changed and why.",
  "fill": { "field_key": "new value" }
}
Only include keys in "fill" that you are actually changing. For pure conversation use "fill": {}.
Use ONLY field keys that appear in the catalog below — an invented key does nothing.
Booleans are the strings "true" / "false". Colors are hex (#RRGGBB).

=== THROTTLE: ${throttle.label.toUpperCase()} ===
${throttle.guidance}
This is a hard ceiling: anything past ${throttle.maxFields} fields is dropped before it reaches the user.${focusBlock}

=== FIELD CATALOG (current values shown) ===${catalogText}
${notes ? `\n=== FIELD NOTES ===\n${notes}` : ''}

=== DESIGN PRINCIPLES ===
- Keep palettes cohesive: primary/deep/mid should be shades of one hue.
- Accent must contrast with primary — it carries CTAs and highlights.
- Backgrounds stay light and neutral unless the brand is deliberately dark.
- Pair a distinctive heading face with a clean, legible body face.
- Check contrast between text and background; accessibility is not optional.
- Write copy in the brand's voice, specific to this business — never lorem-ipsum
  filler or generic agency boilerplate.`;

    // Optional web search for design inspiration
    let researchCtx = '';
    if (/inspir|trend|modern|style|example|like|similar/i.test(lastMsg)) {
      try {
        const searchResult = await webSearch(`${lastMsg} website color palette design 2025`);
        if (searchResult && !searchResult.startsWith('Search'))
          researchCtx = `\n\n--- DESIGN RESEARCH ---\n${searchResult}\n--- END RESEARCH ---`;
      } catch { /* non-fatal */ }
    }

    const fullPrompt = systemPrompt + researchCtx;
    const raw = await callLLM(messages, fullPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'design'));
    const parsed = tryParseAgentResponse(raw) || { message: '', fill: {} };

    // ── Enforce the throttle server-side ──────────────────────────────────────
    // The model is told the ceiling but not trusted with it. Unknown keys are
    // dropped too: they'd silently no-op in the panel and read as a phantom edit.
    let dropped = 0, unknown = [];
    if (parsed.fill && typeof parsed.fill === 'object') {
      const known = new Set(knownKeys);
      let entries = Object.entries(parsed.fill);
      if (known.size) {
        const kept = entries.filter(([k]) => known.has(k) || DESIGN_DEFAULTS.hasOwnProperty(k));
        unknown = entries.filter(([k]) => !known.has(k) && !DESIGN_DEFAULTS.hasOwnProperty(k)).map(([k]) => k);
        entries = kept;
      }
      if (entries.length > throttle.maxFields) {
        dropped = entries.length - throttle.maxFields;
        entries = entries.slice(0, throttle.maxFields);
      }
      parsed.fill = Object.fromEntries(entries);
    }

    // The agent picks a font by NAME; enrich with the CSS2 weight spec from the
    // catalog so the picked font renders with its real weights (not just 400).
    if (parsed.fill && typeof parsed.fill === 'object') {
      const fkey = tenantFontsKey(req);
      if (parsed.fill.font_heading) parsed.fill.font_heading_spec = await specForFamily(parsed.fill.font_heading, fkey);
      if (parsed.fill.font_body) parsed.fill.font_body_spec = await specForFamily(parsed.fill.font_body, fkey);
    }

    parsed.throttle = throttleKey || 'balanced';
    if (dropped) parsed.notice = `${dropped} further change${dropped > 1 ? 's were' : ' was'} held back by the ${throttle.label.toLowerCase()} throttle. Ask again with a harder throttle to go further.`;
    else if (unknown.length) parsed.notice = `Skipped ${unknown.length} unrecognized field${unknown.length > 1 ? 's' : ''}.`;

    res.json(parsed);
  } catch (err) {
    console.error('Design agent error:', err);
    res.status(500).json({ error: 'Agent error: ' + err.message });
  }
});

// ── Thumbs up/down on an agent reply → developer signal ──────────────────────
// Fire-and-forget: the panel never blocks on this and a failure is silent.
router.post('/agent/feedback', async (req, res) => {
  try {
    const rating = req.body.rating === 'up' ? 'up' : 'down';
    await recordAgentFeedback({
      agent: 'design',
      rating,
      prompt: req.body.prompt,
      reply: req.body.reply,
      fill: req.body.fill,
      throttle: req.body.throttle,
      focusField: req.body.focusField || req.body.focusSection,
      scope: req.body.scope,
      note: req.body.note,
      req,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Agent feedback error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── Email preview ───────────────────────────────────────────────
 * Renders the tenant's transactional email templates with their
 * current design tokens. Templates resolve `c_primary`, `accent_on_primary`,
 * `badge_bg`, `button_text`, etc. via plugins/mailer.js → themeFromDesign.
 * ──────────────────────────────────────────────────────────────── */
const EMAIL_TEMPLATES = [
  { key: 'invoice',              label: 'Invoice' },
  { key: 'payment-receipt',      label: 'Payment Receipt' },
  { key: 'welcome',              label: 'Welcome' },
  { key: 'booking-confirmation', label: 'Booking Confirmation' },
  { key: 'password-reset',       label: 'Password Reset' },
  { key: 'campaign',             label: 'Marketing Campaign' },
];

async function renderEmailForPreview(key, tenant, theme) {
  const mailer = await import('../../plugins/mailer.js');
  switch (key) {
    case 'invoice':
      return mailer.renderInvoiceEmail({
        invoice: {
          invoiceNumber: 'INV-1042',
          title: 'Monthly retainer',
          amount: 1850.00,
          dueDate: new Date(Date.now() + 5 * 86400000),
          notes: 'Net 15. Payment via Stripe or ACH. Thanks again for the continued partnership.',
          lineItems: [
            { description: 'Hosting + monitoring (May)',       quantity: 1, unitPrice: 149.00 },
            { description: 'Content updates (4 articles)',     quantity: 4, unitPrice: 175.00 },
            { description: 'SEO audit & on-page improvements', quantity: 1, unitPrice: 450.00 },
            { description: 'Strategy call (60 min)',           quantity: 1, unitPrice: 151.00 },
          ],
        },
        clientDoc:  { name: 'Casey Morgan', company: 'Front Range Outfitters', email: 'casey@example.com' },
        paymentUrl: '#',
        tenant, theme,
      });
    case 'payment-receipt':
      return mailer.renderPaymentReceiptEmail({
        payment: { receiptNumber: 'RCT-7741X', invoiceNumber: 'INV-1042', description: 'Monthly retainer', method: 'Visa ending 4242', amount: 1850.00, paidOn: new Date() },
        clientDoc: { name: 'Casey Morgan' },
        viewUrl: '#', tenant, theme,
      });
    case 'welcome':
      return mailer.renderWelcomeEmail({
        user: { name: 'Casey Morgan', email: 'casey@example.com' },
        dashboardUrl: '#',
        tagline: `Your account is ready. Build a site, launch in days, and own every byte of it.`,
        tenant, theme,
      });
    case 'booking-confirmation':
      return mailer.renderBookingConfirmationEmail({
        booking: {
          title: 'Discovery call & site walkthrough',
          start: new Date(Date.now() + 3 * 86400000 + 14.5 * 3600000),
          location: tenant?.brand?.location || 'Online (Zoom link in calendar invite)',
          prepNotes: "Bring the top 3 things you want visitors to do on your site. We'll review analytics, sketch the structure, and have an estimate ready.",
          googleCalUrl: '#', icsUrl: '#', manageUrl: '#',
        },
        tenant, theme,
      });
    case 'password-reset':
      return mailer.renderPasswordResetEmail({
        userEmail: 'casey@example.com',
        resetUrl: 'https://example.com/auth/reset?token=preview-token',
        expiresIn: '30 minutes',
        tenant, theme,
      });
    case 'campaign':
      return mailer.renderCampaignEmail({
        toEmail: 'casey@example.com', toName: 'Casey',
        subject: 'A few quick wins',
        preheader: 'Three things we noticed that could double your inquiries.',
        body: `Hi Casey,\n\nWe've been keeping an eye on the way prospects move through your site. A few patterns jumped out — and they're easy fixes.\n\n<strong>1. The contact form is a scroll away.</strong> 64% of mobile visitors never reach it.\n\n<strong>2. Your reviews section is underselling you.</strong> Real testimonials sitting below the fold.\n\n<strong>3. The "About" page is your second-most-visited.</strong> People want to know who you are.`,
        brandDomain: tenant?.domain ? `https://${tenant.domain}` : '',
        tenant, theme,
      });
    default: return null;
  }
}

router.get('/email-preview', async (req, res) => {
  try {
    const { loadTenantTheme } = await import('../../plugins/mailer.js');
    const theme = await loadTenantTheme(req.tenant);

    // Compute contrast diagnostics for the panel
    const { contrastRatio } = await import('../../plugins/colorContrast.js');
    const diagnostics = [
      { label: 'Header text on primary',  fg: theme.on_primary,       bg: theme.c_primary },
      { label: 'Eyebrow on primary',      fg: theme.accent_on_primary, bg: theme.c_primary },
      { label: 'Badge text on badge bg',  fg: theme.badge_text,       bg: theme.badge_bg },
      { label: 'Button text on button',   fg: theme.button_text,      bg: theme.button_bg },
      { label: 'Body text on white',      fg: theme.on_white,         bg: theme.c_white },
    ].map(d => {
      const r = contrastRatio(d.fg, d.bg);
      return { ...d, ratio: r.toFixed(2), aa: r >= 4.5, aaLarge: r >= 3 };
    });

    res.render('admin/design/email-preview', {
      user: req.adminUser, page: 'design', title: 'Email Preview',
      tenant: req.tenant, theme, diagnostics, templates: EMAIL_TEMPLATES,
    });
  } catch (err) {
    console.error('Email preview error:', err);
    res.redirect('/admin/design?error=1');
  }
});

router.get('/email-preview/:template', async (req, res) => {
  try {
    const { loadTenantTheme } = await import('../../plugins/mailer.js');
    const theme = await loadTenantTheme(req.tenant);
    const result = await renderEmailForPreview(req.params.template, req.tenant, theme);
    if (!result) return res.status(404).send('Unknown template');
    res.type('html').send(result.html);
  } catch (err) {
    console.error('Email preview render error:', err);
    res.status(500).send('Preview error: ' + err.message);
  }
});

// ── Google Fonts catalog (Web Fonts Developer API) ───────────────────────────
// Powers the full-catalog font picker. The catalog is ~1,900 families and rarely
// changes, so it's cached process-wide for a day. Each entry carries its real
// `variants` so the client can build a CSS2 request that only asks for weights
// the font actually has (avoids Google's 400-on-missing-weight behavior).
let _fontCatalog = null;
let _fontCatalogAt = 0;
const FONT_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

// The Web Fonts Developer API takes a Google Cloud API key. Tenants already
// store one at `public.googlePlacesKey` (used for Google Places reviews) on the
// same Cloud project, so reuse it — keeping fonts consistent with the tenant's
// existing Google key. Falls back to a global GOOGLE_FONTS_API_KEY env var.
function tenantFontsKey(req) {
  return req.tenant?.public?.googlePlacesKey || config.GOOGLE_FONTS_API_KEY || null;
}

// Fetch (and cache) the Google Fonts catalog with the given key. The catalog is
// identical for every key, so it's cached process-wide and served to any tenant
// once loaded. Returns null when there's no key AND nothing cached yet; throws
// on a Google API error so the route can surface it.
async function getFontCatalog(apiKey) {
  if (_fontCatalog && (Date.now() - _fontCatalogAt) < FONT_CATALOG_TTL_MS) return _fontCatalog;
  if (!apiKey) return null;
  const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Google Fonts HTTP ${r.status}`);
  _fontCatalog = (j.items || []).map(f => ({ family: f.family, category: f.category, variants: f.variants || ['regular'] }));
  _fontCatalogAt = Date.now();
  return _fontCatalog;
}

const _bareFamily = (n) => String(n || '').trim().replace(/\s+/g, '+');

// Build a CSS2 `family=` fragment from a font's real variants — only requesting
// weights the font actually has (mirrors the client-side builder in the picker).
function buildFontSpec(family, variants) {
  const fam = _bareFamily(family);
  const up = new Set(), it = new Set();
  (variants || []).forEach(v => {
    if (v === 'regular') up.add(400);
    else if (v === 'italic') it.add(400);
    else if (/^\d+$/.test(v)) up.add(parseInt(v, 10));
    else { const m = /^(\d+)italic$/.exec(v); if (m) it.add(parseInt(m[1], 10)); }
  });
  const ups = [...up].sort((a, b) => a - b);
  const its = [...it].sort((a, b) => a - b);
  if (!ups.length && !its.length) return fam;
  if (!its.length) return (ups.length === 1 && ups[0] === 400) ? fam : fam + ':wght@' + ups.join(';');
  const parts = [];
  ups.forEach(w => parts.push('0,' + w));
  its.forEach(w => parts.push('1,' + w));
  return fam + ':ital,wght@' + parts.join(';');
}

// Resolve a font name → its CSS2 spec via the catalog, falling back to the bare
// family (renders at regular weight) when the catalog is unavailable/unknown.
async function specForFamily(family, apiKey) {
  if (!family) return '';
  try {
    const cat = await getFontCatalog(apiKey);
    const entry = cat && cat.find(f => f.family.toLowerCase() === String(family).toLowerCase());
    if (entry) return buildFontSpec(entry.family, entry.variants);
  } catch { /* fall through to bare family */ }
  return _bareFamily(family);
}

router.get('/fonts', async (req, res) => {
  try {
    const fonts = await getFontCatalog(tenantFontsKey(req));
    if (!fonts) {
      return res.json({ ok: false, error: 'No Google API key for this tenant — add a Google Places/Cloud key (public.googlePlacesKey) or set GOOGLE_FONTS_API_KEY.', fonts: [] });
    }
    res.json({ ok: true, fonts });
  } catch (e) {
    console.error('[design/fonts] error:', e.message);
    res.status(502).json({ ok: false, error: e.message, fonts: [] });
  }
});

export default router;
