/**
 * Valheim Server Management
 * - tmux session control (start/stop/restart)
 * - Log-based player tracking (no RCON)
 * - BepInEx plugin management
 * - Auto-shutdown after inactivity
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = 'valheim';
const START_SCRIPT = path.join(__dirname, '..', 'start-valheim.sh');
const VALHEIM_DIR = '/srv/games/valheim';
const LOG_FILE = path.join(VALHEIM_DIR, 'logs', 'server.log');
const PLUGINS_DIR = path.join(VALHEIM_DIR, 'BepInEx', 'plugins');
const PLUGINS_DISABLED_DIR = path.join(PLUGINS_DIR, 'disabled');

// --- Auto-shutdown ---
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
let lastPlayerActivity = null;
let inactivityTimer = null;

// --- tmux helpers ---

function isRunning() {
  try {
    execSync(`tmux has-session -t ${SESSION} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function startServer() {
  if (isRunning()) return { ok: false, message: 'Server already running' };
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
    execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`);
    clearInactivityTimer();
    console.log(`[games] Valheim server stopped${reason ? ': ' + reason : ''}`);
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

// --- Player tracking via log parsing ---
// Valheim log entries:
//   "Got connection SteamID XXXXXXXXXXXXXXX"  → player joined
//   "Closing socket XXXXXXXXXXXXXXX"           → player left

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');

    // Find the last server start line to scope our search
    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Valheim version') || lines[i].includes('DungeonDB Start')) {
        startIdx = i;
        break;
      }
    }

    const connected = new Set();
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const join = line.match(/Got connection SteamID (\d+)/);
      const leave = line.match(/Closing socket (\d+)/);
      if (join) connected.add(join[1]);
      if (leave) connected.delete(leave[1]);
    }
    return connected.size;
  } catch {
    return 0;
  }
}

function getUptime() {
  if (!fs.existsSync(LOG_FILE)) return null;
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n');
    // Find last server start timestamp
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('DungeonDB Start')) {
        // Log lines don't always have timestamps in Valheim, return line count as proxy
        const elapsed = Math.floor((Date.now() - fs.statSync(LOG_FILE).mtimeMs) / 1000);
        return null; // will show via log mtime in future
      }
    }
  } catch {}
  return null;
}

async function getStatus() {
  const running = isRunning();
  if (!running) return { running: false, players: 0, maxPlayers: 0 };

  // Check if still booting (log file very new or missing start marker)
  let booting = false;
  if (fs.existsSync(LOG_FILE)) {
    const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-50).join('\n');
    booting = !tail.includes('DungeonDB Start') && !tail.includes('Game server connected');
  } else {
    booting = true;
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 10, // Valheim default (configurable)
    map: 'MadLads',
    worldSize: null,
    seed: null,
    fps: null,
    uptime: null,
    hostname: 'MadLadsLab Valheim',
  };
}

// --- Plugin management (BepInEx) ---

function getPlugins() {
  const plugins = [];
  try {
    fs.mkdirSync(PLUGINS_DISABLED_DIR, { recursive: true });
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.dll'));
    files.forEach(f => plugins.push({ name: f.replace('.dll', ''), file: f, enabled: true }));
  } catch {}
  try {
    const disabled = fs.readdirSync(PLUGINS_DISABLED_DIR).filter(f => f.endsWith('.dll'));
    disabled.forEach(f => plugins.push({ name: f.replace('.dll', ''), file: f, enabled: false }));
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
        console.log('[games] Auto-shutting down Valheim: 1hr inactivity');
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
