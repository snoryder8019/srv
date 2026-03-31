'use strict';

const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const broadcasts = require('../lib/broadcasts');
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

// ── Auth: current user info ──
router.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ id: null, name: null, role: 'viewer', authed: false });
  const u = req.user;
  res.json({
    id: u._id.toString(),
    name: u.displayName || u.firstName || u.email,
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
