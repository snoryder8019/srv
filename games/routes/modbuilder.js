'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const WINDROSE_DATA_DIR = path.join(__dirname, '..', 'windrose', 'windrose_plus_data');
const SERVER_STATUS = path.join(WINDROSE_DATA_DIR, 'server_status.json');
const LIVEMAP = path.join(WINDROSE_DATA_DIR, 'livemap_data.json');
const PLUS_CONFIG = path.join(__dirname, '..', 'windrose', 'windrose_plus.json');

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const u = req.user;
  const gp = u.permissions && u.permissions.games;
  if (u.isAdmin || gp === 'admin') return next();
  res.status(403).send('Forbidden');
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

router.get('/', requireAdmin, (req, res) => {
  res.sendFile('modbuilder.html', { root: path.join(__dirname, '..', 'public') });
});

router.get('/api/state', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const status = readJsonSafe(SERVER_STATUS);
    const livemap = readJsonSafe(LIVEMAP);
    const config = readJsonSafe(PLUS_CONFIG);

    const [recentEvents, playerStats, eventCounts, latestSnapshot] = await Promise.all([
      db.collection('game_events').find({ game: 'windrose' }).sort({ ts: -1 }).limit(50).toArray(),
      db.collection('player_stats').find({ game: 'windrose' }).sort({ lastSeen: -1 }).limit(50).toArray(),
      db.collection('game_events').aggregate([
        { $match: { game: 'windrose', ts: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('game_snapshots').findOne({ game: 'windrose' }, { sort: { ts: -1 } }),
    ]);

    const counts = eventCounts.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
    const activeNames = new Set((livemap?.players || []).map(p => p.name).filter(Boolean));

    res.json({
      ts: Date.now(),
      status,
      livemap,
      config: config ? { rconPasswordSet: config.rcon?.password && config.rcon.password !== 'changeme', features: config.features, multipliers: config.multipliers } : null,
      latestSnapshot,
      events: recentEvents,
      players: playerStats.map(p => ({ ...p, active: activeNames.has(p.name) })),
      counts24h: counts,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
