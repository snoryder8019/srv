'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const stats = require('../lib/stats-collector');
const router = express.Router();

const WR_DATA_DIR     = path.join(__dirname, '..', 'windrose', 'windrose_plus_data');
const WR_SERVER_STAT  = path.join(WR_DATA_DIR, 'server_status.json');
const WR_LIVEMAP      = path.join(WR_DATA_DIR, 'livemap_data.json');
const WR_POIS         = path.join(WR_DATA_DIR, 'pois.json');
const WR_POI_CLASSES  = path.join(WR_DATA_DIR, 'poi_discovered_classes.json');
const WR_RCON_STATUS  = path.join(WR_DATA_DIR, 'rcon_status.json');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function summarisePois(p) {
  if (!p || !Array.isArray(p.pois)) return null;
  const islandTop = Object.entries(p.island_counts || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ id: k, count: v }));
  return {
    total: p.total_pois || 0,
    actorsScanned: p.actors_scanned || 0,
    actorsMatched: p.actors_matched || 0,
    missingPosition: p.missing_position || 0,
    timestamp: p.timestamp || null,
    kindCounts: p.kind_counts || {},
    islandCount: Object.keys(p.island_counts || {}).length,
    subTypeCount: Object.keys(p.sub_type_counts || {}).length,
    islandTop,
  };
}

function summariseClassCensus(c) {
  if (!c || !Array.isArray(c.classes)) return null;
  const all = c.classes;
  const sum = arr => arr.reduce((s, x) => s + (x.count || 0), 0);
  return {
    lastUpdated: c.last_updated || null,
    totalClasses: all.length,
    totalActors: sum(all),
    top: all.slice(0, 15),
    farmingCount: sum(all.filter(x => /^BP_Farming_/i.test(x.class))),
    mobsCount:    sum(all.filter(x => /^BP_Mob_/i.test(x.class))),
    shipsCount:   sum(all.filter(x => /^BP_AIShip_/i.test(x.class))),
    bossesCount:  sum(all.filter(x => /^BP_Boss_/i.test(x.class))),
  };
}

// All stats endpoints are public — this is spectator data

// Recent events across all games (or filter by game)
// Heartbeats + mod-internal probes are excluded by default. Pass ?includeNoise=1
// (or the legacy ?includeHeartbeats=1) to opt back in.
router.get('/events', async (req, res) => {
  try {
    const game = req.query.game || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const includeNoise = req.query.includeNoise === '1' || req.query.includeHeartbeats === '1';
    const before = req.query.before || null;
    const events = await stats.getRecentEvents(game, limit, { includeNoise, before });
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// Server summary (latest snapshot + 24h stats)
router.get('/summary/:game', async (req, res) => {
  try {
    const summary = await stats.getServerSummary(req.params.game);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// All server summaries at once
router.get('/summary', async (req, res) => {
  try {
    const games = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose'];
    const summaries = {};
    for (const game of games) {
      summaries[game] = await stats.getServerSummary(game);
    }
    res.json(summaries);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load summaries' });
  }
});

// Snapshot history (for charts/graphs)
router.get('/snapshots/:game', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // max 7 days
    const snapshots = await stats.getRecentSnapshots(req.params.game, hours);
    res.json({ snapshots });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load snapshots' });
  }
});

// Player leaderboard
router.get('/leaderboard/:game', async (req, res) => {
  try {
    const sort = req.query.sort || 'totalPlaytime';
    const allowed = ['totalPlaytime', 'kills', 'deaths', 'sessions'];
    const sortField = allowed.includes(sort) ? sort : 'totalPlaytime';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const players = await stats.getPlayerLeaderboard(req.params.game, sortField, limit);
    res.json({ players });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Player stats by Steam ID
router.get('/player/:steamId', async (req, res) => {
  try {
    const playerStats = await stats.getPlayerStats(req.params.steamId);
    res.json({ stats: playerStats });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load player stats' });
  }
});

// All-time aggregated stats for a game
router.get('/alltime/:game', async (req, res) => {
  try {
    const allTime = await stats.getGameAllTimeStats(req.params.game);
    res.json(allTime);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load all-time stats' });
  }
});

// Notable events (deaths, kills, boss kills, raids) for a game
router.get('/notable/:game', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const events = await stats.getNotableEvents(req.params.game, limit);
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notable events' });
  }
});

// All summaries including new fields
router.get('/dashboard', async (req, res) => {
  try {
    const games = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose'];
    const result = {};
    for (const game of games) {
      const [summary, allTime, leaderboard] = await Promise.all([
        stats.getServerSummary(game),
        stats.getGameAllTimeStats(game),
        stats.getPlayerLeaderboard(game, 'totalPlaytime', 5),
      ]);
      result[game] = { ...summary, allTime, topPlayers: leaderboard };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// Public windrose live-stats panel — combat counts, POI scan, world class
// census, mod-health hook gauge, RCON state. No console history, no config
// (those stay admin-only on /admin/modbuilder/api/state).
router.get('/windrose-live', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const status  = readJsonSafe(WR_SERVER_STAT);
    const livemap = readJsonSafe(WR_LIVEMAP);
    const pois    = readJsonSafe(WR_POIS);
    const census  = readJsonSafe(WR_POI_CLASSES);
    const rcon    = readJsonSafe(WR_RCON_STATUS);

    const [eventCounts, modArmed, destroyedActorCounts] = await Promise.all([
      db.collection('game_events').aggregate([
        { $match: { game: 'windrose', ts: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('game_events').findOne(
        { game: 'windrose', type: 'mod_boot', hooksTotal: { $exists: true } },
        { sort: { ts: -1 } }
      ),
      db.collection('game_events').aggregate([
        { $match: {
            game: 'windrose',
            ts: { $gte: since },
            type: { $in: ['boss_kill', 'mob_kill', 'npc_kill', 'ship_sunk', 'item_drop'] },
        } },
        { $group: { _id: { type: '$type', actorClass: '$actorClass' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 30 },
      ]).toArray(),
    ]);

    const counts = eventCounts.reduce((a, r) => { a[r._id] = r.count; return a; }, {});
    const combatBreakdown = { boss_kill: [], mob_kill: [], npc_kill: [], ship_sunk: [], item_drop: [] };
    for (const row of destroyedActorCounts) {
      const t = row._id?.type;
      if (combatBreakdown[t]) combatBreakdown[t].push({ class: row._id.actorClass || 'unknown', count: row.count });
    }

    res.json({
      ts: Date.now(),
      server: status?.server || null,
      activePlayers: (livemap?.players || []).map(p => p.name).filter(Boolean),
      combat: {
        totals: {
          bossKills: counts.boss_kill || 0,
          mobKills:  counts.mob_kill  || 0,
          npcKills:  counts.npc_kill  || 0,
          shipsSunk: counts.ship_sunk || 0,
          itemDrops: counts.item_drop || 0,
        },
        breakdown: combatBreakdown,
      },
      counts24h: counts,
      pois: summarisePois(pois),
      world: summariseClassCensus(census),
      modHealth: modArmed ? {
        registered: modArmed.hooksRegistered ?? null,
        total:      modArmed.hooksTotal      ?? null,
        failed:     modArmed.hooksFailed     ?? null,
        lastArmedAt: modArmed.ts,
      } : null,
      rcon: rcon ? { state: rcon.state, detail: rcon.detail, version: rcon.version, ts: rcon.ts, last_error: rcon.last_error } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
