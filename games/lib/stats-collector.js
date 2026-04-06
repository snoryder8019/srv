'use strict';

/**
 * Stats Collector — polls game servers, tails logs, stores events + snapshots
 * Emits events via a shared EventEmitter for Socket.IO to broadcast
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();

// Log file positions (for tailing)
const logPositions = {};

// ── Config ──
const LOG_PATHS = {
  rust:    path.join(__dirname, '..', 'rust', 'server', 'madlads', 'Log.EAC.txt'),
  valheim: path.join(__dirname, '..', 'valheim', 'logs', 'server.log'),
  l4d2:    path.join(__dirname, '..', 'l4d2', 'logs', 'console.log'),
  '7dtd':  path.join(__dirname, '..', '7dtd', 'logs', 'output_log.txt'),
  se:      path.join(__dirname, '..', 'se', 'logs', 'server.log'),
  palworld: path.join(__dirname, '..', 'palworld', 'logs', 'server.log'),
};

// Fallback log paths
const RUST_LOG_ALT = path.join(__dirname, '..', 'rust', 'RustDedicated_Data', 'output_log.txt');

// ── Log line patterns per game ──
const PATTERNS = {
  rust: [
    { type: 'player_join', re: /(\d+\.\d+\.\d+\.\d+:\d+)\/(\d+)\/(.+?) joined \[(.+?)\/(\d+)\]/, fields: ['ip', 'steamId', 'name', 'os', 'ownerSteamId'] },
    { type: 'player_leave', re: /(\d+\.\d+\.\d+\.\d+:\d+)\/(\d+)\/(.+?) disconnecting:/, fields: ['ip', 'steamId', 'name'] },
    { type: 'chat', re: /\[CHAT\] (.+?)\[(\d+)\] : (.+)/, fields: ['name', 'steamId', 'message'] },
    { type: 'kill', re: /(.+?)\[(\d+)\] was killed by (.+?)(?:\[(\d+)\])?$/, fields: ['victim', 'victimId', 'attacker', 'attackerId'] },
  ],
  valheim: [
    { type: 'player_join', re: /Got connection SteamID (\d+)/, fields: ['steamId'] },
    { type: 'player_leave', re: /Closing socket (\d+)/, fields: ['steamId'] },
    { type: 'server_start', re: /Game server connected/, fields: [] },
  ],
  l4d2: [
    { type: 'player_join', re: /"(.+?)<\d+><(STEAM_\S+)>" entered the game/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /"(.+?)<\d+><(STEAM_\S+)>" disconnected/, fields: ['name', 'steamId'] },
    { type: 'map_change', re: /Started map "([^"]+)"/, fields: ['map'] },
    { type: 'chat', re: /"(.+?)<\d+><(STEAM_\S+)><[^>]*>" say "(.+)"/, fields: ['name', 'steamId', 'message'] },
    { type: 'kill', re: /"(.+?)<\d+><(STEAM_\S+)>" killed "(.+?)<\d+><(STEAM_\S+)>"/, fields: ['attacker', 'attackerId', 'victim', 'victimId'] },
  ],
  '7dtd': [
    { type: 'player_join', re: /PlayerSpawnedInWorld.*PlayerName='(.+?)'.*SteamId='(\d+)'/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /Player disconnected:.*PlayerName='(.+?)'.*SteamId='(\d+)'/, fields: ['name', 'steamId'] },
    { type: 'chat', re: /Chat.*'(.+?)': (.+)/, fields: ['name', 'message'] },
    { type: 'kill', re: /Player '(.+?)' killed by '(.+?)'/, fields: ['victim', 'attacker'] },
    { type: 'server_start', re: /GameManager Awake done/, fields: [] },
  ],
  se: [
    { type: 'player_join', re: /Player connected.*?:\s*(.+?)\s*\((\d{17})\)/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /Player disconnected.*?:\s*(.+?)\s*\((\d{17})\)/, fields: ['name', 'steamId'] },
    { type: 'server_start', re: /Game ready|Server started/, fields: [] },
  ],
  palworld: [
    { type: 'player_join', re: /Login.*?:\s*(.+?)\s*.*?SteamID:\s*(\d{17})/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /Logout.*?:\s*(.+?)\s*.*?SteamID:\s*(\d{17})/, fields: ['name', 'steamId'] },
    { type: 'server_start', re: /Setting breakpad|Server started/, fields: [] },
  ],
};

let db = null;
let pollTimer = null;
let logTimers = {};

// ── Init ──
function init(database) {
  db = database;
  ensureCollections();
  startPolling();
  startLogTailing();
  console.log('[stats] Collector started');
}

async function ensureCollections() {
  try {
    // Create indexes for efficient queries
    await db.collection('game_events').createIndex({ game: 1, ts: -1 });
    await db.collection('game_events').createIndex({ type: 1, ts: -1 });
    await db.collection('game_events').createIndex({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // 30-day TTL
    await db.collection('game_snapshots').createIndex({ game: 1, ts: -1 });
    await db.collection('game_snapshots').createIndex({ ts: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // 7-day TTL
    await db.collection('player_stats').createIndex({ steamId: 1, game: 1 }, { unique: true, sparse: true });
    await db.collection('player_stats').createIndex({ game: 1, totalPlaytime: -1 });
  } catch (e) {
    console.error('[stats] Index creation error:', e.message);
  }
}

// ── Server Polling (snapshots every 30s) ──
function startPolling() {
  pollTimer = setInterval(pollAllServers, 30000);
  pollAllServers(); // initial poll
}

async function pollAllServers() {
  const games = ['rust', 'valheim', 'l4d2', '7dtd'];
  for (const game of games) {
    try {
      const lib = require(`./${game === '7dtd' ? '7dtd' : game}`);
      const status = await lib.getStatus();
      if (!status.running) continue;

      const snapshot = {
        game,
        ts: new Date(),
        players: status.players || 0,
        maxPlayers: status.maxPlayers || 0,
        map: status.map || null,
        fps: status.fps || null,
        uptime: status.uptime || null,
        seed: status.seed || null,
        worldSize: status.worldSize || null,
        hostname: status.hostname || null,
        booting: status.booting || false,
      };

      await db.collection('game_snapshots').insertOne(snapshot);
      emitter.emit('snapshot', snapshot);

      // For Rust, also grab player list via RCON
      if (game === 'rust' && !status.booting) {
        try {
          const playerListRaw = await lib.rconCommand('playerlist');
          const players = parseRustPlayerList(playerListRaw);
          if (players.length > 0) {
            emitter.emit('playerlist', { game: 'rust', players, ts: Date.now() });
            // Update player stats
            for (const p of players) {
              await upsertPlayerStat('rust', p);
            }
          }
        } catch (e) { /* RCON may fail, skip */ }
      }
    } catch (e) {
      // Server lib may throw if server is offline
    }
  }
}

function parseRustPlayerList(raw) {
  // Rust playerlist returns CSV-ish lines:
  // SteamID, DisplayName, Ping, Address, ConnectedSeconds, ...
  const players = [];
  const lines = (raw || '').split('\n');
  for (const line of lines) {
    const match = line.match(/(\d{17})\s+"(.+?)"\s+(\d+)\s+(\S+)\s+([\d.]+)/);
    if (match) {
      players.push({
        steamId: match[1],
        name: match[2],
        ping: parseInt(match[3]),
        address: match[4],
        connectedSeconds: parseFloat(match[5]),
      });
    }
  }
  return players;
}

// ── Log Tailing ──
function startLogTailing() {
  for (const [game, logPath] of Object.entries(LOG_PATHS)) {
    const actualPath = (game === 'rust' && !fs.existsSync(logPath)) ? RUST_LOG_ALT : logPath;
    tailLog(game, actualPath);
  }
}

function tailLog(game, logPath) {
  if (!fs.existsSync(logPath)) return;

  // Start from end of file
  try {
    const stat = fs.statSync(logPath);
    logPositions[game] = stat.size;
  } catch (e) {
    logPositions[game] = 0;
  }

  logTimers[game] = setInterval(() => {
    readNewLines(game, logPath);
  }, 3000); // check every 3s
}

function readNewLines(game, logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < logPositions[game]) {
      // Log was rotated/truncated
      logPositions[game] = 0;
    }
    if (stat.size <= logPositions[game]) return;

    const fd = fs.openSync(logPath, 'r');
    const bufSize = Math.min(stat.size - logPositions[game], 64 * 1024); // max 64KB per read
    const buf = Buffer.alloc(bufSize);
    fs.readSync(fd, buf, 0, bufSize, logPositions[game]);
    fs.closeSync(fd);
    logPositions[game] += bufSize;

    const text = buf.toString('utf8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      processLogLine(game, line.trim());
    }
  } catch (e) {
    // File may be temporarily unavailable
  }
}

function processLogLine(game, line) {
  const patterns = PATTERNS[game];
  if (!patterns) return;

  for (const pat of patterns) {
    const match = line.match(pat.re);
    if (match) {
      const event = {
        game,
        type: pat.type,
        ts: new Date(),
        raw: line.slice(0, 300),
      };

      // Map captured groups to named fields
      pat.fields.forEach((field, i) => {
        event[field] = match[i + 1] || null;
      });

      storeEvent(event);
      break; // one match per line
    }
  }
}

// ── Event Storage ──
async function storeEvent(event) {
  try {
    await db.collection('game_events').insertOne(event);
    emitter.emit('event', event);

    // Update player stats on join/leave
    if (event.type === 'player_join' && event.steamId) {
      await db.collection('player_stats').updateOne(
        { steamId: event.steamId, game: event.game },
        {
          $set: { name: event.name || 'Unknown', lastSeen: event.ts },
          $inc: { sessions: 1 },
          $setOnInsert: { firstSeen: event.ts, totalPlaytime: 0 },
        },
        { upsert: true }
      );
    }

    if (event.type === 'kill') {
      // Increment kill count for attacker
      if (event.attackerId) {
        await db.collection('player_stats').updateOne(
          { steamId: event.attackerId, game: event.game },
          { $inc: { kills: 1 } },
          { upsert: true }
        );
      }
      // Increment death count for victim
      if (event.victimId) {
        await db.collection('player_stats').updateOne(
          { steamId: event.victimId, game: event.game },
          { $inc: { deaths: 1 } },
          { upsert: true }
        );
      }
    }
  } catch (e) {
    console.error('[stats] Event store error:', e.message);
  }
}

async function upsertPlayerStat(game, player) {
  try {
    await db.collection('player_stats').updateOne(
      { steamId: player.steamId, game },
      {
        $set: {
          name: player.name,
          lastSeen: new Date(),
          lastPing: player.ping,
        },
        $inc: { totalPlaytime: 30 }, // 30s per snapshot interval
        $setOnInsert: { firstSeen: new Date(), sessions: 0, kills: 0, deaths: 0 },
      },
      { upsert: true }
    );
  } catch (e) { /* skip */ }
}

// ── Query Helpers (used by API routes) ──

async function getRecentEvents(game, limit = 50) {
  const query = game ? { game } : {};
  return db.collection('game_events')
    .find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();
}

async function getRecentSnapshots(game, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  return db.collection('game_snapshots')
    .find({ game, ts: { $gte: since } })
    .sort({ ts: 1 })
    .toArray();
}

async function getPlayerLeaderboard(game, sortField = 'totalPlaytime', limit = 20) {
  const query = game ? { game } : {};
  return db.collection('player_stats')
    .find(query)
    .sort({ [sortField]: -1 })
    .limit(limit)
    .toArray();
}

async function getPlayerStats(steamId) {
  return db.collection('player_stats')
    .find({ steamId })
    .toArray();
}

async function getServerSummary(game) {
  // Latest snapshot
  const latest = await db.collection('game_snapshots')
    .findOne({ game }, { sort: { ts: -1 } });

  // Event counts last 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const eventCounts = await db.collection('game_events').aggregate([
    { $match: { game, ts: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]).toArray();

  // Unique players last 24h
  const uniquePlayers = await db.collection('game_events').distinct(
    'steamId',
    { game, type: 'player_join', ts: { $gte: since }, steamId: { $ne: null } }
  );

  // Peak players (max from snapshots)
  const peakSnap = await db.collection('game_snapshots')
    .findOne({ game, ts: { $gte: since } }, { sort: { players: -1 } });

  return {
    game,
    latest,
    events: eventCounts.reduce((acc, e) => { acc[e._id] = e.count; return acc; }, {}),
    uniquePlayers24h: uniquePlayers.length,
    peakPlayers24h: peakSnap ? peakSnap.players : 0,
  };
}

function shutdown() {
  if (pollTimer) clearInterval(pollTimer);
  Object.values(logTimers).forEach(t => clearInterval(t));
  console.log('[stats] Collector stopped');
}

module.exports = {
  init,
  shutdown,
  emitter,
  getRecentEvents,
  getRecentSnapshots,
  getPlayerLeaderboard,
  getPlayerStats,
  getServerSummary,
};
