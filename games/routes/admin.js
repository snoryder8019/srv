const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const u = req.user;
  const gp = u.permissions && u.permissions['games'];
  if (u.isAdmin || gp === 'admin') return next();
  res.status(403).send('Forbidden');
}

async function bihCall(path, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'X-Bridge-Secret': process.env.BRIDGE_SECRET,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`http://127.0.0.1:3055${path}`, opts);
  return r.json();
}

// Serve admin panel HTML
router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.sendFile('admin.html', { root: __dirname + '/../public' });
});

// --- Games users ---
router.get('/api/games/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const users = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/games/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { isAdmin, permissions } = req.body;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isAdmin: !!isAdmin, permissions: permissions || {} } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- bih users ---
router.get('/api/bih/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await bihCall('/api/internal/users'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/bih/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await bihCall(`/api/internal/users/${req.params.id}/permissions`, 'PUT', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- bih tickets ---
router.get('/api/bih/tickets', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await bihCall('/api/internal/tickets'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
