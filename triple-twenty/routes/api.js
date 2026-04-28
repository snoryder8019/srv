const router  = require('express').Router();
const fetch    = require('node-fetch');
const crypto   = require('crypto');
const Game     = require('../models/Game');
const Correction = require('../models/Correction');
const { apply501Round, applyCricketRound, isCricketWinner } = require('../lib/gameLogic');
const { captureFrameBase64 } = require('../lib/rtspCapture');

const OLLAMA_BASE = process.env.OLLAMA_BASE;
const OLLAMA_KEY  = process.env.OLLAMA_KEY;

// Tunnel timeouts (ms). Analyze calls get a longer budget; health probes short.
// Analyze default is 30s to accommodate llava:7b cold-start (model load from disk
// on first request after idle can exceed 15s). /dartboard/warm should be fired
// at game start to preload and keep cold-starts off the critical path.
const OLLAMA_TIMEOUT_ANALYZE = parseInt(process.env.OLLAMA_TIMEOUT_ANALYZE || '30000', 10);
const OLLAMA_TIMEOUT_HEALTH  = parseInt(process.env.OLLAMA_TIMEOUT_HEALTH  || '3500', 10);
const OLLAMA_TIMEOUT_WARM    = parseInt(process.env.OLLAMA_TIMEOUT_WARM    || '2500', 10);

function ollamaFetch(path, opts = {}) {
  const timeoutMs = opts.timeoutMs || OLLAMA_TIMEOUT_ANALYZE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _omit, ...fetchOpts } = opts;
  return fetch(`${OLLAMA_BASE}${path}`, {
    ...fetchOpts,
    signal: controller.signal,
    headers: { 'Authorization': `Bearer ${OLLAMA_KEY}`, 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) }
  }).finally(() => clearTimeout(timer));
}

// Cluster /dartboard/analyze now accepts a raw JPEG body with
// Content-Type: image/jpeg, which saves ~33% tunnel bandwidth vs base64 JSON.
// There is also a 2 MB hard cap on the binary body (413 + socket close over).
// We still accept base64 from the client (camera.js/remote.ejs send that),
// and decode on the server boundary so the tunnel hop is binary.
const OLLAMA_ANALYZE_MAX_BYTES = 2 * 1024 * 1024;
function analyzeFrame(base64OrDataUrl) {
  const cleaned = String(base64OrDataUrl || '').replace(/^data:[^,]+,/, '');
  const buf = Buffer.from(cleaned, 'base64');
  const kb = Math.round(buf.length / 1024);
  if (buf.length > OLLAMA_ANALYZE_MAX_BYTES) {
    console.warn(`[analyze] frame ${kb}KB exceeds 2MB cluster cap — cluster will 413`);
  }
  console.log(`[analyze] POST /dartboard/analyze ${kb}KB binary`);
  return ollamaFetch('/dartboard/analyze', {
    method: 'POST',
    body: buf,
    headers: { 'Content-Type': 'image/jpeg' }
  });
}

// ── Health cache: coalesces N concurrent clients into 1 upstream probe ──
// N open tabs no longer mean N tunnel probes. TTL chosen so client poll
// at 30s still gets fresh data, but bursts collapse to 1 upstream call.
const HEALTH_CACHE_TTL = parseInt(process.env.HEALTH_CACHE_TTL || '15000', 10);
let _healthCache = { at: 0, payload: null, inflight: null };

async function _computeHealth() {
  const out = { status: 'ok', backend: {}, dartboard: { status: 'unknown' } };
  try {
    const resp = await fetch(`${OLLAMA_BASE}/health`, { timeout: OLLAMA_TIMEOUT_HEALTH });
    out.backend = await resp.json();
  } catch (err) {
    out.backend = { status: 'unreachable', error: err.message };
  }
  try {
    const probe = await ollamaFetch('/dartboard/analyze', {
      method: 'POST', body: JSON.stringify({ probe: true }),
      timeoutMs: OLLAMA_TIMEOUT_HEALTH
    });
    if (probe.status === 404)      out.dartboard = { status: 'missing',   note: 'dartboard model not deployed on tunnel' };
    else if (probe.status === 401) out.dartboard = { status: 'unauthorized' };
    else if (probe.ok || probe.status === 400) out.dartboard = { status: 'up' };
    else                           out.dartboard = { status: 'error', code: probe.status };
  } catch (err) {
    out.dartboard = { status: 'unreachable', error: err.message };
  }
  out.cachedAt = new Date().toISOString();
  return out;
}

function getHealthCached() {
  const now = Date.now();
  if (_healthCache.payload && (now - _healthCache.at) < HEALTH_CACHE_TTL) {
    return Promise.resolve(_healthCache.payload);
  }
  if (_healthCache.inflight) return _healthCache.inflight;
  _healthCache.inflight = _computeHealth()
    .then(payload => { _healthCache = { at: Date.now(), payload, inflight: null }; return payload; })
    .catch(err => {
      _healthCache.inflight = null;
      const fallback = {
        status: 'ok',
        backend:   { status: 'unreachable', error: err.message },
        dartboard: { status: 'unreachable', error: err.message },
        cachedAt: new Date().toISOString()
      };
      _healthCache = { at: Date.now(), payload: fallback, inflight: null };
      return fallback;
    });
  return _healthCache.inflight;
}

// Helpers using req.io (attached in app.js middleware)
const notifyUser = (io, userId, event, payload) => io.notifyUser && io.notifyUser(userId, event, payload);
const lobbyUpdate = (io) => io.lobbyUpdate && io.lobbyUpdate();

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Login required' });
}

// ══════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════
router.get('/health', async (req, res) => {
  // Serves a shared cached snapshot. See getHealthCached() above.
  // Pass ?fresh=1 to force a live probe (still coalesced via inflight promise).
  try {
    if (req.query.fresh === '1') {
      _healthCache = { at: 0, payload: null, inflight: null };
    }
    const payload = await getHealthCached();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ══════════════════════════════════════════════════
// ACTIVE GAMES (lobby)
// ══════════════════════════════════════════════════
router.get('/active-games', async (req, res) => {
  try {
    const games = await Game.find({ status: { $in: ['active', 'waiting'] } })
      .sort({ updatedAt: -1 }).limit(8).lean();
    res.json({ games: games.map(g => ({
      _id: g._id, mode: g.mode, status: g.status, name: g.name,
      inviteCode: g.inviteCode,
      currentPlayerIndex: g.currentPlayerIndex,
      roundCount: (g.rounds || []).length,
      updatedAt: g.updatedAt,
      players: g.players.map(p => ({ name: p.name, remaining: p.remaining, cricketPoints: p.cricketPoints })),
      lastRound: g.rounds && g.rounds.length ? g.rounds[g.rounds.length - 1] : null
    })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// USER — dashboard + settings
// ══════════════════════════════════════════════════
router.get('/user/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const hosted = await Game.find({ hostUserId: userId }).sort({ updatedAt: -1 }).limit(50).lean();
    const joined = await Game.find({ 'players.userId': userId, hostUserId: { $ne: userId } })
      .sort({ updatedAt: -1 }).limit(50).lean();

    const summarize = games => games.map(g => ({
      _id: g._id, mode: g.mode, status: g.status, name: g.name,
      inviteCode: g.inviteCode, updatedAt: g.updatedAt, createdAt: g.createdAt,
      lastActivityAt: g.lastActivityAt,
      pausedFromStatus: g.pausedFromStatus,
      roundCount: (g.rounds || []).length,
      currentPlayerIndex: g.currentPlayerIndex,
      winner: g.winner,
      players: g.players.map(p => ({
        name: p.name, remaining: p.remaining,
        cricketPoints: p.cricketPoints,
        userId: p.userId ? p.userId.toString() : null
      }))
    }));

    res.json({
      user: {
        _id: req.user._id.toString(),
        displayName: req.user.displayName,
        avatar: req.user.avatar,
        email: req.user.email,
        stats: req.user.stats || {},
        notifyOnTurn: req.user.notifyOnTurn !== false,
        notifyOnChat: req.user.notifyOnChat || false
      },
      hosted: summarize(hosted),
      joined: summarize(joined)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/user/me', requireAuth, async (req, res) => {
  try {
    const User = require('../models/User');
    const { notifyOnTurn, notifyOnChat, displayName } = req.body;
    const update = {};
    if (notifyOnTurn  !== undefined) update.notifyOnTurn  = notifyOnTurn;
    if (notifyOnChat  !== undefined) update.notifyOnChat  = notifyOnChat;
    if (displayName)                 update.displayName   = displayName;
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    res.json({ ok: true, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// GAME CRUD
// ══════════════════════════════════════════════════
router.post('/game', async (req, res) => {
  try {
    const { mode, players, camera, name } = req.body;
    const inviteCode   = crypto.randomBytes(4).toString('hex').toUpperCase();
    const playerStates = players.map((p, i) => ({
      name: p.name,
      // Auto-link first player slot to the creating user (if logged in)
      userId: p.userId || (i === 0 && req.user ? req.user._id : undefined),
      token: crypto.randomBytes(6).toString('hex'),
      remaining: mode === '501' ? 501 : undefined
    }));
    const game = await Game.create({
      mode, players: playerStates, status: 'waiting',
      camera, inviteCode, name: name || null,
      hostUserId: req.user ? req.user._id : undefined
    });
    lobbyUpdate(req.io);
    res.json(game);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/game/:id', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    res.json(game);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/game/:id', requireAuth, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    if (String(game.hostUserId) !== String(req.user._id))
      return res.status(403).json({ error: 'Host only' });
    const { name, camera, status } = req.body;
    if (name   !== undefined) game.name   = name;
    if (camera !== undefined) { game.camera = { ...( game.camera?.toObject ? game.camera.toObject() : game.camera || {}), ...camera }; game.markModified('camera'); }
    if (status && ['waiting','archived'].includes(status)) game.status = status;
    await game.save();
    lobbyUpdate(req.io);
    res.json(game);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/game/:id', requireAuth, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    if (String(game.hostUserId) !== String(req.user._id))
      return res.status(403).json({ error: 'Host only' });
    game.status = 'archived';
    await game.save();
    req.io.to(`game:${game._id}`).emit('game-archived', { gameId: game._id });
    lobbyUpdate(req.io);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/game/:id/start', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    game.status = 'active';
    game.lastActivityAt = new Date();
    game.pausedFromStatus = null;
    await game.save();
    req.io.to(`game:${game._id}`).emit('game-started', { game });
    lobbyUpdate(req.io);
    _notifyTurn(game, req.io);
    // Fire-and-forget: preload llava:7b on the GPU so the first analyze
    // doesn't eat a cold-start. Short timeout — endpoint returns instantly.
    ollamaFetch('/dartboard/warm', { method: 'GET', timeoutMs: OLLAMA_TIMEOUT_WARM })
      .catch(() => {});
    res.json(game);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Resume an idle game: restores it to its previous status (active or waiting).
router.post('/game/:id/resume', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    // Only linked players (or host) can resume. Anyone can resume a game where
    // they occupy a slot, which matches the "it's still my game" expectation.
    if (req.user) {
      const isHost = String(game.hostUserId) === String(req.user._id);
      const isPlayer = game.players.some(p => p.userId && String(p.userId) === String(req.user._id));
      if (!isHost && !isPlayer) return res.status(403).json({ error: 'Not your game' });
    }
    if (game.status !== 'idle') {
      // Already running — just respond with current state
      return res.json({ ok: true, game, alreadyActive: true });
    }
    const restoreTo = game.pausedFromStatus || 'active';
    game.status = (restoreTo === 'waiting') ? 'waiting' : 'active';
    game.pausedFromStatus = null;
    game.lastActivityAt = new Date();
    await game.save();
    req.io.to(`game:${game._id}`).emit('game-resumed', { game: game.toObject() });
    lobbyUpdate(req.io);
    if (game.status === 'active') {
      _notifyTurn(game, req.io);
      ollamaFetch('/dartboard/warm', { method: 'GET', timeoutMs: OLLAMA_TIMEOUT_WARM })
        .catch(() => {});
    }
    res.json({ ok: true, game });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kick a player slot (host only)
router.post('/game/:id/kick/:playerIndex', requireAuth, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    if (String(game.hostUserId) !== String(req.user._id))
      return res.status(403).json({ error: 'Host only' });
    const pi = parseInt(req.params.playerIndex);
    if (game.players[pi]) {
      game.players[pi].name = '(open)';
      game.players[pi].userId = undefined;
      await game.save();
      req.io.to(`game:${game._id}`).emit('game-update', { game: game.toObject() });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Claim a player slot by name (logged-in user joining a game)
router.post('/game/:id/claim', requireAuth, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    const { name } = req.body;
    const pi = game.players.findIndex(p => p.name.toLowerCase() === (name || '').toLowerCase());
    if (pi === -1) return res.status(404).json({ error: 'Player slot not found' });
    game.players[pi].userId = req.user._id;
    await game.save();
    res.json({ ok: true, playerIndex: pi });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// JOIN (by invite code)
// ══════════════════════════════════════════════════
router.get('/join/:code', async (req, res) => {
  try {
    const game = await Game.findOne({ inviteCode: req.params.code.toUpperCase() });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // If logged in, auto-claim matching slot
    let claimedIndex = -1;
    if (req.user) {
      const existing = game.players.findIndex(p => p.userId && String(p.userId) === String(req.user._id));
      if (existing === -1) {
        // Try to match by display name
        const nameMatch = game.players.findIndex(
          p => !p.userId && p.name.toLowerCase() === req.user.displayName.toLowerCase()
        );
        if (nameMatch !== -1) {
          game.players[nameMatch].userId = req.user._id;
          await game.save();
          claimedIndex = nameMatch;
        }
      } else {
        claimedIndex = existing;
      }
    }

    res.json({
      _id: game._id, mode: game.mode, status: game.status,
      inviteCode: game.inviteCode, name: game.name,
      claimedIndex,
      currentPlayerIndex: game.currentPlayerIndex,
      players: game.players.map(p => ({
        name: p.name, token: p.token,
        remaining: p.remaining, cricketPoints: p.cricketPoints,
        hasUser: !!p.userId,
        isMe: req.user ? String(p.userId) === String(req.user._id) : false
      })),
      rounds: game.rounds
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// CAMERA PROXIES
// ══════════════════════════════════════════════════
router.post('/proxy-snapshot', async (req, res) => {
  try {
    const { ip, username, password } = req.body;
    if (!ip) return res.status(400).json({ error: 'No IP' });
    const url = username && password
      ? `http://${username}:${password}@${ip}/cgi-bin/snapshot.cgi`
      : `http://${ip}/cgi-bin/snapshot.cgi`;
    const response = await fetch(url, { timeout: 5000 });
    if (!response.ok) throw new Error(`Camera ${response.status}`);
    res.json({ image: (await response.buffer()).toString('base64') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/game/:id/snapshot', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game || !game.camera?.ip) return res.status(400).json({ error: 'No camera' });
    res.json({ image: await captureFrameBase64(game.camera) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/game/:id/capture', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    let base64;
    if (game.camera?.ip) base64 = await captureFrameBase64(game.camera);
    else if (req.body.image) base64 = req.body.image;
    else return res.status(400).json({ error: 'No image source' });
    const analysis = await (await analyzeFrame(base64)).json();
    analysis.frame = base64;
    req.io.to(`game:${game._id}`).emit('analysis-result', { analysis, frame: base64 });
    res.json(analysis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// ANALYZE
// ══════════════════════════════════════════════════
router.post('/analyze', async (req, res) => {
  try {
    const { image, gameId, playerIndex } = req.body;
    const upstream = await analyzeFrame(image);
    let analysis;
    if (upstream.status === 404) {
      // No dartboard model deployed on the tunnel yet — return a neutral payload
      // so the UI can degrade gracefully and learning-mode still captures truth.
      analysis = {
        darts: [], total: 0, confidence: 'unavailable',
        note: 'dartboard model not deployed on tunnel (404)',
        available: false
      };
    } else if (upstream.status === 413) {
      analysis = {
        darts: [], total: 0, confidence: 'error',
        note: 'frame exceeds 2MB cluster cap', available: false
      };
    } else if (!upstream.ok) {
      analysis = {
        darts: [], total: 0, confidence: 'error',
        note: `backend ${upstream.status}`, available: false
      };
    } else {
      analysis = await upstream.json();
      analysis.available = true;
    }
    if (gameId) {
      req.io.to(`game:${gameId}`).emit('analysis-result', {
        analysis, frame: image,
        forPlayerIndex: playerIndex !== undefined ? playerIndex : null
      });
      req.io.emit('lobby-frame', { gameId, playerIndex: playerIndex || 0, frame: image, analysis });
    }
    res.json(analysis);
  } catch (err) {
    res.json({
      darts: [], total: 0, confidence: 'error',
      note: err.message, available: false, error: err.message
    });
  }
});

// ══════════════════════════════════════════════════
// SUBMIT ROUND
// ══════════════════════════════════════════════════
router.post('/game/:id/round', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game || game.status !== 'active')
      return res.status(400).json({ error: 'Game not active' });

    const { darts, confidence, frameId } = req.body;
    const pi     = game.currentPlayerIndex;
    const player = game.players[pi];
    let roundTotal = 0;

    if (game.mode === '501') {
      const result     = apply501Round(player, darts);
      player.remaining = result.remaining;
      roundTotal       = result.total;
      if (result.busted) roundTotal = 0;
      if (result.won) { game.status = 'finished'; game.winner = pi; }
    } else {
      // Cricket: multi-player safe. Pass ALL opponents (empty array if solo).
      const opponents = game.players.filter((_, idx) => idx !== pi);
      const result    = applyCricketRound(player, darts, opponents);
      player.marks         = result.marks;
      player.cricketPoints = result.cricketPoints;
      roundTotal           = result.pointsScored;
      if (isCricketWinner(player, opponents)) { game.status = 'finished'; game.winner = pi; }
    }

    game.rounds.push({ playerIndex: pi, darts, total: roundTotal, confidence, frameId, timestamp: new Date() });
    if (game.status === 'active') game.currentPlayerIndex = (pi + 1) % game.players.length;
    game.lastActivityAt = new Date();

    await game.save();
    const gameObj = game.toObject();

    req.io.to(`game:${game._id}`).emit('game-update', { game: gameObj, soloMode: game.players.length <= 1, roundPlayerIndex: pi });
    req.io.emit('lobby-score-update', {
      gameId: game._id.toString(),
      soloMode: game.players.length <= 1,
      players: game.players.map(p => ({ name: p.name, remaining: p.remaining, cricketPoints: p.cricketPoints })),
      currentPlayerIndex: game.currentPlayerIndex,
      roundPlayerIndex: pi,
      lastRound: game.rounds[game.rounds.length - 1],
      roundCount: game.rounds.length
    });

    if (game.status === 'finished') {
      const winnerName = game.players[game.winner].name;
      req.io.to(`game:${game._id}`).emit('game-finished', { winner: winnerName, winnerIndex: game.winner, game: gameObj });
      lobbyUpdate(req.io);

      // Update User stats
      try {
        const User = require('../models/User');
        for (let i = 0; i < game.players.length; i++) {
          const p = game.players[i];
          if (!p.userId) continue;
          const playerRounds = game.rounds.filter(r => r.playerIndex === i);
          const totalScore   = playerRounds.reduce((s, r) => s + r.total, 0);
          const avgPerRound  = playerRounds.length ? Math.round(totalScore / playerRounds.length) : 0;
          const isWinner     = game.winner === i;
          await User.findByIdAndUpdate(p.userId, {
            $inc: {
              'stats.gamesPlayed': 1,
              'stats.gamesWon':    isWinner ? 1 : 0,
              'stats.totalDartsThrown': playerRounds.reduce((s, r) => s + (r.darts?.length || 0), 0)
            },
            $max: { 'stats.highScore': Math.max(...playerRounds.map(r => r.total), 0) }
          });
          // Recalculate average (weighted) — simple approach: just overwrite
          const user = await User.findById(p.userId);
          if (user && user.stats.gamesPlayed > 0) {
            // Keep a rolling average using new game's avg
            const prevAvg = user.stats.averagePerRound || 0;
            const prevGames = user.stats.gamesPlayed;
            const newAvg = Math.round((prevAvg * (prevGames - 1) + avgPerRound) / prevGames);
            await User.findByIdAndUpdate(p.userId, { 'stats.averagePerRound': newAvg });
          }
        }
      } catch (statsErr) {
        console.error('Stats update error:', statsErr.message);
      }

      // Notify all players game is over
      game.players.forEach(p => {
        if (p.userId) notifyUser(req.io, p.userId, 'game-notification', {
          type: 'game-over',
          gameId: game._id.toString(),
          gameName: _gameName(game),
          message: `🏆 Game over — ${winnerName} wins!`,
          link: `/game/${game._id}`
        });
      });
    } else {
      _notifyTurn(game, req.io);
    }

    res.json(game);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Fire your-turn notification to the active player ──
function _notifyTurn(game, io) {
  // Solo: no cross-device notification needed — the only player is already here.
  if (game.players.length <= 1) return;
  const p = game.players[game.currentPlayerIndex];
  if (!p || !p.userId) return;
  const score = game.mode === '501' ? `${p.remaining} remaining` : `${p.cricketPoints || 0} pts`;
  notifyUser(io, p.userId, 'your-turn', {
    gameId:     game._id.toString(),
    gameName:   _gameName(game),
    mode:       game.mode,
    soloMode:   false,
    score,
    link:       `/camera/${game._id}`,
    remoteLink: `/remote/${game.inviteCode}`
  });
}

function _gameName(game) {
  return game.name || `${game.mode.toUpperCase()} · ${game.players.map(p => p.name).join(' vs ')}`;
}


// ══════════════════════════════════════════════════
// TRAINING SAMPLES (learning mode)
// Records human-entered truth + frame for future fine-tuning.
// Also auto-compares vs the current AI result if supplied.
// ══════════════════════════════════════════════════
router.post('/training-sample', async (req, res) => {
  try {
    const { gameId, frame, truth, aiResult, note, learningMode } = req.body;
    // Reuse the Correction collection — a training sample is just a labeled
    // correction. `ai` may be null if the model isn't available.
    const correction = await Correction.create({
      gameId, frameId: new Date().toISOString(),
      ai:        aiResult ? { darts: aiResult.darts || [], total: aiResult.total || 0 } : { darts: [], total: 0 },
      corrected: { darts: truth.darts || [], total: truth.total || 0 },
      note: note || (learningMode ? 'learning-mode sample' : 'manual truth')
    });
    const total = await Correction.countDocuments();
    res.json({ ok: true, id: correction._id, totalSamples: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════
// CORRECTIONS
// ══════════════════════════════════════════════════
router.post('/correct', async (req, res) => {
  try {
    const { gameId, frameId, ai, corrected, note } = req.body;
    const correction = await Correction.create({ gameId, frameId, ai, corrected, note });
    const total = await Correction.countDocuments();
    res.json({ ok: true, id: correction._id, totalCorrections: total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/corrections', async (req, res) => {
  try {
    const corrections = await Correction.find().sort({ createdAt: -1 }).limit(50);
    res.json({ corrections, total: await Correction.countDocuments() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// LEADERBOARD + H2H
// ══════════════════════════════════════════════════
router.get('/leaderboard', async (req, res) => {
  try {
    const games = await Game.find({ status: 'finished' }).sort({ createdAt: -1 }).limit(100);
    const stats = {};
    for (const g of games) {
      g.players.forEach((p, i) => {
        if (!stats[p.name]) stats[p.name] = { name: p.name, wins:0, losses:0, games:0, totalScore:0, rounds:0 };
        stats[p.name].games++;
        if (g.winner === i) stats[p.name].wins++; else stats[p.name].losses++;
        g.rounds.forEach(r => { if (r.playerIndex===i) { stats[p.name].totalScore+=r.total; stats[p.name].rounds++; } });
      });
    }
    const board = Object.values(stats).map(s => ({
      ...s,
      winRate:     s.games  ? Math.round(s.wins/s.games*100)       : 0,
      avgPerRound: s.rounds ? Math.round(s.totalScore/s.rounds)    : 0
    })).sort((a,b) => b.wins-a.wins || b.winRate-a.winRate);
    const recentGames = games.slice(0,20).map(g => ({
      _id: g._id, mode: g.mode,
      players: g.players.map(p=>p.name),
      winner: g.winner!=null ? g.players[g.winner]?.name : null,
      rounds: g.rounds.length, createdAt: g.createdAt
    }));
    res.json({ board, recentGames });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/h2h/:player1/:player2', async (req, res) => {
  try {
    const { player1, player2 } = req.params;
    const games = await Game.find({ status:'finished', 'players.name':{ $all:[player1,player2] } })
      .sort({ createdAt:-1 }).limit(20);
    let p1wins=0, p2wins=0;
    const history = games.map(g => {
      const p1i = g.players.findIndex(p=>p.name===player1);
      const p2i = g.players.findIndex(p=>p.name===player2);
      const won = g.winner===p1i ? player1 : g.winner===p2i ? player2 : null;
      if (won===player1) p1wins++; if (won===player2) p2wins++;
      return { _id:g._id, mode:g.mode, winner:won, createdAt:g.createdAt };
    });
    res.json({ player1, player2, p1wins, p2wins, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
