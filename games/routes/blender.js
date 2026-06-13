// Admin Blender tool — tree browser + GLB viewer + CRUD-from-prompt over the
// shared model scope (/srv/games/_shared/assets/models). All management is gated to
// admins; the GLB files themselves are served by the public /shared mount (by
// design — games load them at runtime per BLENDER_SD_PROTOCOL.md).
const express = require('express');
const router = express.Router();
const models3d = require('../lib/models3d');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'login required' });
}
function requireAdmin(req, res, next) {
  const u = req.user;
  if (!u) return res.status(403).json({ error: 'forbidden' });
  const gp = u.permissions && u.permissions['games'];
  if (u.isAdmin === true || gp === 'admin') return next();
  return res.status(403).json({ error: 'admin only' });
}
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.sendFile('blender.html', { root: __dirname + '/../public' });
});

// Which renderer is live (blender-local / blender-remote / procedural)
router.get('/api/status', (req, res) => {
  res.json({ ok: true, renderer: models3d.blenderStatus() });
});

router.get('/api/tree', async (req, res) => {
  try { res.json({ ok: true, categories: models3d.CATEGORIES, tree: await models3d.tree() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/api/models', async (req, res) => {
  try { res.json({ ok: true, models: await models3d.list({ category: req.query.category || null }) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/api/model/:id', async (req, res) => {
  try {
    const m = await models3d.get(req.params.id);
    if (!m) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, model: m });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post('/api/generate', async (req, res) => {
  try {
    const { prompt, name, category } = req.body || {};
    const m = await models3d.generateFromPrompt({
      prompt, name, category, author: (req.user && req.user.email) || '',
    });
    res.json({ ok: true, model: m });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post('/api/upload', express.raw({ type: ['model/gltf-binary', 'application/octet-stream'], limit: '50mb' }), async (req, res) => {
  try {
    const m = await models3d.saveUpload({
      buffer: req.body, name: req.query.name, category: req.query.category,
      author: (req.user && req.user.email) || '',
    });
    res.json({ ok: true, model: m });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.patch('/api/model/:id', async (req, res) => {
  try {
    const { name, category, tags } = req.body || {};
    res.json(await models3d.update(req.params.id, { name, category, tags }));
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.delete('/api/model/:id', async (req, res) => {
  try { res.json(await models3d.remove(req.params.id)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

module.exports = router;
