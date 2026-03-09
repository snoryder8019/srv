const router = require('express').Router();
const BotConfig = require('../models/BotConfig');
const { listAgents } = require('../lib/agentBot');

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).json({ error: 'Forbidden' });
}

// GET /api/bots — list configured bots
router.get('/bots', ensureAdmin, async (req, res) => {
  const bots = await BotConfig.find().sort({ createdAt: -1 }).lean();
  res.json(bots);
});

// GET /api/bots/agents — list available agents from madladslab DB
router.get('/bots/agents', ensureAdmin, async (req, res) => {
  try {
    const agents = await listAgents();
    res.json(agents);
  } catch (err) {
    console.error('[BotConfig] listAgents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agents: ' + err.message });
  }
});

// POST /api/bots — create a new bot config
router.post('/bots', ensureAdmin, async (req, res) => {
  const { trigger, agentId, agentName, displayName, avatar } = req.body;
  if (!trigger || !agentId || !displayName) {
    return res.status(400).json({ error: 'trigger, agentId, and displayName are required' });
  }
  const clean = trigger.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clean) return res.status(400).json({ error: 'Invalid trigger name' });

  try {
    const bot = await BotConfig.create({
      trigger: clean,
      agentId,
      agentName: agentName || displayName,
      displayName,
      avatar: avatar || ''
    });
    res.json(bot);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: `Trigger "@${clean}" is already in use` });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bots/:id — update enabled, displayName, avatar, rateMs
router.patch('/bots/:id', ensureAdmin, async (req, res) => {
  const { enabled, displayName, avatar, rateMs } = req.body;
  const update = {};
  if (typeof enabled === 'boolean') update.enabled = enabled;
  if (displayName) update.displayName = displayName;
  if (typeof avatar === 'string') update.avatar = avatar;
  if (typeof rateMs === 'number') update.rateMs = rateMs;

  const bot = await BotConfig.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!bot) return res.status(404).json({ error: 'Not found' });
  res.json(bot);
});

// DELETE /api/bots/:id — remove a bot config
router.delete('/bots/:id', ensureAdmin, async (req, res) => {
  await BotConfig.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
