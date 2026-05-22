'use strict';

const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const broadcasts = require('../lib/broadcasts');
const username = require('../lib/username');
const router = express.Router();

// Generate time-limited TURN credentials (coturn HMAC auth)
function getTurnCredentials() {
  const secret = process.env.TURN_SECRET;
  const server = process.env.TURN_SERVER;
  if (!secret || !server) return null;

  const ttl = 24 * 3600; // 24h
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = timestamp + ':madladslab';
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  return {
    iceServers: [
      { urls: 'stun:' + server + ':3478' },
      { urls: 'turn:' + server + ':3478', username, credential },
      { urls: 'turn:' + server + ':3478?transport=tcp', username, credential },
      { urls: 'turns:' + server + ':5349', username, credential },
    ],
  };
}

function optionalAuth(req, res, next) {
  // Attach user if logged in, but don't block
  next();
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Login required' });
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  const u = req.user;
  if (u.isAdmin === true || (u.permissions && u.permissions.games === 'admin')) return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ── Public: list active broadcasts ──
router.get('/api/list', (req, res) => {
  res.json({ broadcasts: broadcasts.listBroadcasts() });
});

// ── Public: broadcast info ──
router.get('/api/:code/info', (req, res) => {
  const b = broadcasts.getBroadcast(req.params.code);
  if (!b) return res.status(404).json({ error: 'Broadcast not found' });
  res.json({ broadcast: broadcasts.serializeBroadcast(b, true) });
});

// ── Public: QR code PNG ──
router.get('/api/:code/qr', async (req, res) => {
  const code = req.params.code;
  const b = broadcasts.getBroadcast(code);
  if (!b) return res.status(404).json({ error: 'Broadcast not found' });
  const url = `https://games.madladslab.com/broadcasts/${code}`;
  try {
    const buf = await QRCode.toBuffer(url, {
      width: 300,
      margin: 2,
      color: { dark: '#cd412b', light: '#0d0d0d' },
    });
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ── Admin: create broadcast (tied to game server start) ──
router.post('/api/create', requireAdmin, (req, res) => {
  const { game } = req.body;
  if (!game) return res.status(400).json({ error: 'game is required' });

  // Check if game already has an active broadcast
  const existing = broadcasts.getBroadcastByGame(game);
  if (existing) {
    return res.json({ ok: true, broadcast: broadcasts.serializeBroadcast(existing, false), existing: true });
  }

  const b = broadcasts.createBroadcast(req.user, game);
  res.json({ ok: true, broadcast: broadcasts.serializeBroadcast(b, false) });
});

// ── Admin: end broadcast ──
router.post('/api/:code/end', requireAdmin, (req, res) => {
  const b = broadcasts.getBroadcast(req.params.code);
  if (!b) return res.status(404).json({ error: 'Broadcast not found' });
  if (b.host.id !== req.user._id.toString() && req.user.isAdmin !== true) {
    return res.status(403).json({ error: 'Only the broadcaster can end this' });
  }
  broadcasts.endBroadcast(req.params.code);
  res.json({ ok: true });
});

// ── Public: per-broadcast stats (live snapshot + host lifetime totals) ──
// Used by the title card on landing.html and broadcast.html. Host identity
// in the response is anonymized via `host.handle` — name is only included
// for live broadcasts since the host is actively self-publishing.
router.get('/api/:code/stats', async (req, res) => {
  try {
    const stats = await broadcasts.getBroadcastStats(req.params.code);
    if (!stats) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Auth: current user's own broadcast stats ──
router.get('/api/stats/me', requireAuth, async (req, res) => {
  try {
    const stats = await broadcasts.getUserStats(req.user._id.toString());
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Public: anonymized per-user stats by handle (user_<8hex>) ──
// Real userIds are NOT exposed in the response; the URL also accepts a
// userId but the lookup result is the same anonymized projection.
router.get('/api/stats/user/:handle', async (req, res) => {
  try {
    const stats = await broadcasts.getPublicUserStats(req.params.handle);
    if (!stats) return res.status(404).json({ error: 'No stats for this user' });
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Public: anonymized leaderboard ──
// sort ∈ {airtime, broadcasts, peakViewers, uniqueViewers, watch}
router.get('/api/stats/leaderboard', async (req, res) => {
  try {
    const rows = await broadcasts.getLeaderboard(req.query.sort, req.query.limit);
    res.json({ leaderboard: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Public: recently-ended sessions (no hostId leak) ──
router.get('/api/stats/sessions', async (req, res) => {
  try {
    const rows = await broadcasts.getRecentSessions(req.query.game || null, req.query.limit);
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Auth: current user info ──
router.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ id: null, username: null, role: 'viewer', authed: false });
  const u = req.user;
  res.json({
    id: u._id.toString(),
    username: username.displayFor(u),
    handle: broadcasts.anonHandle(u._id.toString()),
    role: broadcasts.getUserRole(u),
    authed: true,
  });
});

// ── Public: ICE server config (with TURN credentials) ──
router.get('/api/ice', (req, res) => {
  const turn = getTurnCredentials();
  if (!turn) {
    return res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }
  res.json(turn);
});

// ── Public: broadcast viewer page ──
router.get('/:code', (req, res) => {
  res.sendFile('broadcast.html', { root: __dirname + '/../public' });
});

module.exports = router;
