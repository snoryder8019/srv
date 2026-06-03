const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const presence = require('../lib/presence');
const rust = require('../lib/rust');
const valheim = require('../lib/valheim');
const l4d2 = require('../lib/l4d2');
const sdtd = require('../lib/7dtd');
const se = require('../lib/se');
const palworld = require('../lib/palworld');
const windrose = require('../lib/windrose');
const wallet = require('../lib/wallet');
const username = require('../lib/username');

function requireInternal(req, res, next) {
  if (req.headers['x-bridge-secret'] === process.env.BRIDGE_SECRET) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const libs = { rust, valheim, l4d2, '7dtd': sdtd, se, palworld, windrose };

const crypto = require('crypto');
// Privacy guard: NEVER store a caller-reported player name. Platform identity is
// authoritative — the public handle is resolved from the platformId (the platform
// user _id) via username.displayFor(). Any displayName a game service sends in the
// body is ignored entirely, so a real name can never enter webgame_* or wallets
// even if a caller mistakenly reports one (this is stricter than the old
// whitespace/email heuristic, which let single-token real names through).
// Unknown / non-ObjectId platformIds (test, dev, bot) get a deterministic anon handle.
function anonHandle(platformId) {
  return 'user_' + crypto.createHash('sha256').update(String(platformId)).digest('hex').slice(0, 8);
}
async function resolveHandle(db, platformId) {
  const pid = String(platformId);
  let oid;
  // Only an ObjectId-parse failure means "not a platform user" (test/dev/bot) -> anon.
  // A DB error must NOT be swallowed here, or a transient Mongo blip would clobber a
  // real user's handle with an anon one; let it propagate so the endpoint 500s and
  // the stored name is left untouched.
  try { oid = new ObjectId(pid); } catch { return anonHandle(pid); }
  const user = await db.collection('users').findOne({ _id: oid });
  return user ? username.displayFor(user) : anonHandle(pid);
}

router.get('/:game/status', requireInternal, async (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  try { res.json(await lib.getStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:game/start', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.startServer());
});

router.post('/:game/stop', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.stopServer('bih request'));
});

router.post('/:game/restart', requireInternal, (req, res) => {
  const lib = libs[req.params.game];
  if (!lib) return res.status(404).json({ error: 'Unknown game' });
  res.json(lib.restartServer());
});

// Discord bot bridge — bot listens for voiceStateUpdate on the designated
// Games voice channel and POSTs here. We rebroadcast on the /stats namespace
// so the portal index toasts it.
router.post('/discord/voice-join', requireInternal, (req, res) => {
  const { user, channel } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const io = req.app.get('io');
  if (io) io.of('/stats').emit('discord:voice-join', { user, channel: channel || null });
  res.json({ ok: true });
});

// ---- Web games: master leaderboard ingest + read (see WEBGAMES_PROTOCOL.md) ----
router.post('/webgame/score', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { game, platformId, event = 'run-end', score = 0, wave = 0, status = 'abandoned', durationMs = 0, meta = {} } = req.body || {};
    if (!game || !platformId) return res.status(400).json({ error: 'game and platformId required' });
    const displayName = await resolveHandle(db, platformId);   // authoritative handle; reported name ignored
    const now = new Date();
    await db.collection('webgame_scores').insertOne({
      game, platformId: String(platformId), displayName,
      event, score: Number(score) || 0, wave: Number(wave) || 0, status,
      durationMs: Number(durationMs) || 0, meta: (meta && typeof meta === 'object') ? meta : {}, ts: now,
    });
    const won = status === 'won' ? 1 : 0;
    await db.collection('webgame_leaderboard').updateOne(
      { game, platformId: String(platformId) },
      {
        $set: { displayName, lastPlayedAt: now },
        $max: { bestScore: Number(score) || 0, highestWave: Number(wave) || 0 },
        $inc: { runs: 1, wins: won },
        $setOnInsert: { game, platformId: String(platformId), firstPlayedAt: now },
      },
      { upsert: true }
    );
    // Chip economy: every recorded arcade result earns chips (participation + win bonus).
    try { await wallet.awardArcadeResult(db, { platformId, displayName, status, game }); } catch (we) { /* best-effort */ }
    if (event === 'game-end') {
      try {
        const io = req.app.get('io');
        if (io) {
          const act = { game, type: 'webgame_result', ts: now, name: displayName || 'Player',
            status, score: Number(score) || 0, opponentScore: (meta && meta.opponentScore) || 0 };
          io.of('/stats').to('game:' + game).emit('stats:event', act);
          io.of('/stats').to('game:all').emit('stats:event', act);
        }
      } catch (emitErr) { /* live feed emit is best-effort */ }
    }
    const row = await db.collection('webgame_leaderboard').findOne({ game, platformId: String(platformId) });
    const rank = await db.collection('webgame_leaderboard').countDocuments({ game, bestScore: { $gt: row.bestScore } });
    res.json({ ok: true, best: row.bestScore, rank: rank + 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/webgame/leaderboard/:slug', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const top = await db.collection('webgame_leaderboard')
      .find({ game: req.params.slug }).sort({ bestScore: -1 }).limit(limit).toArray();
    res.json({ ok: true, game: req.params.slug, leaderboard: top });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Private invites: online portal users + push an invite (matchmaking) ----
router.get('/online-users', requireInternal, (req, res) => {
  const exclude = req.query.exclude || null;
  res.json({ ok: true, users: presence.list(exclude) });
});

// Soft presence heartbeat from another arcade surface (matchmaking intake).
// Keeps the player invitable while they're in matchmaking, not just on landing.
// Presence is in-memory only (never persisted) and the caller contract is to
// send username.displayFor(user); we still resolve to the authoritative handle
// so a stray reported name can't surface in the invite list.
router.post('/presence/heartbeat', requireInternal, async (req, res) => {
  const { platformId } = req.body || {};
  if (!platformId) return res.status(400).json({ error: 'platformId required' });
  const name = await resolveHandle(req.app.locals.db, platformId);
  presence.heartbeat(platformId, name);
  res.json({ ok: true });
});
router.post('/presence/clear', requireInternal, (req, res) => {
  const { platformId } = req.body || {};
  if (platformId) presence.clearSoft(platformId);
  res.json({ ok: true });
});

// Pending invites for users not on an open socket (soft presence). The invitee's
// surface polls /internal/invites/pending to pick these up. Socket users still get
// a live push. TTL'd in memory.
const pendingInvites = new Map(); // toPlatformId -> { ...payload, ts }
const INVITE_TTL = 2 * 60 * 1000;
function reapInvites() {
  const now = Date.now();
  for (const [k, v] of pendingInvites) if (now - v.ts > INVITE_TTL) pendingInvites.delete(k);
}

router.post('/invite', requireInternal, (req, res) => {
  const { toPlatformId, fromName, game, joinUrl, inviteId } = req.body || {};
  if (!toPlatformId || !joinUrl) return res.status(400).json({ error: 'toPlatformId and joinUrl required' });
  const payload = { inviteId: inviteId || null, fromName: fromName || 'A player', game: game || 'a game', joinUrl, ts: Date.now() };
  // live push to any open presence sockets
  const io = req.app.get('io');
  const sockets = presence.socketsFor(toPlatformId);
  let delivered = 0;
  if (io && sockets.length) {
    const ns = io.of('/presence');
    for (const sid of sockets) ns.to(sid).emit('invite', payload);
    delivered = sockets.length;
  }
  // also queue for polling (covers soft-presence users in matchmaking)
  pendingInvites.set(String(toPlatformId), payload);
  res.json({ ok: true, delivered, online: presence.isOnline(toPlatformId) });
});

// The invitee's surface polls this (with the internal secret, proxied by match)
// to discover an invite when they don't have an open portal socket.
router.get('/invites/pending', requireInternal, (req, res) => {
  reapInvites();
  const pid = String(req.query.platformId || '');
  const inv = pendingInvites.get(pid) || null;
  if (inv && req.query.consume === '1') pendingInvites.delete(pid);
  res.json({ ok: true, invite: inv });
});


// ───────────────────────── Chip wallet (service-to-service) ─────────────────────────
// tiles' casino games call these with the shared bridge secret to spend/settle
// real chips. All amounts are integers; debit fails (ok:false) on insufficient funds.
// displayName is always resolved from platformId — the caller-sent value is ignored.
router.post('/wallet/get', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const w = await wallet.getWallet(db, platformId, await resolveHandle(db, platformId));
    res.json({ ok: true, chips: w.chips, biggestBetWon: w.biggestBetWon || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/debit', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, game, meta } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.debit(db, platformId, amount, 'wager', game, meta, await resolveHandle(db, platformId));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/credit', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, reason, game, meta } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.credit(db, platformId, amount, reason || 'credit', game, meta, await resolveHandle(db, platformId));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/settle', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, wager, payout, game, meta } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.settleBet(db, platformId, { wager, payout, game, meta, displayName: await resolveHandle(db, platformId) });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generic grant — dedicated-server presence, daily bonuses, admin gifts, etc.
router.post('/wallet/grant', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, reason, meta } = req.body || {};
    if (!platformId || !amount) return res.status(400).json({ error: 'platformId and amount required' });
    const r = await wallet.credit(db, platformId, amount, reason || 'grant', null, meta, await resolveHandle(db, platformId));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Award server-reward COINS (distinct from chips) to a platform user. Any trusted
// service (dedicated-server hooks, reward cron, admin) can grant coins here.
router.post('/wallet/award-coins', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, reason, game, meta } = req.body || {};
    if (!platformId || !amount) return res.status(400).json({ error: 'platformId and amount required' });
    const r = await wallet.creditCoins(db, platformId, amount, reason || 'server-reward', game || null, meta, await resolveHandle(db, platformId));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
