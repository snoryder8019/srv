const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const QRCode = require('qrcode');
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');
const l4d2 = require('../lib/l4d2');
const sdtd = require('../lib/7dtd');
const se = require('../lib/se');
const palworld = require('../lib/palworld');
const windrose = require('../lib/windrose');
const wallet = require('../lib/wallet');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const u = req.user;
  const gamesPerm = u.permissions && u.permissions.get ? u.permissions.get('games') : (u.permissions || {})['games'];
  if (u.isAdmin || gamesPerm === 'admin') return next();
  res.status(403).json({ error: 'Forbidden — admin required' });
}

// --- Rust server ---

router.get('/rust/status', requireAuth, async (req, res) => {
  try {
    const status = await rust.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/rust/start', requireAdmin, (req, res) => {
  const result = rust.startServer();
  res.json(result);
});

router.post('/rust/stop', requireAdmin, (req, res) => {
  const result = rust.stopServer('manual stop');
  res.json(result);
});

router.post('/rust/restart', requireAdmin, (req, res) => {
  const result = rust.restartServer();
  res.json(result);
});

router.post('/rust/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await rust.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Plugins ---

router.get('/rust/plugins', requireAdmin, (req, res) => {
  res.json(rust.getPlugins());
});

router.post('/rust/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  const result = rust.togglePlugin(req.params.filename, enable);
  res.json(result);
});

// --- Valheim server ---

router.get('/valheim/status', requireAuth, async (req, res) => {
  try {
    const status = await valheim.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/valheim/start', requireAdmin, (req, res) => {
  res.json(valheim.startServer());
});

router.post('/valheim/stop', requireAdmin, (req, res) => {
  res.json(valheim.stopServer('manual stop'));
});

router.post('/valheim/restart', requireAdmin, (req, res) => {
  res.json(valheim.restartServer());
});

router.get('/valheim/plugins', requireAdmin, (req, res) => {
  res.json(valheim.getPlugins());
});

router.post('/valheim/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(valheim.togglePlugin(req.params.filename, enable));
});

// --- Left 4 Dead 2 ---

router.get('/l4d2/status', requireAuth, async (req, res) => {
  try { res.json(await l4d2.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/l4d2/start', requireAdmin, (req, res) => { res.json(l4d2.startServer()); });
router.post('/l4d2/stop', requireAdmin, (req, res) => { res.json(l4d2.stopServer('manual stop')); });
router.post('/l4d2/restart', requireAdmin, (req, res) => { res.json(l4d2.restartServer()); });

router.get('/l4d2/plugins', requireAdmin, (req, res) => { res.json(l4d2.getPlugins()); });

router.post('/l4d2/plugins/:filename/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(l4d2.togglePlugin(req.params.filename, enable));
});

// --- 7 Days to Die ---

router.get('/7dtd/status', requireAuth, async (req, res) => {
  try { res.json(await sdtd.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/7dtd/start', requireAdmin, (req, res) => { res.json(sdtd.startServer()); });
router.post('/7dtd/stop', requireAdmin, (req, res) => { res.json(sdtd.stopServer('manual stop')); });
router.post('/7dtd/restart', requireAdmin, (req, res) => { res.json(sdtd.restartServer()); });

router.get('/7dtd/mods', requireAdmin, (req, res) => { res.json(sdtd.getMods()); });

router.post('/7dtd/mods/:modname/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(sdtd.toggleMod(req.params.modname, enable));
});

// --- Space Engineers ---

router.get('/se/status', requireAuth, async (req, res) => {
  try { res.json(await se.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/se/start', requireAdmin, (req, res) => { res.json(se.startServer()); });
router.post('/se/stop', requireAdmin, (req, res) => { res.json(se.stopServer('manual stop')); });
router.post('/se/restart', requireAdmin, (req, res) => { res.json(se.restartServer()); });

router.post('/se/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await se.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/se/mods', requireAdmin, (req, res) => { res.json(se.getMods()); });

router.post('/se/mods/:modname/toggle', requireAdmin, (req, res) => {
  const { enable } = req.body;
  res.json(se.toggleMod(req.params.modname, enable));
});

// --- Palworld ---

router.get('/palworld/status', requireAuth, async (req, res) => {
  try { res.json(await palworld.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/palworld/start', requireAdmin, (req, res) => { res.json(palworld.startServer()); });
router.post('/palworld/stop', requireAdmin, (req, res) => { res.json(palworld.stopServer('manual stop')); });
router.post('/palworld/restart', requireAdmin, (req, res) => { res.json(palworld.restartServer()); });

router.post('/palworld/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const output = await palworld.rconCommand(cmd);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Windrose ---

router.get('/windrose/status', requireAuth, async (req, res) => {
  try { res.json(await windrose.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/windrose/start', requireAdmin, (req, res) => { res.json(windrose.startServer()); });
router.post('/windrose/stop', requireAdmin, (req, res) => { res.json(windrose.stopServer('manual stop')); });
router.post('/windrose/restart', requireAdmin, (req, res) => { res.json(windrose.restartServer()); });

router.post('/windrose/rcon', requireAdmin, async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const result = await windrose.rconCommand(cmd, { adminUser: req.user && req.user.email });
    res.json({ output: result.message, status: result.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Auth ---

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const gamesPerm = u.permissions && u.permissions.get ? u.permissions.get('games') : (u.permissions || {})['games'];
  const isAdmin = u.isAdmin || gamesPerm === 'admin';
  // Only the public-safe handle is returned to the browser. displayName/email
  // never leave the server through this endpoint; the dashboard renders the
  // username only.
  res.json({
    id: u._id,
    username: require('../lib/username').displayFor(u),
    isAdmin,
    premium: !!u.premium,
    // World-saves dropdown shows for admins + premium subscribers.
    canManageWorlds: isAdmin || !!u.premium,
  });
});

// Per-game Discord voice invites. The discord bot mints temporary invites for
// each game's stats voice channel and stores the codes in its config.json.
// `temporary: true` means non-members get kicked when they disconnect from
// voice, so the invite scope is effectively just that channel.
const DISCORD_CONFIG_PATH = path.join(__dirname, '..', 'discord', 'config.json');
router.get('/discord/voice-invites', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(DISCORD_CONFIG_PATH, 'utf8'));
    const codes = cfg.voiceInvites || {};
    const urls = {};
    for (const [k, code] of Object.entries(codes)) urls[k] = `https://discord.gg/${code}`;
    res.json(urls);
  } catch (e) {
    res.json({});
  }
});

// Landing-page share QR for games.madladslab.com. URL is static so the PNG is
// generated once and cached in memory.
const SHARE_URL = 'https://games.madladslab.com';
let shareQrBuf = null;
router.get('/share-qr', async (req, res) => {
  try {
    if (!shareQrBuf) {
      shareQrBuf = await QRCode.toBuffer(SHARE_URL, {
        width: 260,
        margin: 2,
        color: { dark: '#cd412b', light: '#0d0d0d' },
      });
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(shareQrBuf);
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// --- Web games (arcade): public leaderboard + recent results + your record ---
// Fed by the master-leaderboard ingest (/internal/webgame/score). Public reads
// are spectator data like the other /stats surfaces; /me is the signed-in user.
router.get('/webgame/leaderboard/:slug', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const rows = await db.collection('webgame_leaderboard')
      .find({ game: req.params.slug })
      .sort({ wins: -1, bestScore: -1, runs: -1 })
      .limit(limit).toArray();
    res.json({ ok: true, game: req.params.slug, leaderboard: rows.map((r) => ({
      displayName: r.displayName || 'Player', wins: r.wins || 0, runs: r.runs || 0,
      bestScore: r.bestScore || 0, lastPlayedAt: r.lastPlayedAt || null,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/webgame/recent/:slug', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);
    const rows = await db.collection('webgame_scores')
      .find({ game: req.params.slug, event: 'game-end' })
      .sort({ ts: -1 }).limit(limit).toArray();
    res.json({ ok: true, game: req.params.slug, results: rows.map((r) => ({
      displayName: r.displayName || 'Player', status: r.status,
      score: r.score || 0, opponentScore: (r.meta && r.meta.opponentScore != null) ? r.meta.opponentScore : null,
      partner: (r.meta && r.meta.partner) || null, ts: r.ts,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/webgame/me', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const pid = String(req.user._id);
    const stats = await db.collection('webgame_leaderboard').find({ platformId: pid }).toArray();
    const recent = await db.collection('webgame_scores')
      .find({ platformId: pid, event: 'game-end' }).sort({ ts: -1 }).limit(10).toArray();
    res.json({ ok: true,
      stats: stats.map((s) => ({ game: s.game, wins: s.wins || 0, runs: s.runs || 0, bestScore: s.bestScore || 0, lastPlayedAt: s.lastPlayedAt || null })),
      recent: recent.map((r) => ({ game: r.game, status: r.status, score: r.score || 0, opponentScore: (r.meta && r.meta.opponentScore) || 0, ts: r.ts })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Master cross-game leaderboard — aggregates webgame_leaderboard across all games
// into per-player totals (wins / games / win-rate). Powers the modal Leaderboards tab.
router.get('/webgame/leaderboard', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = await db.collection('webgame_leaderboard').find({}).toArray();
    const byPlayer = new Map();
    for (const r of rows) {
      const key = r.platformId || r.displayName;
      if (!key) continue;
      let e = byPlayer.get(key);
      if (!e) { e = { displayName: r.displayName || 'Player', wins: 0, runs: 0, games: new Set(), lastPlayedAt: null }; byPlayer.set(key, e); }
      e.wins += (r.wins || 0);
      e.runs += (r.runs || 0);
      if (r.game) e.games.add(r.game);
      if (r.displayName) e.displayName = r.displayName;
      if (r.lastPlayedAt && (!e.lastPlayedAt || r.lastPlayedAt > e.lastPlayedAt)) e.lastPlayedAt = r.lastPlayedAt;
    }
    const board = [...byPlayer.values()]
      .map((e) => ({ displayName: e.displayName, wins: e.wins, runs: e.runs,
        winRate: e.runs ? Math.round((e.wins / e.runs) * 100) : 0,
        gameCount: e.games.size, lastPlayedAt: e.lastPlayedAt }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.runs - a.runs)
      .slice(0, limit);
    res.json({ ok: true, leaderboard: board });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ───────────────────────── Chip wallet (public reads) ─────────────────────────
// The player's own balance (used by the portal + arcade chip pill).
router.get('/wallet/me', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const pid = String(req.user._id);
    const name = require("../lib/username").displayFor(req.user); // privacy: generated handle only, never real name/email
    const w = await wallet.getWallet(db, pid, name);
    const recent = await wallet.recentActivity(db, pid, 10);
    res.json({ ok: true, chips: w.chips, coins: w.coins || 0,
      biggestBetWon: w.biggestBetWon || 0, biggestBetGame: w.biggestBetGame || null,
      totalWagered: w.totalWagered || 0, totalWon: w.totalWon || 0,
      serverCoinsEarned: w.serverCoinsEarned || 0, recent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chip leaderboards: kind=chips (richest) or kind=bet (largest single bet won).
router.get('/wallet/leaderboard', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const kind = req.query.kind === 'bet' ? 'bet' : 'chips';
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const leaderboard = await wallet.leaderboard(db, kind, limit);
    res.json({ ok: true, kind, leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;