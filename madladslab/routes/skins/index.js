// skins — landing page style builder & handoff tool
// Admin-only: browse, create, edit, preview, and export skins for vibecoders / small biz clients

import express from 'express';
import Skin from '../../api/v1/models/Skin.js';

const router = express.Router();

// ─── middleware ───────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (req.user && req.user.isAdmin === true) return next();
  return res.status(401).send('Unauthorized');
}

// ─── view routes ─────────────────────────────────────────────────────────────

// Gallery / browser
router.get('/', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const { category } = req.query;
    const query = category ? { category } : {};
    const skins = await model.getAll(query);

    res.render('skins/index', {
      user: req.user,
      skins,
      activeCategory: category || 'all',
      currentPage: 'skins',
      title: 'Skins — madLadsLab',
    });
  } catch (err) {
    console.error('Skins gallery error:', err);
    res.status(500).send('Error loading skins');
  }
});

// New skin — open editor with blank slate
router.get('/new', requireAdmin, (req, res) => {
  res.render('skins/editor', {
    user: req.user,
    skin: null,
    currentPage: 'skins',
    title: 'New Skin — madLadsLab',
  });
});

// Edit existing skin
router.get('/editor/:id', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const skin = await model.getById(req.params.id);
    if (!skin) return res.status(404).send('Skin not found');

    res.render('skins/editor', {
      user: req.user,
      skin,
      currentPage: 'skins',
      title: `Edit ${skin.name} — madLadsLab`,
    });
  } catch (err) {
    console.error('Skin editor error:', err);
    res.status(500).send('Error loading skin editor');
  }
});

// Full-page preview (no chrome)
router.get('/preview/:id', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const skin = await model.getById(req.params.id);
    if (!skin) return res.status(404).send('Skin not found');

    res.render('skins/preview', {
      user: req.user,
      skin,
      title: `Preview: ${skin.name}`,
    });
  } catch (err) {
    console.error('Skin preview error:', err);
    res.status(500).send('Error loading preview');
  }
});

// CSS handoff export — returns downloadable .css file
router.get('/export/:id', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const skin = await model.getById(req.params.id);
    if (!skin) return res.status(404).send('Skin not found');

    const css = buildExportCss(skin);
    const filename = `${skin.name.replace(/\s+/g, '-').toLowerCase()}-skin.css`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/css');
    res.send(css);
  } catch (err) {
    console.error('Skin export error:', err);
    res.status(500).send('Error exporting skin');
  }
});

// ─── api routes ───────────────────────────────────────────────────────────────

// List all (JSON)
router.get('/api/skins', requireAdmin, async (_req, res) => {
  try {
    const model = new Skin();
    const skins = await model.getAll();
    res.json(skins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create
router.post('/api/skins', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const skin = await model.create({
      ...req.body,
      createdBy: String(req.user._id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.status(201).json(skin);
  } catch (err) {
    console.error('Skin create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update
router.put('/api/skins/:id', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const skin = await model.updateById(req.params.id, {
      ...req.body,
      updatedAt: new Date(),
    });
    if (!skin) return res.status(404).json({ error: 'Skin not found' });
    res.json(skin);
  } catch (err) {
    console.error('Skin update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete('/api/skins/:id', requireAdmin, async (req, res) => {
  try {
    const model = new Skin();
    const deleted = await model.deleteById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Skin not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Skin delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildExportCss(skin) {
  return `/* =============================================
   Skin: ${skin.name}
   Category: ${skin.category || 'general'}
   Exported from madLadsLab Skins
   ============================================= */

:root {
  --skin-primary:        ${skin.primaryColor   || '#6c63ff'};
  --skin-secondary:      ${skin.secondaryColor || '#ff6584'};
  --skin-accent:         ${skin.accentColor    || '#43e97b'};
  --skin-bg:             ${skin.bgColor        || (skin.darkMode ? '#0d0d0d' : '#ffffff')};
  --skin-text:           ${skin.textColor      || (skin.darkMode ? '#e0e0e0' : '#1a1a1a')};
  --skin-font-body:      ${skin.fontBody       || "'Inter', sans-serif"};
  --skin-font-heading:   ${skin.fontHeading    || "'Inter', sans-serif"};
  --skin-border-radius:  ${skin.borderRadius   || '8px'};
}

/* Base reset */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--skin-bg);
  color: var(--skin-text);
  font-family: var(--skin-font-body);
  font-size: 16px;
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--skin-font-heading);
  color: var(--skin-text);
}

a { color: var(--skin-primary); }
a:hover { opacity: 0.8; }

/* Buttons */
.btn-primary {
  background: var(--skin-primary);
  color: #fff;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: var(--skin-border-radius);
  font-family: var(--skin-font-body);
  font-size: 1rem;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-primary:hover { opacity: 0.85; }

.btn-secondary {
  background: transparent;
  color: var(--skin-primary);
  border: 2px solid var(--skin-primary);
  padding: 0.75rem 1.5rem;
  border-radius: var(--skin-border-radius);
  font-family: var(--skin-font-body);
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-secondary:hover { background: var(--skin-primary); color: #fff; }

/* Hero */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 5rem 2rem;
  background: var(--skin-bg);
}
.hero h1 { font-size: clamp(2rem, 5vw, 4rem); margin-bottom: 1rem; }
.hero p  { font-size: 1.2rem; max-width: 600px; opacity: 0.8; margin-bottom: 2rem; }

/* Card */
.card {
  background: ${skin.darkMode ? '#1a1a1a' : '#f8f8f8'};
  border-radius: var(--skin-border-radius);
  padding: 2rem;
  border: 1px solid ${skin.darkMode ? '#2a2a2a' : '#e0e0e0'};
}

/* Section */
.section { padding: 4rem 2rem; max-width: 1100px; margin: 0 auto; }

${skin.customCss ? `/* Custom overrides */\n${skin.customCss}` : ''}
`;
}

export default router;
