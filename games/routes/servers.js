'use strict';

const express = require('express');
const net = require('net');
const provisioner = require('../lib/linode-provisioner');
const playtime = require('../lib/playtime');
const worldBackup = require('../lib/world-backup');
const router = express.Router();

// TCP reachability check — Valheim/Rust/etc use UDP, so this only tells us the
// host is up and something is binding. For a cheap ready signal we just check
// that a TCP SYN returns RST (port closed but host alive) vs ACK (port open).
// We treat either as "reachable"; timeout means still booting.
function probeHost(ip, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('error', (e) => finish(e && e.code === 'ECONNREFUSED')); // host reachable, port just closed
    s.once('timeout', () => finish(false));
    s.connect(port, ip);
  });
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Login required' });
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  const u = req.user;
  const gp = u.permissions && u.permissions['games'];
  if (u.isAdmin || gp === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

function requireSuperAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Superadmin only' });
  next();
}

// Admins and premium subscribers can manage world saves (create named saves,
// pick a save when spinning up). Free users still see public servers.
function requireAdminOrPremium(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  const u = req.user;
  const gamesPerm = u.permissions && u.permissions['games'];
  if (u.isAdmin || gamesPerm === 'admin' || u.premium) return next();
  res.status(403).json({ error: 'World saves are an admin / premium feature' });
}

function isAdminOrPremium(u) {
  if (!u) return false;
  const gamesPerm = u.permissions && u.permissions['games'];
  return !!(u.isAdmin || gamesPerm === 'admin' || u.premium);
}

// ── Community server request — admin only (controls server starts + Linode provisioning) ──
const GAME_LIBS = {
  rust: () => require('../lib/rust'),
  valheim: () => require('../lib/valheim'),
  l4d2: () => require('../lib/l4d2'),
  '7dtd': () => require('../lib/7dtd'),
  se: () => require('../lib/se'),
  palworld: () => require('../lib/palworld'),
  windrose: () => require('../lib/windrose'),
};

router.post('/api/request', requireAuth, async (req, res) => {
  try {
    const { game, worldSaveId } = req.body;
    const validGames = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose'];
    if (!game || !validGames.includes(game)) {
      return res.status(400).json({ error: 'Invalid game. Choose: ' + validGames.join(', ') });
    }

    const serverManager = req.app.locals.serverManager;
    const userName = require('../lib/username').displayFor(req.user);
    // Admins always skip the queue alongside premium subscribers.
    const isPremium = !!(req.user.premium || req.user.isAdmin || (req.user.permissions && req.user.permissions.games === 'admin'));

    // Only admins / premium can pick a specific saved world. Silently drop the
    // hint for free users so a forged request can't trigger a restore.
    let resolvedSaveId = null;
    if (worldSaveId && isAdminOrPremium(req.user)) {
      const save = await worldBackup.getBackup(worldSaveId);
      if (!save || save.game !== game) {
        return res.status(400).json({ error: 'World save not found for ' + game });
      }
      resolvedSaveId = worldSaveId;
    }

    const result = await serverManager.requestStart(game, {
      userId: req.user._id.toString(),
      userName,
      premium: isPremium,
      worldSaveId: resolvedSaveId,
    });

    // Log to DB + stats feed
    const db = req.app.locals.db;
    // The queue path already wrote a server_requests record from inside
    // requestStart — don't double-log.
    if (result.status !== 'queued') {
      await db.collection('server_requests').insertOne({
        userId: req.user._id.toString(), userName, game,
        status: result.status || 'requested', createdAt: new Date(),
      }).catch(() => {});
    }

    if (result.status === 'starting' || result.status === 'already_running') {
      const event = { game, type: 'server_start', ts: new Date(), name: userName };
      await db.collection('game_events').insertOne(event).catch(() => {});
      require('../lib/stats-collector').emitter.emit('event', event);
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Check provisioned server status (any authed user can poll) ──
router.get('/api/provisioned-status/:game', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const server = await db.collection('provisioned_servers')
      .findOne({ game: req.params.game, status: { $in: ['provisioning', 'running'] } }, { sort: { createdAt: -1 } });
    if (!server) return res.json({ active: false });

    const GAME_PORTS_MAP = { rust: 28015, valheim: 2456, l4d2: 27015, '7dtd': 26900, se: 27016, palworld: 8211 };
    const port = GAME_PORTS_MAP[server.game] || '';

    // Determine readiness:
    //   1. Linode API must report the instance as "running".
    //   2. SSH 22 reachable → host booted; still "booting" until the game port is live.
    //   3. Game port reachable (SYN accepted) → "running".
    // We still use age as a safety cap, but the port probe is the authoritative signal.
    let linodeStatus = 'provisioning';
    if (server.ip) {
      try {
        const linodeData = await provisioner.getLinodeStatus(server.linodeId);
        if (linodeData && linodeData.status === 'running') {
          linodeStatus = 'booting';
          const age = Date.now() - new Date(server.createdAt).getTime();
          const sshUp = await probeHost(server.ip, 22, 1200);
          const gameUp = port ? await probeHost(server.ip, port, 1500) : false;
          if (gameUp || (sshUp && age > 12 * 60 * 1000)) {
            linodeStatus = 'running';
            if (server.status !== 'running') {
              await db.collection('provisioned_servers').updateOne(
                { linodeId: server.linodeId },
                { $set: { status: 'running', lastActivity: new Date() } }
              );
            }
          }

          // Pending world-save restore — apply once on the first poll where
          // SSH is reachable. We stop the gameserver, SCP the save in, then
          // restart so the binary picks up the restored files.
          if (sshUp && server.pendingRestoreId && !server.restoreAppliedAt) {
            try {
              await db.collection('provisioned_servers').updateOne(
                { linodeId: server.linodeId, restoreAppliedAt: { $exists: false } },
                { $set: { restoreAppliedAt: new Date(), restoreStatus: 'applying' } }
              );
              const { execSync } = require('child_process');
              const sshOpts = '-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes';
              try { execSync(`ssh ${sshOpts} root@${server.ip} "systemctl stop gameserver"`, { timeout: 20000 }); } catch {}
              const restoreOwner = server.requestedBy || req.user._id.toString();
              const restoreResult = await worldBackup.restoreToLinode(server.ip, server.game, restoreOwner, server.pendingRestoreId);
              try { execSync(`ssh ${sshOpts} root@${server.ip} "chown -R gameserver:gameserver /srv/game && systemctl start gameserver"`, { timeout: 20000 }); } catch {}
              await db.collection('provisioned_servers').updateOne(
                { linodeId: server.linodeId },
                { $set: { restoreStatus: restoreResult.ok ? 'applied' : 'failed', restoreMessage: restoreResult.message || null } }
              );
              console.log('[servers] Applied pending world restore for linode', server.linodeId, '->', restoreResult.ok ? 'ok' : restoreResult.message);
            } catch (e) {
              console.error('[servers] Pending restore failed:', e.message);
              await db.collection('provisioned_servers').updateOne(
                { linodeId: server.linodeId },
                { $set: { restoreStatus: 'failed', restoreMessage: e.message } }
              );
            }
          }
        }
      } catch (e) {}
    }

    const ready = linodeStatus === 'running';

    res.json({
      active: true,
      ready,
      ip: server.ip,
      port,
      connect: server.ip && port ? server.ip + ':' + port : null,
      steam: server.ip && port ? 'steam://connect/' + server.ip + ':' + port : null,
      password: (provisioner.GAME_PASSWORDS || {})[server.game] || null,
      game: server.game,
      status: linodeStatus,
      linodeId: server.linodeId,
      createdAt: server.createdAt,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List community server requests ──
router.get('/api/requests', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const requests = await db.collection('server_requests')
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: provision a new Linode ──
router.post('/api/provision', requireSuperAdmin, async (req, res) => {
  try {
    const { game } = req.body;
    if (!game) return res.status(400).json({ error: 'game is required' });
    const uid = req.user._id.toString();
    const server = await provisioner.provisionServer(game, uid);
    res.json({ ok: true, server });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: destroy a Linode (backup first) ──
router.post('/api/destroy/:linodeId', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const linodeId = parseInt(req.params.linodeId);
    const server = await db.collection('provisioned_servers').findOne({ linodeId });

    let backupResult = null;
    if (server && server.ip && server.game) {
      // Backup world files before destroying
      const userId = server.requestedBy || req.user._id.toString();
      console.log('[servers] Backing up', server.game, 'world from', server.ip, 'before destroy');
      try {
        backupResult = await worldBackup.backupFromLinode(server.ip, server.game, userId);
      } catch (e) {
        console.error('[servers] Backup failed (destroying anyway):', e.message);
        backupResult = { ok: false, message: e.message };
      }
    }

    const result = await provisioner.destroyServer(linodeId);
    res.json({ ...result, backup: backupResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: list provisioned servers ──
router.get('/api/provisioned', requireSuperAdmin, async (req, res) => {
  try {
    const active = await provisioner.listActive();
    const all = await provisioner.listAll(20);
    res.json({ active, history: all });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: check Linode status ──
router.get('/api/provisioned/:linodeId/status', requireSuperAdmin, async (req, res) => {
  try {
    const status = await provisioner.getLinodeStatus(parseInt(req.params.linodeId));
    res.json(status || { error: 'Not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: force inactivity check ──
router.post('/api/cleanup', requireSuperAdmin, async (req, res) => {
  try {
    const destroyed = await provisioner.checkInactivity();
    res.json({ ok: true, destroyed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Playtime: get current user's playtime ──
router.get('/api/playtime', requireAuth, async (req, res) => {
  try {
    const data = await playtime.getMonthly(req.user._id.toString());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Playtime: leaderboard ──
router.get('/api/playtime/leaderboard', requireAuth, async (req, res) => {
  try {
    const board = await playtime.getLeaderboard(20);
    res.json({ leaderboard: board });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: playtime for any user ──
router.get('/api/playtime/:userId', requireSuperAdmin, async (req, res) => {
  try {
    const data = await playtime.getMonthly(req.params.userId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── World Backups ──

// Admin: list all backups (admins see all, players see own)
router.get('/api/backups', requireAuth, async (req, res) => {
  try {
    const game = req.query.game || null;
    const u = req.user;
    const isAdminUser = u.isAdmin || (u.permissions && u.permissions.games === 'admin');
    if (isAdminUser) {
      const backups = await worldBackup.listAllBackups(100);
      const filtered = game ? backups.filter(b => b.game === game) : backups;
      res.json({ backups: filtered });
    } else {
      const backups = await worldBackup.listBackups(u._id.toString(), game);
      res.json({ backups });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin / premium: backup local server (optionally with a user-supplied label
// and a launch-wrapper choice that locks the save to that runtime)
router.post('/api/backups/local/:game', requireAdminOrPremium, async (req, res) => {
  try {
    const rawLabel = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const label = rawLabel ? rawLabel.slice(0, 80) : null;
    const wrapper = typeof req.body?.wrapper === 'string' ? req.body.wrapper : null;
    if (wrapper && !worldBackup.isValidWrapper(req.params.game, wrapper)) {
      return res.status(400).json({ error: 'Unknown wrapper for ' + req.params.game });
    }
    const userName = require('../lib/username').displayFor(req.user);
    const result = await worldBackup.backupLocal(req.params.game, req.user._id.toString(), {
      label,
      userName,
      wrapper,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin / premium: list saved worlds for a game (used by the spin-up dropdown)
router.get('/api/world-saves/:game', requireAdminOrPremium, async (req, res) => {
  try {
    const saves = await worldBackup.listBackupsByGame(req.params.game, 100);
    const me = req.user._id.toString();
    const slim = saves.map(s => ({
      id: s._id.toString(),
      label: s.label || null,
      userName: s.userName || null,
      userId: s.userId,
      mine: s.userId === me,
      source: s.source,
      wrapper: s.wrapper || worldBackup.defaultWrapper(s.game),
      createdAt: s.createdAt,
      fileSize: s.fileSize,
    }));
    res.json({
      saves: slim,
      wrappers: worldBackup.listWrappers(req.params.game),
      defaultWrapper: worldBackup.defaultWrapper(req.params.game),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Anyone with the manage-worlds gate can read the wrapper list for a game.
// Used by the "Save current world" modal so we don't have to inline the
// per-game wrapper list in the page.
router.get('/api/world-wrappers/:game', requireAdminOrPremium, (req, res) => {
  res.json({
    wrappers: worldBackup.listWrappers(req.params.game),
    defaultWrapper: worldBackup.defaultWrapper(req.params.game),
  });
});

// Admin: restore a specific backup to local server
router.post('/api/backups/:id/restore-local', requireAdmin, async (req, res) => {
  try {
    const backup = await worldBackup.getBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: 'Backup not found' });

    // Check if the game server is running — warn but allow
    const game = backup.game;
    let running = false;
    try {
      const lib = GAME_LIBS[game]();
      running = lib.isRunning();
    } catch (e) {}

    const result = await worldBackup.restoreLocal(game, req.params.id);
    if (result.ok && running) {
      result.warning = game.toUpperCase() + ' server is still running — restart it to load the restored save';
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: restore a specific backup to a provisioned Linode
router.post('/api/backups/:id/restore-linode', requireAdmin, async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    const backup = await worldBackup.getBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: 'Backup not found' });

    const result = await worldBackup.restoreToLinode(ip, backup.game, backup.userId, req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a backup — only the original requestor or a superadmin.
router.delete('/api/backups/:id', requireAuth, async (req, res) => {
  try {
    const backup = await worldBackup.getBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: 'Backup not found' });
    const me = req.user._id.toString();
    const allowed = req.user.isAdmin === true || backup.userId === me;
    if (!allowed) {
      return res.status(403).json({ error: 'Only the creator of this save (or a superadmin) can delete it' });
    }
    const result = await worldBackup.deleteBackup(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
