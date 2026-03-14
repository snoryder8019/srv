const router = require('express').Router();
const User = require('../models/User');
const Suggestion = require('../models/Suggestion');
const { getLiveStreams } = require('../lib/twitch');
const theshow = require('../lib/theshow');

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

// ─── The Show API proxy ──────────────────────────────────────────────────────

// GET /api/theshow/player-search?query=...&page=1
router.get('/theshow/player-search', ensureAuth, async (req, res) => {
  try {
    const { query, page } = req.query;
    const data = await theshow.playerSearch(query || '', parseInt(page) || 1);
    res.json(data);
  } catch (err) {
    console.error('TheShow player-search error:', err.message);
    res.status(502).json({ error: 'Failed to search players' });
  }
});

// GET /api/theshow/items?type=mlb_card&name=...&rarity=...&page=1
router.get('/theshow/items', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getItems(req.query);
    res.json(data);
  } catch (err) {
    console.error('TheShow items error:', err.message);
    res.status(502).json({ error: 'Failed to fetch items' });
  }
});

// GET /api/theshow/item/:uuid
router.get('/theshow/item/:uuid', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getItem(req.params.uuid);
    res.json(data);
  } catch (err) {
    console.error('TheShow item error:', err.message);
    res.status(502).json({ error: 'Failed to fetch item' });
  }
});

// GET /api/theshow/listings?name=...&rarity=...&page=1
router.get('/theshow/listings', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getListings(req.query);
    res.json(data);
  } catch (err) {
    console.error('TheShow listings error:', err.message);
    res.status(502).json({ error: 'Failed to fetch listings' });
  }
});

// GET /api/theshow/listing/:uuid
router.get('/theshow/listing/:uuid', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getListing(req.params.uuid);
    res.json(data);
  } catch (err) {
    console.error('TheShow listing error:', err.message);
    res.status(502).json({ error: 'Failed to fetch listing' });
  }
});

// GET /api/theshow/roster-updates
router.get('/theshow/roster-updates', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getRosterUpdates();
    res.json(data);
  } catch (err) {
    console.error('TheShow roster-updates error:', err.message);
    res.status(502).json({ error: 'Failed to fetch roster updates' });
  }
});

// GET /api/theshow/roster-update/:id
router.get('/theshow/roster-update/:id', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getRosterUpdate(req.params.id);
    res.json(data);
  } catch (err) {
    console.error('TheShow roster-update error:', err.message);
    res.status(502).json({ error: 'Failed to fetch roster update' });
  }
});

// GET /api/theshow/game-history?username=...&page=1
router.get('/theshow/game-history', ensureAuth, async (req, res) => {
  try {
    const { username, page } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const data = await theshow.getGameHistory(username, parseInt(page) || 1);
    res.json(data);
  } catch (err) {
    console.error('TheShow game-history error:', err.message);
    res.status(502).json({ error: 'Failed to fetch game history' });
  }
});

// GET /api/theshow/game-log/:uuid
router.get('/theshow/game-log/:uuid', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getGameLog(req.params.uuid);
    res.json(data);
  } catch (err) {
    console.error('TheShow game-log error:', err.message);
    res.status(502).json({ error: 'Failed to fetch game log' });
  }
});

// GET /api/theshow/captains
router.get('/theshow/captains', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getCaptains();
    res.json(data);
  } catch (err) {
    console.error('TheShow captains error:', err.message);
    res.status(502).json({ error: 'Failed to fetch captains' });
  }
});

// GET /api/theshow/meta-data
router.get('/theshow/meta-data', ensureAuth, async (req, res) => {
  try {
    const data = await theshow.getMetaData();
    res.json(data);
  } catch (err) {
    console.error('TheShow meta-data error:', err.message);
    res.status(502).json({ error: 'Failed to fetch meta data' });
  }
});

// GET /api/theshow/members — bih members who play The Show
router.get('/theshow/members', ensureAuth, async (req, res) => {
  try {
    const members = await User.find(
      { theShowUsername: { $exists: true, $ne: '' } },
      'displayName avatar theShowUsername theShowPlatform'
    ).lean();
    res.json({ members });
  } catch (err) {
    console.error('TheShow members error:', err.message);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ────────────────────────────────────────────────────────────────────────────

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
