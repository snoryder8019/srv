'use strict';

const net = require('net');

function _probePort(ip, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
    s.once('timeout', () => finish(false));
    s.connect(port, ip);
  });
}

/**
 * lib/server-manager.js
 *
 * Central authority for all local game server lifecycle:
 *   - Tracks which servers are running
 *   - Enforces MAX_LOCAL = 2 concurrent servers
 *   - Inactivity auto-shutdown (1hr no players → graceful stop)
 *   - Emits Socket.IO events on every state change
 *   - Coordinates with linode-provisioner when local slots full
 *
 * All game libs delegate start/stop through here.
 * Socket.IO io instance injected via init().
 */

const GAME_LIBS = {
  rust:     () => require('./rust'),
  valheim:  () => require('./valheim'),
  l4d2:     () => require('./l4d2'),
  '7dtd':   () => require('./7dtd'),
  se:       () => require('./se'),
  palworld: () => require('./palworld'),
  windrose: () => require('./windrose'),
};

const MAX_LOCAL        = 2;
const INACTIVITY_MS    = 60 * 60 * 1000;  // 1 hour
const POLL_INTERVAL_MS = 2 * 60 * 1000;   // poll every 2 min for inactivity
const STATUS_PUSH_MS   = 10 * 1000;       // push status to clients every 10s

let io          = null;
let provisioner = null;
let db          = null;

// Per-game inactivity tracking: { game: { lastActivity: Date, timer: intervalId } }
const _inactivity = {};

// Per-game "keep online" override — admin sets this to skip the 1hr idle auto-shutdown.
// Cleared when the server stops (so next start defaults back to auto-shutdown behavior).
const _keepOnline = {};

// Last known status per game (for diffing — only push on change)
const _lastStatus = {};

// Main poll timer
let _pollTimer = null;
let _pushTimer = null;

// ── Init ─────────────────────────────────────────────────────────────────
function init(ioInstance, provisionerLib, database) {
  io          = ioInstance;
  provisioner = provisionerLib;
  db          = database;

  // Seed inactivity timers for any servers already running at boot
  for (const [game, getLib] of Object.entries(GAME_LIBS)) {
    try {
      if (getLib().isRunning()) {
        console.log('[server-manager] Found', game, 'already running — starting inactivity watch');
        _startInactivityWatch(game);
      }
    } catch {}
  }

  // Start continuous inactivity + status poll
  _pollTimer = setInterval(_poll, POLL_INTERVAL_MS);
  _pushTimer = setInterval(_pushAllStatuses, STATUS_PUSH_MS);

  console.log('[server-manager] Initialized — max local:', MAX_LOCAL);
}

// ── Count currently running local servers ─────────────────────────────────
function countRunning() {
  let n = 0;
  for (const [, getLib] of Object.entries(GAME_LIBS)) {
    try { if (getLib().isRunning()) n++; } catch {}
  }
  return n;
}

function runningList() {
  const list = [];
  for (const [game, getLib] of Object.entries(GAME_LIBS)) {
    try { if (getLib().isRunning()) list.push(game); } catch {}
  }
  return list;
}

// ── Request to start a game ───────────────────────────────────────────────
async function requestStart(game, requestedBy) {
  const lib = GAME_LIBS[game];
  if (!lib) return { ok: false, error: 'Unknown game: ' + game };

  const gameLib = lib();

  // Already running
  if (gameLib.isRunning()) {
    return { ok: true, status: 'already_running', message: game + ' is already running' };
  }

  const running = countRunning();

  if (running >= MAX_LOCAL) {
    // Provision a Linode instead
    console.log('[server-manager] Local slots full (' + running + '/' + MAX_LOCAL + ') — provisioning Linode for', game);
    try {
      const server = await provisioner.provisionServer(game, requestedBy);
      if (db) {
        await db.collection('server_requests').insertOne({
          userId: requestedBy, game, status: 'provisioned',
          linodeId: server.linodeId, createdAt: new Date(),
        });
      }
      _emit('server:provisioning', { game, ip: server.ip, linodeId: server.linodeId });
      return {
        ok: true, status: 'provisioning',
        message: game + ' provisioning on new Linode (local slots full)',
        linodeId: server.linodeId, ip: server.ip,
      };
    } catch (e) {
      return { ok: false, error: 'Could not provision: ' + e.message };
    }
  }

  // Start locally
  console.log('[server-manager] Starting', game, 'locally (' + running + '/' + MAX_LOCAL + ' slots used)');
  const result = gameLib.startServer();

  if (result.ok !== false) {
    _startInactivityWatch(game);
    _emit('server:starting', { game });
    // Push updated status after short boot delay
    setTimeout(() => _pushStatus(game), 5000);
  }

  return { ok: true, status: 'starting', message: game + ' starting up', ...result };
}

// ── Stop a game ───────────────────────────────────────────────────────────
function stop(game, reason) {
  const lib = GAME_LIBS[game];
  if (!lib) return { ok: false, error: 'Unknown game' };

  const result = lib().stopServer(reason || 'manual stop');
  _stopInactivityWatch(game);
  delete _keepOnline[game];
  _emit('server:stopped', { game, reason: reason || 'manual' });
  _pushStatus(game);
  return result;
}

// Toggle the auto-shutdown override for a single game.
function setKeepOnline(game, on) {
  if (!GAME_LIBS[game]) return { ok: false, error: 'Unknown game' };
  if (on) _keepOnline[game] = true;
  else delete _keepOnline[game];
  // Reset the idle clock either way so a freshly toggled-off server gets a full grace window.
  if (_inactivity[game]) _inactivity[game].lastActivity = Date.now();
  _emit('server:keep-online', { game, keepOnline: !!_keepOnline[game] });
  return { ok: true, keepOnline: !!_keepOnline[game] };
}

function isKeepOnline(game) {
  return !!_keepOnline[game];
}

function getKeepOnlineMap() {
  return Object.keys(_keepOnline).reduce((acc, g) => { acc[g] = true; return acc; }, {});
}

// ── Inactivity watch per game ─────────────────────────────────────────────
function _startInactivityWatch(game) {
  _stopInactivityWatch(game); // clear any existing

  _inactivity[game] = {
    lastActivity: Date.now(),
    timer: setInterval(() => _checkInactivity(game), POLL_INTERVAL_MS),
  };
}

function _stopInactivityWatch(game) {
  if (_inactivity[game]) {
    clearInterval(_inactivity[game].timer);
    delete _inactivity[game];
  }
}

async function _checkInactivity(game) {
  const lib = GAME_LIBS[game];
  if (!lib) return;

  const gameLib = lib();
  if (!gameLib.isRunning()) {
    _stopInactivityWatch(game);
    return;
  }

  // Keep-online override — admin pinned this server up; skip idle shutdown.
  if (_keepOnline[game]) {
    if (_inactivity[game]) _inactivity[game].lastActivity = Date.now();
    return;
  }

  try {
    const status = await gameLib.getStatus();

    if (status.players > 0) {
      // Reset activity clock
      if (_inactivity[game]) _inactivity[game].lastActivity = Date.now();
      return;
    }

    // No players — check how long we've been empty.
    // If the server is running but we have no inactivity record (e.g., started outside
    // the portal, or requestStart short-circuited on already_running), seed one now
    // instead of treating it as instantly expired.
    if (!_inactivity[game]) {
      _startInactivityWatch(game);
      return;
    }
    const idle = Date.now() - _inactivity[game].lastActivity;

    if (idle >= INACTIVITY_MS) {
      console.log('[server-manager] Auto-shutdown:', game, '— idle', Math.round(idle / 60000) + 'min');

      // Warn via Socket.IO before shutdown
      _emit('server:shutdown-warning', { game, reason: 'inactivity', idleMinutes: Math.round(idle / 60000) });

      // Give 30 seconds for any last-minute joins
      setTimeout(() => {
        // Re-check in case someone joined during warning window
        try {
          const stillRunning = gameLib.isRunning();
          if (!stillRunning) return;
          gameLib.stopServer('inactivity auto-shutdown');
          _stopInactivityWatch(game);
          _emit('server:stopped', { game, reason: 'inactivity' });
          _pushStatus(game);
          console.log('[server-manager]', game, 'stopped — inactivity');
        } catch (e) {
          console.error('[server-manager] Auto-shutdown error:', game, e.message);
        }
      }, 30 * 1000);
    }
  } catch (e) {
    console.error('[server-manager] Inactivity check error:', game, e.message);
  }
}

// ── Status push via Socket.IO ─────────────────────────────────────────────
async function _pushStatus(game) {
  const lib = GAME_LIBS[game];
  if (!lib || !io) return;

  try {
    const status = await lib().getStatus();

    // If local isn't running, surface any active Linode for this game so the card lights up for everyone.
    if (!status.running && db) {
      try {
        const remote = await db.collection('provisioned_servers')
          .findOne({ game, status: { $in: ['provisioning', 'running'] } }, { sort: { createdAt: -1 } });
        if (remote && remote.ip) {
          // Confirm the Linode still exists (auto-reconciles in getLinodeStatus on 404).
          let linodeAlive = true;
          if (provisioner && provisioner.getLinodeStatus) {
            try {
              const linodeData = await provisioner.getLinodeStatus(remote.linodeId);
              linodeAlive = !!linodeData;
            } catch { linodeAlive = false; }
          }
          if (linodeAlive) {
            const GAME_PORTS_MAP = { rust: 28015, valheim: 2456, l4d2: 27015, '7dtd': 26900, se: 27016, palworld: 8211 };
            const port = GAME_PORTS_MAP[game];
            const passwords = (provisioner && provisioner.GAME_PASSWORDS) || {};
            let ready = remote.status === 'running';
            if (!ready && port) {
              ready = await _probePort(remote.ip, port, 1200);
            }
            if (ready && remote.status !== 'running') {
              try {
                await db.collection('provisioned_servers').updateOne(
                  { linodeId: remote.linodeId },
                  { $set: { status: 'running', lastActivity: new Date() } }
                );
              } catch {}
            }
            // Keep running=true so the card treats this as "booting" (not offline) while the Linode comes up.
            status.running = true;
            status.booting = !ready;
            status.remoteConnect = port ? remote.ip + ':' + port : null;
            status.remoteSteam = port ? 'steam://connect/' + remote.ip + ':' + port : null;
            status.remotePassword = passwords[game] || null;
          }
        }
      } catch {}
    }

    const payload = { game, ...status, ts: Date.now() };

    // Only emit if something changed
    const last = _lastStatus[game];
    const changed = !last
      || last.running !== status.running
      || last.players !== status.players
      || last.booting !== status.booting;

    _lastStatus[game] = status;

    if (changed) {
      _emit('server:status', payload);
    }

    // Always push to the stats namespace too
    io.of('/stats').to('game:' + game).emit('stats:snapshot', payload);
    io.of('/stats').to('game:all').emit('stats:snapshot', payload);
  } catch {}
}

async function _pushAllStatuses() {
  for (const game of Object.keys(GAME_LIBS)) {
    await _pushStatus(game);
  }
}

// ── Main poll — inactivity + status ──────────────────────────────────────
async function _poll() {
  for (const game of Object.keys(GAME_LIBS)) {
    await _checkInactivity(game);
  }
}

// ── Emit helper — broadcasts namespace ───────────────────────────────────
function _emit(event, data) {
  if (!io) return;
  // Emit to all connected clients on the stats namespace
  io.of('/stats').emit(event, data);
  // Also emit on main namespace
  io.emit(event, data);
  console.log('[server-manager] emit', event, data.game || '', data.reason || data.status || '');
}

// ── Public status snapshot ────────────────────────────────────────────────
async function getStatus(game) {
  const lib = GAME_LIBS[game];
  if (!lib) return null;
  try { return await lib().getStatus(); } catch { return { running: false, players: 0 }; }
}

async function getAllStatuses() {
  const out = {};
  for (const game of Object.keys(GAME_LIBS)) {
    out[game] = await getStatus(game);
  }
  return out;
}

module.exports = {
  init,
  requestStart,
  stop,
  setKeepOnline,
  isKeepOnline,
  getKeepOnlineMap,
  countRunning,
  runningList,
  getStatus,
  getAllStatuses,
  MAX_LOCAL,
};
