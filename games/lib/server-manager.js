'use strict';

const net  = require('net');
const fs   = require('fs');
const path = require('path');

const KEEP_ONLINE_FILE = path.join(__dirname, '..', 'keep-online.json');

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
// Persisted to KEEP_ONLINE_FILE so the override survives `node app.js` restarts.
const _keepOnline = {};

function _loadKeepOnline() {
  try {
    if (!fs.existsSync(KEEP_ONLINE_FILE)) return;
    const raw = fs.readFileSync(KEEP_ONLINE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const [g, v] of Object.entries(data)) {
        if (v && GAME_LIBS[g]) _keepOnline[g] = true;
      }
    }
    const pinned = Object.keys(_keepOnline);
    if (pinned.length) console.log('[server-manager] Restored keep-online state:', pinned.join(', '));
  } catch (e) {
    console.error('[server-manager] Failed to load keep-online state:', e.message);
  }
}

function _saveKeepOnline() {
  try {
    fs.writeFileSync(KEEP_ONLINE_FILE, JSON.stringify(_keepOnline), 'utf8');
  } catch (e) {
    console.error('[server-manager] Failed to persist keep-online state:', e.message);
  }
}

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

  _loadKeepOnline();

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
// `userInfo` is either the legacy string `userId` or an object
// `{ userId, userName, premium, worldSaveId? }`. Premium users (or admins) skip the
// queue and get a Linode immediately when local slots are full; free users
// are queued and notified when a slot opens up. `worldSaveId` is an optional
// world_backups _id — when present the requested game starts from that save
// instead of its current on-disk world (local: restored before start; Linode:
// queued for restore once the host is reachable).
async function requestStart(game, userInfo) {
  const lib = GAME_LIBS[game];
  if (!lib) return { ok: false, error: 'Unknown game: ' + game };

  // Normalize userInfo for back-compat with the older signature.
  const info = (typeof userInfo === 'string') ? { userId: userInfo } : (userInfo || {});
  const { userId, userName, premium, worldSaveId } = info;

  const gameLib = lib();

  // Already running
  if (gameLib.isRunning()) {
    return { ok: true, status: 'already_running', message: game + ' is already running' };
  }

  const running = countRunning();

  if (running >= MAX_LOCAL) {
    // Free users wait for a local slot rather than burning a Linode.
    if (!premium) {
      const queued = await _enqueueRequest(game, userId, userName);
      _emit('server:queued', { game, userId, position: queued.position });
      return {
        ok: true,
        status: 'queued',
        message: 'Both servers are currently in use. Your request is queued — we will notify you when your server is ready.',
        queueId: queued.queueId,
        position: queued.position,
        premiumPriceUsd: 5.99,
        premiumPitch: 'Upgrade to MadLadsLab Premium for $5.99/mo — instant access to any dedicated server, no queue.',
      };
    }

    // Premium / admin path — provision a Linode.
    console.log('[server-manager] Local slots full (' + running + '/' + MAX_LOCAL + ') — provisioning Linode for', game, '(premium)');
    try {
      const server = await provisioner.provisionServer(game, userId);
      // Persist the requested save (+ its wrapper) on the linode record. The
      // /api/provisioned-status poller picks this up once SSH is reachable
      // and applies the restore exactly once.
      if (db && worldSaveId) {
        let wrapper = null;
        try {
          const save = await require('./world-backup').getBackup(worldSaveId);
          if (save) wrapper = save.wrapper || null;
        } catch {}
        await db.collection('provisioned_servers').updateOne(
          { linodeId: server.linodeId },
          { $set: { pendingRestoreId: worldSaveId, wrapper, requestedBy: userId } }
        );
      }
      if (db) {
        await db.collection('server_requests').insertOne({
          userId, userName, game, status: 'provisioned',
          linodeId: server.linodeId,
          worldSaveId: worldSaveId || null,
          createdAt: new Date(),
        });
      }
      _emit('server:provisioning', { game, ip: server.ip, linodeId: server.linodeId, worldSaveId: worldSaveId || null });
      return {
        ok: true, status: 'provisioning',
        message: game + ' provisioning on new Linode (local slots full)' + (worldSaveId ? ' — saved world will be restored once host is reachable' : ''),
        linodeId: server.linodeId, ip: server.ip,
        worldSaveId: worldSaveId || null,
      };
    } catch (e) {
      return { ok: false, error: 'Could not provision: ' + e.message };
    }
  }

  // Start locally — optionally restore a saved world first.
  let restored = null;
  let wrapperUsed = null;
  if (worldSaveId) {
    try {
      const worldBackup = require('./world-backup');
      const save = await worldBackup.getBackup(worldSaveId);
      if (save) wrapperUsed = save.wrapper || null;
      console.log('[server-manager] Restoring world save', worldSaveId, 'before starting', game);
      restored = await worldBackup.restoreLocal(game, worldSaveId);
      if (!restored.ok) {
        console.error('[server-manager] World restore failed:', restored.message);
        return { ok: false, error: 'World restore failed: ' + (restored.message || 'unknown') };
      }
    } catch (e) {
      console.error('[server-manager] World restore error:', e.message);
      return { ok: false, error: 'World restore failed: ' + e.message };
    }
  }

  console.log('[server-manager] Starting', game, 'locally (' + running + '/' + MAX_LOCAL + ' slots used)' + (wrapperUsed ? ' (wrapper=' + wrapperUsed + ')' : ''));
  // Game libs are free to read process.env.GAME_WRAPPER from start scripts.
  // We set it process-wide for the duration of the spawn; the child inherits
  // it. Once spawned we clear it so a subsequent default start isn't sticky.
  const priorWrapper = process.env.GAME_WRAPPER;
  if (wrapperUsed) process.env.GAME_WRAPPER = wrapperUsed;
  let result;
  try {
    result = gameLib.startServer({ wrapper: wrapperUsed, worldSaveId: worldSaveId || null });
  } finally {
    if (wrapperUsed) {
      if (priorWrapper === undefined) delete process.env.GAME_WRAPPER;
      else process.env.GAME_WRAPPER = priorWrapper;
    }
  }

  if (result.ok !== false) {
    _startInactivityWatch(game);
    _emit('server:starting', { game, worldSaveId: worldSaveId || null, wrapper: wrapperUsed });
    // Push updated status after short boot delay
    setTimeout(() => _pushStatus(game), 5000);
  }

  return {
    ok: true,
    status: 'starting',
    message: game + ' starting up' + (worldSaveId ? ' (restoring saved world)' : ''),
    worldSaveId: worldSaveId || null,
    wrapper: wrapperUsed,
    ...result,
  };
}

// ── Request queue ─────────────────────────────────────────────────────────
// Free users land here when both local slots are taken. A slot becoming
// available (server:stopped) triggers _drainQueue which pops the oldest
// pending request and starts the requested game locally for them.
async function _enqueueRequest(game, userId, userName) {
  if (!db) return { position: 1 };

  // Idempotent — if this user already has a pending request for this game,
  // surface their existing position instead of stacking duplicates.
  const existing = await db.collection('server_requests').findOne({
    userId, game, status: 'queued',
  });

  let queueId;
  if (existing) {
    queueId = existing._id;
  } else {
    const ins = await db.collection('server_requests').insertOne({
      userId, userName, game, status: 'queued', createdAt: new Date(),
    });
    queueId = ins.insertedId;
  }

  // Position = count of earlier-or-equal pending requests.
  const position = await db.collection('server_requests').countDocuments({
    status: 'queued',
    _id: { $lte: queueId },
  });

  return { queueId, position };
}

async function _drainQueue() {
  if (!db) return;
  if (countRunning() >= MAX_LOCAL) return;

  const next = await db.collection('server_requests').findOne(
    { status: 'queued' },
    { sort: { createdAt: 1 } }
  );
  if (!next) return;

  // Mark fulfilled before starting so a parallel drain doesn't double-pop.
  await db.collection('server_requests').updateOne(
    { _id: next._id, status: 'queued' },
    { $set: { status: 'starting', fulfilledAt: new Date() } }
  );

  const lib = GAME_LIBS[next.game];
  if (!lib) return;
  try {
    const gameLib = lib();
    if (!gameLib.isRunning()) {
      const result = gameLib.startServer();
      if (result && result.ok !== false) {
        _startInactivityWatch(next.game);
        _emit('server:starting', { game: next.game });
        setTimeout(() => _pushStatus(next.game), 5000);
      }
    }
    _emit('server:queue-ready', {
      game: next.game,
      userId: next.userId,
      message: 'Your ' + next.game + ' server is starting up.',
    });
  } catch (e) {
    console.error('[server-manager] Drain queue start failed:', next.game, e.message);
    await db.collection('server_requests').updateOne(
      { _id: next._id },
      { $set: { status: 'failed', error: e.message } }
    );
  }
}

// ── Stop a game ───────────────────────────────────────────────────────────
function stop(game, reason) {
  const lib = GAME_LIBS[game];
  if (!lib) return { ok: false, error: 'Unknown game' };

  const result = lib().stopServer(reason || 'manual stop');
  _stopInactivityWatch(game);
  if (_keepOnline[game]) {
    delete _keepOnline[game];
    _saveKeepOnline();
  }
  _emit('server:stopped', { game, reason: reason || 'manual' });
  _pushStatus(game);
  // A slot just opened — promote the next queued free-tier request, if any.
  _drainQueue().catch(e => console.error('[server-manager] drainQueue:', e.message));
  return result;
}

// Toggle the auto-shutdown override for a single game.
function setKeepOnline(game, on) {
  if (!GAME_LIBS[game]) return { ok: false, error: 'Unknown game' };
  const before = !!_keepOnline[game];
  if (on) _keepOnline[game] = true;
  else delete _keepOnline[game];
  // Reset the idle clock either way so a freshly toggled-off server gets a full grace window.
  if (_inactivity[game]) _inactivity[game].lastActivity = Date.now();
  if (before !== !!_keepOnline[game]) _saveKeepOnline();
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
          _drainQueue().catch(e => console.error('[server-manager] drainQueue:', e.message));
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
