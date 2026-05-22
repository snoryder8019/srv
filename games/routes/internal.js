const express = require('express');
const router = express.Router();
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');
const l4d2 = require('../lib/l4d2');
const sdtd = require('../lib/7dtd');
const se = require('../lib/se');
const palworld = require('../lib/palworld');
const windrose = require('../lib/windrose');

function requireInternal(req, res, next) {
  if (req.headers['x-bridge-secret'] === process.env.BRIDGE_SECRET) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const libs = { rust, valheim, l4d2, '7dtd': sdtd, se, palworld, windrose };

router.get('/:game/status', requireInternal, async (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  try { res.json(await lib.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:game/start', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.startServer());
});

router.post('/:game/stop', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.stopServer('bih request'));
});

router.post('/:game/restart', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.restartServer());
});

// Discord bot bridge — bot listens for voiceStateUpdate on the designated
// Games voice channel and POSTs here. We rebroadcast on the /stats namespace
// so the portal index toasts it.
router.post('/discord/voice-join', requireInternal, (req, res) => {
  const { user, channel } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const io = req.app.get('io');
  if (io) io.of('/stats').emit('discord:voice-join', { user, channel: channel || null });
  res.json({ ok: true });
});

module.exports = router;
