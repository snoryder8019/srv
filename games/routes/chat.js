'use strict';

const express = require('express');
const chat = require('../lib/game-chat');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'not authed' });
  next();
}

router.get('/:game', requireAuth, async (req, res) => {
  try {
    const game = req.params.game;
    const [messages, presence] = await Promise.all([
      chat.getRecent(game, 50),
      chat.getPresence(game),
    ]);
    const canPost = !!(
      req.user.isAdmin ||
      (req.user.permissions && req.user.permissions.games === 'admin') ||
      chat.userIsInGame(req.user, presence.names, presence.steamIds)
    );
    // Strip steamIds before responding — they're internal presence data and
    // shouldn't ship to the chat panel which only needs name presence.
    const { steamIds, ...publicPresence } = presence;
    res.json({ game, messages, presence: publicPresence, canPost, maxLen: chat.MAX_MESSAGE_LEN });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:game', requireAuth, async (req, res) => {
  try {
    const game = req.params.game;
    const doc = await chat.postMessage(game, req.user, req.body?.message);
    res.json({ ok: true, message: doc });
  } catch (e) {
    if (e.code === 'NOT_IN_GAME') return res.status(403).json({ error: 'not in-game', code: 'NOT_IN_GAME' });
    res.status(400).json({ error: e.message });
  }
});

// Paginated older messages for the channel-history UI. `before` is the
// timestamp of the earliest message the caller already has.
router.get('/:game/history', requireAuth, async (req, res) => {
  try {
    const game  = req.params.game;
    const before = req.query.before || null;
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const out = await chat.getHistory(game, before, limit);
    res.json({ game, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:game/stats', async (req, res) => {
  try {
    const out = await chat.getStats(req.params.game);
    res.json({ game: req.params.game, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
