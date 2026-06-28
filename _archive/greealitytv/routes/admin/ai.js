// AI Studio routes — Ollama-powered tools for GreealityTV admins + verified authors.
// Hub at /admin/ai; JSON endpoints under /admin/ai/api/*.

const express = require('express');
const router = express.Router();
const ai = require('../../services/ai');
const Post = require('../../models/Post');
const Video = require('../../models/Video');
const User = require('../../models/User');
const ShareDigest = require('../../models/ShareDigest');
const Local = require('../../models/Local');
const Gig = require('../../models/Gig');
const { ensureAiAccess, ensureAdmin } = require('../../middleware/auth');

router.use(ensureAiAccess);

// Hub page
router.get('/', (req, res) => {
  res.render('admin/ai/index', {
    aiConfig: ai._config,
    isAdmin: !!req.user.isAdmin
  });
});

// ── Copy writer ────────────────────────────────────────────────────────────
router.post('/api/draft', async (req, res) => {
  try {
    const { topic, angle, length, tags } = req.body;
    if (!topic || !topic.trim()) return res.status(400).json({ error: 'Topic required.' });
    const out = await ai.writeDraft({ topic, angle, length, tags: Array.isArray(tags) ? tags : [] });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/headlines', async (req, res) => {
  try {
    const headlines = await ai.suggestHeadlines({ topic: req.body.topic, body: req.body.body, n: req.body.n || 6 });
    res.json({ headlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/excerpt', async (req, res) => {
  try {
    if (!req.body.body) return res.status(400).json({ error: 'Body required.' });
    const excerpt = await ai.generateExcerpt({ body: req.body.body });
    res.json({ excerpt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tags', async (req, res) => {
  try {
    const tags = await ai.suggestTags({ title: req.body.title, body: req.body.body });
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SEO + social ───────────────────────────────────────────────────────────
router.post('/api/seo', async (req, res) => {
  try {
    const seo = await ai.generateSeo({ title: req.body.title, body: req.body.body });
    res.json(seo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Images ─────────────────────────────────────────────────────────────────
router.post('/api/image', async (req, res) => {
  try {
    const { prompt, negative_prompt, size, steps, guidance, seed } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt required.' });
    const out = await ai.generateImage({ prompt, negative_prompt, size, steps, guidance, seed });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/image-prompt', async (req, res) => {
  try {
    const prompt = await ai.imagePromptFromArticle({ title: req.body.title, body: req.body.body });
    res.json({ prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Moderation (admin only) ────────────────────────────────────────────────
router.post('/api/moderate', ensureAdmin, async (req, res) => {
  try {
    const { type, payload } = req.body;
    if (!type || !payload) return res.status(400).json({ error: 'type + payload required.' });
    const out = await ai.moderate({ type, payload });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/moderate-pending', ensureAdmin, async (req, res) => {
  try {
    const [posts, shares, locals, gigs] = await Promise.all([
      Post.find({ status: 'pending' }).populate('author', 'displayName').lean(),
      ShareDigest.find({ status: 'pending' }).populate('submittedBy', 'displayName').lean(),
      Local.find({ status: 'pending' }).populate('submittedBy', 'displayName').lean(),
      Gig.find({ status: 'pending' }).populate('submittedBy', 'displayName').lean()
    ]);

    const items = [
      ...posts.map(p => ({ kind: 'post', id: p._id, label: p.title, payload: { title: p.title, body: (p.body || '').slice(0, 1500), author: p.author?.displayName } })),
      ...shares.map(s => ({ kind: 'share', id: s._id, label: s.title, payload: { title: s.title, url: s.url, platform: s.platform, submittedBy: s.submittedBy?.displayName } })),
      ...locals.map(l => ({ kind: 'local', id: l._id, label: l.name, payload: { name: l.name, category: l.category, description: l.description, submittedBy: l.submittedBy?.displayName } })),
      ...gigs.map(g => ({ kind: 'gig', id: g._id, label: g.title, payload: { title: g.title, type: g.type, category: g.category, description: g.description, submittedBy: g.submittedBy?.displayName } }))
    ];

    const results = [];
    for (const item of items.slice(0, 25)) {
      try {
        const verdict = await ai.moderate({ type: item.kind, payload: item.payload });
        results.push({ kind: item.kind, id: item.id, label: item.label, verdict });
      } catch (e) {
        results.push({ kind: item.kind, id: item.id, label: item.label, verdict: { verdict: 'review', confidence: 0, reasons: [e.message], summary: '' } });
      }
    }
    res.json({ count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Blogger report (admin only) ────────────────────────────────────────────
router.post('/api/report', ensureAdmin, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalUsers, newUsers,
      totalPosts, publishedPosts,
      totalVideos,
      pendingCount,
      topPostsRaw,
      recentPostsRaw
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Post.countDocuments(),
      Post.countDocuments({ published: true }),
      Video.countDocuments(),
      Post.countDocuments({ status: 'pending' }),
      Post.find({ published: true }).sort({ views: -1 }).limit(5).select('title views tags').lean(),
      Post.find({ published: true }).sort({ createdAt: -1 }).limit(10).select('title tags createdAt').lean()
    ]);

    const report = await ai.bloggerReport({
      stats: { totalUsers, newUsers, totalPosts, publishedPosts, totalVideos },
      topPosts: topPostsRaw.map(p => ({ title: p.title, views: p.views, tags: p.tags })),
      recentTitles: recentPostsRaw.map(p => p.title),
      pendingCount
    });

    res.json({ generatedAt: new Date(), stats: { totalUsers, newUsers, totalPosts, publishedPosts, totalVideos, pendingCount }, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Free-form chat ─────────────────────────────────────────────────────────
router.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required.' });
    const reply = await ai.freeChat({ history, message });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health ─────────────────────────────────────────────────────────────────
router.get('/api/health', async (req, res) => {
  const start = Date.now();
  try {
    const reply = await ai.chat([{ role: 'user', content: 'reply with the single word: ok' }], { max_tokens: 10, timeoutMs: 120000 });
    res.json({ ok: true, model: ai._config.MODEL, reply: reply.slice(0, 80), ms: Date.now() - start });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, ms: Date.now() - start });
  }
});

module.exports = router;
