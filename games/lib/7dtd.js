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
// 7DTD log patterns:
//   "GameManager Awake done" or "StartGame" → server ready
//   "Player connected, entityid=..." → player joined
//   "Player disconnected, entityid=..." → player left

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('GameManager Awake done') || lines[i].includes('StartGame')) {
        startIdx = i;
        break;
      }
    }
    let count = 0;
    for (let i = startIdx; i < lines.length; i++) {
      if (/Player connected,/.test(lines[i])) count++;
      if (/Player disconnected,/.test(lines[i])) count = Math.max(0, count - 1);
    }
    return count;
  } catch {
    return 0;
  }
}

async function getStatus() {
  const running = isRunning();
  if (!running) return { running: false, players: 0, maxPlayers: 0 };

  let booting = true;
  let map = null;
  let seed = null;
  if (fs.existsSync(LOG_FILE)) {
    const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-80).join('\n');
    booting = !tail.includes('GameManager Awake done') && !tail.includes('StartGame');
    const worldMatch = tail.match(/World '[^']*' loaded/i) || tail.match(/Loaded World: ([^\n]+)/);
    if (worldMatch) map = worldMatch[1] || worldMatch[0];
    const seedMatch = tail.match(/Seed: (\d+)/);
    if (seedMatch) seed = seedMatch[1];
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 8,
    map: map ? map.replace(/World '(.+)' loaded/i, '$1').trim() : '—',
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
      if (status.players > 0) {
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
