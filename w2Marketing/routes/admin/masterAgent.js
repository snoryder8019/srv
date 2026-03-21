import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { callLLM, webSearch, runTool, handleMcpRequest } from '../../plugins/agentMcp.js';

const router = express.Router();

const ROUTING_PROMPT = `You are a routing assistant for a marketing agency admin panel.
Analyze the user's request and determine which department should handle it.

Output ONLY raw JSON — no prose, no fences:
{
  "department": "blog" | "copy" | "section" | "page",
  "task": "concise task description for the specialist",
  "section_type": "text" | "split" | "cta" | "cards" | "faq",
  "page_type": "content" | "landing" | "data-list"
}

"section_type" is only required when department is "section".
"page_type" is only required when department is "page".

Department guide:
- blog: writing articles, blog posts, content pieces
- copy: website headline, hero text, services descriptions, about blurb, contact details
- section: adding a new website section (text block, split layout, CTA banner, feature cards, FAQ)
- page: creating a standalone website page (info/article page, visual landing page, or paginated data list)`;

const DEPT_ACTIONS = {
  blog:    { label: 'Open Blog Editor', url: '/admin/blog/new',  color: '#2E4270' },
  copy:    { label: 'Go to Site Copy',  url: '/admin/copy',      color: '#1C2B4A' },
  section: { label: 'Go to Sections',   url: '/admin/sections',  color: '#5B3E2B' },
  page:    { label: 'Open Page Editor', url: '/admin/pages/new', color: '#2E5B3E' },
};

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Returns 3 contextual follow-up suggestions based on what was just produced
function getSuggestions(department, task, fill) {
  const topic = (fill?.title || fill?.heading || fill?.hero_heading || task || 'our services').slice(0, 40);
  const s = {
    blog: [
      `Write a follow-up post expanding on "${topic}"`,
      `Create a CTA section promoting this blog content`,
      `Update the hero copy to highlight our expertise`,
    ],
    copy: [
      `Write a blog post about ${topic}`,
      `Add an FAQ section addressing common questions`,
      `Create a landing page for a specific service`,
    ],
    section: [
      `Add a CTA banner encouraging visitors to book a consultation`,
      `Write a blog post about "${topic}"`,
      `Create a cards section showcasing key features`,
    ],
    page: [
      `Write a blog post to support this page`,
      `Add a CTA section on the homepage promoting this page`,
      `Create another page for a different service`,
    ],
  };
  return s[department] || s.copy;
}

// ── Research step — POST /admin/master-agent/research ────────────────────────
// Fast: route the message + do one web search. Returns before full content gen.
router.post('/research', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Route
    let route = { department: 'copy', task: lastMsg, section_type: 'text', page_type: 'content' };
    try {
      const routeRaw = await callLLM([{ role: 'user', content: lastMsg }], ROUTING_PROMPT);
      const cleaned = routeRaw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) route = { ...route, ...JSON.parse(m[0]) };
    } catch { /* use defaults */ }

    // Web search on the routed task
    const searchQuery = route.task || lastMsg;
    let searchResult = '';
    try {
      searchResult = await webSearch(searchQuery);
    } catch { /* non-fatal */ }

    console.log(`[master-agent/research] dept=${route.department} query="${searchQuery}"`);

    res.json({
      department: route.department,
      task: route.task,
      section_type: route.section_type || null,
      page_type: route.page_type || null,
      searchQuery,
      searchResult,
    });
  } catch (err) {
    console.error('[master-agent/research] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Master orchestrator — POST /admin/master-agent ───────────────────────────
router.post('/', async (req, res) => {
  const { messages, research } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Step 1: Route — use pre-fetched research if provided, else re-route
    let route = research || { department: 'copy', task: lastMsg, section_type: 'text', page_type: 'content' };
    if (!research) {
      try {
        const routeRaw = await callLLM([{ role: 'user', content: lastMsg }], ROUTING_PROMPT);
        const cleaned = routeRaw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) route = { ...route, ...JSON.parse(m[0]) };
      } catch { /* use defaults */ }
    }

    console.log(`[master-agent] dept=${route.department} task="${route.task}"`);

    // Step 2: Build context — inject conversation history + research snippets
    const historyCtx = messages.length > 1
      ? '\n\nConversation history:\n' + messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')
      : '';
    const researchCtx = research?.searchResult
      ? '\n\nResearch findings:\n' + research.searchResult
      : '';
    const context = historyCtx + researchCtx;

    // Step 3: Run MCP tool
    let toolName, toolArgs;
    if (route.department === 'blog') {
      toolName = 'write_blog_post';
      toolArgs = { topic: route.task, context };
    } else if (route.department === 'section') {
      toolName = 'fill_section';
      toolArgs = { section_type: route.section_type || 'text', task: route.task, context };
    } else if (route.department === 'page') {
      toolName = 'write_page';
      toolArgs = { title: route.task, page_type: route.page_type || 'content', task: route.task, context };
    } else {
      toolName = 'fill_site_copy';
      toolArgs = { task: route.task, section: 'all', context };
    }

    const result = await runTool(toolName, toolArgs);
    const action = DEPT_ACTIONS[route.department] || DEPT_ACTIONS.copy;
    const suggestions = getSuggestions(route.department, route.task, result.fill);

    res.json({
      message: result.message || 'Done.',
      department: route.department,
      section_type: route.section_type || null,
      page_type: route.page_type || null,
      fill: result.fill || {},
      suggestedBlocks: result.suggestedBlocks || null,
      tool_used: toolName,
      action,
      suggestions,
    });
  } catch (err) {
    console.error('[master-agent] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Execute — POST /admin/master-agent/execute ────────────────────────────────
// Writes agent-generated content directly to the database.
router.post('/execute', async (req, res) => {
  const { department, fill, section_type, page_type, label } = req.body;
  if (!department || !fill || typeof fill !== 'object') {
    return res.status(400).json({ error: 'department and fill required' });
  }

  try {
    const db = getDb();
    const now = new Date();
    let summary = '';
    let editUrl = '';

    if (department === 'copy') {
      const entries = Object.entries(fill).filter(([, v]) => v && String(v).trim());
      if (!entries.length) return res.json({ ok: false, message: 'No copy fields to save.' });

      const ops = entries.map(([key, value]) =>
        db.collection('w2_copy').updateOne(
          { key },
          { $set: { key, value: String(value), updatedAt: now } },
          { upsert: true }
        )
      );
      await Promise.all(ops);
      summary = `Updated ${entries.length} copy field${entries.length > 1 ? 's' : ''}: ${entries.slice(0,3).map(([k]) => k.replace(/_/g,' ')).join(', ')}${entries.length > 3 ? '…' : ''}.`;
      editUrl = '/admin/copy';

    } else if (department === 'blog') {
      const { title, excerpt, content, category, tags } = fill;
      if (!title) return res.json({ ok: false, message: 'Blog post needs a title.' });

      let slug = toSlug(title);
      const existing = await db.collection('w2_blog').findOne({ slug });
      if (existing) slug = slug + '-' + Date.now();

      const result = await db.collection('w2_blog').insertOne({
        title,
        slug,
        excerpt: excerpt || '',
        content: content || '',
        category: category || '',
        tags: tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
        featuredImageUrl: '',
        status: 'draft',
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      summary = `Created draft blog post: "${title}".`;
      editUrl = `/admin/blog/${result.insertedId}/edit`;

    } else if (department === 'section') {
      const type = section_type || 'text';
      const sectionLabel = label || fill.heading || `New ${type} section`;

      const result = await db.collection('w2_custom_sections').insertOne({
        type,
        label: sectionLabel,
        fields: fill,
        images: {},
        visible: true,
        createdAt: now,
        updatedAt: now,
      });
      summary = `Created new "${type}" section: "${sectionLabel}".`;
      editUrl = '/admin/sections';

    } else if (department === 'page') {
      const { title, metaTitle, metaDesc, content, blocks } = fill;
      if (!title) return res.json({ ok: false, message: 'Page needs a title.' });

      let slug = toSlug(title);
      const existing = await db.collection('w2_pages').findOne({ slug });
      if (existing) slug = slug + '-' + Date.now();

      const pageType = req.body.page_type || 'content';
      const pageDoc = {
        title,
        slug,
        pageType,
        status: 'draft',
        metaTitle: metaTitle || title,
        metaDesc: metaDesc || '',
        content: pageType === 'content' ? (content || '') : '',
        blocks: pageType === 'landing' ? (blocks || []) : [],
        dataCollection: pageType === 'data-list' ? 'w2_blog' : '',
        dataPageSize: 9,
        robotsMeta: 'index,follow',
        sitemapPriority: 0.5,
        sitemapChangefreq: 'monthly',
        canonicalUrl: '',
        ogImage: '',
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection('w2_pages').insertOne(pageDoc);
      summary = `Created draft page: "${title}" (${pageType}).`;
      editUrl = `/admin/pages/${result.insertedId}/edit`;

    } else {
      return res.status(400).json({ error: 'Unknown department: ' + department });
    }

    res.json({ ok: true, message: summary, editUrl });
  } catch (err) {
    console.error('[master-agent/execute] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MCP HTTP endpoint — POST /admin/master-agent/mcp ─────────────────────────
router.post('/mcp', async (req, res) => {
  try {
    const response = await handleMcpRequest(req.body);
    if (response === null) return res.status(202).end();
    res.json(response);
  } catch (err) {
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: err.message } });
  }
});

// ── MCP discovery — GET /admin/master-agent/mcp ──────────────────────────────
router.get('/mcp', (_req, res) => {
  res.json({
    name: 'W2 Marketing Agent MCP',
    version: '1.0.0',
    description: 'W2 Marketing agents — fill site copy, write blog posts, create sections, write pages',
    endpoint: '/admin/master-agent/mcp',
    transport: 'http',
    protocol: 'MCP 2024-11-05',
  });
});

export default router;
