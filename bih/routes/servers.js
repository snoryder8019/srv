const express = require('express');
const router = express.Router();

const GAMES_URL = process.env.GAMES_URL || 'http://127.0.0.1:3500';

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

function requireGamesAccess(req, res, next) {
  const u = req.user;
  const perms = u.permissions || [];
  if (u.isAdmin || perms.includes('games') || perms.includes('games:admin')) return next();
  res.status(403).render('error', { message: 'You need games permission to access this section.' });
}

function requireGamesAdmin(req, res, next) {
  const u = req.user;
  const perms = u.permissions || [];
  if (u.isAdmin || perms.includes('games:admin')) return next();
  res.status(403).json({ error: 'games:admin permission required' });
}

async function gamesInternal(path, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'X-Bridge-Secret': process.env.BRIDGE_SECRET,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${GAMES_URL}/internal${path}`, opts);
  return r.json();
}

// Server control dashboard
router.get('/', requireAuth, requireGamesAccess, (req, res) => {
  const u = req.user;
  const perms = u.permissions || [];
  const isGameAdmin = u.isAdmin || perms.includes('games:admin');
  res.render('servers', { user: u, isGameAdmin });
});

// Status
router.get('/status/:game', requireAuth, requireGamesAccess, async (req, res) => {
  try {
    res.json(await gamesInternal(`/${req.params.game}/status`));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Control actions (admin only)
const VALID_ACTIONS = ['start', 'stop', 'restart'];
const VALID_GAMES = ['rust', 'valheim', 'l4d2', '7dtd'];

router.post('/control/:game/:action', requireAuth, requireGamesAccess, requireGamesAdmin, async (req, res) => {
  const { game, action } = req.params;
  if (!VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game' });
  if (!VALID_ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    res.json(await gamesInternal(`/${game}/${action}`, 'POST'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
