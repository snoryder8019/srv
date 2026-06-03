/**
 * Windrose Dedicated Server Management
 * - tmux session control (start/stop/restart) via Proton-GE
 * - Invite code + config read from R5/ServerDescription.json
 * - Player count read from windrose_plus_data/server_status.json
 *   (WindrosePlus rewrites it every heartbeat; treated as stale after 60s).
 * - Auto-stop after inactivity (mirrors other game modules).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = 'windrose';
const GS_USER = 'gs-windrose';
const START_SCRIPT = path.join(__dirname, '..', 'start-windrose.sh');
const WINDROSE_DIR = '/srv/games/windrose';
const LOG_FILE = path.join(WINDROSE_DIR, 'logs', 'server.log');
const UE5_LOG = path.join(WINDROSE_DIR, 'R5', 'Saved', 'Logs', 'R5.log');
const SERVER_DESC = path.join(WINDROSE_DIR, 'R5', 'ServerDescription.json');
const PLUS_STATUS = path.join(WINDROSE_DIR, 'windrose_plus_data', 'server_status.json');
const PLUS_CONFIG = path.join(WINDROSE_DIR, 'windrose_plus.json');
const PLUS_DATA_DIR = path.join(WINDROSE_DIR, 'windrose_plus_data');
const RCON_SPOOL_DIR = path.join(WINDROSE_DIR, 'windrose_plus_data', 'rcon');
const RCON_INDEX_FILE = path.join(RCON_SPOOL_DIR, 'pending_commands.txt');
const RCON_TIMEOUT_MS = 10_000;
const RCON_POLL_MS = 200;
// server_status.json is rewritten by WindrosePlus on every heartbeat (~5s).
// Anything older than this is stale (server crashed, mod unloaded, etc.).
const PLUS_STATUS_MAX_AGE_MS = 60 * 1000;

// Used by getStatus() to detect when the server has finished booting
// (player count comes from WindrosePlus's server_status.json, not log scraping).
const SERVER_READY_RE = /(Server is ready|LogLoad: \(Engine Initialization\) Total time|InviteCode)/i;

// --- Inactivity auto-stop ---
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
let lastPlayerActivity = null;
let inactivityTimer = null;

// --- tmux helpers ---

function isRunning() {
  try {
    execSync(`sudo -u ${GS_USER} tmux has-session -t ${SESSION} 2>/dev/null`);
  } catch {
    return false;
  }
  // tmux session exists — verify the Wine/server process is actually alive
  try {
    execSync(`pgrep -u ${GS_USER} -f WindroseServer`, { stdio: 'pipe' });
    return true;
  } catch {
    // Session exists but server process died — clean up the stale session
    try { execSync(`sudo -u ${GS_USER} tmux kill-session -t ${SESSION} 2>/dev/null`); } catch {}
    return false;
  }
}

function startServer() {
  if (isRunning()) return { ok: false, message: 'Server already running' };
  try {
    execSync(`bash ${START_SCRIPT}`, { stdio: 'pipe' });
    resetInactivityTimer();
    return { ok: true, message: 'Server starting (Wine + Xvfb)...' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function stopServer(reason) {
  if (!isRunning()) return { ok: false, message: 'Server not running' };
  try {
    execSync(`sudo -u ${GS_USER} tmux kill-session -t ${SESSION} 2>/dev/null`);
    clearInactivityTimer();
    console.log(`[games] Windrose server stopped${reason ? ': ' + reason : ''}`);
    return { ok: true, message: 'Server stopped' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function restartServer() {
  stopServer('restart');
  setTimeout(() => startServer(), 3000);
  return { ok: true, message: 'Restarting...' };
}

// --- ServerDescription.json reader ---

function readServerDescription() {
  try {
    if (!fs.existsSync(SERVER_DESC)) return null;
    const raw = fs.readFileSync(SERVER_DESC, 'utf8');
    const json = JSON.parse(raw);
    const persistent = json.ServerDescription_Persistent || json;
    const useDirect = !!persistent.UseDirectConnection;
    const directHost = persistent.DirectConnectionServerAddress || '';
    const directPort = persistent.DirectConnectionServerPort || 7777;
    return {
      inviteCode:        persistent.InviteCode || null,
      serverName:        persistent.ServerName || null,
      maxPlayers:        persistent.MaxPlayerCount || 8,
      passwordLock:      !!persistent.IsPasswordProtected,
      worldId:           persistent.WorldIslandId || null,
      useDirect,
      directAddress:     useDirect && directHost ? `${directHost}:${directPort}` : null,
    };
  } catch (e) {
    console.warn('[games] Windrose ServerDescription.json unreadable:', e.message);
    return null;
  }
}

// --- Player tracking via log parsing (provisional) ---

function readPlusStatus() {
  try {
    if (!fs.existsSync(PLUS_STATUS)) return null;
    const stat = fs.statSync(PLUS_STATUS);
    if (Date.now() - stat.mtimeMs > PLUS_STATUS_MAX_AGE_MS) return null;
    return JSON.parse(fs.readFileSync(PLUS_STATUS, 'utf8'));
  } catch {
    return null;
  }
}

// Reconstruct the active-player set from the NDJSON activity log when
// server_status.json is unusable. WindrosePlus emits `player.join` and
// `player.leave` events keyed on display name; we replay the tail of today's
// log to derive who's currently in. Capped read size keeps this cheap even
// on chatty days. Used as a fallback when the mod is degraded (the LiveMap
// subsystem can't poll, so plus.players is stale) or when the JSON is missing.
function _resolveActivityLog() {
  const candidates = [path.join(PLUS_DATA_DIR, 'logs'), PLUS_DATA_DIR];
  let bestName = '';
  let bestPath = null;
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f));
      for (const f of files) { if (f > bestName) { bestName = f; bestPath = path.join(dir, f); } }
    } catch {}
  }
  return bestPath;
}

function _activePlayersFromLog() {
  const logPath = _resolveActivityLog();
  if (!logPath) return null;
  let raw;
  try {
    const stat = fs.statSync(logPath);
    // Read at most the tail 256KB — joins/leaves are tiny lines, this covers
    // many hours of normal traffic without slurping the whole day.
    const READ_MAX = 256 * 1024;
    const fd = fs.openSync(logPath, 'r');
    try {
      const len = Math.min(stat.size, READ_MAX);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
      raw = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }

  const active = new Set();
  // If we read a partial file the first line may be truncated — drop it.
  const lines = raw.split('\n');
  if (lines.length > 1 && raw.length === 256 * 1024) lines.shift();
  for (const line of lines) {
    if (!line || line[0] !== '{') continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (!evt || !evt.ev) continue;
    if (evt.ev === 'player.join') {
      const name = evt.payload && (evt.payload.name || evt.payload.player_name);
      if (name) active.add(name);
    } else if (evt.ev === 'player.leave') {
      const name = evt.payload && (evt.payload.name || evt.payload.player_name);
      if (name) active.delete(name);
    } else if (evt.ev === 'mod.boot') {
      // A fresh boot wipes the in-memory active set — anyone "joined" prior
      // is gone now. We see this when the server (and WindrosePlus) restart.
      active.clear();
    }
  }
  return { count: active.size, players: Array.from(active) };
}

function getPlayerCount() {
  // Primary source: WindrosePlus server_status.json — accurate when the mod
  // is in `ready`/`idle` mode (LiveMap subsystem can poll the in-game thread).
  const plus = readPlusStatus();
  if (plus && !plus.degraded) {
    if (Array.isArray(plus.players)) return plus.players.length;
    if (typeof plus?.server?.player_count === 'number') return plus.server.player_count;
    if (typeof plus.player_count === 'number') return plus.player_count;
    return 0;
  }
  // Fallback: WindrosePlus is degraded or the status file is missing/stale.
  // Reconstruct active set from the NDJSON player.join/leave stream — those
  // events still fire on the WindrosePlus core thread even when the in-game
  // thread queue starves (the LiveMap query is what gets blocked, not event
  // emission). This keeps the player count live across degraded windows.
  const derived = _activePlayersFromLog();
  if (derived) return derived.count;
  // Last resort: if the file exists but is degraded, surface the stale value
  // it does have — better than zeroing the card.
  if (plus) {
    if (Array.isArray(plus.players)) return plus.players.length;
    if (typeof plus?.server?.player_count === 'number') return plus.server.player_count;
  }
  return 0;
}

async function getStatus() {
  const running = isRunning();
  const desc = readServerDescription();
  const maxPlayers = desc?.maxPlayers || 8;

  if (!running) {
    return {
      running: false,
      players: 0,
      maxPlayers,
      inviteCode: desc?.inviteCode || null,
      serverName: desc?.serverName || null,
      directConnect: (desc?.useDirect && desc?.directAddress)
        ? { enabled: true, address: desc.directAddress }
        : { enabled: false, address: null },
    };
  }

  let booting = true;
  // Check console log, UE5 internal log, and ServerDescription.json for ready signals
  const logsToCheck = [LOG_FILE, UE5_LOG];
  for (const log of logsToCheck) {
    if (booting && fs.existsSync(log)) {
      const tail = fs.readFileSync(log, 'utf8').split('\n').slice(-200).join('\n');
      if (SERVER_READY_RE.test(tail)) booting = false;
    }
  }
  // ServerDescription.json is written on first successful boot — treat as ready signal
  if (booting && fs.existsSync(SERVER_DESC)) booting = false;

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers,
    map: desc?.serverName || 'Windrose',
    inviteCode: desc?.inviteCode || null,
    serverName: desc?.serverName || 'MadLadsLab Windrose',
    directConnect: (desc?.useDirect && desc?.directAddress)
      ? { enabled: true, address: desc.directAddress }
      : { enabled: false, address: null },
  };
}

// --- Inactivity auto-stop ---

function resetInactivityTimer() {
  clearInactivityTimer();
  lastPlayerActivity = Date.now();
  inactivityTimer = setInterval(async () => {
    try {
      const status = await getStatus();
      if (!status.running) { clearInactivityTimer(); return; }
      let pinned = false;
      try { pinned = require('./server-manager').isKeepOnline('windrose'); } catch {}
      if (status.players > 0 || pinned) {
        lastPlayerActivity = Date.now();
      } else if (lastPlayerActivity && Date.now() - lastPlayerActivity >= INACTIVITY_LIMIT_MS) {
        console.log('[games] Auto-stopping Windrose: 1hr inactivity');
        stopServer('inactivity auto-stop');
      }
    } catch {}
  }, 5 * 60 * 1000);
}

function clearInactivityTimer() {
  if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
}

if (isRunning()) resetInactivityTimer();

// --- WindrosePlus RCON via file spool ---
// Protocol (see WindrosePlus/Scripts/modules/rcon.lua):
//   1. Write cmd_<id>.json into RCON_SPOOL_DIR with {id,command,args,password,timestamp}
//   2. Append "cmd_<id>.json\n" to pending_commands.txt so the Lua poll picks it up
//   3. Poll for res_<id>.json, parse {status, message}, delete it
// The Lua side enforces a 30s command-expiry window from `timestamp`; we cap our
// own wait at RCON_TIMEOUT_MS so a silent mod can't hang the request.

function readRconPassword() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PLUS_CONFIG, 'utf8'));
    return cfg && cfg.rcon && cfg.rcon.password;
  } catch { return null; }
}

function rconCommand(cmd, opts = {}) {
  return new Promise((resolve) => {
    if (!isRunning()) return resolve({ status: 'error', message: 'Server not running' });

    const password = readRconPassword();
    if (!password || password === 'changeme') {
      return resolve({ status: 'error', message: 'RCON not configured (password missing or default)' });
    }

    const id = `web_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cmdFile = `cmd_${id}.json`;
    const cmdPath = path.join(RCON_SPOOL_DIR, cmdFile);
    const tmpPath = cmdPath + '.tmp';
    const resPath = path.join(RCON_SPOOL_DIR, `res_${id}.json`);
    const payload = JSON.stringify({
      id,
      command: cmd,
      args: [],
      password,
      admin_user: opts.adminUser || 'web',
      timestamp: Math.floor(Date.now() / 1000),
    });

    try {
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, cmdPath);
      fs.appendFileSync(RCON_INDEX_FILE, cmdFile + '\n');
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch {}
      return resolve({ status: 'error', message: 'Spool write failed: ' + e.message });
    }

    const deadline = Date.now() + RCON_TIMEOUT_MS;
    const tick = () => {
      let raw;
      try { raw = fs.readFileSync(resPath, 'utf8'); } catch { raw = null; }
      if (raw) {
        try { fs.unlinkSync(resPath); } catch {}
        try { fs.unlinkSync(cmdPath); } catch {}
        let parsed;
        try { parsed = JSON.parse(raw); } catch {
          return resolve({ status: 'error', message: 'Malformed RCON response' });
        }
        return resolve({
          status: parsed.status || 'ok',
          message: parsed.message != null ? String(parsed.message) : '(no output)',
        });
      }
      if (Date.now() >= deadline) {
        try { fs.unlinkSync(cmdPath); } catch {}
        return resolve({ status: 'error', message: 'RCON timeout (no response in 10s)' });
      }
      setTimeout(tick, RCON_POLL_MS);
    };
    tick();
  });
}

module.exports = {
  isRunning,
  startServer,
  stopServer,
  restartServer,
  getStatus,
  rconCommand,
  resetInactivityTimer,
  readServerDescription,
};
