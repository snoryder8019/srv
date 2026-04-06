const express = require('express');
const router = express.Router();
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');
const l4d2 = require('../lib/l4d2');
const sdtd = require('../lib/7dtd');
const se = require('../lib/se');
const palworld = require('../lib/palworld');

function requireInternal(req, res, next) {
  if (req.headers['x-bridge-secret'] === process.env.BRIDGE_SECRET) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const libs = { rust, valheim, l4d2, '7dtd': sdtd, se, palworld };

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

module.exports = router;
