'use strict';

const crypto = require('crypto');
const { displayFor } = require('./username');

// In-memory broadcast store
const broadcasts = new Map();

// Mongo handle for persistent session + per-user aggregate stats. Set via
// init(db) at app boot. All persistence calls no-op if init was skipped so
// the in-memory broadcast layer keeps working in tests/dev without Mongo.
let dbRef = null;

async function init(db) {
  dbRef = db;
  try {
    await db.collection('broadcast_sessions').createIndex({ code: 1 });
    await db.collection('broadcast_sessions').createIndex({ hostId: 1, startedAt: -1 });
    await db.collection('broadcast_sessions').createIndex({ game: 1, startedAt: -1 });
    await db.collection('broadcast_user_stats').createIndex({ userId: 1 }, { unique: true });
    await db.collection('broadcast_user_stats').createIndex({ 'host.totalAirtimeMs': -1 });
  } catch (e) {
    console.error('[broadcast] index create error:', e.message);
  }
}

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getUserRole(user) {
  if (!user) return 'viewer';
  if (user.isAdmin === true) return 'superadmin';
  if (user.permissions && user.permissions.games === 'admin') return 'admin';
  return 'player';
}

// Stable per-user public handle that does not leak displayName/email. The
// hash is deterministic across processes for the same userId, so links and
// leaderboards stay consistent. Pre-image (the raw userId) is not exposed.
function anonHandle(userId) {
  if (!userId) return 'anon';
  const h = crypto.createHash('sha256').update(String(userId)).digest('hex');
  return 'user_' + h.slice(0, 8);
}

function createBroadcast(host, game) {
  const code = generateCode();
  const role = getUserRole(host);
  const broadcast = {
    code,
    game, // 'rust', 'valheim', 'l4d2', '7dtd'
    host: {
      id: host._id.toString(),
      name: displayFor(host),
      role,
      socketId: null, // set when broadcaster connects via socket
    },
    viewers: new Map(),     // authenticated viewers
    anonViewers: 0,         // anonymous viewer count
    banned: new Set(),
    muted: new Set(),
    messages: [],
    live: false,            // true once screen share is streaming
    createdAt: Date.now(),
    // Session stats (built up while the broadcast is alive)
    stats: {
      peakViewers: 0,
      uniqueViewerIds: new Set(),
      uniqueAnonJoins: 0,
      messageCount: 0,
      liveStartedAt: null,
      voicePeers: new Set(),
      peakVoicePeers: 0,
      viewerJoinAt: new Map(), // uid -> ts, for per-viewer watchtime accounting
    },
    sessionId: null, // ObjectId of broadcast_sessions doc (set on persist)
  };
  broadcasts.set(code, broadcast);
  return broadcast;
}

function getBroadcast(code) {
  return broadcasts.get(code) || null;
}

function getBroadcastByGame(game) {
  for (const [, b] of broadcasts) {
    if (b.game === game) return b;
  }
  return null;
}

function setLive(code, socketId) {
  const b = broadcasts.get(code);
  if (!b) return null;
  b.live = true;
  b.host.socketId = socketId;
  if (!b.stats.liveStartedAt) {
    b.stats.liveStartedAt = Date.now();
    persistSessionStart(b).catch(e => console.error('[broadcast] session start persist:', e.message));
  }
  return b;
}

function endBroadcast(code) {
  const b = broadcasts.get(code);
  if (!b) return null;
  // Persist the session + roll-up per-user aggregates before evicting the
  // in-memory entry. Fire-and-forget so the socket teardown path stays fast.
  persistSessionEnd(b).catch(e => console.error('[broadcast] session end persist:', e.message));
  broadcasts.delete(code);
  return b;
}

function addViewer(code, user) {
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };

  // Anonymous viewer
  if (!user) {
    b.anonViewers++;
    b.stats.uniqueAnonJoins++;
    refreshPeak(b);
    return { ok: true, anon: true, broadcast: b };
  }

  const uid = user._id.toString();
  if (b.banned.has(uid)) return { error: 'You are banned from this broadcast' };

  const now = Date.now();
  b.viewers.set(uid, {
    id: uid,
    name: displayFor(user),
    role: getUserRole(user),
    joinedAt: now,
  });
  b.stats.uniqueViewerIds.add(uid);
  b.stats.viewerJoinAt.set(uid, now);
  refreshPeak(b);
  return { ok: true, broadcast: b };
}

function removeViewer(code, userId) {
  const b = broadcasts.get(code);
  if (!b) return;
  if (!userId) {
    b.anonViewers = Math.max(0, b.anonViewers - 1);
    return;
  }
  // Settle this viewer's watch-time on leave so reconnects don't reset their
  // contribution. The per-user aggregate is written on session end.
  const joined = b.stats.viewerJoinAt.get(userId);
  if (joined) {
    const ms = Math.max(0, Date.now() - joined);
    if (!b.stats.watchMsByViewer) b.stats.watchMsByViewer = new Map();
    b.stats.watchMsByViewer.set(userId, (b.stats.watchMsByViewer.get(userId) || 0) + ms);
    b.stats.viewerJoinAt.delete(userId);
  }
  b.viewers.delete(userId);
}

function refreshPeak(b) {
  const cur = b.viewers.size + b.anonViewers;
  if (cur > b.stats.peakViewers) b.stats.peakViewers = cur;
}

function getViewerCount(code) {
  const b = broadcasts.get(code);
  if (!b) return 0;
  return b.viewers.size + b.anonViewers;
}

function canModerate(code, userId) {
  const b = broadcasts.get(code);
  if (!b) return false;
  if (b.host.id === userId) return true;
  const v = b.viewers.get(userId);
  return v && v.role === 'superadmin';
}

function kickViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (targetId === b.host.id) return { error: 'Cannot kick the broadcaster' };
  b.viewers.delete(targetId);
  return { ok: true };
}

function muteViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (b.muted.has(targetId)) {
    b.muted.delete(targetId);
    return { ok: true, muted: false };
  }
  b.muted.add(targetId);
  return { ok: true, muted: true };
}

function banViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (targetId === b.host.id) return { error: 'Cannot ban the broadcaster' };
  b.viewers.delete(targetId);
  b.banned.add(targetId);
  return { ok: true };
}

function addMessage(code, userId, userName, userRole, text) {
  const b = broadcasts.get(code);
  if (!b) return null;
  if (b.muted.has(userId)) return { error: 'You are muted' };
  const msg = {
    id: crypto.randomBytes(4).toString('hex'),
    userId,
    name: userName,
    role: userRole,
    text,
    ts: Date.now(),
  };
  b.messages.push(msg);
  if (b.messages.length > 200) b.messages = b.messages.slice(-200);
  b.stats.messageCount++;
  if (!b.stats.messagesByUser) b.stats.messagesByUser = new Map();
  if (userId) b.stats.messagesByUser.set(userId, (b.stats.messagesByUser.get(userId) || 0) + 1);
  return msg;
}

// Bump voice-peer counters from the socket layer. Tracking is best-effort —
// disconnects are settled here so leaver-without-explicit-leave still counts.
function noteVoiceJoin(code, userId) {
  const b = broadcasts.get(code);
  if (!b || !userId) return;
  b.stats.voicePeers.add(userId);
  if (b.stats.voicePeers.size > b.stats.peakVoicePeers) b.stats.peakVoicePeers = b.stats.voicePeers.size;
}
function noteVoiceLeave(code, userId) {
  const b = broadcasts.get(code);
  if (!b || !userId) return;
  b.stats.voicePeers.delete(userId);
}

function listBroadcasts() {
  const list = [];
  for (const [code, b] of broadcasts) {
    list.push({
      code,
      game: b.game,
      host: b.host.name,
      hostRole: b.host.role,
      viewers: b.viewers.size + b.anonViewers,
      live: b.live,
      createdAt: b.createdAt,
    });
  }
  return list;
}

function serializeBroadcast(b, includeMessages) {
  return {
    code: b.code,
    game: b.game,
    host: { id: b.host.id, name: b.host.name, role: b.host.role },
    viewers: Array.from(b.viewers.values()),
    viewerCount: b.viewers.size + b.anonViewers,
    muted: Array.from(b.muted),
    live: b.live,
    messages: includeMessages ? b.messages.slice(-50) : [],
    createdAt: b.createdAt,
  };
}

// ─────────────────────────── Persistence layer ───────────────────────────
//
// Two collections back the broadcast stats panel:
//   • broadcast_sessions     — one doc per live broadcast (open→close).
//   • broadcast_user_stats   — per-user roll-up (host + viewer + chat).
//
// Sessions persist on go-live; aggregates update on end. We don't update the
// aggregate on every viewer/message tick — too chatty for the value. The
// `live` flag on the session is the queryable source of truth for current
// state.

async function persistSessionStart(b) {
  if (!dbRef) return;
  const res = await dbRef.collection('broadcast_sessions').insertOne({
    code: b.code,
    game: b.game,
    hostId: b.host.id,
    hostHandle: anonHandle(b.host.id),
    hostRole: b.host.role,
    startedAt: new Date(b.stats.liveStartedAt),
    endedAt: null,
    live: true,
    durationMs: 0,
    peakViewers: 0,
    uniqueViewers: 0,
    uniqueAnonJoins: 0,
    totalChatMessages: 0,
    peakVoicePeers: 0,
  });
  b.sessionId = res.insertedId;
  // Bump host stats so /api/stats/me reflects an in-flight broadcast even
  // before it ends. The end-of-session pass adds airtime + peak.
  await dbRef.collection('broadcast_user_stats').updateOne(
    { userId: b.host.id },
    {
      $set: {
        userId: b.host.id,
        handle: anonHandle(b.host.id),
        lastSeenAt: new Date(),
      },
      $inc: { 'host.broadcasts': 1 },
      $addToSet: { 'host.games': b.game },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

async function persistSessionEnd(b) {
  if (!dbRef) return;
  const now = Date.now();
  // Settle any still-watching viewers' airtime contribution.
  if (!b.stats.watchMsByViewer) b.stats.watchMsByViewer = new Map();
  for (const [uid, joinedAt] of b.stats.viewerJoinAt.entries()) {
    const ms = Math.max(0, now - joinedAt);
    b.stats.watchMsByViewer.set(uid, (b.stats.watchMsByViewer.get(uid) || 0) + ms);
  }
  const durationMs = b.stats.liveStartedAt ? Math.max(0, now - b.stats.liveStartedAt) : 0;
  const uniqueViewers = b.stats.uniqueViewerIds.size;

  if (b.sessionId) {
    await dbRef.collection('broadcast_sessions').updateOne(
      { _id: b.sessionId },
      {
        $set: {
          endedAt: new Date(now),
          live: false,
          durationMs,
          peakViewers: b.stats.peakViewers,
          uniqueViewers,
          uniqueAnonJoins: b.stats.uniqueAnonJoins,
          totalChatMessages: b.stats.messageCount,
          peakVoicePeers: b.stats.peakVoicePeers,
        },
      }
    );
  }

  // Host aggregate
  if (durationMs > 0 || b.stats.messageCount > 0 || uniqueViewers > 0) {
    await dbRef.collection('broadcast_user_stats').updateOne(
      { userId: b.host.id },
      {
        $set: {
          userId: b.host.id,
          handle: anonHandle(b.host.id),
          lastSeenAt: new Date(now),
          'host.lastBroadcastAt': new Date(now),
        },
        $inc: {
          'host.totalAirtimeMs': durationMs,
          'host.totalChatMessages': b.stats.messageCount,
          'host.totalUniqueViewers': uniqueViewers,
          'host.totalAnonJoins': b.stats.uniqueAnonJoins,
        },
        $max: {
          'host.peakViewersEver': b.stats.peakViewers,
          'host.peakVoicePeersEver': b.stats.peakVoicePeers,
        },
        $addToSet: { 'host.games': b.game },
        $setOnInsert: { createdAt: new Date(now) },
      },
      { upsert: true }
    );
  }

  // Viewer aggregates (one update per unique viewer)
  const bulk = dbRef.collection('broadcast_user_stats').initializeUnorderedBulkOp();
  let viewerWrites = 0;
  for (const uid of b.stats.uniqueViewerIds) {
    const watchMs = b.stats.watchMsByViewer.get(uid) || 0;
    bulk.find({ userId: uid }).upsert().updateOne({
      $set: {
        userId: uid,
        handle: anonHandle(uid),
        lastSeenAt: new Date(now),
        'viewer.lastWatchedAt': new Date(now),
      },
      $inc: {
        'viewer.sessions': 1,
        'viewer.totalWatchMs': watchMs,
      },
      $addToSet: { 'viewer.hostsWatched': b.host.id, 'viewer.games': b.game },
      $setOnInsert: { createdAt: new Date(now) },
    });
    viewerWrites++;
  }
  // Chat-by-user aggregates (broadcast-chat side; game-chat is separate)
  if (b.stats.messagesByUser) {
    for (const [uid, count] of b.stats.messagesByUser.entries()) {
      bulk.find({ userId: uid }).upsert().updateOne({
        $set: { userId: uid, handle: anonHandle(uid), lastSeenAt: new Date(now) },
        $inc: { 'chat.broadcastMessages': count },
        $setOnInsert: { createdAt: new Date(now) },
      });
      viewerWrites++;
    }
  }
  if (viewerWrites) await bulk.execute();
}

// Build the JSON-shaped current snapshot the API returns. Strips Sets and Maps
// (which don't serialize) and includes lifetime totals if requested.
function serializeStats(b) {
  return {
    code: b.code,
    game: b.game,
    live: b.live,
    startedAt: b.createdAt,
    liveStartedAt: b.stats.liveStartedAt,
    durationMs: b.stats.liveStartedAt ? Date.now() - b.stats.liveStartedAt : 0,
    viewers: b.viewers.size,
    anonViewers: b.anonViewers,
    peakViewers: b.stats.peakViewers,
    uniqueViewers: b.stats.uniqueViewerIds.size,
    uniqueAnonJoins: b.stats.uniqueAnonJoins,
    totalChatMessages: b.stats.messageCount,
    voicePeers: b.stats.voicePeers.size,
    peakVoicePeers: b.stats.peakVoicePeers,
    host: { handle: anonHandle(b.host.id), name: b.host.name, role: b.host.role },
  };
}

// Stats for a broadcast by code. Looks at the in-memory live entry first;
// falls back to the most recent persisted session for that code. This lets
// the title card on a just-ended broadcast still surface its stats.
async function getBroadcastStats(code) {
  const live = broadcasts.get(code);
  if (live) {
    const out = serializeStats(live);
    if (dbRef) {
      const host = await dbRef.collection('broadcast_user_stats').findOne({ userId: live.host.id });
      out.hostLifetime = publicHostStats(host);
    }
    return out;
  }
  if (!dbRef) return null;
  const sess = await dbRef.collection('broadcast_sessions').findOne({ code }, { sort: { startedAt: -1 } });
  if (!sess) return null;
  const host = await dbRef.collection('broadcast_user_stats').findOne({ userId: sess.hostId });
  return {
    code: sess.code,
    game: sess.game,
    live: false,
    startedAt: sess.startedAt,
    liveStartedAt: sess.startedAt,
    durationMs: sess.durationMs || 0,
    viewers: 0,
    anonViewers: 0,
    peakViewers: sess.peakViewers || 0,
    uniqueViewers: sess.uniqueViewers || 0,
    uniqueAnonJoins: sess.uniqueAnonJoins || 0,
    totalChatMessages: sess.totalChatMessages || 0,
    voicePeers: 0,
    peakVoicePeers: sess.peakVoicePeers || 0,
    host: { handle: sess.hostHandle, role: sess.hostRole },
    hostLifetime: publicHostStats(host),
  };
}

// Public-facing host snapshot — never includes name/email/userId.
function publicHostStats(doc) {
  if (!doc) return null;
  const h = doc.host || {};
  return {
    handle: doc.handle || anonHandle(doc.userId),
    broadcasts: h.broadcasts || 0,
    totalAirtimeMs: h.totalAirtimeMs || 0,
    totalChatMessages: h.totalChatMessages || 0,
    totalUniqueViewers: h.totalUniqueViewers || 0,
    totalAnonJoins: h.totalAnonJoins || 0,
    peakViewersEver: h.peakViewersEver || 0,
    peakVoicePeersEver: h.peakVoicePeersEver || 0,
    games: h.games || [],
    lastBroadcastAt: h.lastBroadcastAt || null,
  };
}

function publicViewerStats(doc) {
  if (!doc) return null;
  const v = doc.viewer || {};
  return {
    handle: doc.handle || anonHandle(doc.userId),
    sessions: v.sessions || 0,
    totalWatchMs: v.totalWatchMs || 0,
    hostsWatched: (v.hostsWatched || []).length,
    games: v.games || [],
    lastWatchedAt: v.lastWatchedAt || null,
  };
}

function publicChatStats(doc) {
  if (!doc) return null;
  const c = doc.chat || {};
  return {
    handle: doc.handle || anonHandle(doc.userId),
    broadcastMessages: c.broadcastMessages || 0,
  };
}

// Current user's own full stats (still anonymized handle, but includes the
// userId since it's their own data).
async function getUserStats(userId) {
  if (!dbRef || !userId) return null;
  const doc = await dbRef.collection('broadcast_user_stats').findOne({ userId: String(userId) });
  if (!doc) {
    return {
      userId: String(userId),
      handle: anonHandle(userId),
      host: publicHostStats({ userId, host: {}, handle: anonHandle(userId) }),
      viewer: publicViewerStats({ userId, viewer: {}, handle: anonHandle(userId) }),
      chat: publicChatStats({ userId, chat: {}, handle: anonHandle(userId) }),
    };
  }
  return {
    userId: doc.userId,
    handle: doc.handle,
    host: publicHostStats(doc),
    viewer: publicViewerStats(doc),
    chat: publicChatStats(doc),
    createdAt: doc.createdAt,
    lastSeenAt: doc.lastSeenAt,
  };
}

// Public stats by handle (no userId resolution leak). Accepts either a
// userId or a handle — both look up the same document, but only the
// public-safe projection is returned.
async function getPublicUserStats(handleOrId) {
  if (!dbRef || !handleOrId) return null;
  const key = String(handleOrId);
  const doc = key.startsWith('user_')
    ? await dbRef.collection('broadcast_user_stats').findOne({ handle: key })
    : await dbRef.collection('broadcast_user_stats').findOne({ userId: key });
  if (!doc) return null;
  return {
    handle: doc.handle,
    host: publicHostStats(doc),
    viewer: publicViewerStats(doc),
    chat: publicChatStats(doc),
  };
}

async function getLeaderboard(sort, limit) {
  if (!dbRef) return [];
  const allowed = {
    airtime: 'host.totalAirtimeMs',
    broadcasts: 'host.broadcasts',
    peakViewers: 'host.peakViewersEver',
    uniqueViewers: 'host.totalUniqueViewers',
    watch: 'viewer.totalWatchMs',
  };
  const field = allowed[sort] || allowed.airtime;
  const cap = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
  const rows = await dbRef.collection('broadcast_user_stats')
    .find({ [field]: { $gt: 0 } })
    .sort({ [field]: -1 })
    .limit(cap)
    .project({ userId: 0, _id: 0 }) // never return userId publicly
    .toArray();
  return rows.map(d => ({
    handle: d.handle,
    host: publicHostStats({ ...d, userId: null }),
    viewer: publicViewerStats({ ...d, userId: null }),
    chat: publicChatStats({ ...d, userId: null }),
  }));
}

async function getRecentSessions(game, limit) {
  if (!dbRef) return [];
  const cap = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
  const q = { live: false };
  if (game) q.game = game;
  const rows = await dbRef.collection('broadcast_sessions')
    .find(q)
    .sort({ endedAt: -1 })
    .limit(cap)
    .project({ hostId: 0 }) // never return hostId publicly
    .toArray();
  return rows;
}

module.exports = {
  init,
  createBroadcast,
  getBroadcast,
  getBroadcastByGame,
  setLive,
  endBroadcast,
  addViewer,
  removeViewer,
  getViewerCount,
  kickViewer,
  muteViewer,
  banViewer,
  addMessage,
  noteVoiceJoin,
  noteVoiceLeave,
  listBroadcasts,
  serializeBroadcast,
  getUserRole,
  canModerate,
  anonHandle,
  getBroadcastStats,
  getUserStats,
  getPublicUserStats,
  getLeaderboard,
  getRecentSessions,
};
