'use strict';

const express = require('express');
const provisioner = require('../lib/linode-provisioner');
const playtime = require('../lib/playtime');
const worldBackup = require('../lib/world-backup');
const router = express.Router();

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

// ── Community server request — admin only (controls server starts + Linode provisioning) ──
const GAME_LIBS = {
  rust: () => require('../lib/rust'),
  valheim: () => require('../lib/valheim'),
  l4d2: () => require('../lib/l4d2'),
  '7dtd': () => require('../lib/7dtd'),
};

router.post('/api/request', requireAdmin, async (req, res) => {
  try {
    const { game } = req.body;
    const validGames = ['rust', 'valheim', 'l4d2', '7dtd'];
    if (!game || !validGames.includes(game)) {
      return res.status(400).json({ error: 'Invalid game. Choose: ' + validGames.join(', ') });
    }

    const lib = GAME_LIBS[game]();
    const userName = req.user.displayName || req.user.email;

    // Check if already running
    if (lib.isRunning()) {
      console.log('[servers]', userName, 'requested', game, '— already running');
      return res.json({ ok: true, message: game.toUpperCase() + ' server is already running', status: 'running' });
    }

    // Count how many local servers are currently running (max 2 on this box)
    const runningCount = Object.entries(GAME_LIBS).filter(([, fn]) => {
      try { return fn().isRunning(); } catch (e) { return false; }
    }).length;

    if (runningCount >= 2) {
      // 3rd server — spin up a Linode instead
      console.log('[servers]', userName, 'requested', game, '— 2 already running, provisioning Linode');
      try {
        const server = await provisioner.provisionServer(game, req.user._id.toString());
        const db2 = req.app.locals.db;
        await db2.collection('server_requests').insertOne({
          userId: req.user._id.toString(),
          userName,
          game,
          status: 'provisioned',
          linodeId: server.linodeId,
          createdAt: new Date(),
        });
        // Push event to feed
        const provEvent = { game, type: 'server_start', ts: new Date(), name: userName + ' (Linode)' };
        await db.collection('game_events').insertOne(provEvent);
        require('../lib/stats-collector').emitter.emit('event', provEvent);

        return res.json({
          ok: true,
          message: game.toUpperCase() + ' server provisioning on a new Linode (2 already running locally)',
          status: 'provisioning',
          linodeId: server.linodeId,
          ip: server.ip,
        });
      } catch (e) {
        console.error('[servers] Linode provision failed:', e.message);
        return res.status(500).json({ error: 'Could not provision server: ' + e.message });
      }
    }

    // Start locally
    console.log('[servers]', userName, 'requested', game, '— starting server');
    const result = lib.startServer();

    // Log the request + emit event
    const db = req.app.locals.db;
    await db.collection('server_requests').insertOne({
      userId: req.user._id.toString(),
      userName,
      game,
      status: 'started',
      createdAt: new Date(),
    });

    // Push event to stats feed so dashboard updates
    const event = { game, type: 'server_start', ts: new Date(), name: userName };
    await db.collection('game_events').insertOne(event);
    const statsCollector = require('../lib/stats-collector');
    statsCollector.emitter.emit('event', event);

    res.json({ ok: true, message: game.toUpperCase() + ' server starting up — give it a minute to boot', status: 'starting' });
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

    const GAME_PORTS_MAP = { rust: 28015, valheim: 2456, l4d2: 27015, '7dtd': 26900 };
    const port = GAME_PORTS_MAP[server.game] || '';

    // Check Linode API for actual status
    let linodeStatus = 'provisioning';
    if (server.ip) {
      try {
        const linodeData = await provisioner.getLinodeStatus(server.linodeId);
        if (linodeData && linodeData.status === 'running') {
          linodeStatus = 'booting';
          // Estimate: Linode boots ~2min, SteamCMD install ~5-8min
          const age = Date.now() - new Date(server.createdAt).getTime();
          if (age > 8 * 60 * 1000) {
            // 8+ minutes — game should be installed and running
            linodeStatus = 'running';
            if (server.status !== 'running') {
              await db.collection('provisioned_servers').updateOne(
                { linodeId: server.linodeId },
                { $set: { status: 'running', lastActivity: new Date() } }
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

// User: list my backups
router.get('/api/backups', requireAuth, async (req, res) => {
  try {
    const game = req.query.game || null;
    const backups = await worldBackup.listBackups(req.user._id.toString(), game);
    res.json({ backups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Superadmin: list all backups
router.get('/api/backups/all', requireSuperAdmin, async (req, res) => {
  try {
    const backups = await worldBackup.listAllBackups(50);
    res.json({ backups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Superadmin: backup local server
router.post('/api/backups/local/:game', requireSuperAdmin, async (req, res) => {
  try {
    const result = await worldBackup.backupLocal(req.params.game, req.user._id.toString());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
