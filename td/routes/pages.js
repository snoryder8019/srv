/**
 * Page routes - EJS views for game / builder / admin.
 */
import express from 'express';
import Tower from '../api/v1/models/Tower.js';
import config from '../config/index.js';
import { verifyDescriptor } from '../services/siege/token.js';
import { validateDescriptor } from '../services/siege/descriptor.js';

const router = express.Router();

// Play requires a signed-in user (stats are tied to the account).
function requirePageAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/auth/google');
}

// Community build + admin tools are admin-only for now.
function requireAdmin(req, res, next) {
  if (req.user && req.user.hasRole('admin')) return next();
  return res.redirect('/');
}

// Parse + verify a ?siege=<token> launch (siege-kit protocol). Returns a verified
// descriptor or null. A missing/invalid token simply means "free play".
function readSiege(req) {
  const token = req.query.siege;
  if (!token || !config.platform.bridgeSecret) return null;
  const v = verifyDescriptor(token, config.platform.bridgeSecret);
  if (!v.ok) { console.warn('[siege] launch rejected:', v.error); return null; }
  const check = validateDescriptor(v.descriptor);
  if (!check.ok) { console.warn('[siege] bad descriptor:', check.errors.join(', ')); return null; }
  return v.descriptor;
}

router.get('/', async (req, res) => {
  let featured = [];
  try {
    featured = await Tower.find({ status: { $in: ['featured', 'approved'] }, gltfUrl: { $ne: '' } })
      .sort({ status: 1, 'votes.up': -1 }).limit(4).lean();
  } catch (e) { /* db optional for landing */ }
  res.render('index', { title: 'Towers - Hex TD', featured });
});

router.get('/lobby', requirePageAuth, (req, res) => {
  res.render('game/lobby', { title: 'Command Lobby - Towers' });
});

router.get('/play', (req, res) => {
  // A siege launch may arrive before a Towers session exists. If so, complete
  // platform SSO and resume THIS exact launch URL (not the lobby), so the player
  // lands in the fight madlands sent them to. Free play with no token keeps the
  // original Google-login behaviour.
  const siege = readSiege(req);
  if (!req.user) {
    if (siege) return res.redirect('/auth/platform?next=' + encodeURIComponent(req.originalUrl));
    return res.redirect('/auth/google');
  }
  // Server-verified descriptor is injected for the client; escape "<" so the
  // JSON can't break out of the <script> tag.
  const siegeJson = siege ? JSON.stringify(siege).replace(/</g, '\\u003c') : 'null';
  res.render('game/play', { title: 'Play - Towers', siegeJson });
});

// ---- Admin balance backend (levels + characters) ----
router.get('/admin', requireAdmin, (req, res) => {
  res.render('admin/balance', { title: 'Balance - Admin' });
});

// ---- Community build (hidden for players; admin-only while we curate) ----
router.get('/build/tower', requireAdmin, (req, res) => {
  res.render('builder/tower', { title: 'Tower Builder' });
});

router.get('/build/map', requireAdmin, (req, res) => {
  res.render('builder/map', { title: 'Map Builder' });
});

router.get('/build/story', requireAdmin, (req, res) => {
  res.render('builder/story', { title: 'Story Arc Builder' });
});

router.get('/browse', requireAdmin, (req, res) => {
  res.render('browse', { title: 'Browse Community' });
});

export default router;
