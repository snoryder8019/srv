import express from "express";
import ForwardChatSite from "../../api/v1/models/ForwardChatSite.js";
import Agent from "../../api/v1/models/Agent.js";
import { isAdmin } from "./middleware.js";

const router = express.Router();

// ── Site Management ──────────────────────────────────────────────────────────

// List all registered sites
router.get('/api/forwardchat/sites', isAdmin, async (req, res) => {
  try {
    const sites = await ForwardChatSite.find({})
      .populate('activeAgent', 'name model')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, sites });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get a single site
router.get('/api/forwardchat/sites/:id', isAdmin, async (req, res) => {
  try {
    const site = await ForwardChatSite.findById(req.params.id)
      .populate('activeAgent', 'name model')
      .lean();
    if (!site) return res.status(404).json({ success: false, error: 'Site not found' });
    res.json({ success: true, site });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Register a new site — generates a SITE_TOKEN
router.post('/api/forwardchat/sites', isAdmin, async (req, res) => {
  try {
    const { siteName, siteUrl, origin, chatMode } = req.body;
    if (!siteName?.trim() || !siteUrl?.trim()) {
      return res.status(400).json({ success: false, error: 'siteName and siteUrl are required' });
    }
    const site = new ForwardChatSite({
      siteName: siteName.trim(),
      siteUrl: siteUrl.trim(),
      origin: origin?.trim() || '',
      chatMode: chatMode || 'active',
      createdBy: req.user._id
    });
    await site.save();
    res.json({ success: true, site, token: site.plugin.token });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update a site (name, url, origin, chatMode, enabled)
router.put('/api/forwardchat/sites/:id', isAdmin, async (req, res) => {
  try {
    const { siteName, siteUrl, origin, chatMode, enabled } = req.body;
    const site = await ForwardChatSite.findById(req.params.id);
    if (!site) return res.status(404).json({ success: false, error: 'Site not found' });

    if (siteName !== undefined) site.siteName = siteName.trim();
    if (siteUrl !== undefined) site.siteUrl = siteUrl.trim();
    if (origin !== undefined) site.origin = origin.trim();
    if (chatMode !== undefined && ['passive', 'active', 'agent'].includes(chatMode)) site.chatMode = chatMode;
    if (enabled !== undefined) site.enabled = Boolean(enabled);

    await site.save();
    res.json({ success: true, site });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Delete a site
router.delete('/api/forwardchat/sites/:id', isAdmin, async (req, res) => {
  try {
    const site = await ForwardChatSite.findById(req.params.id);
    if (!site) return res.status(404).json({ success: false, error: 'Site not found' });

    // Remove from any agents that reference this site
    await Agent.updateMany(
      { 'forwardChat.sites.siteId': site._id },
      { $pull: { 'forwardChat.sites': { siteId: site._id } } }
    );

    await ForwardChatSite.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── CORS for public plugin endpoints (called cross-origin from 3rd-party sites)
function pluginCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

// ── Plugin Verification (called by the forwardchat loader on first load) ─────
// Public endpoint — no isAdmin (called from 3rd-party site context)
router.options('/api/forwardchat/verify/:token', pluginCors);
router.options('/api/forwardchat/meta', pluginCors);
router.post('/api/forwardchat/verify/:token', pluginCors, async (req, res) => {
  try {
    const site = await ForwardChatSite.findOne({ 'plugin.token': req.params.token });
    if (!site) return res.status(404).json({ success: false, error: 'Invalid token' });

    const now = new Date();
    const updateFields = { 'plugin.lastPing': now };
    if (!site.plugin.verified) {
      updateFields['plugin.verified'] = true;
      updateFields['plugin.installedAt'] = now;
    }
    await ForwardChatSite.updateOne({ _id: site._id }, { $set: updateFields });

    // Return minimal config the widget needs
    const agent = site.activeAgent
      ? await Agent.findById(site.activeAgent, 'name description forwardChat config').lean()
      : null;

    res.json({
      success: true,
      siteName: site.siteName,
      chatMode: site.chatMode,
      agent: agent ? { name: agent.name, description: agent.description } : null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Plugin runtime meta (served to loader to resolve runtime URL) ─────────────
router.get('/api/forwardchat/meta', pluginCors, async (req, res) => {
  try {
    const { site: token } = req.query;
    if (!token) return res.status(400).json({ success: false, error: 'Missing site token' });

    const site = await ForwardChatSite.findOne({ 'plugin.token': token, enabled: true }).lean();
    if (!site) return res.status(404).json({ success: false });

    res.json({
      success: true,
      runtimeUrl: '/plugin/forwardchat.runtime.js',
      siteId: site._id,
      siteName: site.siteName
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Agent ↔ Site Assignment ───────────────────────────────────────────────────

// Assign / update agent on a site
router.patch('/api/forwardchat/sites/:id/agent', isAdmin, async (req, res) => {
  try {
    const { agentId, chatMode } = req.body;
    const site = await ForwardChatSite.findById(req.params.id);
    if (!site) return res.status(404).json({ success: false, error: 'Site not found' });

    if (agentId) {
      const agent = await Agent.findById(agentId);
      if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
      site.activeAgent = agent._id;

      // Add site to agent's forwardChat.sites if not already there
      const alreadyLinked = agent.forwardChat.sites.some(s => s.siteId?.toString() === site._id.toString());
      if (!alreadyLinked) {
        agent.forwardChat.sites.push({ siteId: site._id, chatMode: chatMode || 'active', enabled: true });
        await agent.save();
      }
    } else {
      // Remove agent assignment
      if (site.activeAgent) {
        await Agent.updateOne(
          { _id: site.activeAgent },
          { $pull: { 'forwardChat.sites': { siteId: site._id } } }
        );
      }
      site.activeAgent = null;
    }

    if (chatMode && ['passive', 'active', 'agent'].includes(chatMode)) site.chatMode = chatMode;
    await site.save();

    const populated = await ForwardChatSite.findById(site._id).populate('activeAgent', 'name model').lean();
    res.json({ success: true, site: populated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Toggle agent's forwardChat BIH deployment
router.patch('/api/agents/:id/forwardchat/bih', isAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

    agent.forwardChat.bihEnabled = typeof enabled === 'boolean' ? enabled : !agent.forwardChat.bihEnabled;

    // Keep bihBot fields in sync so agentBot.js picks it up
    if (agent.forwardChat.bihEnabled) {
      agent.bihBot.enabled = true;
      if (!agent.bihBot.trigger) {
        agent.bihBot.trigger = agent.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      }
      if (!agent.bihBot.displayName) agent.bihBot.displayName = agent.name;
    } else {
      agent.bihBot.enabled = false;
    }

    await agent.save();
    res.json({ success: true, bihEnabled: agent.forwardChat.bihEnabled, bihBot: agent.bihBot });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update agent's forwardChat limits
router.patch('/api/agents/:id/forwardchat/config', isAdmin, async (req, res) => {
  try {
    const { sessionLimit, rateLimitPerHour } = req.body;
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

    if (sessionLimit !== undefined) agent.forwardChat.sessionLimit = parseInt(sessionLimit);
    if (rateLimitPerHour !== undefined) agent.forwardChat.rateLimitPerHour = parseInt(rateLimitPerHour);

    await agent.save();
    res.json({ success: true, forwardChat: agent.forwardChat });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
