import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { brandUpload, modelUpload } from '../../middleware/upload.js';
import { callLLM, tryParseAgentResponse, webSearch } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { enrichDesignContrast } from '../../plugins/colorContrast.js';

const router = express.Router();

export const DESIGN_DEFAULTS = {
  color_primary:       '#1C2B4A',
  color_primary_deep:  '#0F1B30',
  color_primary_mid:   '#2E4270',
  color_accent:        '#C9A848',
  color_accent_light:  '#E8D08A',
  color_bg:            '#F5F3EF',
  font_heading:        'Cormorant Garamond',
  font_body:           'Jost',
  // ── Contrast / utility colors ──
  color_dark:          '#0F1B30',       // main text color
  color_white:         '#FDFCFA',       // page background / white surface
  color_muted:         '',              // secondary text (auto-computed if empty)
  color_border:        '',              // borders / dividers (auto-computed if empty)
  color_success:       '#15803D',       // success state
  color_danger:        '#8B1C1C',       // error / danger state
  vis_header:          'true',
  vis_hero:            'true',
  vis_marquee:         'true',
  vis_services:        'true',
  vis_portfolio:       'true',
  vis_about:           'true',
  vis_process:         'true',
  vis_reviews:         'true',
  vis_contact:         'true',
  vis_blog:            'false',
  vis_footer:          'true',
  vis_admin_link:      'true',
  agent_name:          'Assistant',
  agent_greeting:      'Hi! I can write blog posts, update site copy, or build new sections. What would you like to create?',
  portfolio_layout:    'grid',
  blog_layout:         'grid',
  nav_logo_display:    'text',
  nav_logo_split:      '0',
  landing_layout:      'classic',
  hero_name_large:     '',
  vis_pricing:           'true',
  vis_qr:               'false',
  model_header_enabled: 'false',
  model_logo_enabled:   'false',
  // ── Hero & section styling ──
  hero_overlay_opacity: '55',          // 0-100, darkness of overlay on hero bg image
  hero_overlay_color:   '',            // hex — defaults to color_primary_deep if empty
  hero_text_align:      'left',        // left, center, right
  hero_height:          '100vh',       // 100vh, 80vh, 60vh, auto
  section_animation:    'fade',        // none, fade, slide
  // ── Scroll-snap layout ──
  snap_enabled:         'false',       // full-page snap scrolling (ACM-style)
  // ── Industrial/service styling ──
  hero_bg_pattern:      'none',        // none, grid, diagonal, dots — subtle overlay pattern
  card_hover_accent:    'true',        // accent-colored top border on card hover
  card_border_radius:   '2',           // 0-16 px
  // ── Color accents (secondary + tertiary for multi-brand) ──
  color_accent_2:       '',            // secondary accent (e.g. ACM Heyday gold)
  color_accent_3:       '',            // tertiary accent (e.g. ACM Graffiti lime)
  // ── Gradient backgrounds ──
  gradient_enabled:     'false',       // enable section gradient backgrounds
  gradient_angle:       '135',         // 0-360 degrees
  // ── Contact section colors ──
  contact_bg:           '',            // left panel bg (defaults to --navy-deep)
  contact_heading_color:'',            // heading color (defaults to white)
  contact_eyebrow_color:'',            // eyebrow color (defaults to --gold-light)
  contact_text_color:   '',            // sub/body text color
  contact_label_color:  '',            // detail label color (defaults to --gold)
  contact_value_color:  '',            // detail value color
  contact_form_bg:      '',            // form/right panel bg (defaults to --ivory)
  contact_form_label_color:'',         // form field label color
  contact_btn_bg:       '',            // submit button bg (defaults to --navy)
  contact_btn_color:    '',            // submit button text color
};

// ── Theme-saveable design keys (excludes agent settings / visibility) ──
export const THEME_KEYS = [
  'color_primary', 'color_primary_deep', 'color_primary_mid',
  'color_accent', 'color_accent_light', 'color_bg',
  'color_accent_2', 'color_accent_3',
  'color_dark', 'color_white', 'color_muted', 'color_border',
  'color_success', 'color_danger',
  'font_heading', 'font_body',
  'portfolio_layout', 'blog_layout', 'nav_logo_display', 'nav_logo_split', 'landing_layout',
  'hero_overlay_opacity', 'hero_text_align', 'hero_height',
  'snap_enabled', 'gradient_enabled', 'gradient_angle',
  'hero_bg_pattern', 'card_hover_accent', 'card_border_radius',
  'section_animation',
];

// Copy section field map — shared with copy.js
export const COPY_SECTIONS = {
  hero: ['hero_eyebrow', 'hero_heading', 'hero_heading_em', 'hero_sub', 'hero_badge',
         'hero_cta_primary', 'hero_cta_primary_link', 'hero_cta_secondary', 'hero_cta_secondary_link'],
  services: ['services_label', 'services_heading', 'services_heading_em', 'services_sub',
             'service1_title', 'service1_desc', 'service1_link', 'service1_image',
             'service2_title', 'service2_desc', 'service2_link', 'service2_image',
             'service3_title', 'service3_desc', 'service3_link', 'service3_image'],
  about: ['about_quote', 'about_desc', 'about_sig', 'about_eyebrow', 'about_initial',
         'about_stat1_num', 'about_stat1_label', 'about_stat2_num', 'about_stat2_label',
         'about_stat3_num', 'about_stat3_label', 'about_stat4_num', 'about_stat4_label'],
  process: ['process_label', 'process_heading', 'process_heading_em',
           'process1_title', 'process1_desc', 'process2_title', 'process2_desc',
           'process3_title', 'process3_desc', 'process4_title', 'process4_desc'],
  pricing: ['startup_price_heading', 'startup_price_desc', 'startup_price_cta', 'startup_price_note',
           'startup_price_amount', 'startup_price_unit', 'startup_price_label', 'startup_price_features',
           'pricing_tier2_amount', 'pricing_tier2_unit', 'pricing_tier2_label', 'pricing_tier2_equiv',
           'pricing_tier2_cta_link',
           'pricing_tier3_amount', 'pricing_tier3_unit', 'pricing_tier3_label', 'pricing_tier3_equiv',
           'pricing_tier3_featured', 'pricing_tier3_cta_link',
           'pricing_tier4_amount', 'pricing_tier4_unit', 'pricing_tier4_label', 'pricing_tier4_equiv',
           'pricing_tier4_cta_link',
           'promo_enabled', 'promo_badge', 'promo_heading', 'promo_text'],
  contact: ['contact_eyebrow', 'contact_heading', 'contact_heading_em',
           'contact_sub', 'contact_location', 'contact_location_label',
           'contact_serving', 'contact_serving_label',
           'contact_services', 'contact_services_label',
           'contact_btn', 'contact_fname_label', 'contact_fname_placeholder',
           'contact_lname_label', 'contact_lname_placeholder',
           'contact_email_label', 'contact_email_placeholder',
           'contact_company_label', 'contact_company_placeholder',
           'contact_service_label', 'contact_service_placeholder',
           'contact_message_label', 'contact_message_placeholder',
           'contact_service_fallback', 'contact_service_extra'],
};

router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [rawDesign, brandImages, themes, brandModels, rawCopy] = await Promise.all([
      db.collection('design').find({}).toArray(),
      db.collection('brand_images').find({}).sort({ slot: 1, uploadedAt: -1 }).toArray(),
      db.collection('themes').find({}).sort({ createdAt: -1 }).toArray(),
      db.collection('brand_models').find({}).sort({ slot: 1 }).toArray(),
      db.collection('copy').find({}).toArray(),
    ]);
    const design = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) design[item.key] = item.value;
    const enriched = enrichDesignContrast(design);
    const copy = {};
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('admin/design/index', {
      user: req.adminUser, page: 'design', title: 'Design & Content',
      design: enriched, brandImages, themes, brandModels, copy, copySections: COPY_SECTIONS,
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
      const isBool = key.startsWith('vis_') || key.startsWith('model_') || key === 'snap_enabled' || key === 'gradient_enabled' || key === 'card_hover_accent';
      const value = isBool
        ? (req.body[key] === 'on' ? 'true' : 'false')
        : (req.body[key] !== undefined && req.body[key] !== '' ? req.body[key] : DESIGN_DEFAULTS[key]);
      return db.collection('design').updateOne(
        { key },
        { $set: { key, value, updatedAt: now } },
        { upsert: true }
      );
    });

    // Save copy fields (any key starting with known copy prefixes)
    // Checkbox copy fields need explicit handling (unchecked = not in body)
    const COPY_CHECKBOXES = ['promo_enabled', 'pricing_tier3_featured'];
    const allCopyKeys = Object.values(COPY_SECTIONS).flat();
    const copyOps = allCopyKeys.filter(key => req.body[key] !== undefined || COPY_CHECKBOXES.includes(key)).map(key => {
      const value = COPY_CHECKBOXES.includes(key)
        ? (req.body[key] || '')       // '' when unchecked, 'yes' when checked
        : (req.body[key] || '');
      return db.collection('copy').updateOne(
        { key },
        { $set: { key, value, updatedAt: now } },
        { upsert: true }
      );
    });

    await Promise.all([...designOps, ...copyOps]);
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
// DESIGN AGENT — specialist agent for design & settings
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/agent', async (req, res) => {
  try {
    const { messages, currentDesign } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const designCtx = currentDesign
      ? `\n\nCurrent design settings:\n${Object.entries(currentDesign).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}`
      : '';

    const brandCtx = await loadBrandContext(req.tenant, req.db);

    const systemPrompt = `You are a design and branding assistant for the business.

${brandCtx}

Your job is to help configure the site's visual design: colors, fonts, layouts, and section visibility.

When the user asks you to change design settings, respond with valid JSON in this exact format:
{
  "message": "Brief explanation of your design changes.",
  "fill": {
    "field_key": "new value",
    ...
  }
}

Only include fields in "fill" that you are actually changing. If just having a conversation, respond with:
{
  "message": "Your conversational response here.",
  "fill": {}
}

Available field keys and their types:
COLOR FIELDS (hex values):
- color_primary: Main brand color — navs, headings, buttons (current default: #1C2B4A navy)
- color_primary_deep: Darkest shade — hero bg, footer (default: #0F1B30)
- color_primary_mid: Mid-tone — borders, hover states (default: #2E4270)
- color_accent: Gold accent — highlights, badges, CTA (default: #C9A848)
- color_accent_light: Light accent — text on dark backgrounds (default: #E8D08A)
- color_bg: Section backgrounds — ivory/cream tones (default: #F5F3EF)

FONT FIELDS:
- font_heading: One of: Cormorant Garamond, Playfair Display, Lora, Merriweather, Libre Baskerville
- font_body: One of: Jost, Inter, Poppins, Raleway, Nunito, DM Sans

LAYOUT FIELDS:
- landing_layout: classic, bold, minimal, magazine, dark, or startup (overall landing page layout)
- portfolio_layout: grid, masonry, carousel, or list
- blog_layout: grid, list, masonry, or featured
- nav_logo_display: text, image, or both

VISIBILITY FIELDS (string "true" or "false"):
- vis_hero, vis_services, vis_portfolio, vis_about, vis_process, vis_reviews, vis_contact, vis_blog

COPY FIELDS (text content shown on the landing page):
- hero_eyebrow: Small text above the headline (e.g. "Welcome to...")
- hero_heading: Main hero headline
- hero_heading_em: Italic/accent word in the hero heading
- hero_sub: Supporting text below the headline
- hero_badge: Small badge text (e.g. "Est. 2020")
- hero_cta_primary: Primary call-to-action button text
- hero_cta_primary_link: Primary CTA link URL
- hero_cta_secondary: Secondary CTA button text
- hero_cta_secondary_link: Secondary CTA link URL
- services_label: Section label for services (e.g. "What We Do")
- services_heading: Services section heading
- services_heading_em: Emphasized word in services heading
- services_sub: Services section subheading
- service1_title, service2_title, service3_title: Individual service card titles
- service1_desc, service2_desc, service3_desc: Individual service card descriptions
- about_eyebrow: About section label
- about_quote: Main quote/statement in about section
- about_desc: About section description paragraph
- about_sig: Signature/name in about section
- about_initial: Large decorative initial letter
- process_label: Process section label
- process_heading, process_heading_em: Process section heading + emphasis
- process1_title through process4_title: Step titles
- process1_desc through process4_desc: Step descriptions
- contact_eyebrow: Contact section label
- contact_heading, contact_heading_em: Contact heading + emphasis
- contact_sub: Contact section subheading
- contact_location: Business location text
- contact_serving: "Serving" text
- contact_services: Services list text
- contact_btn: Submit button text

AGENT SETTINGS:
- agent_name: Name of the AI assistant
- agent_greeting: Greeting message shown in the chat

DESIGN TIPS:
- Keep color palettes cohesive. Primary/deep/mid should be shades of the same hue.
- Accent colors should contrast with primary for CTAs and highlights.
- Background color should be light and neutral for readability.
- Serif fonts (Cormorant Garamond, Playfair Display) work well for headings; sans-serif (Jost, Inter) for body.
- Consider accessibility — ensure sufficient contrast between text and background colors.
${designCtx}`;

    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

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
    const raw = await callLLM(messages, fullPrompt);
    const parsed = tryParseAgentResponse(raw);

    res.json(parsed);
  } catch (err) {
    console.error('Design agent error:', err);
    res.status(500).json({ error: 'Agent error: ' + err.message });
  }
});

export default router;
