const express = require('express');
const router = express.Router();
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');
const l4d2 = require('../lib/l4d2');
const sdtd = require('../lib/7dtd');
const se = require('../lib/se');
const palworld = require('../lib/palworld');
const windrose = require('../lib/windrose');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const u = req.user;
  const gamesPerm = u.permissions && u.permissions.get ? u.permissions.get('games') : (u.permissions || {})['games'];
  if (u.isAdmin || gamesPerm === 'admin') return next();
  res.status(403).json({ error: 'Forbidden — admin required' });
}

// --- Rust server ---

router.get('/rust/status', requireAuth, async (req, res) => {
  try {
    const status = await rust.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/rust/start', requireAdmin, (req, res) => {
  const result = rust.startServer();
  res.json(result);
});

router.post('/rust/stop', requireAdmin, (req, res) => {
  const result = rust.stopServer('manual stop');
  res.json(result);
});

router.post('/rust/restart', requireAdmin, (req, res) => {
  const result = rust.restartServer();
  res.json(result);
});

router.post('/rust/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await rust.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Plugins ---

router.get('/rust/plugins', requireAdmin, (req, res) => {
  res.json(rust.getPlugins());
});

router.post('/rust/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  const result = rust.togglePlugin(req.params.filename, enable);
  res.json(result);
});

// --- Valheim server ---

router.get('/valheim/status', requireAuth, async (req, res) => {
  try {
    const status = await valheim.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/valheim/start', requireAdmin, (req, res) => {
  res.json(valheim.startServer());
});

router.post('/valheim/stop', requireAdmin, (req, res) => {
  res.json(valheim.stopServer('manual stop'));
});

router.post('/valheim/restart', requireAdmin, (req, res) => {
  res.json(valheim.restartServer());
});

router.get('/valheim/plugins', requireAdmin, (req, res) => {
  res.json(valheim.getPlugins());
});

router.post('/valheim/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(valheim.togglePlugin(req.params.filename, enable));
});

// --- Left 4 Dead 2 ---

router.get('/l4d2/status', requireAuth, async (req, res) => {
  try { res.json(await l4d2.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/l4d2/start', requireAdmin, (req, res) => { res.json(l4d2.startServer()); });
router.post('/l4d2/stop', requireAdmin, (req, res) => { res.json(l4d2.stopServer('manual stop')); });
router.post('/l4d2/restart', requireAdmin, (req, res) => { res.json(l4d2.restartServer()); });

router.get('/l4d2/plugins', requireAdmin, (req, res) => { res.json(l4d2.getPlugins()); });

router.post('/l4d2/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(l4d2.togglePlugin(req.params.filename, enable));
});

// --- 7 Days to Die ---

router.get('/7dtd/status', requireAuth, async (req, res) => {
  try { res.json(await sdtd.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/7dtd/start', requireAdmin, (req, res) => { res.json(sdtd.startServer()); });
router.post('/7dtd/stop', requireAdmin, (req, res) => { res.json(sdtd.stopServer('manual stop')); });
router.post('/7dtd/restart', requireAdmin, (req, res) => { res.json(sdtd.restartServer()); });

router.get('/7dtd/mods', requireAdmin, (req, res) => { res.json(sdtd.getMods()); });

router.post('/7dtd/mods/:modname/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(sdtd.toggleMod(req.params.modname, enable));
});

// --- Space Engineers ---

router.get('/se/status', requireAuth, async (req, res) => {
  try { res.json(await se.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/se/start', requireAdmin, (req, res) => { res.json(se.startServer()); });
router.post('/se/stop', requireAdmin, (req, res) => { res.json(se.stopServer('manual stop')); });
router.post('/se/restart', requireAdmin, (req, res) => { res.json(se.restartServer()); });

router.post('/se/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await se.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/se/mods', requireAdmin, (req, res) => { res.json(se.getMods()); });

router.post('/se/mods/:modname/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(se.toggleMod(req.params.modname, enable));
});

// --- Palworld ---

router.get('/palworld/status', requireAuth, async (req, res) => {
  try { res.json(await palworld.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/palworld/start', requireAdmin, (req, res) => { res.json(palworld.startServer()); });
router.post('/palworld/stop', requireAdmin, (req, res) => { res.json(palworld.stopServer('manual stop')); });
router.post('/palworld/restart', requireAdmin, (req, res) => { res.json(palworld.restartServer()); });

router.post('/palworld/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await palworld.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Windrose ---

router.get('/windrose/status', requireAuth, async (req, res) => {
  try { res.json(await windrose.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/windrose/start', requireAdmin, (req, res) => { res.json(windrose.startServer()); });
router.post('/windrose/stop', requireAdmin, (req, res) => { res.json(windrose.stopServer('manual stop')); });
router.post('/windrose/restart', requireAdmin, (req, res) => { res.json(windrose.restartServer()); });

router.post('/windrose/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await windrose.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Auth ---

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const gamesPerm = u.permissions && u.permissions.get ? u.permissions.get('games') : (u.permissions || {})['games'];
  res.json({
    id: u._id,
    displayName: u.displayName,
    email: u.email,
    isAdmin: u.isAdmin || gamesPerm === 'admin',
  });
});

module.exports = router;
