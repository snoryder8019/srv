'use strict';

/**
 * Game Chat — portal-side chat per game, gated on in-game presence.
 *
 * - Read access: any caller (route layer enforces auth)
 * - Post access: only users whose displayName matches an active player name
 *   in the live player list for that game (case-insensitive).
 * - Messages persist indefinitely (channel history is browsable via
 *   getHistory). Older messages can be paginated with `before` cursor.
 * - Pure portal chat for now — no RCON say-bridge to in-game.
 */

const fs   = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { displayFor } = require('./username');

const emitter = new EventEmitter();

const WINDROSE_LIVEMAP = path.join(__dirname, '..', 'windrose', 'windrose_plus_data', 'livemap_data.json');

const SUPPORTED_GAMES = new Set(['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose']);
const PRESENCE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes — counts as "still in-game"
const MAX_MESSAGE_LEN = 240;
const MAX_HISTORY_PAGE = 100;

let dbRef = null;

async function init(db) {
  dbRef = db;
  try {
    await db.collection('game_chat').createIndex({ game: 1, ts: -1 });
    // Historical: this collection had a 30-min TTL index. Drop it so messages
    // persist as channel history. Safe to call repeatedly — listIndexes is
    // the cheapest check and dropIndex is a no-op once the index is gone.
    try {
      const idx = await db.collection('game_chat').listIndexes().toArray();
      const ttl = idx.find(i => i.expireAfterSeconds != null);
      if (ttl) await db.collection('game_chat').dropIndex(ttl.name);
    } catch (e) {
      if (e.codeName !== 'IndexNotFound') console.error('[chat] ttl drop error:', e.message);
    }
  } catch (e) {
    console.error('[chat] index create error:', e.message);
  }
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

// Lower-case + strip whitespace so we match "Scott Ryder" against "scottryder"
// without forcing every player to use an exact case match.
function normaliseName(s) {
  return String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');
}

async function getActivePlayerNames(game) {
  const rows = await getActivePlayers(game);
  return rows.map(r => r.name).filter(Boolean);
}

async function getActiveSteamIds(game) {
  const rows = await getActivePlayers(game);
  return rows.map(r => r.steamId).filter(Boolean);
}

async function getActivePlayers(game) {
  if (!SUPPORTED_GAMES.has(game)) return [];

  // Windrose surfaces live names via WindrosePlus's livemap snapshot; the
  // file refreshes every few seconds so it's our cheapest presence source.
  // (Windrose does not expose Steam IDs.)
  if (game === 'windrose') {
    const livemap = readJsonSafe(WINDROSE_LIVEMAP);
    return (livemap?.players || []).map(p => ({ name: p.name, steamId: null }));
  }

  // For other games we don't have a per-tick name list; fall back to
  // player_stats rows seen in the last 2 minutes. This covers anyone who
  // joined or whose join event got logged recently.
  if (!dbRef) return [];
  const since = new Date(Date.now() - PRESENCE_WINDOW_MS);
  const rows = await dbRef.collection('player_stats')
    .find({ game, lastSeen: { $gte: since } }, { projection: { name: 1, steamId: 1, _id: 0 } })
    .toArray();
  return rows.map(r => ({ name: r.name, steamId: r.steamId }));
}

function userIsInGame(user, activeNames, activeSteamIds) {
  if (!user) return false;
  // Preferred match: Steam ID linked via /profile. Game logs that surface a
  // steamId (rust/l4d2/7dtd/se/palworld) get an exact, name-independent
  // match this way. Falls back to name-based matching for Valheim/Windrose.
  if (user.steamId && Array.isArray(activeSteamIds) && activeSteamIds.includes(user.steamId)) {
    return true;
  }
  const candidates = [
    user.username,
    // Per-game in-game name override — for users whose game name differs
    // from their username and the game doesn't expose a Steam ID.
    user.gameNames && user.gameNames._matched,
  ].filter(Boolean).map(normaliseName);
  if (!candidates.length) return false;
  const norm = activeNames.map(normaliseName);
  return candidates.some(c => norm.includes(c));
}

async function postMessage(game, user, rawMessage) {
  if (!SUPPORTED_GAMES.has(game)) throw new Error('unsupported game');
  if (!user) throw new Error('not authed');
  const text = String(rawMessage || '').trim().slice(0, MAX_MESSAGE_LEN);
  if (!text) throw new Error('empty message');
  if (!dbRef) throw new Error('chat not initialised');

  const activePlayers = await getActivePlayers(game);
  const activeNames = activePlayers.map(p => p.name).filter(Boolean);
  const activeSteamIds = activePlayers.map(p => p.steamId).filter(Boolean);
  // Admins and the platform superadmin can always post (staff announcements).
  const isAdmin = !!(user.isAdmin || (user.permissions && user.permissions.games === 'admin'));
  const inGame  = isAdmin || userIsInGame(user, activeNames, activeSteamIds);
  if (!inGame) {
    const e = new Error('not in-game');
    e.code = 'NOT_IN_GAME';
    throw e;
  }

  const name = displayFor(user);
  const doc = {
    game,
    userId: user._id ? String(user._id) : null,
    name,
    message: text,
    isAdmin,
    ts: new Date(),
  };
  await dbRef.collection('game_chat').insertOne(doc);
  emitter.emit('chat', doc);
  return doc;
}

async function getRecent(game, limit = 50) {
  if (!SUPPORTED_GAMES.has(game) || !dbRef) return [];
  const rows = await dbRef.collection('game_chat')
    .find({ game })
    .sort({ ts: -1 })
    .limit(Math.min(limit, 200))
    .toArray();
  return rows.reverse();
}

// Older messages, paginated by `before` (a Date or ISO string). Returns
// chronological-oldest-first, like getRecent. The caller's "load older" UI
// passes the timestamp of the earliest message it already has.
async function getHistory(game, before, limit = 50) {
  if (!SUPPORTED_GAMES.has(game) || !dbRef) return { messages: [], hasMore: false };
  const cap = Math.min(Math.max(parseInt(limit) || 50, 1), MAX_HISTORY_PAGE);
  const cursor = before ? new Date(before) : null;
  const q = { game };
  if (cursor && !isNaN(cursor.getTime())) q.ts = { $lt: cursor };
  const rows = await dbRef.collection('game_chat')
    .find(q)
    .sort({ ts: -1 })
    .limit(cap + 1)
    .toArray();
  const hasMore = rows.length > cap;
  const page = hasMore ? rows.slice(0, cap) : rows;
  return { messages: page.reverse(), hasMore };
}

async function getStats(game) {
  if (!SUPPORTED_GAMES.has(game) || !dbRef) return { total: 0, uniquePosters: 0, since: null };
  const [total, uniques, oldest] = await Promise.all([
    dbRef.collection('game_chat').countDocuments({ game }),
    dbRef.collection('game_chat').distinct('userId', { game }),
    dbRef.collection('game_chat').find({ game }).sort({ ts: 1 }).limit(1).toArray(),
  ]);
  return {
    total,
    uniquePosters: uniques.filter(Boolean).length,
    since: oldest[0] ? oldest[0].ts : null,
  };
}

async function getPresence(game) {
  const players = await getActivePlayers(game);
  const names = players.map(p => p.name).filter(Boolean);
  const steamIds = players.map(p => p.steamId).filter(Boolean);
  const uniqueNames = Array.from(new Set(names));
  return {
    count: uniqueNames.length,
    names: uniqueNames,
    steamIds: Array.from(new Set(steamIds)),
  };
}

module.exports = {
  init,
  emitter,
  postMessage,
  getRecent,
  getHistory,
  getStats,
  getPresence,
  userIsInGame,
  getActivePlayerNames,
  getActivePlayers,
  getActiveSteamIds,
  MAX_MESSAGE_LEN,
};
