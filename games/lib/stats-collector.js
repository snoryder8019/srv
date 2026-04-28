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
  rust:    path.join(__dirname, '..', 'rust', 'logs', 'server.log'),
  valheim: path.join(__dirname, '..', 'valheim', 'logs', 'server.log'),
  valheim_events: path.join(__dirname, '..', 'valheim', 'logs', 'events.log'),
  l4d2:    path.join(__dirname, '..', 'l4d2', 'logs', 'console.log'),
  '7dtd':  path.join(__dirname, '..', '7dtd', 'logs', 'output_log.txt'),
  se:      path.join(__dirname, '..', 'se', 'logs', 'server.log'),
  palworld: path.join(__dirname, '..', 'palworld', 'logs', 'server.log'),
  windrose: path.join(__dirname, '..', 'windrose', 'logs', 'server.log'),
  windrose_events: path.join(__dirname, '..', 'windrose', 'WindrosePlus', 'logs', 'activity.log'),
  madlads_stats: path.join(__dirname, '..', 'windrose', 'windrose_plus_data', 'madlads_stats.log'),
};

// Fallback log paths
const RUST_LOG_ALT = path.join(__dirname, '..', 'rust', 'RustDedicated_Data', 'output_log.txt');
const WINDROSE_LOG_ALT = path.join(__dirname, '..', 'windrose', 'R5', 'Saved', 'Logs', 'R5.log');
// WindrosePlus writes one NDJSON file per UTC day named YYYY-MM-DD.log inside
// <game>/windrose_plus_data/. We pick the most recent at startup; daily
// rollover requires a games service restart (acceptable for now).
const WINDROSE_PLUS_DATA_DIR = path.join(__dirname, '..', 'windrose', 'windrose_plus_data');
function resolveWindrosePlusLog() {
  try {
    if (!fs.existsSync(WINDROSE_PLUS_DATA_DIR)) return null;
    const files = fs.readdirSync(WINDROSE_PLUS_DATA_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort();
    return files.length ? path.join(WINDROSE_PLUS_DATA_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

// Map virtual log sources to their game for DB storage
const LOG_GAME_MAP = {
  rust: 'rust', valheim: 'valheim', valheim_events: 'valheim',
  l4d2: 'l4d2', '7dtd': '7dtd', se: 'se', palworld: 'palworld',
  windrose: 'windrose', windrose_events: 'windrose', madlads_stats: 'windrose',
};

// Sources whose lines are NDJSON instead of free-form text
const JSON_SOURCES = new Set(['windrose_events', 'madlads_stats']);

// Per-source one-shot raw-line dump. WindrosePlus's NDJSON schema is
// unconfirmed — log the first few lines so we can lock in field names.
const DEBUG_DUMP_LIMITS = { windrose_events: 5, madlads_stats: 30 };
const debugDumpCounts = {};

// ── Log line patterns per game ──
const PATTERNS = {
  rust: [
    { type: 'player_join', re: /(.+?) with steamid (\d+) joined from ip (\S+)/, fields: ['name', 'steamId', 'ip'] },
    { type: 'player_join', re: /(\d+\.\d+\.\d+\.\d+:\d+)\/(\d+)\/(.+?) joined \[(.+?)\/(\d+)\]/, fields: ['ip', 'steamId', 'name', 'os', 'ownerSteamId'] },
    { type: 'player_spawn', re: /(.+?)\[(\d+)\] has spawned/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /(\d+\.\d+\.\d+\.\d+:\d+)\/(\d+)\/(.+?) disconnecting:/, fields: ['ip', 'steamId', 'name'] },
    { type: 'chat', re: /\[CHAT\] (.+?)\[(\d+)\] : (.+)/, fields: ['name', 'steamId', 'message'] },
    { type: 'kill', re: /(.+?)\[(\d+)\] was killed by (.+?)(?:\[(\d+)\])? at \((.+?)\)/, fields: ['victim', 'victimId', 'attacker', 'attackerId', 'pos'] },
    { type: 'kill', re: /(.+?)\[(\d+)\] was killed by (.+?)(?:\[(\d+)\])?$/, fields: ['victim', 'victimId', 'attacker', 'attackerId'] },
    { type: 'save', re: /Saved ([\d,]+) ents/, fields: ['entityCount'] },
    { type: 'server_start', re: /Server startup complete/, fields: [] },
  ],
  valheim: [
    { type: 'player_join', re: /Got connection SteamID (\d+)/, fields: ['steamId'] },
    { type: 'player_leave', re: /Closing socket (\d+)/, fields: ['steamId'] },
    { type: 'character_name', re: /Got character ZDOID from (.+?) :/, fields: ['name'] },
    { type: 'wrong_password', re: /Peer (\d+) has wrong password/, fields: ['steamId'] },
    { type: 'server_start', re: /Game server connected/, fields: [] },
    { type: 'server_version', re: /Valheim version: (.+?) \(network version (\d+)\)/, fields: ['version', 'networkVersion'] },
  ],
  // BepInEx event logger (MadLadsEventLogger plugin) — structured events
  valheim_events: [
    { type: 'death', re: /\[MLEVENT\] .+? \| death \| victim=(.+?)\|victim_type=(.+?)\|killer=(.+?)\|killer_type=(.+?)\|pos=(.+)/, fields: ['victim', 'victimType', 'attacker', 'attackerType', 'pos'] },
    { type: 'boss_kill', re: /\[MLEVENT\] .+? \| boss_kill \| boss=(.+?)\|killed_by=(.+?)\|pos=(.+)/, fields: ['boss', 'killedBy', 'pos'] },
    { type: 'raid_start', re: /\[MLEVENT\] .+? \| raid_start \| event=(.+?)\|pos=(.+)/, fields: ['raidEvent', 'pos'] },
    { type: 'raid_end', re: /\[MLEVENT\] .+? \| raid_end \|/, fields: [] },
    { type: 'piece_place', re: /\[MLEVENT\] .+? \| piece_place \| player=(.+?)\|piece=(.+)/, fields: ['name', 'piece'] },
    { type: 'world_save', re: /\[MLEVENT\] .+? \| world_save \|/, fields: [] },
  ],
  l4d2: [
    { type: 'player_join', re: /"(.+?)<\d+><(STEAM_\S+)>" entered the game/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /"(.+?)<\d+><(STEAM_\S+)>" disconnected/, fields: ['name', 'steamId'] },
    { type: 'map_change', re: /Started map "([^"]+)"/, fields: ['map'] },
    { type: 'chat', re: /"(.+?)<\d+><(STEAM_\S+)><[^>]*>" say "(.+)"/, fields: ['name', 'steamId', 'message'] },
    { type: 'kill', re: /"(.+?)<\d+><(STEAM_\S+)>" killed "(.+?)<\d+><(STEAM_\S+)>"/, fields: ['attacker', 'attackerId', 'victim', 'victimId'] },
    { type: 'friendly_fire', re: /"(.+?)<\d+><(STEAM_\S+)>.*" attacked "(.+?)<\d+><(STEAM_\S+)>"/, fields: ['attacker', 'attackerId', 'victim', 'victimId'] },
    { type: 'infected_kill', re: /"(.+?)<\d+><(STEAM_\S+)><Survivor>" triggered "Killed" against "(.+?)<\d+><[^>]*><Infected>"/, fields: ['name', 'steamId', 'infected'] },
  ],
  '7dtd': [
    { type: 'player_join', re: /PlayerSpawnedInWorld \(reason: (.+?), position: (.+?)\).*PltfmId='Steam_(\d+)'.*PlayerName='(.+?)'/, fields: ['reason', 'pos', 'steamId', 'name'] },
    { type: 'player_join', re: /PlayerSpawnedInWorld.*PlayerName='(.+?)'.*SteamId='(\d+)'/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /Player (.+?) disconnected after ([\d.]+) minutes/, fields: ['name', 'sessionMinutes'] },
    { type: 'player_leave', re: /Player disconnected:.*PltfmId='Steam_(\d+)'.*PlayerName='(.+?)'/, fields: ['steamId', 'name'] },
    { type: 'player_leave', re: /Player disconnected:.*PlayerName='(.+?)'.*SteamId='(\d+)'/, fields: ['name', 'steamId'] },
    { type: 'death', re: /GMSG: Player '(.+?)' died/, fields: ['victim'] },
    { type: 'chat', re: /Chat.*'(.+?)': (.+)/, fields: ['name', 'message'] },
    { type: 'kill', re: /Player '(.+?)' killed by '(.+?)'/, fields: ['victim', 'attacker'] },
    { type: 'server_start', re: /GameManager Awake done/, fields: [] },
    { type: 'bloodmoon', re: /BloodMoon.*SetDay=(\d+)/, fields: ['day'] },
  ],
  se: [
    { type: 'player_join', re: /OnConnectedClient (.+?) attempt/, fields: ['name'] },
    { type: 'player_join', re: /Player connected.*?:\s*(.+?)\s*\((\d{17})\)/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /User left (.+)/, fields: ['name'] },
    { type: 'player_leave', re: /Player disconnected.*?:\s*(.+?)\s*\((\d{17})\)/, fields: ['name', 'steamId'] },
    { type: 'server_start', re: /Session loaded/, fields: [] },
    { type: 'save', re: /Autosave/, fields: [] },
    { type: 'grid_built', re: /Grid created.*?by\s*(.+)/, fields: ['name'] },
  ],
  palworld: [
    { type: 'player_join', re: /Login.*?:\s*(.+?)\s*.*?SteamID:\s*(\d{17})/, fields: ['name', 'steamId'] },
    { type: 'player_leave', re: /Logout.*?:\s*(.+?)\s*.*?SteamID:\s*(\d{17})/, fields: ['name', 'steamId'] },
    { type: 'server_start', re: /Setting breakpad|Server started/, fields: [] },
    { type: 'pal_captured', re: /captured.*?Pal.*?:\s*(.+)/, fields: ['pal'] },
  ],
  // Windrose runs UE5; log lines come through tee to logs/server.log.
  // Patterns are intentionally permissive — Windrose is in early access and the log
  // schema is undocumented. Update as real logs accumulate.
  windrose: [
    { type: 'player_join', re: /Join succeeded:\s*(\S+)/i, fields: ['name'] },
    { type: 'player_leave', re: /UChannel::Close.*?(?:RemoteAddr|PlayerName)[:=]\s*(\S+)/i, fields: ['name'] },
    { type: 'server_start', re: /(Server is ready|InviteCode|Engine Initialization\) Total time)/i, fields: [] },
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
    await db.collection('game_events').createIndex({ game: 1, type: 1, ts: -1 });
    await db.collection('game_events').createIndex({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // 30-day TTL
    await db.collection('game_snapshots').createIndex({ game: 1, ts: -1 });
    await db.collection('game_snapshots').createIndex({ ts: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // 7-day TTL
    await db.collection('player_stats').createIndex({ steamId: 1, game: 1 }, { unique: true, sparse: true });
    await db.collection('player_stats').createIndex({ game: 1, totalPlaytime: -1 });
    await db.collection('player_stats').createIndex({ game: 1, kills: -1 });
    await db.collection('player_stats').createIndex({ game: 1, deaths: -1 });
    await db.collection('player_stats').createIndex({ game: 1, bossKills: -1 });
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
  const games = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose'];
  for (const game of games) {
    try {
      const lib = require(`./${game === '7dtd' ? '7dtd' : game}`);
      const status = await lib.getStatus();
      if (!status.running) continue;

      const snapshot = {
        game,
        ts: new Date(),
        running: true,
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
  for (const [source, logPath] of Object.entries(LOG_PATHS)) {
    let actualPath = logPath;
    if (source === 'rust' && !fs.existsSync(logPath)) actualPath = RUST_LOG_ALT;
    if (source === 'windrose' && !fs.existsSync(logPath)) actualPath = WINDROSE_LOG_ALT;
    if (source === 'windrose_events') {
      actualPath = resolveWindrosePlusLog() || logPath;
    }
    tailLog(source, actualPath);
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

// WindrosePlus emits NDJSON of shape:
//   {"ev":"player.join","ts":"...","ts_unix":...,"payload":{...},"sid":"..."}
// We map dot-namespaced ev names to our internal type vocab, and flatten
// payload so name/x/y/z/etc are top-level on the stored event.
const JSON_TYPE_MAP = {
  'player.join': 'player_join', 'player.leave': 'player_leave',
  'mod.boot': 'server_start',
  'config.load': 'config_load', 'config.load.fail': 'config_load_fail',
  'heartbeat': 'heartbeat',
  'admin.command': 'command',
  // MadLadsStats discovery — every successful hook firing names the path it fired on
  'hook.fired': 'hook_fired',
  'madlads_stats.boot': 'mod_boot',
  'madlads_stats.hooks': 'mod_status',
};

function processJsonLogLine(source, line) {
  const limit = DEBUG_DUMP_LIMITS[source];
  if (limit) {
    const seen = debugDumpCounts[source] || 0;
    if (seen < limit) {
      debugDumpCounts[source] = seen + 1;
      console.log(`[stats] ${source} sample #${seen + 1}:`, line.slice(0, 500));
    }
  }

  let parsed;
  try { parsed = JSON.parse(line); } catch { return; }
  if (!parsed || typeof parsed !== 'object') return;

  const rawType = parsed.ev || parsed.event || parsed.type || parsed.action;
  if (!rawType) return;

  const game = LOG_GAME_MAP[source] || source;
  const tsRaw = parsed.ts || parsed.timestamp;
  const event = {
    game,
    type: JSON_TYPE_MAP[rawType] || rawType,
    ts: tsRaw ? new Date(tsRaw) : new Date(),
    raw: line.slice(0, 300),
  };
  if (parsed.sid) event.sessionId = parsed.sid;

  const p = (parsed.payload && typeof parsed.payload === 'object') ? parsed.payload : parsed;
  const name = p.name || p.player || p.playerName;
  const steamId = p.steamId || p.steamid || p.accountId || p.account_id;

  if (name) event.name = name;
  if (steamId) event.steamId = String(steamId);
  if (p.message || p.text) event.message = p.message || p.text;
  if (p.x != null && p.y != null) event.pos = `${p.x},${p.y},${p.z != null ? p.z : 0}`;
  if (p.player_count != null) event.playerCount = p.player_count;
  if (p.mode) event.mode = p.mode;
  if (p.attacker) event.attacker = p.attacker;
  if (p.victim) event.victim = p.victim;
  if (p.attackerId) event.attackerId = String(p.attackerId);
  if (p.victimId) event.victimId = String(p.victimId);

  storeEvent(event);
}

function processLogLine(source, line) {
  if (JSON_SOURCES.has(source)) return processJsonLogLine(source, line);

  const patterns = PATTERNS[source];
  if (!patterns) return;

  const game = LOG_GAME_MAP[source] || source;

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

// ── Cross-game SteamID → login/character name cache ──
// Populated whenever we observe a name+steamId pair in any event. Used to
// backfill the `name` field on later events that only carry a steamId so the
// live feed always keys on a human-readable login instead of a player number.
const nameCache = {}; // `${game}:${steamId}` → name

function cacheName(game, steamId, name) {
  if (!game || !steamId || !name) return;
  nameCache[`${game}:${steamId}`] = name;
}

function lookupName(game, steamId) {
  if (!game || !steamId) return null;
  return nameCache[`${game}:${steamId}`] || null;
}

// Legacy alias kept to avoid touching call sites elsewhere.
const valheimNameCache = nameCache;
function resolveValheimName(steamId) {
  return lookupName('valheim', steamId) || steamId;
}

// ── Event Storage ──
async function storeEvent(event) {
  try {
    // Cache any name+steamId pair we can learn from this event…
    if (event.steamId && event.name) cacheName(event.game, event.steamId, event.name);
    if (event.attackerId && event.attacker) cacheName(event.game, event.attackerId, event.attacker);
    if (event.victimId && event.victim) cacheName(event.game, event.victimId, event.victim);

    // …then backfill missing names from the cache so the live feed never has to
    // fall back to a raw steamId / "player number".
    if (!event.name && event.steamId) {
      const cached = lookupName(event.game, event.steamId);
      if (cached) event.name = cached;
    }
    if (!event.attacker && event.attackerId) {
      const cached = lookupName(event.game, event.attackerId);
      if (cached) event.attacker = cached;
    }
    if (!event.victim && event.victimId) {
      const cached = lookupName(event.game, event.victimId);
      if (cached) event.victim = cached;
    }

    await db.collection('game_events').insertOne(event);
    emitter.emit('event', event);

    // --- Valheim character name resolution ---
    if (event.game === 'valheim' && event.type === 'character_name' && event.name) {
      // Cache name; also update last join event with name
      const recentJoin = await db.collection('game_events').findOne(
        { game: 'valheim', type: 'player_join', ts: { $gte: new Date(Date.now() - 60000) } },
        { sort: { ts: -1 } }
      );
      if (recentJoin && recentJoin.steamId) {
        cacheName('valheim', recentJoin.steamId, event.name);
        // Re-emit a synthetic player_join with the resolved name so the live feed
        // updates from "Anonymous joined" to the real character name.
        emitter.emit('event', {
          game: 'valheim',
          type: 'player_join',
          ts: event.ts,
          name: event.name,
          steamId: recentJoin.steamId,
          resolved: true,
        });
        await db.collection('player_stats').updateOne(
          { steamId: recentJoin.steamId, game: 'valheim' },
          { $set: { name: event.name, lastSeen: event.ts } },
          { upsert: false }
        );
      }
    }

    // --- Player join: upsert player_stats ---
    if (event.type === 'player_join' && event.steamId) {
      const name = event.name || resolveValheimName(event.steamId);
      await db.collection('player_stats').updateOne(
        { steamId: event.steamId, game: event.game },
        {
          $set: { name, lastSeen: event.ts },
          $inc: { sessions: 1 },
          $setOnInsert: {
            firstSeen: event.ts, totalPlaytime: 0,
            kills: 0, deaths: 0, bossKills: 0, piecesPlaced: 0, crafted: 0,
          },
        },
        { upsert: true }
      );
    }

    // --- Windrose: name-keyed upsert (no SteamID exposed by WindrosePlus) ---
    // Death tracking is not implemented: WindrosePlus only emits player.join
    // when a player NAME enters the active set (set-diff detection), so
    // respawn-while-still-online produces no event. UE4SS RegisterHook against
    // engine death/damage UFunctions doesn't fire under Proton/UE5.6 either.
    // Re-evaluate when WindrosePlus adds death events upstream.
    if (event.type === 'player_join' && event.game === 'windrose' && event.name && !event.steamId) {
      await db.collection('player_stats').updateOne(
        { game: 'windrose', name: event.name },
        {
          $set: { lastSeen: event.ts },
          $inc: { sessions: 1 },
          $setOnInsert: {
            firstSeen: event.ts, totalPlaytime: 0,
            kills: 0, deaths: 0, bossKills: 0, piecesPlaced: 0, crafted: 0,
          },
        },
        { upsert: true }
      );
    }

    // --- Player leave (name-keyed games): close the session, increment playtime ---
    // Caps at 24h so a missing player_leave (server crash) can't inflate the total.
    if (event.type === 'player_leave' && event.name && !event.steamId) {
      const recentJoin = await db.collection('game_events').findOne(
        { game: event.game, type: 'player_join', name: event.name, ts: { $lt: event.ts } },
        { sort: { ts: -1 } }
      );
      const sessionSec = recentJoin && recentJoin.ts
        ? Math.min(86400, Math.max(0, Math.floor((event.ts - recentJoin.ts) / 1000)))
        : 0;
      await db.collection('player_stats').updateOne(
        { game: event.game, name: event.name },
        { $set: { lastSeen: event.ts }, $inc: { totalPlaytime: sessionSec } }
      );
    }

    // --- Kill events (Rust, L4D2, 7DTD) ---
    if (event.type === 'kill') {
      if (event.attackerId) {
        await db.collection('player_stats').updateOne(
          { steamId: event.attackerId, game: event.game },
          { $inc: { kills: 1 } },
          { upsert: true }
        );
      }
      if (event.victimId) {
        await db.collection('player_stats').updateOne(
          { steamId: event.victimId, game: event.game },
          { $inc: { deaths: 1 } },
          { upsert: true }
        );
      }
    }

    // --- Valheim death (from BepInEx event logger) ---
    if (event.type === 'death' && event.game === 'valheim') {
      if (event.victimType === 'player') {
        // Player died — increment deaths by name
        await db.collection('player_stats').updateOne(
          { game: 'valheim', name: event.victim },
          { $inc: { deaths: 1 } }
        );
      }
      if (event.attackerType === 'player' && event.victimType === 'creature') {
        // Player killed a creature
        await db.collection('player_stats').updateOne(
          { game: 'valheim', name: event.attacker },
          { $inc: { kills: 1 } }
        );
      }
    }

    // --- Valheim boss kill ---
    if (event.type === 'boss_kill' && event.game === 'valheim') {
      if (event.killedBy && event.killedBy !== 'unknown') {
        await db.collection('player_stats').updateOne(
          { game: 'valheim', name: event.killedBy },
          { $inc: { bossKills: 1 } }
        );
      }
    }

    // --- Valheim piece placement ---
    if (event.type === 'piece_place' && event.game === 'valheim') {
      if (event.name) {
        await db.collection('player_stats').updateOne(
          { game: 'valheim', name: event.name },
          { $inc: { piecesPlaced: 1 } }
        );
      }
    }

    // --- 7DTD player death ---
    if (event.type === 'death' && event.game === '7dtd' && event.victim) {
      await db.collection('player_stats').updateOne(
        { game: '7dtd', name: event.victim },
        { $inc: { deaths: 1 } }
      );
    }

    // --- L4D2 infected kills ---
    if (event.type === 'infected_kill' && event.steamId) {
      await db.collection('player_stats').updateOne(
        { steamId: event.steamId, game: event.game },
        { $inc: { kills: 1 } },
        { upsert: true }
      );
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

  // Unique players last 24h. Prefer steamId, fall back to name — windrose
  // and valheim track players by name only (no Steam ID exposed).
  const joins = await db.collection('game_events').find(
    { game, type: 'player_join', ts: { $gte: since } },
    { projection: { steamId: 1, name: 1 } }
  ).toArray();
  const uniquePlayers = new Set(
    joins.map(e => e.steamId || e.name).filter(Boolean)
  );

  // Peak players (max from snapshots)
  const peakSnap = await db.collection('game_snapshots')
    .findOne({ game, ts: { $gte: since } }, { sort: { players: -1 } });

  const evMap = eventCounts.reduce((acc, e) => { acc[e._id] = e.count; return acc; }, {});

  return {
    game,
    latest,
    events: evMap,
    uniquePlayers24h: uniquePlayers.size,
    peakPlayers24h: peakSnap ? peakSnap.players : 0,
    // Enriched stats
    deaths24h: evMap.death || 0,
    bossKills24h: evMap.boss_kill || 0,
    raids24h: evMap.raid_start || 0,
    piecesPlaced24h: evMap.piece_place || 0,
  };
}

// ── All-time stats for a game ──
async function getGameAllTimeStats(game) {
  const pipeline = [
    { $match: { game } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: '$sessions' },
        totalPlaytime: { $sum: '$totalPlaytime' },
        totalKills: { $sum: { $ifNull: ['$kills', 0] } },
        totalDeaths: { $sum: { $ifNull: ['$deaths', 0] } },
        totalBossKills: { $sum: { $ifNull: ['$bossKills', 0] } },
        totalPiecesPlaced: { $sum: { $ifNull: ['$piecesPlaced', 0] } },
        playerCount: { $sum: 1 },
      },
    },
  ];
  const result = await db.collection('player_stats').aggregate(pipeline).toArray();
  return result[0] || {
    totalSessions: 0, totalPlaytime: 0, totalKills: 0,
    totalDeaths: 0, totalBossKills: 0, totalPiecesPlaced: 0, playerCount: 0,
  };
}

// ── Recent notable events (deaths, boss kills, raids) for a game ──
async function getNotableEvents(game, limit = 20) {
  const notableTypes = ['death', 'boss_kill', 'kill', 'raid_start', 'raid_end'];
  return db.collection('game_events')
    .find({ game, type: { $in: notableTypes } })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();
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
  getGameAllTimeStats,
  getNotableEvents,
};
