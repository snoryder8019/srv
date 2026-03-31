/**
 * Left 4 Dead 2 Server Management
 * - tmux session control (start/stop/restart)
 * - Log-based status tracking
 * - SourceMod plugin management (.smx files)
 * - Auto-shutdown after inactivity
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = 'l4d2';
const GS_USER = 'gs-l4d2';
const START_SCRIPT = path.join(__dirname, '..', 'start-l4d2.sh');
const L4D2_DIR = '/srv/games/l4d2';
const LOG_FILE = path.join(L4D2_DIR, 'logs', 'console.log');
const PLUGINS_DIR = path.join(L4D2_DIR, 'addons', 'sourcemod', 'plugins');
const PLUGINS_DISABLED_DIR = path.join(PLUGINS_DIR, 'disabled');

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
  if (!fs.existsSync(START_SCRIPT)) return { ok: false, message: 'start-l4d2.sh not found' };
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
    console.log(`[games] L4D2 server stopped${reason ? ': ' + reason : ''}`);
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
// L4D2 srcds log: "L 01/01/2024 - 00:00:00: "CBaseClient::Connect" ... "
// Player connect: 'entered the game'
// Player disconnect: 'disconnected'

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Started map') || lines[i].includes('Log file started')) {
        startIdx = i;
        break;
      }
    }
    let count = 0;
    for (let i = startIdx; i < lines.length; i++) {
      if (lines[i].includes('entered the game')) count++;
      if (lines[i].includes('disconnected')) count = Math.max(0, count - 1);
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
  if (fs.existsSync(LOG_FILE)) {
    const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-60).join('\n');
    booting = !tail.includes('Started map') && !tail.includes('VAC secure mode');
    const mapMatch = tail.match(/Started map "([^"]+)"/);
    if (mapMatch) map = mapMatch[1];
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 8,
    map: map || '—',
  };
}

// --- Plugin management (SourceMod .smx) ---

function getPlugins() {
  const plugins = [];
  try {
    fs.mkdirSync(PLUGINS_DISABLED_DIR, { recursive: true });
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.smx'));
    files.forEach(f => plugins.push({ name: f.replace('.smx', ''), file: f, enabled: true }));
  } catch {}
  try {
    const disabled = fs.readdirSync(PLUGINS_DISABLED_DIR).filter(f => f.endsWith('.smx'));
    disabled.forEach(f => plugins.push({ name: f.replace('.smx', ''), file: f, enabled: false }));
  } catch {}
  return plugins;
}

function togglePlugin(filename, enable) {
  fs.mkdirSync(PLUGINS_DISABLED_DIR, { recursive: true });
  const src = enable
    ? path.join(PLUGINS_DISABLED_DIR, filename)
    : path.join(PLUGINS_DIR, filename);
  const dst = enable
    ? path.join(PLUGINS_DIR, filename)
    : path.join(PLUGINS_DISABLED_DIR, filename);
  if (!fs.existsSync(src)) return { ok: false, message: 'Plugin not found' };
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
        console.log('[games] Auto-shutting down L4D2: 1hr inactivity');
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
  getPlugins,
  togglePlugin,
  resetInactivityTimer,
};
