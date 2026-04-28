/**
 * Windrose Dedicated Server Management
 * - tmux session control (start/stop/restart) via Wine
 * - Invite code + config read from R5/ServerDescription.json
 * - Player count parsed from server log (patterns are provisional —
 *   Windrose is 2 days into Early Access and the log format is
 *   not publicly documented; update PLAYER_JOIN_RE / PLAYER_LEAVE_RE
 *   once a real log is available).
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

// --- Log patterns (provisional; verify against real logs) ---
// UE5 servers usually log along the lines of:
//   "[...] LogNet: Join succeeded: <PlayerName>"
//   "[...] LogNet: UChannel::Close: ... <PlayerName>"
// We try a few reasonable shapes; safe if nothing matches -> players = 0.
const PLAYER_JOIN_RE  = /Join succeeded:\s*(\S+)/i;
const PLAYER_LEAVE_RE = /UChannel::Close.*?(?:RemoteAddr|PlayerName)[:=]\s*(\S+)/i;
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
    return {
      inviteCode:   persistent.InviteCode || null,
      serverName:   persistent.ServerName || null,
      maxPlayers:   persistent.MaxPlayerCount || 8,
      passwordLock: !!persistent.IsPasswordProtected,
      worldId:      persistent.WorldIslandId || null,
    };
  } catch (e) {
    console.warn('[games] Windrose ServerDescription.json unreadable:', e.message);
    return null;
  }
}

// --- Player tracking via log parsing (provisional) ---

function getPlayerCount() {
  // Prefer UE5 internal log where join/leave events actually appear
  const logPath = fs.existsSync(UE5_LOG) ? UE5_LOG : LOG_FILE;
  if (!fs.existsSync(logPath)) return 0;
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');

    let startIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (SERVER_READY_RE.test(lines[i])) { startIdx = i; break; }
    }

    const connected = new Set();
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const join = line.match(PLAYER_JOIN_RE);
      const leave = line.match(PLAYER_LEAVE_RE);
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
  const desc = readServerDescription();
  const maxPlayers = desc?.maxPlayers || 8;

  if (!running) {
    return {
      running: false,
      players: 0,
      maxPlayers,
      inviteCode: desc?.inviteCode || null,
      serverName: desc?.serverName || null,
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
      if (status.players > 0) {
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

// --- Console passthrough via tmux send-keys ---

function rconCommand(cmd) {
  return new Promise((resolve) => {
    if (!isRunning()) return resolve('Server not running');
    try {
      execSync(`sudo -u ${GS_USER} tmux send-keys -t ${SESSION} '${cmd.replace(/'/g, "\x27\\\x27\x27")}' Enter`);
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
  readServerDescription,
};
