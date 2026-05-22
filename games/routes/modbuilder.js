'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { UI_SUPPRESSED_EVENT_TYPES } = require('../lib/stats-collector');

const router = express.Router();

const WINDROSE_DATA_DIR = path.join(__dirname, '..', 'windrose', 'windrose_plus_data');
const SERVER_STATUS    = path.join(WINDROSE_DATA_DIR, 'server_status.json');
const LIVEMAP          = path.join(WINDROSE_DATA_DIR, 'livemap_data.json');
const POIS             = path.join(WINDROSE_DATA_DIR, 'pois.json');
const POI_CLASSES      = path.join(WINDROSE_DATA_DIR, 'poi_discovered_classes.json');
const RCON_STATUS      = path.join(WINDROSE_DATA_DIR, 'rcon_status.json');
const CONSOLE_HISTORY  = path.join(WINDROSE_DATA_DIR, 'console_history.json');
const PLUS_CONFIG      = path.join(__dirname, '..', 'windrose', 'windrose_plus.json');

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

// Summarise pois.json down to a few KB — the full file is 141 KB and we don't
// need every POI position client-side just to render the dashboard panel.
function summarisePois(pois) {
  if (!pois || !Array.isArray(pois.pois)) return null;
  // Top 10 most-populated islands.
  const islandTop = Object.entries(pois.island_counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => ({ id: k, count: v }));
  return {
    total: pois.total_pois || 0,
    actorsScanned: pois.actors_scanned || 0,
    actorsMatched: pois.actors_matched || 0,
    missingPosition: pois.missing_position || 0,
    timestamp: pois.timestamp || null,
    kindCounts: pois.kind_counts || {},
    islandCount: Object.keys(pois.island_counts || {}).length,
    islandTop,
    subTypeCount: Object.keys(pois.sub_type_counts || {}).length,
  };
}

// Cherry-pick a few useful slices from the class census.
function summariseClassCensus(census) {
  if (!census || !Array.isArray(census.classes)) return null;
  const all = census.classes;
  const top = all.slice(0, 15);
  const farming = all.filter(c => /^BP_Farming_/i.test(c.class));
  const mobs    = all.filter(c => /^BP_Mob_/i.test(c.class));
  const ships   = all.filter(c => /^BP_AIShip_/i.test(c.class));
  const bosses  = all.filter(c => /^BP_Boss_/i.test(c.class));
  const sum = arr => arr.reduce((s, c) => s + (c.count || 0), 0);
  return {
    lastUpdated: census.last_updated || null,
    totalClasses: all.length,
    totalActors: sum(all),
    top,
    farmingCount: sum(farming),
    farmingTop: farming.slice(0, 8),
    mobsCount: sum(mobs),
    mobsTop: mobs.slice(0, 6),
    shipsCount: sum(ships),
    bossesCount: sum(bosses),
  };
}

router.get('/', requireAdmin, (req, res) => {
  res.sendFile('modbuilder.html', { root: path.join(__dirname, '..', 'public') });
});

router.get('/api/state', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const status   = readJsonSafe(SERVER_STATUS);
    const livemap  = readJsonSafe(LIVEMAP);
    const config   = readJsonSafe(PLUS_CONFIG);
    const pois     = readJsonSafe(POIS);
    const census   = readJsonSafe(POI_CLASSES);
    const rcon     = readJsonSafe(RCON_STATUS);
    const consoleHist = readJsonSafe(CONSOLE_HISTORY);

    // Heartbeats + mod-internal probes flood the event log; if we mixed them
    // into the 50-event window, real player events would scroll out of view.
    // Pull only player-facing events for the feed, and the latest heartbeat
    // separately so the UI can still derive mode + uptime from it.
    const noiseTypes = Array.from(UI_SUPPRESSED_EVENT_TYPES);
    const [
      recentEvents,
      lastHeartbeat,
      playerStats,
      eventCounts,
      latestSnapshot,
      modArmed,
      destroyedActorCounts,
    ] = await Promise.all([
      db.collection('game_events').find({ game: 'windrose', type: { $nin: noiseTypes } }).sort({ ts: -1 }).limit(50).toArray(),
      db.collection('game_events').findOne({ game: 'windrose', type: 'heartbeat' }, { sort: { ts: -1 } }),
      db.collection('player_stats').find({ game: 'windrose' }).sort({ lastSeen: -1 }).limit(50).toArray(),
      db.collection('game_events').aggregate([
        { $match: { game: 'windrose', ts: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('game_snapshots').findOne({ game: 'windrose' }, { sort: { ts: -1 } }),
      // Latest MadLadsStats arm event — carries hook health gauge.
      db.collection('game_events').findOne(
        { game: 'windrose', type: 'mod_boot', hooksTotal: { $exists: true } },
        { sort: { ts: -1 } }
      ),
      // Top destroyed-actor classes in the last 24h (combat panel detail).
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

    const counts = eventCounts.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
    const activeNames = new Set((livemap?.players || []).map(p => p.name).filter(Boolean));

    // Pre-bucket the actor-class breakdown so the client can render straight
    // into the combat panel without re-grouping.
    const combatBreakdown = { boss_kill: [], mob_kill: [], npc_kill: [], ship_sunk: [], item_drop: [] };
    for (const row of destroyedActorCounts) {
      const t = row._id?.type;
      if (combatBreakdown[t]) {
        combatBreakdown[t].push({ class: row._id.actorClass || 'unknown', count: row.count });
      }
    }

    const combatTotals = {
      bossKills: counts.boss_kill   || 0,
      mobKills:  counts.mob_kill    || 0,
      npcKills:  counts.npc_kill    || 0,
      shipsSunk: counts.ship_sunk   || 0,
      itemDrops: counts.item_drop   || 0,
    };

    const modHealth = modArmed ? {
      registered: modArmed.hooksRegistered ?? null,
      total:      modArmed.hooksTotal      ?? null,
      failed:     modArmed.hooksFailed     ?? null,
      lastArmedAt: modArmed.ts,
    } : null;

    // Trim console history to the last 30 entries to keep the payload small.
    const consoleTail = Array.isArray(consoleHist) ? consoleHist.slice(-30) : [];

    res.json({
      ts: Date.now(),
      status,
      livemap,
      config: config ? { rconPasswordSet: config.rcon?.password && config.rcon.password !== 'changeme', features: config.features, multipliers: config.multipliers } : null,
      latestSnapshot,
      events: recentEvents,
      lastHeartbeat,
      players: playerStats.map(p => ({ ...p, active: activeNames.has(p.name) })),
      counts24h: counts,
      combat: { totals: combatTotals, breakdown: combatBreakdown },
      pois: summarisePois(pois),
      world: summariseClassCensus(census),
      modHealth,
      rcon: rcon || null,
      consoleHistory: consoleTail,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
