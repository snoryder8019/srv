/**
 * 7 Days to Die Server Management
 * - tmux session control (start/stop/restart)
 * - Log-based status tracking
 * - Folder-based mod management (Mods/ directory)
 * - Auto-shutdown after inactivity
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = '7dtd';
const GS_USER = 'gs-7dtd';
const START_SCRIPT = path.join(__dirname, '..', 'start-7dtd.sh');
const SDTD_DIR = '/srv/games/7dtd';
const LOG_FILE = path.join(SDTD_DIR, 'logs', 'output_log.txt');
const MODS_DIR = path.join(SDTD_DIR, 'Mods');
const MODS_DISABLED_DIR = path.join(SDTD_DIR, 'Mods_disabled');

const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
let lastPlayerActivity = null;
let inactivityTimer = null;
// Once we observe "StartGame done" after the latest StartAsServer, we cache it
// so the booting flag doesn't flap as the log churns past a tail window.
let _readySince = null;

// --- tmux helpers ---

function isRunning() {
  try {
    execSync(`sudo -u ${GS_USER} tmux has-session -t ${SESSION} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function startServer() {
  if (isRunning()) return { ok: false, message: 'Server already running' };
  if (!fs.existsSync(START_SCRIPT)) return { ok: false, message: 'start-7dtd.sh not found' };
  try {
    execSync(`bash ${START_SCRIPT}`, { stdio: 'pipe' });
    _readySince = null;
    resetInactivityTimer();
    return { ok: true, message: 'Server starting...' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function stopServer(reason) {
  if (!isRunning()) return { ok: false, message: 'Server not running' };
  try {
    execSync(`sudo -u ${GS_USER} tmux kill-session -t ${SESSION} 2>/dev/null`);
    clearInactivityTimer();
    _readySince = null;
    console.log(`[games] 7DTD server stopped${reason ? ': ' + reason : ''}`);
    return { ok: true, message: 'Server stopped' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function restartServer() {
  stopServer('restart');
  setTimeout(() => startServer(), 2000);
  return { ok: true, message: 'Restarting...' };
}

// --- Status ---
// 7DTD log patterns (V1.x+ build):
//   "StartAsServer"                                  → boot start (anchor for current run)
//   "StartGame done"                                 → server ready, accepting connections
//   "GMSG: Player 'X' joined the game"               → player entered the world
//   "GMSG: Player 'X' left the game"                 → player left the world
//   "GamePref.GameWorld = <world>"                   → map name
//   "GamePref.WorldGenSeed = <seed>"                 → seed

// Slice the log file down to just the most recent run.
// Anchor: `INF StartGame` at end of line (NOT `INF StartGame done`), since
// GameWorld/WorldGenSeed lines come before StartAsServer in the boot sequence.
function _currentRunSlice(content) {
  const re = /INF StartGame$/gm;
  let last = -1;
  let m;
  while ((m = re.exec(content)) !== null) last = m.index;
  return last === -1 ? content : content.slice(last);
}

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const content = _currentRunSlice(fs.readFileSync(LOG_FILE, 'utf8'));
    let count = 0;
    for (const line of content.split('\n')) {
      if (/GMSG: Player '[^']+' joined the game/.test(line)) count++;
      else if (/GMSG: Player '[^']+' left the game/.test(line)) count = Math.max(0, count - 1);
    }
    return count;
  } catch {
    return 0;
  }
}

async function getStatus() {
  const running = isRunning();
  if (!running) {
    _readySince = null;
    return { running: false, players: 0, maxPlayers: 0 };
  }

  let booting = _readySince === null;
  let map = null;
  let seed = null;

  if (fs.existsSync(LOG_FILE)) {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const run = _currentRunSlice(content);

    if (booting && run.includes('StartGame done')) {
      _readySince = Date.now();
      booting = false;
    }

    const worldMatch = run.match(/GamePref\.GameWorld\s*=\s*([^\r\n]+)/);
    if (worldMatch) map = worldMatch[1].trim();
    const seedMatch = run.match(/GamePref\.WorldGenSeed\s*=\s*([^\r\n]+)/);
    if (seedMatch) seed = seedMatch[1].trim();
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 8,
    map: map || '—',
    seed: seed || null,
  };
}

// --- Mod management (folder-based) ---
// Each mod is a directory under Mods/
// Disabled mods are moved to Mods_disabled/

function getMods() {
  const mods = [];
  try {
    fs.mkdirSync(MODS_DIR, { recursive: true });
    const entries = fs.readdirSync(MODS_DIR, { withFileTypes: true });
    entries.filter(e => e.isDirectory()).forEach(e => {
      mods.push({ name: e.name, file: e.name, enabled: true });
    });
  } catch {}
  try {
    fs.mkdirSync(MODS_DISABLED_DIR, { recursive: true });
    const entries = fs.readdirSync(MODS_DISABLED_DIR, { withFileTypes: true });
    entries.filter(e => e.isDirectory()).forEach(e => {
      mods.push({ name: e.name, file: e.name, enabled: false });
    });
  } catch {}
  return mods;
}

function toggleMod(modName, enable) {
  fs.mkdirSync(MODS_DIR, { recursive: true });
  fs.mkdirSync(MODS_DISABLED_DIR, { recursive: true });
  const src = enable
    ? path.join(MODS_DISABLED_DIR, modName)
    : path.join(MODS_DIR, modName);
  const dst = enable
    ? path.join(MODS_DIR, modName)
    : path.join(MODS_DISABLED_DIR, modName);
  if (!fs.existsSync(src)) return { ok: false, message: 'Mod not found' };
  fs.renameSync(src, dst);
  return { ok: true };
}

// --- Auto-shutdown ---

function resetInactivityTimer() {
  clearInactivityTimer();
  lastPlayerActivity = Date.now();
  inactivityTimer = setInterval(async () => {
    try {
      const status = await getStatus();
      if (!status.running) { clearInactivityTimer(); return; }
      let pinned = false;
      try { pinned = require('./server-manager').isKeepOnline('7dtd'); } catch {}
      if (status.players > 0 || pinned) {
        lastPlayerActivity = Date.now();
      } else if (lastPlayerActivity && Date.now() - lastPlayerActivity >= INACTIVITY_LIMIT_MS) {
        console.log('[games] Auto-shutting down 7DTD: 1hr inactivity');
        stopServer('inactivity auto-shutdown');
      }
    } catch {}
  }, 5 * 60 * 1000);
}

function clearInactivityTimer() {
  if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
}

if (isRunning()) resetInactivityTimer();

module.exports = {
  isRunning,
  startServer,
  stopServer,
  restartServer,
  getStatus,
  getMods,
  toggleMod,
  resetInactivityTimer,
};
