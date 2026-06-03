/**
 * Arcade — web games plugged into the platform.
 * Registry-driven (../webgames.json). The platform owns identity; launching a
 * game bounces the player through the SSO bridge so the game receives a signed
 * identity token. See WEBGAMES_PROTOCOL.md.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function loadRegistry() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'webgames.json'), 'utf8');
    return JSON.parse(raw).games || [];
  } catch (e) {
    return [];
  }
}

// Public catalog of plugged-in web games.
router.get('/', (req, res) => {
  const games = loadRegistry().map(g => ({
    slug: g.slug, name: g.name, blurb: g.blurb, image: g.image, status: g.status,
    playUrl: `/arcade/${g.slug}/play`,
  }));
  res.json({ ok: true, games });
});

// Launch: send the player through the SSO bridge to the game's callback.
// The bridge handles login (if needed) and signs the 5-min identity token.
router.get('/:slug/play', (req, res) => {
  const game = loadRegistry().find(g => g.slug === req.params.slug && g.status !== 'disabled');
  if (!game) return res.status(404).send('Unknown game');
  const redirect = game.url.replace(/\/+$/, '') + (game.callbackPath || '/auth/platform/callback');
  res.redirect('/auth/bridge?redirect=' + encodeURIComponent(redirect));
});

module.exports = router;
