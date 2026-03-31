'use strict';

const express = require('express');
const stats = require('../lib/stats-collector');
const router = express.Router();

// All stats endpoints are public — this is spectator data

// Recent events across all games (or filter by game)
router.get('/events', async (req, res) => {
  try {
    const game = req.query.game || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const events = await stats.getRecentEvents(game, limit);
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
    const games = ['rust', 'valheim', 'l4d2', '7dtd'];
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

module.exports = router;
