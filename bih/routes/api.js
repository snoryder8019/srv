const router = require('express').Router();
const User = require('../models/User');
const Suggestion = require('../models/Suggestion');
const { getLiveStreams } = require('../lib/twitch');

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).json({ error: 'Forbidden' });
}

// GET /api/twitch/live — returns live streams for all users with a twitchId
router.get('/twitch/live', ensureAuth, async (req, res) => {
  try {
    const users = await User.find(
      { twitchId: { $exists: true, $ne: '' } },
      'twitchId displayName avatar'
    ).lean();

    if (!users.length) return res.json({ streams: [] });

    const logins = users.map(u => u.twitchId);
    const streams = await getLiveStreams(logins);

    // Merge bih user info with stream data
    const userMap = {};
    users.forEach(u => { userMap[u.twitchId.toLowerCase()] = u; });

    const results = streams.map(s => {
      const bihUser = userMap[s.userName.toLowerCase()] || {};
      return {
        ...s,
        bihDisplayName: bihUser.displayName || null,
        bihAvatar: bihUser.avatar || null,
        url: `https://twitch.tv/${s.userName}`
      };
    });

    res.json({ streams: results });
  } catch (err) {
    console.error('Twitch API error:', err.message);
    res.status(502).json({ error: 'Failed to fetch Twitch data' });
  }
});

// GET /api/suggestions — admin: view all suggestions from Jules
router.get('/suggestions', ensureAdmin, async (req, res) => {
  const suggestions = await Suggestion.find().sort({ createdAt: -1 }).lean();
  res.json(suggestions);
});

// PATCH /api/suggestions/:id — admin: update suggestion status
router.patch('/suggestions/:id', ensureAdmin, async (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'reviewed', 'accepted', 'declined'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const s = await Suggestion.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

module.exports = router;
