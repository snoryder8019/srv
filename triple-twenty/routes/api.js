const router  = require('express').Router();
const fetch    = require('node-fetch');
const crypto   = require('crypto');
const Game     = require('../models/Game');
const Correction = require('../models/Correction');
const { apply501Round, applyCricketRound, isCricketWinner } = require('../lib/gameLogic');
const { captureFrameBase64 } = require('../lib/rtspCapture');
const { saveFrameBase64, frameDirStats } = require('../lib/frameStorage');

const OLLAMA_BASE = process.env.OLLAMA_BASE;
const OLLAMA_KEY  = process.env.OLLAMA_KEY;

// In-memory cache of the most recent analyzed frame + AI result per game.
// Populated by /api/analyze, consumed by the round-submit handler so every
// confirmed round auto-creates a training sample with frame + AI + truth —
// regardless of whether the scoring client (host/remote/phone) wired its own
// /api/training-sample call. Bounded to last N games to avoid unbounded growth.
const lastAnalysisByGame = new Map();
const LAST_ANALYSIS_CAP  = 50;
function cacheLastAnalysis(gameId, frame, analysis) {
  if (!gameId || !frame) return;
  if (lastAnalysisByGame.size >= LAST_ANALYSIS_CAP) {
    const oldest = lastAnalysisByGame.keys().next().value;
    if (oldest) lastAnalysisByGame.delete(oldest);
  }
  lastAnalysisByGame.set(String(gameId), { frame, analysis, ts: Date.now() });
}

// Tunnel timeouts (ms). Analyze calls get a longer budget; health probes short.
// Analyze default is 30s to accommodate llava:7b cold-start (model load from disk
// on first request after idle can exceed 15s). /dartboard/warm should be fired
// at game start to preload and keep cold-starts off the critical path.
const OLLAMA_TIMEOUT_ANALYZE = parseInt(process.env.OLLAMA_TIMEOUT_ANALYZE || '45000', 10);
// Health probe sends a real 1×1 JPEG which forces actual inference. Slower
// models like minicpm-v take ~15-22 s to respond, so the budget here must
// accommodate them or the chip flashes "AI hung" while inference is fine.
const OLLAMA_TIMEOUT_HEALTH  = parseInt(process.env.OLLAMA_TIMEOUT_HEALTH  || '25000', 10);
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

// Cluster /dartboard/analyze accepts either a raw JPEG body (Content-Type:
// image/jpeg, 2 MB hard cap) or JSON `{image, examples?, reference?, dartIndex?}`.
// Binary path is faster but cannot carry few-shot examples; when we want the
// cluster to inject mongo corrections into buildScoringPrompt(), we switch to
// the JSON path.
const OLLAMA_ANALYZE_MAX_BYTES = 2 * 1024 * 1024;
const FEW_SHOT_LIMIT = 6;

// Pull few-shot examples from mongo for the cluster's buildScoringPrompt().
// VALIDATED ONLY — unvalidated corrections can poison the pool (e.g. when
// every recent AI-side is the same canned response, the model learns "don't
// predict that" and over-corrects to "no darts visible"). Curated wins.
// Returns [] if no validated entries → analyzeFrame falls back to the binary
// path (no examples), which is safer than a biased pool.
async function loadFewShotExamples() {
  try {
    // Validated only — user-curated. Truth must be present; AI side may be
    // empty (and often is, when minicpm-v returns prose that parse-fails).
    // An empty AI on a real dart frame is itself a useful training signal:
    // "AI said {} → correct is {S20, S5, S1}" tells the model it missed real
    // darts. We just exclude entries whose AI side is the obvious canned
    // poison pattern (3 bull-area scores totaling 150).
    const cursor = await Correction.find({
      validated: true,
      'corrected.darts': { $exists: true, $ne: [] }
    }).sort({ createdAt: -1 }).limit(FEW_SHOT_LIMIT * 2).lean();
    const filtered = cursor.filter(c => {
      const ai = c.ai?.darts || [];
      if (ai.length !== 3) return true;
      const isBullPattern = ai.every(d =>
        d && (d.ring === 'inner_bull' || d.ring === 'outer_bull')) &&
        (c.ai?.total === 150);
      return !isBullPattern;
    }).slice(0, FEW_SHOT_LIMIT);
    return filtered.map(c => ({
      ai:        c.ai || { darts: [], total: 0 },
      corrected: c.corrected,
      note:      c.note || ''
    }));
  } catch (e) {
    console.warn('[few-shot] load failed:', e.message);
    return [];
  }
}

function analyzeFrame(base64OrDataUrl, examples) {
  const cleaned = String(base64OrDataUrl || '').replace(/^data:[^,]+,/, '');
  const buf = Buffer.from(cleaned, 'base64');
  const kb = Math.round(buf.length / 1024);
  if (buf.length > OLLAMA_ANALYZE_MAX_BYTES) {
    console.warn(`[analyze] frame ${kb}KB exceeds 2MB cluster cap — cluster will 413`);
  }
  if (Array.isArray(examples) && examples.length > 0) {
    // JSON path: ship base64 + examples so the cluster can do few-shot.
    const b64 = buf.toString('base64');
    console.log(`[analyze] POST /dartboard/analyze ${kb}KB json (examples=${examples.length})`);
    return ollamaFetch('/dartboard/analyze', {
      method: 'POST',
      body: JSON.stringify({ image: b64, examples }),
      headers: { 'Content-Type': 'application/json' }
    });
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

// Tiny 1×1 JPEG used as the dartboard health probe. The previous probe sent
// `{probe: true}` which the upstream wrapper acknowledges WITHOUT invoking
// the model — so a dead model runner read as "up". Sending a real (if
// trivial) image forces actual inference, which exposes model crashes.
const _TINY_JPEG_BUF = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APvQ/9k=',
  'base64'
);

async function _computeHealth() {
  const out = { status: 'ok', backend: {}, dartboard: { status: 'unknown' } };
  let backendReachable = false;
  try {
    const resp = await fetch(`${OLLAMA_BASE}/health`, { timeout: OLLAMA_TIMEOUT_HEALTH });
    out.backend = await resp.json();
    backendReachable = (out.backend?.status === 'ok' || out.backend?.tunnel?.status === 'up');
  } catch (err) {
    out.backend = { status: 'unreachable', error: err.message };
  }
  try {
    const probe = await ollamaFetch('/dartboard/analyze', {
      method: 'POST',
      body: _TINY_JPEG_BUF,
      headers: { 'Content-Type': 'image/jpeg' },
      timeoutMs: OLLAMA_TIMEOUT_HEALTH
    });
    if (probe.status === 404) {
      out.dartboard = { status: 'missing', note: 'dartboard model not deployed on tunnel' };
    } else if (probe.status === 401) {
      out.dartboard = { status: 'unauthorized' };
    } else if (probe.ok) {
      const body = await probe.json().catch(() => null);
      if (body && isUpstreamModelCrash(body)) {
        out.dartboard = { status: 'crashed', note: body.note };
      } else {
        out.dartboard = { status: 'up' };
      }
    } else if (probe.status === 400) {
      // 400 means our image was rejected as malformed but the model is alive.
      out.dartboard = { status: 'up' };
    } else {
      out.dartboard = { status: 'error', code: probe.status };
    }
  } catch (err) {
    // If we just confirmed the tunnel/backend is up via /health, a probe
    // failure here means the model is hung or crashed — NOT that the tunnel
    // is down. Mark accordingly so the UI doesn't flash "Tunnel offline"
    // when the tunnel is actually serving traffic.
    out.dartboard = backendReachable
      ? { status: 'crashed', error: err.message, note: 'tunnel up but dartboard model not responding' }
      : { status: 'unreachable', error: err.message };
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
    const startRemaining = mode === '301' ? 301 : mode === '501' ? 501 : undefined;
    const playerStates = players.map((p, i) => ({
      name: p.name,
      // Auto-link first player slot to the creating user (if logged in)
      userId: p.userId || (i === 0 && req.user ? req.user._id : undefined),
      token: crypto.randomBytes(6).toString('hex'),
      remaining: startRemaining
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
// Upstream returns 200 with a `note` like "ollama error: model runner has
// unexpectedly stopped..." when the GPU model crashes (transient). Downgrade
// these to available:false so the UI doesn't treat the empty result as a
// real low-confidence read, and retry once after a short pause.
function isUpstreamModelCrash(payload) {
  const n = String(payload?.note || '').toLowerCase();
  return n.includes('model runner') || n.includes('unexpectedly stopped') ||
         n.includes('internal error') || n.includes('out of memory');
}

router.post('/analyze', async (req, res) => {
  try {
    const { image, gameId, playerIndex } = req.body;
    const examples = await loadFewShotExamples();
    let upstream = await analyzeFrame(image, examples);
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
      if (isUpstreamModelCrash(analysis)) {
        console.warn('[analyze] upstream model crash — retrying once:', analysis.note);
        await new Promise(r => setTimeout(r, 800));
        try {
          const retry = await analyzeFrame(image, examples);
          if (retry.ok) {
            const retryBody = await retry.json();
            if (!isUpstreamModelCrash(retryBody)) {
              analysis = retryBody;
              analysis.available = true;
            } else {
              analysis = { darts: [], total: 0, confidence: 'unavailable',
                note: 'dartboard model crashed (retry also failed): ' + retryBody.note,
                available: false };
            }
          } else {
            analysis = { darts: [], total: 0, confidence: 'unavailable',
              note: `dartboard model crashed; retry status ${retry.status}`,
              available: false };
          }
        } catch (e) {
          analysis = { darts: [], total: 0, confidence: 'unavailable',
            note: 'dartboard model crashed; retry threw: ' + e.message,
            available: false };
        }
      } else {
        analysis.available = true;
      }
    }
    if (gameId) {
      cacheLastAnalysis(gameId, image, analysis);
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

    if (game.mode === '501' || game.mode === '301') {
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

    // Auto-log a training sample using the cached last frame for this game.
    // Fire-and-forget; never block the round response. Captures every confirmed
    // round regardless of which client (host/remote/phone) submitted it, so the
    // few-shot pool fills without depending on per-client wiring.
    (() => {
      try {
        const cached = lastAnalysisByGame.get(String(game._id));
        if (!cached || !cached.frame) return;
        // Only attach if the cached frame is reasonably fresh (within 30 s of submit)
        // to avoid pairing this round's truth with a stale frame from minutes ago.
        if (Date.now() - cached.ts > 30_000) return;
        const ai = cached.analysis || {};
        const aiDarts = Array.isArray(ai.darts) ? ai.darts : [];
        const aiTotal = ai.total ?? 0;
        const truthTotal = (darts || []).reduce((s, d) => s + (d.score || 0), 0);
        const sameLen = aiDarts.length === darts.length;
        const matched = sameLen && aiDarts.every((a, i) =>
          a && darts[i] && a.segment === darts[i].segment && a.ring === darts[i].ring);
        const note = !aiDarts.length ? 'autolog:no-ai' :
                     matched         ? 'autolog:match' : 'autolog:mismatch';
        const stored = saveFrameBase64(cached.frame);
        Correction.create({
          gameId: game._id,
          frameId: new Date().toISOString(),
          frameSha256: stored?.frameSha256,
          frameUrl:    stored?.frameUrl,
          frameBytes:  stored?.frameBytes,
          ai:        { darts: aiDarts, total: aiTotal },
          corrected: { darts, total: truthTotal },
          note,
          source: 'autolog'
        }).catch(e => console.warn('[autolog] insert failed:', e.message));
      } catch (e) {
        console.warn('[autolog] threw:', e.message);
      }
    })();

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
  const score = (game.mode === '501' || game.mode === '301') ? `${p.remaining} remaining` : `${p.cricketPoints || 0} pts`;
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
    const { gameId, frame, truth, aiResult, note, learningMode, cameraModel } = req.body;
    const stored = saveFrameBase64(frame);
    const correction = await Correction.create({
      gameId,
      frameId: new Date().toISOString(),
      frameSha256: stored?.frameSha256,
      frameUrl:    stored?.frameUrl,
      frameBytes:  stored?.frameBytes,
      cameraModel: cameraModel || null,
      ai:        aiResult ? { darts: aiResult.darts || [], total: aiResult.total || 0 } : { darts: [], total: 0 },
      corrected: { darts: truth.darts || [], total: truth.total || 0 },
      note: note || (learningMode ? 'learning-mode sample' : 'manual truth'),
      source: learningMode ? 'learning-mode' : 'manual'
    });
    const total = await Correction.countDocuments();
    res.json({ ok: true, id: correction._id, totalSamples: total, frameStored: !!stored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════
// CORRECTIONS
// ══════════════════════════════════════════════════
router.post('/correct', async (req, res) => {
  try {
    const { gameId, frameId, frame, ai, corrected, note, cameraModel } = req.body;
    const stored = saveFrameBase64(frame);
    const correction = await Correction.create({
      gameId, frameId,
      frameSha256: stored?.frameSha256,
      frameUrl:    stored?.frameUrl,
      frameBytes:  stored?.frameBytes,
      cameraModel: cameraModel || null,
      ai, corrected, note,
      source: 'post-round'
    });
    const total = await Correction.countDocuments();
    res.json({ ok: true, id: correction._id, totalCorrections: total, frameStored: !!stored });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// DATASET — for ML labeling + export
// ══════════════════════════════════════════════════
router.get('/dataset/stats', async (req, res) => {
  try {
    const total       = await Correction.countDocuments();
    const withFrame   = await Correction.countDocuments({ frameSha256: { $exists: true, $ne: null } });
    const validated   = await Correction.countDocuments({ validated: true });
    const bySource    = await Correction.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]);
    const dir         = frameDirStats();
    res.json({
      corrections: { total, withFrame, validated },
      bySource:    Object.fromEntries(bySource.map(b => [b._id || 'unknown', b.count])),
      frames:      dir
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export labeled samples as JSONL — one record per line.
// Optional ?validated=1 to limit to manually-verified labels.
// Optional ?withFrame=1 (default) to require an attached frame.
router.get('/dataset/export', async (req, res) => {
  try {
    const filter = {};
    if (req.query.validated === '1') filter.validated = true;
    if (req.query.withFrame !== '0') filter.frameSha256 = { $exists: true, $ne: null };
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="dataset-${Date.now()}.jsonl"`);
    const cursor = Correction.find(filter).sort({ createdAt: 1 }).cursor();
    for await (const doc of cursor) {
      res.write(JSON.stringify({
        id:          doc._id.toString(),
        frameUrl:    doc.frameUrl,
        frameSha256: doc.frameSha256,
        ai:          doc.ai,
        corrected:   doc.corrected,
        note:        doc.note,
        source:      doc.source,
        validated:   doc.validated,
        createdAt:   doc.createdAt
      }) + '\n');
    }
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark a correction as validated (label confirmed for training)
router.patch('/dataset/:id/validate', requireAuth, async (req, res) => {
  try {
    const updated = await Correction.findByIdAndUpdate(
      req.params.id,
      { validated: req.body.validated !== false },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, validated: updated.validated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edit corrected labels (for the eventual /admin/dataset UI)
router.patch('/dataset/:id', requireAuth, async (req, res) => {
  try {
    const { corrected, note } = req.body;
    const update = {};
    if (corrected) update.corrected = corrected;
    if (note !== undefined) update.note = note;
    const updated = await Correction.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, correction: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/corrections', async (req, res) => {
  try {
    const corrections = await Correction.find().sort({ createdAt: -1 }).limit(50);
    res.json({ corrections, total: await Correction.countDocuments() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// ML ACCURACY STATS
// Aggregates the Correction collection to track how often the dartboard
// model's analysis matches human truth. Three metrics:
//   - totalMatch: % of samples where ai.total === corrected.total (the
//     headline number — players care if "scored my round right")
//   - perDart:   % of corresponding (ai.dart[i], corrected.dart[i]) pairs
//     where segment + ring match (finer-grained, useful for training)
//   - meanAbsError: average |ai.total - corrected.total|
// Plus a 7-day trend so the lobby can show "improving / regressing".
// Computed server-side in one cursor pass; cached 60s.
// ══════════════════════════════════════════════════
const ML_STATS_TTL = parseInt(process.env.ML_STATS_TTL || '60000', 10);
let _mlStatsCache = { at: 0, payload: null };

function _scoreOne(c) {
  const aiDarts  = (c.ai && c.ai.darts) || [];
  const trDarts  = (c.corrected && c.corrected.darts) || [];
  const aiTotal  = (c.ai && c.ai.total) | 0;
  const trTotal  = (c.corrected && c.corrected.total) | 0;
  const totalMatch = aiTotal === trTotal;
  const absErr     = Math.abs(aiTotal - trTotal);

  // Per-dart: align by index. A missing slot on either side counts as a miss.
  const len = Math.max(aiDarts.length, trDarts.length);
  let dartHits = 0, dartCount = 0;
  for (let i = 0; i < len; i++) {
    const a = aiDarts[i], t = trDarts[i];
    dartCount++;
    if (a && t && a.segment === t.segment && a.ring === t.ring) dartHits++;
  }
  return { totalMatch, absErr, dartHits, dartCount };
}

async function _computeMlStats() {
  const now      = Date.now();
  const day      = 24 * 60 * 60 * 1000;
  const cutoff7  = new Date(now - 7  * day);
  const cutoff30 = new Date(now - 30 * day);

  const agg = {
    samples: 0, withBoth: 0,
    totalMatches: 0, dartHits: 0, dartCount: 0, sumAbsErr: 0,
    last7:  { samples: 0, totalMatches: 0, dartHits: 0, dartCount: 0, sumAbsErr: 0 },
    last30: { samples: 0, totalMatches: 0, dartHits: 0, dartCount: 0, sumAbsErr: 0 },
    bySource: {},
    validated: 0,
    withFrame: 0
  };

  // Stream — corrections collection can grow unbounded; never load all into RAM.
  const cursor = Correction.find({}).sort({ createdAt: -1 })
    .select('ai corrected source validated createdAt frameSha256').lean().cursor();

  for await (const c of cursor) {
    agg.samples++;
    if (c.frameSha256) agg.withFrame++;
    if (c.validated)   agg.validated++;
    agg.bySource[c.source || 'unknown'] = (agg.bySource[c.source || 'unknown'] || 0) + 1;

    const hasBoth = c.ai && c.corrected && (c.ai.darts || c.corrected.darts);
    if (!hasBoth) continue;
    agg.withBoth++;

    const s = _scoreOne(c);
    if (s.totalMatch) agg.totalMatches++;
    agg.dartHits += s.dartHits;
    agg.dartCount += s.dartCount;
    agg.sumAbsErr += s.absErr;

    const created = c.createdAt || new Date(0);
    if (created >= cutoff7) {
      agg.last7.samples++;
      if (s.totalMatch) agg.last7.totalMatches++;
      agg.last7.dartHits  += s.dartHits;
      agg.last7.dartCount += s.dartCount;
      agg.last7.sumAbsErr += s.absErr;
    }
    if (created >= cutoff30) {
      agg.last30.samples++;
      if (s.totalMatch) agg.last30.totalMatches++;
      agg.last30.dartHits  += s.dartHits;
      agg.last30.dartCount += s.dartCount;
      agg.last30.sumAbsErr += s.absErr;
    }
  }

  const pct = (n, d) => d > 0 ? Math.round((n / d) * 1000) / 10 : null;  // 1 dp percent
  const summarize = (b) => ({
    samples:      b.samples,
    totalMatchPct: pct(b.totalMatches, b.samples),
    perDartPct:    pct(b.dartHits, b.dartCount),
    meanAbsError:  b.samples > 0 ? Math.round((b.sumAbsErr / b.samples) * 10) / 10 : null
  });

  // Trend = last7 vs the older window (everything before last7).
  const older = {
    samples: agg.withBoth - agg.last7.samples,
    totalMatches: agg.totalMatches - agg.last7.totalMatches,
    dartHits: agg.dartHits - agg.last7.dartHits,
    dartCount: agg.dartCount - agg.last7.dartCount,
    sumAbsErr: agg.sumAbsErr - agg.last7.sumAbsErr
  };

  return {
    samples: agg.samples,
    withFrame: agg.withFrame,
    validated: agg.validated,
    bySource:  agg.bySource,
    overall:   summarize({
      samples: agg.withBoth,
      totalMatches: agg.totalMatches,
      dartHits: agg.dartHits,
      dartCount: agg.dartCount,
      sumAbsErr: agg.sumAbsErr
    }),
    last7:     summarize(agg.last7),
    last30:    summarize(agg.last30),
    older:     summarize(older),
    cachedAt: new Date().toISOString()
  };
}

router.get('/ml-stats', async (req, res) => {
  try {
    const now = Date.now();
    if (req.query.fresh === '1') _mlStatsCache = { at: 0, payload: null };
    if (_mlStatsCache.payload && (now - _mlStatsCache.at) < ML_STATS_TTL) {
      return res.json(_mlStatsCache.payload);
    }
    const payload = await _computeMlStats();
    _mlStatsCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// PLATFORM-WIDE AGGREGATE STATS
// Cumulative scoring across every game ever played.
// Why: tally is the headline number for the platform — total points scored
// across 301, 501, and cricket combined, plus per-mode breakdowns.
// Cached briefly because this scans every game.
// ══════════════════════════════════════════════════
const PLATFORM_STATS_TTL = parseInt(process.env.PLATFORM_STATS_TTL || '30000', 10);
let _platformStatsCache = { at: 0, payload: null };

async function _computePlatformStats() {
  // Per-mode aggregate from rounds. Note: in 301/501 a "round total" is the
  // points the player actually scored that round (busts are stored as 0),
  // which is exactly the throw-aggregate the platform wants to display.
  // Cricket's roundTotal is points scored AFTER closing — which under-counts
  // total dart-points-thrown. We supplement with sum-of-dart-scores so the
  // headline reads "all points scored, period."
  const perMode = await Game.aggregate([
    { $match: { status: { $in: ['active', 'idle', 'finished', 'archived', 'waiting'] } } },
    { $unwind: { path: '$rounds', preserveNullAndEmptyArrays: false } },
    { $unwind: { path: '$rounds.darts', preserveNullAndEmptyArrays: true } },
    { $group: {
        _id: '$mode',
        games:        { $addToSet: '$_id' },
        rounds:       { $addToSet: '$rounds._id' },
        roundTotals:  { $sum: '$rounds.total' },           // gameplay points (busts=0, cricket only counts overflow)
        dartPoints:   { $sum: { $ifNull: ['$rounds.darts.score', 0] } }, // raw thrown-dart sum
        dartCount:    { $sum: { $cond: [{ $ifNull: ['$rounds.darts.score', false] }, 1, 0] } }
    } },
    { $project: {
        mode: '$_id',
        _id: 0,
        games: { $size: '$games' },
        rounds: { $size: '$rounds' },
        roundTotals: 1,
        dartPoints: 1,
        dartCount: 1
    } }
  ]);

  const byMode = { '301': null, '501': null, cricket: null };
  perMode.forEach(m => { byMode[m.mode] = m; });

  const totalGames     = await Game.countDocuments({});
  const finishedGames  = await Game.countDocuments({ status: 'finished' });
  const activeGames    = await Game.countDocuments({ status: { $in: ['active', 'waiting'] } });
  const totalUsers     = await require('../models/User').countDocuments({});

  // Headline: platform-wide cumulative dart points (sum across modes).
  const totalDartPoints  = perMode.reduce((s, m) => s + (m.dartPoints || 0), 0);
  const totalRoundTotals = perMode.reduce((s, m) => s + (m.roundTotals || 0), 0);
  const totalDartsThrown = perMode.reduce((s, m) => s + (m.dartCount || 0), 0);
  const totalRounds      = perMode.reduce((s, m) => s + (m.rounds || 0), 0);

  return {
    totals: {
      dartPoints: totalDartPoints,           // raw points thrown (sum of every dart score)
      gameplayPoints: totalRoundTotals,       // scored-in-game points (busts=0 for 301/501; overflow only for cricket)
      darts: totalDartsThrown,
      rounds: totalRounds,
      games: totalGames,
      finishedGames, activeGames,
      users: totalUsers
    },
    byMode: {
      '301':    byMode['301']    || { mode: '301',    games: 0, rounds: 0, roundTotals: 0, dartPoints: 0, dartCount: 0 },
      '501':    byMode['501']    || { mode: '501',    games: 0, rounds: 0, roundTotals: 0, dartPoints: 0, dartCount: 0 },
      'cricket':byMode['cricket']|| { mode: 'cricket',games: 0, rounds: 0, roundTotals: 0, dartPoints: 0, dartCount: 0 }
    },
    cachedAt: new Date().toISOString()
  };
}

router.get('/platform-stats', async (req, res) => {
  try {
    const now = Date.now();
    if (req.query.fresh === '1') _platformStatsCache = { at: 0, payload: null };
    if (_platformStatsCache.payload && (now - _platformStatsCache.at) < PLATFORM_STATS_TTL) {
      return res.json(_platformStatsCache.payload);
    }
    const payload = await _computePlatformStats();
    _platformStatsCache = { at: Date.now(), payload };
    res.json(payload);
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
