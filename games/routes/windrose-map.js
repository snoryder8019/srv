'use strict';

// Public-facing Windrose Map endpoints. Session-gated (any signed-in player
// can see this — the same audience as the rest of the games portal). Unlike
// the MCP server, no Bearer token is involved; the page's auth cookie does
// the work.

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

const PLUS_DATA_DIR = '/srv/games/windrose/windrose_plus_data';
const SERVER_STATUS = path.join(PLUS_DATA_DIR, 'server_status.json');
const LIVEMAP       = path.join(PLUS_DATA_DIR, 'livemap_data.json');
const POIS          = path.join(PLUS_DATA_DIR, 'pois.json');
const TERRAIN       = path.join(PLUS_DATA_DIR, 'terrain_v17.json');

function requireSession(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'login required' });
  }
  next();
}

async function readJsonOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// State payload feeding the Map overlay. Trimmed so we're not shipping the
// 141 KB POI dump on every tab open — the overlay JS can ask for the full
// version via /windrose-map/api/pois if it needs it.
router.get('/api/state', requireSession, async (req, res) => {
  try {
    const [serverStatus, livemap, pois] = await Promise.all([
      readJsonOptional(SERVER_STATUS),
      readJsonOptional(LIVEMAP),
      readJsonOptional(POIS),
    ]);
    const poiSummary = pois ? {
      total_pois: pois.total_pois || 0,
      actors_scanned: pois.actors_scanned || 0,
      actors_matched: pois.actors_matched || 0,
      island_counts: pois.island_counts || {},
      islands_count: Object.keys(pois.island_counts || {}).length,
      kind_counts: pois.kind_counts || {},
      timestamp: pois.timestamp || null,
    } : null;
    res.json({ serverStatus, livemap, pois: poiSummary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full POI dump, on demand.
router.get('/api/pois', requireSession, async (_req, res) => {
  try {
    const pois = await readJsonOptional(POIS);
    res.json(pois || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Terrain manifest — 53 landscape actors (one per island) + 1256 landscape
// components with world coords. Components carry `l` (landscape index, matches
// islandId in pois.json), `wx`/`wy` (world position), `sx`/`sy` (grid index),
// and `h` (height — always 0 on this server because Null RHI blocks GPU
// texture reads). Component positions are enough to compute correct island
// bounding boxes / grid hulls without depending on POI clusters.
router.get('/api/terrain', requireSession, async (_req, res) => {
  try {
    const terrain = await readJsonOptional(TERRAIN);
    res.json(terrain || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
