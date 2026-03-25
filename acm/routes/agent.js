const express = require('express');
const router = express.Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const AgentTask = require('../models/AgentTask');
const agentService = require('../services/agentService');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const Promo = require('../models/Promo');

router.use('/admin/agent', ensureAuth, ensureAdmin);

// ─── Agent Dashboard ──────────────────────────────────────
router.get('/admin/agent', async (req, res) => {
  try {
    const recentTasks = await AgentTask.find()
      .sort({ createdAt: -1 })
      .limit(20);
    res.render('admin/agent/dashboard', {
      title: 'Agent Assistant',
      section: 'agent',
      recentTasks
    });
  } catch (err) {
    console.error('Agent dashboard error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ─── Chat endpoint (JSON) ─────────────────────────────────
router.post('/admin/agent/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !messages.length) {
      return res.json({ success: false, content: 'No messages provided' });
    }

    // Save as task
    const task = await AgentTask.create({
      type: 'chat',
      prompt: messages[messages.length - 1].content,
      status: 'running',
      createdBy: req.user._id
    });

    const start = Date.now();
    const result = await agentService.chat(messages);

    task.response = result.content;
    task.status = result.success ? 'completed' : 'failed';
    task.metadata = { model: 'deepseek-r1:7b', tokens: result.tokens, duration: Date.now() - start };
    task.completedAt = new Date();
    await task.save();

    res.json({ success: result.success, content: result.content, taskId: task._id });
  } catch (err) {
    console.error('Agent chat error:', err);
    res.json({ success: false, content: 'Error processing request: ' + err.message });
  }
});

// ─── Generate content (JSON) ──────────────────────────────
router.post('/admin/agent/generate', async (req, res) => {
  try {
    const { prompt, type } = req.body;
    const task = await AgentTask.create({
      type: type || 'content_gen',
      prompt,
      status: 'running',
      createdBy: req.user._id
    });

    const result = await agentService.generateContent(prompt, type);

    task.response = result.content;
    task.status = result.success ? 'completed' : 'failed';
    task.metadata = { model: 'deepseek-r1:7b', tokens: result.tokens };
    task.completedAt = new Date();
    await task.save();

    res.json({ success: result.success, content: result.content, taskId: task._id });
  } catch (err) {
    res.json({ success: false, content: 'Error: ' + err.message });
  }
});

// ─── Analyze platform data (JSON) ────────────────────────
router.post('/admin/agent/analyze', async (req, res) => {
  try {
    // Gather platform stats
    const subCount = await Subscriber.countDocuments({ isSubscribed: true });
    const campCount = await Campaign.countDocuments();
    const sentCamps = await Campaign.countDocuments({ status: 'sent' });
    const promoCount = await Promo.countDocuments({ isActive: true });

    const subsByRestaurant = await Subscriber.aggregate([
      { $match: { isSubscribed: true } },
      { $group: { _id: '$restaurant', count: { $sum: 1 } } }
    ]);

    const subsBySource = await Subscriber.aggregate([
      { $match: { isSubscribed: true } },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);

    const dataContext = `Platform Stats:
- Active Subscribers: ${subCount}
- Subscribers by restaurant: ${JSON.stringify(subsByRestaurant)}
- Subscribers by source: ${JSON.stringify(subsBySource)}
- Total Campaigns: ${campCount} (${sentCamps} sent)
- Active Promos: ${promoCount}

${req.body.question || 'Provide a summary analysis and actionable recommendations.'}`;

    const task = await AgentTask.create({
      type: 'analysis',
      prompt: dataContext,
      status: 'running',
      createdBy: req.user._id
    });

    const result = await agentService.generateContent(dataContext, 'analysis');

    task.response = result.content;
    task.status = result.success ? 'completed' : 'failed';
    task.completedAt = new Date();
    await task.save();

    res.json({ success: result.success, content: result.content, taskId: task._id });
  } catch (err) {
    res.json({ success: false, content: 'Error: ' + err.message });
  }
});

// ─── Draft campaign (JSON) ────────────────────────────────
router.post('/admin/agent/draft-campaign', async (req, res) => {
  try {
    const { restaurant, theme, audience } = req.body;
    const prompt = `Draft an email newsletter campaign for ${restaurant || 'all restaurants'}.
Theme/Topic: ${theme || 'general update'}
Target Audience: ${audience || 'all subscribers'}

Include: Subject line, preview text, and full HTML email body with inline styles.
Make it engaging and on-brand for a restaurant hospitality group.`;

    const task = await AgentTask.create({
      type: 'campaign_draft',
      prompt,
      status: 'running',
      createdBy: req.user._id
    });

    const result = await agentService.generateContent(prompt, 'campaign_draft');

    task.response = result.content;
    task.status = result.success ? 'completed' : 'failed';
    task.completedAt = new Date();
    await task.save();

    res.json({ success: result.success, content: result.content, taskId: task._id });
  } catch (err) {
    res.json({ success: false, content: 'Error: ' + err.message });
  }
});

// ─── Task history ─────────────────────────────────────────
router.get('/admin/agent/tasks', async (req, res) => {
  try {
    const tasks = await AgentTask.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('createdBy', 'email displayName');
    res.render('admin/agent/tasks', { title: 'Agent Tasks', section: 'agent', tasks });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.get('/admin/agent/tasks/:id', async (req, res) => {
  try {
    const task = await AgentTask.findById(req.params.id).populate('createdBy', 'email displayName');
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
