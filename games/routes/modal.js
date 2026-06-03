'use strict';

/**
 * Global modal routes (games-owned overlay). See GLOBAL_MODAL_PROTOCOL.md.
 *   GET  /modal/panel              the overlay UI (iframe target; same-origin to games)
 *   GET  /modal/catalog            arcade games for the Games/nav tab (from webgames.json)
 *   POST /modal/ticket/verify      verify a cross-origin modal ticket -> { ok, identity }
 *
 * loader.js is served statically from /static/modal/loader.js (public/modal/loader.js),
 * but we also expose it at /modal/loader.js for a clean embed URL.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const PUB = path.join(__dirname, '..', 'public', 'modal');

// Restrict who can frame the panel (defense-in-depth alongside loader checks).
router.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.madladslab.com");
  next();
});

router.get('/panel', (req, res) => res.sendFile(path.join(PUB, 'panel.html')));
router.get('/loader.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PUB, 'loader.js'));
});

// Arcade catalog for the Games tab — live games from the registry.
router.get('/catalog', (req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'webgames.json'), 'utf8');
    const games = (JSON.parse(raw).games || [])
      .filter((g) => g.status !== 'disabled')
      .map((g) => ({ slug: g.slug, name: g.name, image: g.image, status: g.status, playUrl: `/arcade/${g.slug}/play` }));
    res.json({ ok: true, games });
  } catch (e) { res.json({ ok: true, games: [] }); }
});

// Verify a cross-origin modal ticket minted by another surface (shares BRIDGE_SECRET).
// Returns the screen-name identity the panel should bind chat/roster to.
router.post('/ticket/verify', express.json(), (req, res) => {
  const token = (req.body && req.body.ticket) || '';
  if (!token) return res.status(400).json({ ok: false, error: 'ticket required' });
  try {
    const p = jwt.verify(token, process.env.BRIDGE_SECRET);
    if (!p.platformId || !p.displayName) throw new Error('incomplete ticket');
    res.json({ ok: true, identity: { platformId: String(p.platformId), displayName: p.displayName, surface: p.surface || null, isAdmin: !!p.isAdmin } });
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid ticket' });
  }
});

module.exports = router;
