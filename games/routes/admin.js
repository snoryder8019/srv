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

function requireSuperAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Superadmin only' });
  next();
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

router.put('/api/games/users/:id', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { isAdmin, permissions } = req.body;
    // Superadmin cannot be granted via admin panel
    if (isAdmin === true) {
      return res.status(403).json({ error: 'Superadmin is reserved — cannot be granted via admin panel' });
    }
    // Prevent modifying your own superadmin status
    if (req.params.id === req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot modify your own superadmin status' });
    }
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isAdmin: false, permissions: permissions || {} } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: full user management ──
router.put('/api/games/users/:id/subscription', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { subscription, subscriptionExpiry } = req.body;
    const allowed = ['free', 'player', 'admin', 'lifetime'];
    if (!allowed.includes(subscription)) {
      return res.status(400).json({ error: 'Invalid subscription: ' + allowed.join(', ') });
    }
    const update = { subscription };
    if (subscription === 'lifetime') {
      update.subscriptionExpiry = null;
    } else if (subscriptionExpiry) {
      update.subscriptionExpiry = new Date(subscriptionExpiry);
    }
    // Auto-set permissions based on subscription
    if (subscription === 'admin') {
      update['permissions.games'] = 'admin';
    }
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/games/users/:id/role', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { isAdmin, isBroadcaster, permissions } = req.body;
    const update = {};

    // Superadmin is reserved for a singular user — only the current superadmin
    // can grant/revoke it, and cannot revoke their own
    if (isAdmin !== undefined) {
      if (isAdmin === true) {
        // Never allow granting superadmin to another user via API
        return res.status(403).json({ error: 'Superadmin is reserved — cannot be granted via admin panel' });
      }
      // Allow revoking superadmin (but not your own)
      if (req.params.id === req.user._id.toString()) {
        return res.status(403).json({ error: 'Cannot modify your own superadmin status' });
      }
      update.isAdmin = false;
    }
    if (isBroadcaster !== undefined) update.isBroadcaster = !!isBroadcaster;
    if (permissions !== undefined) update.permissions = permissions;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: trigger maintenance notification ──
router.post('/api/maintenance', requireSuperAdmin, (req, res) => {
  const { minutes } = req.body;
  const mins = Math.min(parseInt(minutes) || 5, 30);
  const io = req.app.get('io');
  if (!io) return res.status(500).json({ error: 'Socket.IO not available' });

  const message = 'The server is undergoing maintenance. You may notice odd behavior or disconnections. Thanks for your patience!';

  // Broadcast to ALL connected clients across all namespaces
  io.emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });
  io.of('/broadcasts').emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });
  io.of('/stats').emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });

  console.log('[admin] Maintenance notification sent (' + mins + ' min countdown)');
  res.json({ ok: true, message: 'Maintenance notification sent to all clients' });
});

// ── Admin: keep a server pinned online (override 1hr-idle auto-shutdown) ──
const VALID_GAMES = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose'];

router.get('/api/keep-online', requireAuth, requireAdmin, (req, res) => {
  const sm = req.app.locals.serverManager;
  if (!sm) return res.status(500).json({ error: 'server-manager not available' });
  res.json({ ok: true, keepOnline: sm.getKeepOnlineMap() });
});

router.post('/api/keep-online/:game', requireAuth, requireAdmin, (req, res) => {
  const { game } = req.params;
  if (!VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Invalid game' });
  const sm = req.app.locals.serverManager;
  if (!sm) return res.status(500).json({ error: 'server-manager not available' });
  const on = !!req.body.on;
  const result = sm.setKeepOnline(game, on);
  if (!result.ok) return res.status(400).json(result);
  console.log('[admin] keep-online', game, '=', result.keepOnline, 'by', req.user.email || req.user._id);
  res.json(result);
});

module.exports = router;
