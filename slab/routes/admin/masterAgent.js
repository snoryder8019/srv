import express from 'express';
import { ObjectId } from 'mongodb';
import { createCanvas } from 'canvas';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';
import { callLLM, webSearch, runTool, handleMcpRequest } from '../../plugins/agentMcp.js';
import { generateInvoiceNumber, generatePaymentToken, calculateTotal } from '../../plugins/invoiceHelpers.js';
import { loadBrandContext } from '../../plugins/brandContext.js';

const router = express.Router();

const ROUTING_PROMPT = `You are a routing assistant for a business admin panel.
Analyze the user's request and determine which department should handle it.

Output ONLY raw JSON — no prose, no fences:
{
  "department": "blog" | "copy" | "section" | "page" | "design" | "asset" | "email" | "invoice" | "outreach" | "navigate",
  "task": "concise task description for the specialist",
  "section_type": "text" | "split" | "cta" | "cards" | "faq",
  "page_type": "content" | "landing" | "data-list",
  "nav_target": "page name for navigate department"
}

"section_type" only when department is "section".
"page_type" only when department is "page".
"nav_target" only when department is "navigate".

Department guide:
- blog: WRITING or CREATING articles, blog posts, content pieces
- copy: WRITING or UPDATING website headline, hero text, services descriptions, about blurb
- section: CREATING a new website section (text block, split, CTA banner, cards, FAQ)
- page: CREATING a standalone website page (content, landing, data-list)
- design: CHANGING site colors, fonts, layouts, section visibility, theme/branding
- asset: CREATING social media graphics/images, design work
- email: DRAFTING email marketing campaigns, newsletters, promotional blasts
- invoice: CREATING an invoice, billing a client, generating line items
- outreach: DRAFTING a direct email to a specific person/client — follow-ups, updates, proposals, check-ins. Use this when user says "email [name]", "send [name] a message", "write to [client]"
- navigate: GOING to a page, OPENING a section, SHOWING something. Use when user wants to go somewhere, not create something. Examples: "go to blog", "open meetings", "show clients", "take me to design", "check invoices", "open bookkeeping", "set up a meeting"

Key parsing rules:
- "email John" or "message the client" → outreach (draft an email TO someone)
- "email campaign" or "newsletter" → email (marketing blast to subscribers)
- "go to email" or "open email marketing" → navigate
- "set up a meeting" or "schedule a meeting" → navigate (nav_target: meetings)
- "go to X" / "open X" / "show X" / "take me to X" → navigate
- "create X" / "write X" / "draft X" / "build X" → the relevant content department`;

const DEPT_ACTIONS = {
  blog:    { label: 'Open Blog Editor', url: '/admin/blog/new',  color: '#2E4270' },
  copy:    { label: 'Go to Site Copy',  url: '/admin/copy',      color: '#1C2B4A' },
  section: { label: 'Go to Sections',   url: '/admin/sections',  color: '#5B3E2B' },
  page:    { label: 'Open Page Editor', url: '/admin/pages/new', color: '#2E5B3E' },
  design:  { label: 'Go to Design',     url: '/admin/design',    color: '#6B3FA0' },
  asset:   { label: 'Open Asset Center', url: '/admin/assets',   color: '#C9A848' },
  email:   { label: 'Open Email Marketing', url: '/admin/email-marketing', color: '#D4563A' },
  invoice: { label: 'Open Bookkeeping',    url: '/admin/bookkeeping',     color: '#2B7A5B' },
  outreach:{ label: 'Open Clients',        url: '/admin/clients',         color: '#4A6FA5' },
  navigate:{ label: 'Go',                url: '/admin',                 color: '#555'    },
};

const NAV_MAP = {
  dashboard: '/admin', home: '/admin',
  blog: '/admin/blog', 'new blog': '/admin/blog/new', 'blog editor': '/admin/blog/new',
  pages: '/admin/pages', 'new page': '/admin/pages/new', 'page editor': '/admin/pages/new',
  copy: '/admin/copy', 'site copy': '/admin/copy',
  design: '/admin/design', settings: '/admin/design', 'design settings': '/admin/design',
  assets: '/admin/assets', 'asset center': '/admin/assets',
  clients: '/admin/clients', 'client list': '/admin/clients',
  meetings: '/admin/meetings', 'new meeting': '/admin/meetings',
  bookkeeping: '/admin/bookkeeping', invoices: '/admin/bookkeeping',
  'email marketing': '/admin/email-marketing', campaigns: '/admin/email-marketing',
  portfolio: '/admin/portfolio', 'new portfolio': '/admin/portfolio/new',
  sections: '/admin/sections',
  users: '/admin/users',
  site: '/', 'live site': '/', 'view site': '/',
};

const WORKFLOW_PROMPT = `You are a workflow planner for a business admin panel.
Analyze the user's request and decide if it needs one action or multiple ordered steps.

Output ONLY raw JSON — no prose, no fences:
{
  "mode": "workflow" or "single",
  "title": "short title (3-6 words)",
  "tasks": [
    {
      "department": "blog" | "copy" | "section" | "page" | "design" | "asset" | "email" | "invoice" | "outreach",
      "task": "specific instruction for the specialist agent",
      "label": "2-5 word human label",
      "section_type": "text" | "split" | "cta" | "cards" | "faq",
      "page_type": "content" | "landing" | "data-list"
    }
  ]
}

"section_type" only when department is "section".
"page_type" only when department is "page".

Use "single" when the request targets ONE department with ONE output.
Use "workflow" when the request involves 2+ departments or 2+ distinct deliverables.
Order tasks logically (e.g. copy before blog, design before assets). Maximum 8 tasks.

Department capabilities:
- copy: update hero headlines, services text, about section, contact info
- blog: write articles, blog posts, content pieces
- section: create new website section (text block, split layout, CTA banner, feature cards, FAQ)
- page: create standalone page (content article, visual landing page, data list)
- design: change colors, fonts, layouts, toggle section visibility
- asset: create social media graphics and images
- email: draft email marketing campaigns, newsletters, promotional emails
- invoice: create invoices with line items for client billing
- outreach: draft direct emails to clients — updates, follow-ups, proposals`;

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Returns 3 contextual follow-up suggestions based on what was just produced
function getSuggestions(department, task, fill, brand = {}) {
  const topic = (fill?.title || fill?.heading || fill?.hero_heading || task || 'our services').slice(0, 40);
  const biz = brand.name || 'the business';
  const svc = brand.services?.length ? brand.services[0] : 'our top service';

  const s = {
    blog: [
      `Write a follow-up post expanding on "${topic}"`,
      `Create a CTA section promoting this blog content`,
      `Draft an email campaign about this post`,
    ],
    copy: [
      `Write a blog post about ${topic}`,
      `Add an FAQ section addressing common questions`,
      `Email a client about updated services`,
    ],
    section: [
      `Write a blog post about "${topic}"`,
      `Create a cards section showcasing key features`,
      `Design a social graphic for this section`,
    ],
    page: [
      `Write a blog post to support this page`,
      `Create a CTA section promoting this page`,
      `Draft an invoice for ${svc}`,
    ],
    design: [
      `Switch to a modern color palette`,
      `Show the blog section on the homepage`,
      `Create a social graphic with the new brand colors`,
    ],
    asset: [
      `Create an Instagram story promoting ${svc}`,
      `Design a Facebook cover with ${biz} brand colors`,
      `Draft a blog post about visual branding`,
    ],
    email: [
      `Create a follow-up for subscribers who didn't open`,
      `Draft a monthly newsletter about ${topic}`,
      `Go to email marketing to send the campaign`,
    ],
    invoice: [
      `Email the client about the invoice`,
      `Go to bookkeeping to review invoices`,
      `Draft another invoice for a different service`,
    ],
    outreach: [
      `Draft a project status update for the client`,
      `Create an invoice for this client's services`,
      `Go to clients to send the email`,
    ],
  };
  return s[department] || s.copy;
}

/**
 * Build a dynamic suggestion pool based on the tenant's brand profile.
 * Falls back to generic suggestions when brand fields are empty.
 */
function buildSuggestionPool(brand = {}) {
  const pool = [];
  const services = brand.services || [];
  const biz = brand.name || 'the business';
  const audience = brand.targetAudience || 'local businesses';

  // Content creation — personalized if services exist
  if (services.length) {
    pool.push(`Write a blog post about the benefits of ${services[0]}`);
    if (services[1]) pool.push(`Create a landing page for ${services[1]}`);
    if (services[2]) pool.push(`Add an FAQ section about ${services[2]}`);
    pool.push(`Refresh the hero headline to highlight ${services[0]}`);
  } else {
    pool.push('Write a blog post about tips for your target audience');
    pool.push('Refresh the hero headline with something compelling');
    pool.push('Create a landing page for your top service');
    pool.push('Add an FAQ section about services and pricing');
  }
  pool.push('Write a CTA banner for booking a free consultation');
  pool.push('Add a cards section highlighting key features');

  // Email & outreach
  pool.push("Draft an email campaign for this month's newsletter");
  pool.push('Write a re-engagement email for inactive subscribers');
  pool.push('Draft a welcome email for new subscribers');
  pool.push('Email a client with a project status update');
  pool.push('Write a follow-up email for a recent proposal');

  // Business — personalized invoices
  if (services.length) {
    pool.push(`Draft an invoice for ${services[0]}`);
    if (services[1]) pool.push(`Create an invoice for ${services[1]}`);
  } else {
    pool.push('Draft an invoice for a recent project');
    pool.push('Create an invoice for monthly services');
  }

  // Design & assets
  pool.push(`Create an Instagram post promoting ${biz}`);
  pool.push(`Design a Facebook cover with ${biz} brand colors`);
  pool.push('Switch to a modern color palette');
  pool.push('Toggle blog section visibility on the homepage');

  // Navigation
  pool.push('Go to email marketing');
  pool.push('Open the meetings page');
  pool.push('Show me the client list');
  pool.push('Open bookkeeping');
  pool.push('Go to the asset center');

  return pool;
}

// Pick N random non-repeating suggestions from the pool
function getRandomSuggestions(n = 4, exclude = [], brand = {}) {
  const pool = buildSuggestionPool(brand);
  const available = pool.filter(s => !exclude.includes(s));
  const shuffled = available.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// ── Suggestions — GET /admin/master-agent/suggestions ────────────────────────
router.get('/suggestions', (req, res) => {
  res.json({ suggestions: getRandomSuggestions(4, [], req.tenant?.brand || {}) });
});

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

// ── Plan step — POST /admin/master-agent/plan ────────────────────────────────
// Fast: classifies request into single task or multi-step workflow.
router.post('/plan', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const fallback = { mode: 'single', title: 'Task', tasks: [{ id: 1, department: 'copy', task: message, label: message.slice(0, 40) }] };

  // Fast-path: detect obvious navigation requests without LLM
  const lower = message.toLowerCase().trim();
  const navPrefixes = ['go to ', 'open ', 'show me ', 'take me to ', 'navigate to ', 'show '];
  const isNav = navPrefixes.some(p => lower.startsWith(p)) || /^(check|view|see)\s+(the\s+)?/i.test(lower);
  if (isNav) {
    let navUrl = '/admin';
    for (const [key, val] of Object.entries(NAV_MAP)) {
      if (lower.includes(key)) { navUrl = val; break; }
    }
    const label = navUrl.split('/').filter(Boolean).pop() || 'dashboard';
    console.log(`[master-agent/plan] fast-nav → ${navUrl}`);
    return res.json({
      mode: 'single',
      title: `Go to ${label}`,
      tasks: [{ id: 1, department: 'navigate', task: message, label: `Open ${label}`, nav_target: label }],
    });
  }

  try {
    const raw = await callLLM([{ role: 'user', content: message }], WORKFLOW_PROMPT);
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) { console.log('[master-agent/plan] no JSON, using fallback'); return res.json(fallback); }

    const parsed = JSON.parse(m[0]);
    const plan = {
      mode: parsed.mode || 'single',
      title: parsed.title || message.slice(0, 50),
      tasks: (parsed.tasks || []).map((t, i) => ({
        id: i + 1,
        department: t.department || 'copy',
        task: t.task || message,
        label: t.label || (t.task || '').slice(0, 40) || `Task ${i + 1}`,
        section_type: t.section_type || null,
        page_type: t.page_type || null,
      })),
    };
    if (!plan.tasks.length) plan.tasks = fallback.tasks;

    console.log(`[master-agent/plan] mode=${plan.mode} tasks=${plan.tasks.length} title="${plan.title}"`);
    res.json(plan);
  } catch (err) {
    console.error('[master-agent/plan] error:', err);
    res.json(fallback);
  }
});

// ── Run single task — POST /admin/master-agent/run-task ──────────────────────
// Executes one workflow task: web search + LLM content generation.
router.post('/run-task', async (req, res) => {
  const { department, task, section_type, page_type } = req.body;
  if (!department || !task) return res.status(400).json({ error: 'department and task required' });

  try {
    // Navigate — no LLM needed, instant redirect
    if (department === 'navigate') {
      const taskLower = task.toLowerCase();
      let url = '/admin';
      for (const [key, val] of Object.entries(NAV_MAP)) {
        if (taskLower.includes(key)) { url = val; break; }
      }
      // Also check nav_target from routing
      if (req.body.nav_target) {
        const nt = req.body.nav_target.toLowerCase();
        for (const [key, val] of Object.entries(NAV_MAP)) {
          if (nt.includes(key) || key.includes(nt)) { url = val; break; }
        }
      }
      const label = url.split('/').pop() || 'dashboard';
      return res.json({
        message: `Opening ${label}…`,
        department: 'navigate',
        fill: {},
        action: { label: 'Go', url },
        navigate: url,
        suggestions: [],
      });
    }

    let searchResult = '';
    try { searchResult = await webSearch(task); } catch { /* non-fatal */ }
    const context = searchResult ? '\n\nResearch findings:\n' + searchResult : '';
    const brandCtx = await loadBrandContext(req.tenant, req.db);

    let toolName, toolArgs;
    if (department === 'blog') {
      toolName = 'write_blog_post';
      toolArgs = { topic: task, context, brandContext: brandCtx };
    } else if (department === 'section') {
      toolName = 'fill_section';
      toolArgs = { section_type: section_type || 'text', task, context, brandContext: brandCtx };
    } else if (department === 'page') {
      toolName = 'write_page';
      toolArgs = { title: task, page_type: page_type || 'content', task, context, brandContext: brandCtx };
    } else if (department === 'design') {
      toolName = 'update_design';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'asset') {
      toolName = 'generate_social_image';
      toolArgs = { prompt: task, context, brandContext: brandCtx };
    } else if (department === 'email') {
      toolName = 'write_campaign';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'invoice') {
      toolName = 'draft_invoice';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'outreach') {
      toolName = 'draft_client_email';
      toolArgs = { task, context, brandContext: brandCtx };
    } else {
      toolName = 'fill_site_copy';
      toolArgs = { task, section: 'all', context, brandContext: brandCtx };
    }

    const result = await runTool(toolName, toolArgs);
    const action = DEPT_ACTIONS[department] || DEPT_ACTIONS.copy;
    const suggestions = getSuggestions(department, task, result.fill, req.tenant?.brand);

    console.log(`[master-agent/run-task] dept=${department} tool=${toolName}`);

    res.json({
      message: result.message || 'Done.',
      department,
      fill: result.fill || {},
      suggestedBlocks: result.suggestedBlocks || null,
      tool_used: toolName,
      action,
      section_type: section_type || null,
      page_type: page_type || null,
      suggestions,
    });
  } catch (err) {
    console.error('[master-agent/run-task] error:', err);
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
    const brandCtx = await loadBrandContext(req.tenant, req.db);

    // Step 3: Run MCP tool
    let toolName, toolArgs;
    if (route.department === 'blog') {
      toolName = 'write_blog_post';
      toolArgs = { topic: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'section') {
      toolName = 'fill_section';
      toolArgs = { section_type: route.section_type || 'text', task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'page') {
      toolName = 'write_page';
      toolArgs = { title: route.task, page_type: route.page_type || 'content', task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'design') {
      toolName = 'update_design';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'asset') {
      toolName = 'generate_social_image';
      toolArgs = { prompt: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'email') {
      toolName = 'write_campaign';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'invoice') {
      toolName = 'draft_invoice';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'outreach') {
      toolName = 'draft_client_email';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else {
      toolName = 'fill_site_copy';
      toolArgs = { task: route.task, section: 'all', context, brandContext: brandCtx };
    }

    const result = await runTool(toolName, toolArgs);
    const action = DEPT_ACTIONS[route.department] || DEPT_ACTIONS.copy;
    const suggestions = getSuggestions(route.department, route.task, result.fill, req.tenant?.brand);

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
    const db = req.db;
    const now = new Date();
    let summary = '';
    let editUrl = '';

    if (department === 'copy') {
      const entries = Object.entries(fill).filter(([, v]) => v && String(v).trim());
      if (!entries.length) return res.json({ ok: false, message: 'No copy fields to save.' });

      const ops = entries.map(([key, value]) =>
        db.collection('copy').updateOne(
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
      const existing = await db.collection('blog').findOne({ slug });
      if (existing) slug = slug + '-' + Date.now();

      const result = await db.collection('blog').insertOne({
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

      const result = await db.collection('custom_sections').insertOne({
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
      const existing = await db.collection('pages').findOne({ slug });
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
        dataCollection: pageType === 'data-list' ? 'blog' : '',
        dataPageSize: 9,
        robotsMeta: 'index,follow',
        sitemapPriority: 0.5,
        sitemapChangefreq: 'monthly',
        canonicalUrl: '',
        ogImage: '',
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection('pages').insertOne(pageDoc);
      summary = `Created draft page: "${title}" (${pageType}).`;
      editUrl = `/admin/pages/${result.insertedId}/edit`;

    } else if (department === 'design') {
      const entries = Object.entries(fill).filter(([, v]) => v && String(v).trim());
      if (!entries.length) return res.json({ ok: false, message: 'No design fields to save.' });

      const ops = entries.map(([key, value]) =>
        db.collection('design').updateOne(
          { key },
          { $set: { key, value: String(value), updatedAt: now } },
          { upsert: true }
        )
      );
      await Promise.all(ops);
      summary = `Updated ${entries.length} design setting${entries.length > 1 ? 's' : ''}: ${entries.slice(0,3).map(([k]) => k.replace(/_/g,' ')).join(', ')}${entries.length > 3 ? '…' : ''}.`;
      editUrl = '/admin/design';

    } else if (department === 'asset') {
      // Server-side render the design and upload
      const design = {
        size: fill.size || 'ig-post',
        bgColor: fill.bgColor || '#F5F3EF',
        layers: fill.layers || [],
      };
      const title = fill.title || 'Social Asset';
      const SIZE_MAP = {
        'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
        'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
        'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
      };
      const [cw, ch] = SIZE_MAP[design.size] || [1080, 1080];
      const canvas = createCanvas(cw, ch);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = design.bgColor;
      ctx.fillRect(0, 0, cw, ch);
      for (const layer of design.layers) {
        ctx.save();
        ctx.globalAlpha = layer.opacity ?? 1;
        if (layer.type === 'rect') {
          if (layer.fill) { ctx.fillStyle = layer.fill; ctx.fillRect(layer.x||0, layer.y||0, layer.w||100, layer.h||100); }
          if (layer.stroke) { ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth||2; ctx.strokeRect(layer.x||0, layer.y||0, layer.w||100, layer.h||100); }
        } else if (layer.type === 'circle') {
          ctx.beginPath();
          ctx.ellipse((layer.x||0)+(layer.w||100)/2, (layer.y||0)+(layer.h||100)/2, (layer.w||100)/2, (layer.h||100)/2, 0, 0, Math.PI*2);
          if (layer.fill) { ctx.fillStyle = layer.fill; ctx.fill(); }
          if (layer.stroke) { ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth||2; ctx.stroke(); }
        } else if (layer.type === 'text' && layer.text) {
          const fs = layer.fontSize || 48;
          const fam = layer.fontFamily === 'serif' ? 'serif' : 'sans-serif';
          ctx.font = `${layer.bold?'bold ':''}${layer.italic?'italic ':''}${fs}px ${fam}`;
          ctx.fillStyle = layer.color || '#1C2B4A';
          ctx.textAlign = layer.align || 'center';
          ctx.textBaseline = 'top';
          const maxW = layer.w || cw - 40;
          const words = layer.text.split(' ');
          const lines = []; let line = '';
          for (const w of words) { const t = line ? line+' '+w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
          if (line) lines.push(line);
          let dx = layer.x||0; if (ctx.textAlign==='center') dx+=maxW/2; else if (ctx.textAlign==='right') dx+=maxW;
          lines.forEach((l,i) => ctx.fillText(l, dx, (layer.y||0)+i*fs*1.3));
        }
        ctx.restore();
      }
      const pngBuffer = canvas.toBuffer('image/png');

      // Upload to S3
      const folder = 'clients';
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const safeName = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
      const filename = `${ts}-${rand}-${safeName}.png`;
      const s3Prefix = req.tenant?.s3Prefix || 'default';
      const s3key = `${s3Prefix}/assets/${folder}/${filename}`;
      await s3Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: s3key, Body: pngBuffer, ContentType: 'image/png', ACL: 'public-read' }));
      const publicUrl = bucketUrl(s3key);

      const assetDoc = {
        filename, originalName: `${title}.png`, folders: [folder], folder,
        clientId: null, publicUrl, bucketKey: s3key,
        fileType: 'image', mimeType: 'image/png', size: pngBuffer.length,
        title, tags: ['social', 'ai-generated'],
        generatedFrom: { design, createdAt: now },
        uploadedAt: now,
      };
      const insertResult = await db.collection('assets').insertOne(assetDoc);
      summary = `Created social image: "${title}".`;
      editUrl = '/admin/assets';

    } else if (department === 'email') {
      const { subject, preheader, body, targetFunnel } = fill;
      if (!subject) return res.json({ ok: false, message: 'Campaign needs a subject line.' });

      const result = await db.collection('campaigns').insertOne({
        subject,
        preheader: preheader || '',
        body: body || '',
        targetFunnel: targetFunnel || 'all',
        targetTags: '',
        targetContactIds: null,
        status: 'draft',
        sentCount: 0,
        failedCount: 0,
        sentAt: null,
        parentCampaignId: null,
        parentSegment: null,
        createdAt: now,
        updatedAt: now,
      });
      summary = `Created draft campaign: "${subject}".`;
      editUrl = `/admin/email-marketing/campaigns/${result.insertedId}`;

    } else if (department === 'invoice') {
      const { title, lineItems, notes, dueInDays } = fill;
      if (!title) return res.json({ ok: false, message: 'Invoice needs a title.' });

      const items = (Array.isArray(lineItems) ? lineItems : []).map(li => ({
        description: li.description || 'Service',
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.unitPrice) || 0,
      }));
      const amount = calculateTotal(items);
      const invoiceNumber = await generateInvoiceNumber(db);
      const paymentToken = generatePaymentToken();
      const dueDate = new Date(now.getTime() + (Number(dueInDays) || 30) * 86400000);

      const result = await db.collection('invoices').insertOne({
        clientId: null,
        invoiceNumber,
        title,
        lineItems: items,
        amount,
        status: 'draft',
        dueDate,
        notes: notes || '',
        paymentToken,
        payments: [],
        discounts: [],
        refunds: [],
        emailSentAt: null,
        emailSentTo: null,
        recurring: { enabled: false },
        createdAt: now,
        updatedAt: now,
      });
      summary = `Created draft invoice ${invoiceNumber}: "${title}" — $${amount.toFixed(2)}.`;
      editUrl = '/admin/bookkeeping';

    } else if (department === 'outreach') {
      // Outreach emails need a client — save content for the user to send manually
      summary = `Drafted client email: "${fill.subject || 'Email'}". Go to a client page to send it.`;
      editUrl = '/admin/clients';

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
    name: 'Slab Agent MCP',
    version: '1.0.0',
    description: 'Slab agents — fill site copy, write blog posts, create sections, write pages',
    endpoint: '/admin/master-agent/mcp',
    transport: 'http',
    protocol: 'MCP 2024-11-05',
  });
});

export default router;
