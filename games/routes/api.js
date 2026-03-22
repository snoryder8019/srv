const express = require('express');
const router = express.Router();
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');

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
