/**
 * Palworld Dedicated Server Management
 * - tmux session control (start/stop/restart)
 * - Log-based player tracking
 * - Auto-shutdown after inactivity
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION = 'palworld';
const GS_USER = 'gs-palworld';
const START_SCRIPT = path.join(__dirname, '..', 'start-palworld.sh');
const PALWORLD_DIR = '/srv/games/palworld';
const LOG_FILE = path.join(PALWORLD_DIR, 'logs', 'server.log');

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
    console.log(`[games] Palworld server stopped${reason ? ': ' + reason : ''}`);
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
// Palworld log entries:
//   "Login: <name> (SteamID: <id>)"  -> joined
//   "Logout: <name> (SteamID: <id>)" -> left

function getPlayerCount() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');

    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Setting breakpad') || lines[i].includes('Server started')) {
        startIdx = i;
        break;
      }
    }

    const connected = new Set();
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const join = line.match(/Login.*?SteamID:\s*(\d{17})/);
      const leave = line.match(/Logout.*?SteamID:\s*(\d{17})/);
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

  let booting = false;
  if (fs.existsSync(LOG_FILE)) {
    const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-50).join('\n');
    booting = !tail.includes('Setting breakpad') && !tail.includes('Server started');
  } else {
    booting = true;
  }

  const players = booting ? 0 : getPlayerCount();

  return {
    running: true,
    booting,
    players,
    maxPlayers: 32,
    map: 'Palpagos Islands',
    hostname: 'MadLadsLab Palworld',
  };
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
        console.log('[games] Auto-shutting down Palworld: 1hr inactivity');
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
  rconCommand,
  resetInactivityTimer,
};
