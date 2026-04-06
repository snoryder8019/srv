/**
 * Space Engineers 1 Dedicated Server Management
 * - tmux session control (start/stop/restart)
 * - Log-based player tracking
 * - Mod management (folder-based)
 * - Auto-shutdown after inactivity
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = 'se';
const GS_USER = 'gs-se';
const START_SCRIPT = path.join(__dirname, '..', 'start-se.sh');
const SE_DIR = '/srv/games/se';
const LOG_FILE = path.join(SE_DIR, 'logs', 'server.log');
const MODS_DIR = path.join(SE_DIR, 'mods');
const MODS_DISABLED_DIR = path.join(SE_DIR, 'mods_disabled');

// --- Auto-shutdown ---
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
    console.log(`[games] Space Engineers server stopped${reason ? ': ' + reason : ''}`);
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

// --- Player tracking via log parsing ---
// SE log entries:
//   "Player connected: <name> (<steamId>)"  -> joined
//   "Player disconnected: <name> (<steamId>)" -> left

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');

    // Find the last server start line to scope our search
    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Game ready') || lines[i].includes('Server started')) {
        startIdx = i;
        break;
      }
    }

    const connected = new Set();
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const join = line.match(/Player connected.*?(\d{17})/);
      const leave = line.match(/Player disconnected.*?(\d{17})/);
      if (join) connected.add(join[1]);
      if (leave) connected.delete(leave[1]);
    }
    return connected.size;
  } catch {
    return 0;
  }
}

async function getStatus() {
  const running = isRunning();
  if (!running) return { running: false, players: 0, maxPlayers: 0 };

  // Check if still booting
  let booting = false;
  if (fs.existsSync(LOG_FILE)) {
    const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-50).join('\n');
    booting = !tail.includes('Game ready') && !tail.includes('Server started');
  } else {
    booting = true;
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 4,
    map: 'Star System',
    hostname: 'MadLadsLab Space Engineers',
  };
}

// --- Mod management (folder-based) ---

function getMods() {
  const mods = [];
  try {
    fs.mkdirSync(MODS_DIR, { recursive: true });
    fs.mkdirSync(MODS_DISABLED_DIR, { recursive: true });
    const dirs = fs.readdirSync(MODS_DIR).filter(f => {
      const full = path.join(MODS_DIR, f);
      return fs.statSync(full).isDirectory();
    });
    dirs.forEach(d => mods.push({ name: d, enabled: true }));
  } catch {}
  try {
    const disabled = fs.readdirSync(MODS_DISABLED_DIR).filter(f => {
      const full = path.join(MODS_DISABLED_DIR, f);
      return fs.statSync(full).isDirectory();
    });
    disabled.forEach(d => mods.push({ name: d, enabled: false }));
  } catch {}
  return mods;
}

function toggleMod(modname, enable) {
  fs.mkdirSync(MODS_DIR, { recursive: true });
  fs.mkdirSync(MODS_DISABLED_DIR, { recursive: true });
  const src = enable
    ? path.join(MODS_DISABLED_DIR, modname)
    : path.join(MODS_DIR, modname);
  const dst = enable
    ? path.join(MODS_DIR, modname)
    : path.join(MODS_DISABLED_DIR, modname);
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
        console.log('[games] Auto-shutting down Space Engineers: 1hr inactivity');
        stopServer('inactivity auto-shutdown');
      }
    } catch {}
  }, 5 * 60 * 1000);
}

function clearInactivityTimer() {
  if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
}

if (isRunning()) resetInactivityTimer();

// --- Console command via tmux send-keys ---

function rconCommand(cmd) {
  return new Promise((resolve) => {
    if (!isRunning()) return resolve('Server not running');
    try {
      // Capture pane before to find where new output starts
      const before = execSync(
        `sudo -u ${GS_USER} tmux capture-pane -t ${SESSION} -p 2>/dev/null | wc -l`,
        { encoding: 'utf8' }
      ).trim();
      // Send the command
      execSync(`sudo -u ${GS_USER} tmux send-keys -t ${SESSION} '${cmd.replace(/'/g, "'\\''")}' Enter`);
      // Wait for output
      setTimeout(() => {
        try {
          const output = execSync(
            `sudo -u ${GS_USER} tmux capture-pane -t ${SESSION} -p 2>/dev/null`,
            { encoding: 'utf8' }
          );
          const lines = output.split('\n');
          // Return the last 20 lines as output
          resolve(lines.slice(-20).join('\n').trim() || '(command sent)');
        } catch {
          resolve('(command sent — could not capture output)');
        }
      }, 1500);
    } catch (e) {
      resolve('Error: ' + e.message);
    }
  });
}

module.exports = {
  isRunning,
  startServer,
  stopServer,
  restartServer,
  getStatus,
  getMods,
  toggleMod,
  rconCommand,
  resetInactivityTimer,
};
