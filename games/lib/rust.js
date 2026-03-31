/**
 * Rust Server Management
 * - tmux session control (start/stop/restart)
 * - WebRCON for live stats
 * - Auto-shutdown after inactivity
 */

const { execSync, exec } = require('child_process');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const path = require('path');

const SESSION = 'rust';
const START_SCRIPT = path.join(__dirname, '..', 'start-rust.sh');
const RCON_HOST = process.env.RUST_RCON_HOST || '127.0.0.1';
const RCON_PORT = process.env.RUST_RCON_PORT || 28016;
const RCON_PASS = process.env.RUST_RCON_PASS || 'changeme_rcon_pass';

// --- Auto-shutdown tracking ---
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 1 hour
let lastPlayerActivity = null; // timestamp of last time players > 0
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
    console.log(`[games] Rust server stopped${reason ? ': ' + reason : ''}`);
    return { ok: true, message: 'Server stopped' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function restartServer() {
  stopServer('restart');
  // Give the session a moment to fully die
  setTimeout(() => startServer(), 2000);
  return { ok: true, message: 'Restarting...' };
}

// --- RCON ---

let _rconIdCounter = 1;

function rconCommand(cmd) {
  return new Promise((resolve, reject) => {
    const url = `ws://${RCON_HOST}:${RCON_PORT}/${RCON_PASS}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(e);
    }

    const id = _rconIdCounter++;
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('RCON timeout'));
    }, 8000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ Identifier: id, Message: cmd, Name: 'GamesPortal' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.Identifier === id) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.Message);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function getStatus() {
  const running = isRunning();
  if (!running) {
    return {
      running: false,
      players: 0,
      maxPlayers: 0,
      hostname: null,
      map: null,
      seed: null,
      worldSize: null,
      fps: null,
      uptime: null,
    };
  }

  try {
    const raw = await rconCommand('status');
    return parseStatus(raw, running);
  } catch {
    // Server running but RCON not yet available (booting)
    return { running: true, booting: true, players: 0 };
  }
}

function parseStatus(raw, running) {
  const out = { running, booting: false };

  const hostname = raw.match(/hostname\s*:\s*(.+)/i);
  const version = raw.match(/version\s*:\s*(.+)/i);
  const players = raw.match(/players\s*:\s*(\d+)\s*\/\s*(\d+)/i);
  const fps = raw.match(/fps\s*:\s*([\d.]+)/i);
  const uptime = raw.match(/uptime\s*:\s*([\d:]+)/i);
  const map = raw.match(/map\s*:\s*(\S+)/i);
  const seed = raw.match(/seed\s*:\s*(\d+)/i);
  const worldSize = raw.match(/world size\s*:\s*(\d+)/i);

  out.hostname = hostname ? hostname[1].trim() : null;
  out.version = version ? version[1].trim() : null;
  out.players = players ? parseInt(players[1]) : 0;
  out.maxPlayers = players ? parseInt(players[2]) : 0;
  out.fps = fps ? parseFloat(fps[1]) : null;
  out.uptime = uptime ? uptime[1].trim() : null;
  out.map = map ? map[1].trim() : 'Procedural Map';
  out.seed = seed ? parseInt(seed[1]) : null;
  out.worldSize = worldSize ? parseInt(worldSize[1]) : null;

  return out;
}

// --- Plugin management (Carbon ONLY) ---

const fs = require('fs');

const CARBON_PLUGINS_DIR = '/srv/games/rust/carbon/plugins';
const CARBON_DISABLED_DIR = '/srv/games/rust/carbon/plugins/disabled';
const CARBON_DATA_DIR = '/srv/games/rust/carbon/data';
const CARBON_CONFIGS_DIR = '/srv/games/rust/carbon/configs';

function getPluginFramework() {
  return 'carbon';
}

function getPlugins() {
  const plugins = [];

  try {
    fs.mkdirSync(CARBON_DISABLED_DIR, { recursive: true });
    fs.mkdirSync(CARBON_PLUGINS_DIR, { recursive: true });
    const files = fs.readdirSync(CARBON_PLUGINS_DIR).filter(f => f.endsWith('.cs'));
    files.forEach(f => plugins.push({
      name: f.replace('.cs', ''), file: f, enabled: true, framework: 'carbon',
    }));
  } catch {}

  try {
    const disabled = fs.readdirSync(CARBON_DISABLED_DIR).filter(f => f.endsWith('.cs'));
    disabled.forEach(f => plugins.push({
      name: f.replace('.cs', ''), file: f, enabled: false, framework: 'carbon',
    }));
  } catch {}

  return plugins;
}

function togglePlugin(filename, enable) {
  fs.mkdirSync(CARBON_DISABLED_DIR, { recursive: true });

  const src = enable
    ? path.join(CARBON_DISABLED_DIR, filename)
    : path.join(CARBON_PLUGINS_DIR, filename);
  const dst = enable
    ? path.join(CARBON_PLUGINS_DIR, filename)
    : path.join(CARBON_DISABLED_DIR, filename);

  if (!fs.existsSync(src)) return { ok: false, message: 'Plugin not found' };
  fs.renameSync(src, dst);
  return { ok: true, framework: 'carbon' };
}

function installPlugin(filename, content) {
  fs.mkdirSync(CARBON_PLUGINS_DIR, { recursive: true });
  fs.mkdirSync(CARBON_DATA_DIR, { recursive: true });
  const dest = path.join(CARBON_PLUGINS_DIR, filename);
  fs.writeFileSync(dest, content);
  // Pre-create data dir for the plugin (fixes NPC/data registration issue)
  const pluginName = filename.replace('.cs', '');
  const dataDir = path.join(CARBON_DATA_DIR, pluginName);
  fs.mkdirSync(dataDir, { recursive: true });
  return { ok: true, path: dest, framework: 'carbon' };
}

function removePlugin(filename) {
  const activePath = path.join(CARBON_PLUGINS_DIR, filename);
  const disabledPath = path.join(CARBON_DISABLED_DIR, filename);
  if (fs.existsSync(activePath)) { fs.unlinkSync(activePath); return { ok: true }; }
  if (fs.existsSync(disabledPath)) { fs.unlinkSync(disabledPath); return { ok: true }; }
  return { ok: false, message: 'Plugin not found' };
}

// --- Auto-shutdown ---

function resetInactivityTimer() {
  clearInactivityTimer();
  lastPlayerActivity = Date.now();
  inactivityTimer = setInterval(async () => {
    try {
      const status = await getStatus();
      if (!status.running) {
        clearInactivityTimer();
        return;
      }
      if (status.players > 0) {
        lastPlayerActivity = Date.now();
      } else if (lastPlayerActivity && Date.now() - lastPlayerActivity >= INACTIVITY_LIMIT_MS) {
        console.log('[games] Auto-shutting down Rust server: 1hr inactivity');
        stopServer('inactivity auto-shutdown');
      }
    } catch {}
  }, 5 * 60 * 1000); // check every 5 minutes
}

function clearInactivityTimer() {
  if (inactivityTimer) {
    clearInterval(inactivityTimer);
    inactivityTimer = null;
  }
}

// If server is already running when app boots, start inactivity timer
if (isRunning()) {
  resetInactivityTimer();
}

module.exports = {
  isRunning,
  startServer,
  stopServer,
  restartServer,
  getStatus,
  getPlugins,
  togglePlugin,
  installPlugin,
  removePlugin,
  getPluginFramework,
  resetInactivityTimer,
  rconCommand,
};
