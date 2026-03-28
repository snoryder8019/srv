import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { brandUpload, modelUpload } from '../../middleware/upload.js';
import { callLLM, tryParseAgentResponse, webSearch } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';

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
  vis_hero:            'true',
  vis_services:        'true',
  vis_portfolio:       'true',
  vis_about:           'true',
  vis_process:         'true',
  vis_reviews:         'true',
  vis_contact:         'true',
  vis_blog:            'false',
  agent_name:          'Assistant',
  agent_greeting:      'Hi! I can write blog posts, update site copy, or build new sections. What would you like to create?',
  portfolio_layout:    'grid',
  blog_layout:         'grid',
  nav_logo_display:    'text',
  nav_logo_split:      '0',
  landing_layout:      'classic',
  hero_name_large:     '',
  model_header_enabled: 'false',
  model_logo_enabled:   'false',
};

// ── Theme-saveable design keys (excludes agent settings / visibility) ──
const THEME_KEYS = [
  'color_primary', 'color_primary_deep', 'color_primary_mid',
  'color_accent', 'color_accent_light', 'color_bg',
  'font_heading', 'font_body',
  'portfolio_layout', 'blog_layout', 'nav_logo_display', 'nav_logo_split', 'landing_layout',
];

router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [rawDesign, brandImages, themes, brandModels] = await Promise.all([
      db.collection('design').find({}).toArray(),
      db.collection('brand_images').find({}).sort({ slot: 1, uploadedAt: -1 }).toArray(),
      db.collection('themes').find({}).sort({ createdAt: -1 }).toArray(),
      db.collection('brand_models').find({}).sort({ slot: 1 }).toArray(),
    ]);
    const design = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) design[item.key] = item.value;
    res.render('admin/design/index', {
      user: req.adminUser, page: 'design', title: 'Design & Settings',
      design, brandImages, themes, brandModels, saved: req.query.saved === '1', error: req.query.error === '1',
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const ops = Object.keys(DESIGN_DEFAULTS).map(key => {
      const value = (key.startsWith('vis_') || key.startsWith('model_'))
        ? (req.body[key] === 'on' ? 'true' : 'false')
        : (req.body[key] !== undefined && req.body[key] !== '' ? req.body[key] : DESIGN_DEFAULTS[key]);
      return db.collection('design').updateOne(
        { key },
        { $set: { key, value, updatedAt: new Date() } },
        { upsert: true }
      );
    });
    await Promise.all(ops);
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
