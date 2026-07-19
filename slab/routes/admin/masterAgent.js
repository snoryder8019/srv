import express from 'express';
import { ObjectId } from 'mongodb';
import { createCanvas } from 'canvas';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';
import { callLLM, webSearch, runTool, handleMcpRequest, readToolUsage } from '../../plugins/agentMcp.js';
import { executeDepartment } from '../../plugins/agentRouter.js';
import { generateInvoiceNumber, generatePaymentToken, calculateTotal } from '../../plugins/invoiceHelpers.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { buildAssetReferenceIndex, annotateAssets, buildActivityMap } from '../../plugins/usageMap.js';

const router = express.Router();

const ROUTING_PROMPT = `You are a routing assistant for a business admin panel.
Analyze the user's request and determine which department should handle it.

Output ONLY raw JSON — no prose, no fences:
{
  "department": "blog" | "copy" | "section" | "page" | "theme" | "typography" | "visibility" | "design" | "asset" | "email" | "social" | "print" | "invoice" | "outreach" | "research" | "onboarding" | "navigate",
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
- theme: CHANGING site COLORS / palette (primary, accent, background) — "make it navy", "warmer palette", "change the colors"
- typography: CHANGING FONTS — heading or body typeface ("use a serif heading", "change the font")
- visibility: SHOWING or HIDING homepage SECTIONS ("hide the blog section", "show reviews on the homepage", "turn off portfolio")
- design: CHANGING LAYOUT style (portfolio/blog grid vs list vs masonry) or logo display (text/image/both)
- asset: CREATING a social-platform GRAPHIC/IMAGE (Instagram post image, Facebook cover, story graphic) — the rendered picture itself, NOT print pieces
- social: DRAFTING a social media POST (text/caption) for Facebook, Instagram, Threads, X, LinkedIn — what to actually say in the post
- print: A PRINT PIECE — flyer, poster, business card, sticker, brochure, menu, letterhead, postcard. Use this for anything printed, EVEN when the user says "design" (e.g. "design a flyer"). Drafts headline, body, offer, CTA.
- email: DRAFTING email marketing campaigns, newsletters, promotional blasts
- invoice: CREATING an invoice, billing a client, generating line items
- outreach: DRAFTING a direct email to a specific person/client — follow-ups, updates, proposals, check-ins. Use this when user says "email [name]", "send [name] a message", "write to [client]"
- research: RESEARCHING a prospective or existing client/business — competitor scan, web summary, onboarding knowledge base
- onboarding: BUILDING or SUGGESTING fields for a client intake / onboarding form
- navigate: GOING to a page, OPENING a section, SHOWING something. Use when user wants to go somewhere, not create something. Examples: "go to blog", "open meetings", "show clients", "take me to design", "check invoices", "open bookkeeping", "set up a meeting"

Key parsing rules:
- "email John" or "message the client" → outreach (draft an email TO someone)
- "email campaign" or "newsletter" → email (marketing blast to subscribers)
- "post on instagram", "write a tweet", "social post", "caption for facebook" → social (the words/caption of a social post)
- "instagram image", "facebook cover", "story graphic", "social graphic", "make an image for instagram" → asset (a social-platform picture, not the words)
- "flyer", "poster", "business card", "sticker", "brochure", "menu", "letterhead", "postcard", "print copy" → print
- "design a flyer/poster/card/sticker" → print (a print piece — route to print even though the verb is "design"); only route to design/asset when there is NO print format named
- "research [company]" / "look up [client]" / "what do you know about [business]" → research
- "build an intake form" / "suggest onboarding fields" / "client intake" → onboarding
- "go to email" or "open email marketing" → navigate
- "set up a meeting" or "schedule a meeting" → navigate (nav_target: meetings)
- "go to X" / "open X" / "show X" / "take me to X" → navigate
- "create X" / "write X" / "draft X" / "build X" → the relevant content department`;

const DEPT_ACTIONS = {
  blog:       { label: 'Open Blog Editor',     url: '/admin/blog/new',         color: '#2E4270' },
  copy:       { label: 'Go to Site Copy',      url: '/admin/copy',             color: '#1C2B4A' },
  section:    { label: 'Go to Sections',       url: '/admin/sections',         color: '#5B3E2B' },
  page:       { label: 'Open Page Editor',     url: '/admin/pages/new',        color: '#2E5B3E' },
  theme:      { label: 'Go to Design',         url: '/admin/design',           color: '#6B3FA0' },
  typography: { label: 'Go to Design',         url: '/admin/design',           color: '#6B3FA0' },
  visibility: { label: 'Go to Design',         url: '/admin/design',           color: '#6B3FA0' },
  design:     { label: 'Go to Design',         url: '/admin/design',           color: '#6B3FA0' },
  asset:      { label: 'Open Asset Center',    url: '/admin/assets',           color: '#C9A848' },
  social:     { label: 'Open Social',          url: '/admin/social',           color: '#3B5998' },
  print:      { label: 'Open Print Studio',    url: '/admin/print-studio',     color: '#B5651D' },
  email:      { label: 'Open Email Marketing', url: '/admin/email-marketing',  color: '#D4563A' },
  invoice:    { label: 'Open Bookkeeping',     url: '/admin/bookkeeping',      color: '#2B7A5B' },
  outreach:   { label: 'Open Clients',         url: '/admin/clients',          color: '#4A6FA5' },
  research:   { label: 'Open Clients',         url: '/admin/clients',          color: '#3A7B8C' },
  onboarding: { label: 'Open Onboarding',      url: '/admin/onboarding',       color: '#8C5A3A' },
  navigate:   { label: 'Go',                   url: '/admin',                  color: '#555'    },
};

const NAV_MAP = {
  dashboard: '/admin', home: '/admin',
  blog: '/admin/blog', 'new blog': '/admin/blog/new', 'blog editor': '/admin/blog/new',
  pages: '/admin/pages', 'new page': '/admin/pages/new', 'page editor': '/admin/pages/new',
  copy: '/admin/copy', 'site copy': '/admin/copy',
  design: '/admin/design', settings: '/admin/settings', 'design settings': '/admin/design',
  assets: '/admin/assets', 'asset center': '/admin/assets',
  clients: '/admin/clients', 'client list': '/admin/clients',
  meetings: '/admin/meetings', 'new meeting': '/admin/meetings',
  bookkeeping: '/admin/bookkeeping', invoices: '/admin/bookkeeping',
  'email marketing': '/admin/email-marketing', campaigns: '/admin/email-marketing',
  social: '/admin/social', 'social media': '/admin/social', posts: '/admin/social',
  'print studio': '/admin/print-studio', 'print-studio': '/admin/print-studio', print: '/admin/print-studio',
  flyers: '/admin/print-studio', 'business cards': '/admin/print-studio',
  portfolio: '/admin/portfolio', 'new portfolio': '/admin/portfolio/new',
  sections: '/admin/sections',
  users: '/admin/users',
  profile: '/admin/profile',
  analytics: '/admin/analytics', reports: '/admin/analytics',
  onboarding: '/admin/onboarding', 'intake form': '/admin/onboarding', forms: '/admin/onboarding',
  notes: '/admin/notes', shorts: '/admin/notes', rants: '/admin/notes',
  inquiries: '/admin/inquiries', leads: '/admin/inquiries',
  tickets: '/admin/tickets', support: '/admin/tickets',
  tutorials: '/admin/tutorials', docs: '/admin/docs', 'brand builder': '/admin/brand-builder',
  templates: '/admin/templates', 'template store': '/admin/template-store',
  'qr codes': '/admin/qr-codes', qrcodes: '/admin/qr-codes', qr: '/admin/qr-codes',
  scanner: '/admin/scanner',
  calculators: '/admin/calculators',
  super: '/admin/super', 'super admin': '/admin/super',
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
      "department": "blog" | "copy" | "section" | "page" | "theme" | "typography" | "visibility" | "design" | "asset" | "social" | "print" | "email" | "invoice" | "outreach" | "research" | "onboarding",
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
- theme: change site colors / palette (primary, accent, background)
- typography: change heading or body fonts
- visibility: show or hide homepage sections
- design: change layout style (grid/list/masonry) or logo display
- asset: create a social-platform graphic/image (the rendered picture itself), NOT print pieces
- social: draft the text/caption of a social media post (Facebook, Instagram, Threads, X, LinkedIn)
- print: a print piece — flyer, poster, business card, sticker, brochure, menu, postcard (route here even if the user says "design")
- email: draft email marketing campaigns, newsletters, promotional emails
- invoice: create invoices with line items for client billing
- outreach: draft direct emails to clients — updates, follow-ups, proposals
- research: web-research a prospective client, summarize their business, suggest services
- onboarding: design fields for a client intake/onboarding form`;

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
    theme: [
      `Pair these colors with a matching font`,
      `Create a social graphic with the new brand colors`,
      `Adjust the accent color to pop more`,
    ],
    typography: [
      `Refresh the color palette to match these fonts`,
      `Preview the homepage with the new type`,
      `Pick a heading font with more character`,
    ],
    visibility: [
      `Reorder the homepage sections`,
      `Refresh the copy in the sections you kept`,
      `Switch to a modern color palette`,
    ],
    asset: [
      `Create an Instagram story promoting ${svc}`,
      `Design a Facebook cover with ${biz} brand colors`,
      `Draft a blog post about visual branding`,
    ],
    social: [
      `Design a matching social graphic for this post`,
      `Write a follow-up post about ${svc}`,
      `Go to social to schedule it`,
    ],
    print: [
      `Design a flyer to match this campaign`,
      `Create a QR code linking to this offer`,
      `Go to print studio to lay it out`,
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
    } else if (department === 'theme') {
      toolName = 'update_theme';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'typography') {
      toolName = 'update_typography';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'visibility') {
      toolName = 'set_section_visibility';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'design') {
      toolName = 'update_design';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'asset') {
      toolName = 'generate_social_image';
      toolArgs = { prompt: task, context, brandContext: brandCtx };
    } else if (department === 'social') {
      toolName = 'write_social_post';
      toolArgs = { task, platforms: req.body.platforms, context, brandContext: brandCtx };
    } else if (department === 'print') {
      toolName = 'write_print_copy';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'email') {
      toolName = 'write_campaign';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'invoice') {
      toolName = 'draft_invoice';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'outreach') {
      toolName = 'draft_client_email';
      toolArgs = { task, context, brandContext: brandCtx };
    } else if (department === 'research') {
      toolName = 'research_client';
      toolArgs = { prompt: task, notes: context, brandContext: brandCtx };
    } else if (department === 'onboarding') {
      toolName = 'suggest_onboarding_fields';
      toolArgs = { prompt: task, brandContext: brandCtx };
    } else {
      toolName = 'fill_site_copy';
      toolArgs = { task, section: 'all', context, brandContext: brandCtx };
    }

    const result = await runTool(toolName, toolArgs, { db: req.db, tenant: req.tenant });
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
    } else if (route.department === 'theme') {
      toolName = 'update_theme';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'typography') {
      toolName = 'update_typography';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'visibility') {
      toolName = 'set_section_visibility';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'design') {
      toolName = 'update_design';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'asset') {
      toolName = 'generate_social_image';
      toolArgs = { prompt: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'social') {
      toolName = 'write_social_post';
      toolArgs = { task: route.task, platforms: req.body.platforms, context, brandContext: brandCtx };
    } else if (route.department === 'print') {
      toolName = 'write_print_copy';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'email') {
      toolName = 'write_campaign';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'invoice') {
      toolName = 'draft_invoice';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'outreach') {
      toolName = 'draft_client_email';
      toolArgs = { task: route.task, context, brandContext: brandCtx };
    } else if (route.department === 'research') {
      toolName = 'research_client';
      toolArgs = { prompt: route.task, notes: context, brandContext: brandCtx };
    } else if (route.department === 'onboarding') {
      toolName = 'suggest_onboarding_fields';
      toolArgs = { prompt: route.task, brandContext: brandCtx };
    } else {
      toolName = 'fill_site_copy';
      toolArgs = { task: route.task, section: 'all', context, brandContext: brandCtx };
    }

    const result = await runTool(toolName, toolArgs, { db: req.db, tenant: req.tenant });
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
// Thin wrapper — the per-department writers live in plugins/agentRouter.js
// (executeDepartment) so chat's Apply and this dashboard route share ONE committer.
router.post('/execute', async (req, res) => {
  const { department, fill, section_type, page_type, label } = req.body;
  if (!department || !fill || typeof fill !== 'object') {
    return res.status(400).json({ error: 'department and fill required' });
  }
  try {
    const result = await executeDepartment(req.db, req.tenant, {
      department, fill, section_type, page_type, label,
      userEmail: req.adminUser?.email || null,
    });
    res.json(result);
  } catch (err) {
    console.error('[master-agent/execute] error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ── Cross-agent activity digest — GET /admin/master-agent/digest?range=day|week
// Aggregates new items and alerts across every sub-agent scope so the dashboard
// agent can report on what every other agent has produced + what needs attention.
router.get('/digest', async (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'day';
  const days = range === 'week' ? 7 : 1;
  const since = new Date(Date.now() - days * 86400000);

  try {
    const db = req.db;
    const c = (name) => db.collection(name);

    const safe = (p) => p.catch(() => 0);
    const safeArr = (p) => p.catch(() => []);
    const cd = (name, q) => safe(c(name).countDocuments(q));

    const [
      blogNew, pagesNew, sectionsNew, portfolioNew,
      assetsNew, campaignsNew, campaignsSent,
      invoicesNew, invoicesPaid, invoicesOverdue,
      clientsNew, contactsNew, meetingsNew,
      inquiriesNew, ticketsOpen, ticketsNew,
      copyEdits, designEdits,
      onboardingFormsNew, onboardingResponses,
      scanLatest,
      emailOpens, emailClicks, emailBounces, emailUnsubs,
      socialNew, socialPublished, socialScheduledUpcoming,
      printNew, qrNew, calculatorsNew,
    ] = await Promise.all([
      cd('blog',           { createdAt: { $gte: since } }),
      cd('pages',          { createdAt: { $gte: since } }),
      cd('custom_sections',{ createdAt: { $gte: since } }),
      cd('portfolio',      { createdAt: { $gte: since } }),
      cd('assets',         { uploadedAt: { $gte: since } }),
      cd('campaigns',      { createdAt: { $gte: since } }),
      cd('campaigns',      { sentAt:    { $gte: since } }),
      cd('invoices',       { createdAt: { $gte: since } }),
      cd('invoices',       { status: 'paid', updatedAt: { $gte: since } }),
      cd('invoices',       { status: { $in: ['overdue'] } }),
      cd('clients',        { createdAt: { $gte: since } }),
      cd('contacts',       { createdAt: { $gte: since } }),
      cd('meetings',       { createdAt: { $gte: since } }),
      cd('inquiries',      { createdAt: { $gte: since } }),
      cd('tickets',        { status: { $in: ['open', 'in-progress', 'escalated'] } }),
      cd('tickets',        { createdAt: { $gte: since } }),
      cd('copy',           { updatedAt: { $gte: since } }),
      cd('design',         { updatedAt: { $gte: since } }),
      cd('onboarding_forms', { createdAt: { $gte: since } }),
      cd('onboarding_responses', { createdAt: { $gte: since } }),
      safeArr(c('scan_results').find({}).sort({ 'summary.scannedAt': -1 }).limit(1).toArray()),
      cd('campaign_events', { type: 'open',   ts: { $gte: since } }),
      cd('campaign_events', { type: 'click',  ts: { $gte: since } }),
      cd('campaign_events', { type: 'bounce', ts: { $gte: since } }),
      cd('campaign_events', { type: 'unsubscribe', ts: { $gte: since } }),
      cd('social_posts',    { createdAt: { $gte: since } }),
      cd('social_posts',    { status: 'published', publishedAt: { $gte: since } }),
      cd('social_posts',    { status: 'scheduled', scheduledAt: { $gte: new Date() } }),
      cd('print_materials', { createdAt: { $gte: since } }),
      cd('qr_links',        { createdAt: { $gte: since } }),
      cd('calculators',     { createdAt: { $gte: since } }),
    ]);

    const scanCounts = scanLatest?.[0]?.summary?.counts || {};
    const scanCritHigh = (scanCounts.critical || 0) + (scanCounts.high || 0);

    // Build per-agent activity rows so the UI can render "what each agent did"
    const agents = [
      { key: 'blog',       label: 'Blog',        count: blogNew,    url: '/admin/blog' },
      { key: 'pages',      label: 'Pages',       count: pagesNew,   url: '/admin/pages' },
      { key: 'sections',   label: 'Sections',    count: sectionsNew,url: '/admin/sections' },
      { key: 'copy',       label: 'Site Copy',   count: copyEdits,  url: '/admin/copy' },
      { key: 'design',     label: 'Design',      count: designEdits,url: '/admin/design' },
      { key: 'assets',     label: 'Assets',      count: assetsNew,  url: '/admin/assets' },
      { key: 'email',      label: 'Email Campaigns', count: campaignsNew, url: '/admin/email-marketing' },
      { key: 'social',     label: 'Social Posts', count: socialNew,  url: '/admin/social' },
      { key: 'print',      label: 'Print Studio', count: printNew,   url: '/admin/print-studio' },
      { key: 'qr',         label: 'QR Codes',     count: qrNew,      url: '/admin/qr-codes' },
      { key: 'calculators',label: 'Calculators',  count: calculatorsNew, url: '/admin/calculators' },
      { key: 'invoices',   label: 'Invoices',    count: invoicesNew, url: '/admin/bookkeeping' },
      { key: 'clients',    label: 'Clients',     count: clientsNew, url: '/admin/clients' },
      { key: 'contacts',   label: 'Contacts',    count: contactsNew,url: '/admin/email-marketing' },
      { key: 'inquiries',  label: 'Inquiries',   count: inquiriesNew,url: '/admin/inquiries' },
      { key: 'meetings',   label: 'Meetings',    count: meetingsNew, url: '/admin/meetings' },
      { key: 'onboarding', label: 'Onboarding Forms', count: onboardingFormsNew, url: '/admin/onboarding' },
      { key: 'portfolio',  label: 'Portfolio',   count: portfolioNew, url: '/admin/portfolio' },
    ];

    // Alerts — surface things that need the human's attention now
    const alerts = [];
    if (ticketsOpen > 0)      alerts.push({ level: 'warn',   label: `${ticketsOpen} open support ticket${ticketsOpen > 1 ? 's' : ''}`, url: '/admin/tickets' });
    if (invoicesOverdue > 0)  alerts.push({ level: 'danger', label: `${invoicesOverdue} overdue invoice${invoicesOverdue > 1 ? 's' : ''}`, url: '/admin/bookkeeping' });
    if (scanCritHigh > 0)     alerts.push({ level: 'danger', label: `${scanCritHigh} critical/high scan issue${scanCritHigh > 1 ? 's' : ''}`, url: '/admin/scanner' });
    if (emailBounces > 0)     alerts.push({ level: 'warn',   label: `${emailBounces} email bounce${emailBounces > 1 ? 's' : ''}`, url: '/admin/email-marketing' });
    if (emailUnsubs > 5)      alerts.push({ level: 'warn',   label: `${emailUnsubs} unsubscribes this ${range}`, url: '/admin/email-marketing' });
    if (socialScheduledUpcoming > 0) alerts.push({ level: 'info', label: `${socialScheduledUpcoming} social post${socialScheduledUpcoming > 1 ? 's' : ''} scheduled to go out`, url: '/admin/social?tab=scheduled' });

    res.json({
      range,
      since: since.toISOString(),
      agents,
      analytics: {
        invoicesPaid, invoicesOverdue,
        campaignsSent, emailOpens, emailClicks, emailBounces, emailUnsubs,
        ticketsNew, ticketsOpen,
        onboardingResponses,
        socialPublished, socialScheduledUpcoming,
      },
      alerts,
    });
  } catch (err) {
    console.error('[master-agent/digest] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Connection / cleanup map — GET /admin/master-agent/usage ─────────────────
// Cross-module "what's in active use vs. ready for cleanup" report. Powers the
// asset/draft/campaign cleanup flags and lets the dashboard agent advise on
// what is safe to remove. Scans every collection that links an asset, so it is
// heavier than /digest — call it on demand, not on every page load.
router.get('/usage', async (req, res) => {
  try {
    const db = req.db;
    const graceDays = Math.max(0, parseInt(req.query.graceDays, 10) || 7);
    const staleDays = Math.max(1, parseInt(req.query.staleDays, 10) || 30);

    const [refIdx, allAssets, activity] = await Promise.all([
      buildAssetReferenceIndex(db),
      db.collection('assets').find({}).project({ publicUrl: 1, bucketKey: 1, title: 1, originalName: 1, folder: 1, fileType: 1, size: 1, uploadedAt: 1 }).toArray(),
      buildActivityMap(db, { staleDays }),
    ]);

    const annotated = annotateAssets(allAssets, refIdx, { graceDays });
    const cleanupAssets = annotated.filter(a => a.cleanup);
    const reclaimableBytes = cleanupAssets.reduce((s, a) => s + (Number(a.size) || 0), 0);

    res.json({
      assets: {
        total: allAssets.length,
        inUse: annotated.filter(a => a.inUse).length,
        unused: cleanupAssets.length,
        reclaimableBytes,
        graceDays,
        candidates: cleanupAssets
          .sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))
          .slice(0, 25)
          .map(a => ({ id: String(a._id), title: a.title || a.originalName, folder: a.folder, fileType: a.fileType, size: a.size || 0, uploadedAt: a.uploadedAt })),
      },
      activity,
    });
  } catch (err) {
    console.error('[master-agent/usage] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Tool-usage scoreboard — GET /admin/master-agent/tool-usage ───────────────
// The MCP tool-usage counter. Per-tenant by default (this site's own agent tool
// usage). Superadmins may pass ?scope=global for the cross-tenant platform
// roll-up — "where are users actually spending agent calls" — which is what
// drives tool right-sizing (split the heavy ones, cut the dead ones, add where
// there's demand). Reads the aggregated counters written by runTool().
router.get('/tool-usage', async (req, res) => {
  try {
    const wantGlobal = req.query.scope === 'global' && !!req.isSuperAdmin;
    const tenantKey = wantGlobal
      ? null
      : (req.tenant?.db || req.tenant?.s3Prefix || (req.tenant?._id ? String(req.tenant._id) : null));
    const tools = await readToolUsage({ tenantKey });
    const totals = tools.reduce((a, t) => {
      a.calls += t.calls; a.ok += t.ok; a.err += t.err; return a;
    }, { calls: 0, ok: 0, err: 0 });
    totals.successPct = totals.calls ? Math.round((totals.ok / totals.calls) * 100) : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      scope: wantGlobal ? 'global' : 'tenant',
      canGlobal: !!req.isSuperAdmin,
      totals,
      tools,
    });
  } catch (err) {
    console.error('[master-agent/tool-usage] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Welcome briefing — GET /admin/master-agent/briefing ──────────────────────
// LLM-generated 2–3 sentence personal welcome that surfaces what actually needs
// the tenant's attention RIGHT NOW: new inquiries, pending booking requests,
// invoices paid, invoices past due. Returns a plain string the dashboard
// renders in place of the static greeting.
router.get('/briefing', async (req, res) => {
  try {
    const db = req.db;
    const c = (name) => db.collection(name);
    const now = Date.now();

    // "Since last login" anchor — the admin JWT is minted at login (8h cookie),
    // so its `iat` claim is effectively the last-login time and stays stable for
    // the whole session. A brand-new session (just logged in) has nothing to
    // recap yet, so we widen to the last 24h and label it "today".
    const iatMs = req.adminUser?.iat ? req.adminUser.iat * 1000 : 0;
    const freshLogin = !iatMs || (now - iatMs) < 30 * 60 * 1000;
    const activitySince = freshLogin ? new Date(now - 24 * 60 * 60 * 1000) : new Date(iatMs);
    const weekSince = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const windowLabel = freshLogin ? 'in the last day' : 'since you were last here';
    const safe = (p) => p.catch(() => 0);
    const safeArr = (p) => p.catch(() => []);
    const cd = (name, q) => safe(c(name).countDocuments(q));
    const sinceQ = { $gte: activitySince };

    const [
      // ── Needs attention now (current state, not time-bound) ──
      pendingBookings,
      bookingsNeedConfirm,
      invoicesOverdueDocs,
      ticketsOpen,
      socialScheduledUpcoming,
      // ── What happened since last login (every agent's output) ──
      inquiriesNew,
      invoicesPaidSince, invoicesPaidWeek,
      clientsNew, contactsNew, meetingsNew,
      blogNew, pagesNew, sectionsNew, copyEdits, designEdits, assetsNew,
      socialPublished, printNew, campaignsSent,
    ] = await Promise.all([
      safeArr(c('bookings').find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10)
        .project({ name: 1, email: 1, startAt: 1, createdAt: 1, status: 1 }).toArray()),
      cd('bookings', { status: 'pending' }),
      safeArr(c('invoices').find({ status: 'overdue' }).sort({ dueDate: 1 }).limit(10)
        .project({ amount: 1, clientName: 1, number: 1, dueDate: 1 }).toArray()),
      cd('tickets', { status: { $in: ['open', 'in-progress', 'escalated'] } }),
      cd('social_posts', { status: 'scheduled', scheduledAt: { $gte: new Date(now) } }),
      cd('inquiries', { createdAt: sinceQ }),
      cd('invoices', { status: 'paid', updatedAt: sinceQ }),
      cd('invoices', { status: 'paid', updatedAt: { $gte: weekSince } }),
      cd('clients', { createdAt: sinceQ }),
      cd('contacts', { createdAt: sinceQ }),
      cd('meetings', { createdAt: sinceQ }),
      cd('blog', { createdAt: sinceQ }),
      cd('pages', { createdAt: sinceQ }),
      cd('custom_sections', { createdAt: sinceQ }),
      cd('copy', { updatedAt: sinceQ }),
      cd('design', { updatedAt: sinceQ }),
      cd('assets', { uploadedAt: sinceQ }),
      cd('social_posts', { status: 'published', publishedAt: sinceQ }),
      cd('print_materials', { createdAt: sinceQ }),
      cd('campaigns', { sentAt: sinceQ }),
    ]);

    const overdueCount = invoicesOverdueDocs.length;
    const overdueAmount = invoicesOverdueDocs.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const contentCreated = blogNew + pagesNew + sectionsNew;
    const siteEdits = copyEdits + designEdits;
    const audienceNew = clientsNew + contactsNew;

    // Build structured facts the LLM will paraphrase. Two buckets: what needs
    // the owner's attention right now, and a recap of everything the agents +
    // the business produced since the last login.
    const firstName = (req.adminUser?.displayName || req.adminUser?.email || '').split(/[\s@]/)[0] || '';
    const brandName = req.tenant?.brand?.name || '';
    const facts = {
      tenant: brandName,
      user: firstName,
      window: windowLabel,
      needsAttention: {
        overdueInvoices: overdueCount,
        overdueAmount,
        bookingsPendingConfirm: bookingsNeedConfirm,
        bookingsPreview: pendingBookings.slice(0, 3).map(b => ({
          name: b.name,
          when: b.startAt ? new Date(b.startAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null,
        })),
        openTickets: ticketsOpen,
        socialPostsScheduled: socialScheduledUpcoming,
      },
      sinceLastLogin: {
        newInquiries: inquiriesNew,
        invoicesPaid: invoicesPaidSince,
        invoicesPaidThisWeek: invoicesPaidWeek,
        newClients: clientsNew,
        newContacts: contactsNew,
        newMeetings: meetingsNew,
        blogPostsCreated: blogNew,
        pagesCreated: pagesNew,
        sectionsCreated: sectionsNew,
        copyFieldsEdited: copyEdits,
        designChanges: designEdits,
        assetsAdded: assetsNew,
        socialPostsPublished: socialPublished,
        printMaterialsCreated: printNew,
        emailCampaignsSent: campaignsSent,
      },
    };

    // Build deterministic bullets + suggested action chips from the facts.
    // These accompany the LLM briefing so the dashboard can show a scannable
    // list and one-click links to wherever the work actually lives.
    const bullets = [];
    const actions = [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

    // ── Needs-attention bullets (loudest first) ──
    if (overdueCount) {
      bullets.push(`${plural(overdueCount, 'overdue invoice')}${overdueAmount ? ` — $${overdueAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding` : ''}`);
      actions.push({ label: 'Chase overdue invoices', href: '/admin/bookkeeping', icon: '💰' });
    }
    if (bookingsNeedConfirm) {
      const previewName = pendingBookings[0]?.name;
      bullets.push(`${plural(bookingsNeedConfirm, 'booking')} waiting for confirmation${previewName ? ` (${previewName} first up)` : ''}`);
      actions.push({ label: 'Confirm bookings', href: '/admin/meetings', icon: '📅' });
    }
    if (inquiriesNew) {
      bullets.push(`${plural(inquiriesNew, 'new inquiry', 'new inquiries')} ${windowLabel}`);
      actions.push({ label: 'Reply to inquiries', href: '/admin/inquiries', icon: '✉' });
    }
    if (ticketsOpen) {
      bullets.push(`${plural(ticketsOpen, 'open support ticket')}`);
      actions.push({ label: 'Review tickets', href: '/admin/tickets', icon: '🎫' });
    }
    if (socialScheduledUpcoming) {
      bullets.push(`${plural(socialScheduledUpcoming, 'social post')} scheduled to go out`);
    }

    // ── "Since last login" recap bullets (what the agents + business did) ──
    if (invoicesPaidSince) bullets.push(`${plural(invoicesPaidSince, 'invoice')} paid ${windowLabel} — nice`);
    else if (invoicesPaidWeek) bullets.push(`${plural(invoicesPaidWeek, 'invoice')} paid this week`);
    if (contentCreated) {
      const segs = [];
      if (blogNew) segs.push(plural(blogNew, 'blog post'));
      if (pagesNew) segs.push(plural(pagesNew, 'page'));
      if (sectionsNew) segs.push(plural(sectionsNew, 'section'));
      bullets.push(`Content agents added ${segs.join(', ')}`);
    }
    if (socialPublished) bullets.push(`${plural(socialPublished, 'social post')} published`);
    if (printNew) bullets.push(`${plural(printNew, 'print campaign')} drafted`);
    if (campaignsSent) bullets.push(`${plural(campaignsSent, 'email campaign')} sent`);
    if (assetsNew) bullets.push(`${plural(assetsNew, 'asset')} added`);
    if (siteEdits) bullets.push(`${plural(siteEdits, 'site copy/design edit')} applied`);
    if (audienceNew) bullets.push(`${plural(audienceNew, 'new contact/client', 'new contacts/clients')}`);

    // Always offer at least a few generative shortcuts so the agent stays
    // useful on quiet days. `prompt` chips drop text into the chat input.
    const SUGGESTED = [
      { label: 'Draft a blog post', prompt: 'Write a new blog post about ', icon: '✦' },
      { label: 'Refresh homepage copy', prompt: 'Rewrite the homepage hero section to feel more current', icon: '✦' },
      { label: 'Tune up site design', href: '/admin/design', icon: '🎨' },
      { label: 'Add a portfolio item', href: '/admin/portfolio/new', icon: '📁' },
    ];
    for (const s of SUGGESTED) {
      if (actions.length >= 5) break;
      if (!actions.some(a => a.label === s.label)) actions.push(s);
    }

    // Empty-state path: skip the LLM entirely. Save tokens + latency when
    // nothing happened and nothing needs attention.
    const attentionTotal = overdueCount + bookingsNeedConfirm + ticketsOpen;
    const activityTotal = inquiriesNew + invoicesPaidSince + contentCreated + siteEdits +
      assetsNew + socialPublished + printNew + campaignsSent + audienceNew + meetingsNew;
    if (!attentionTotal && !activityTotal) {
      const greeting = firstName ? `Good to see you, ${firstName}.` : 'Welcome back.';
      return res.json({
        briefing: `${greeting} Nothing new ${windowLabel} and nothing needs attention — clear runway. Tell me what to work on and I'll coordinate the agents.`,
        bullets: ['No new inquiries or bookings', 'No overdue invoices or open tickets', 'No new agent activity'],
        actions,
        facts,
      });
    }

    const systemPrompt = `You are the admin dashboard concierge for a small business owner. You coordinate a team of AI agents (blog, copy, sections, pages, design, assets, social, print, email, invoices, clients) and report back on their work.

Write a 3–4 sentence personal welcome briefing from the JSON facts below.

Tone: warm, direct, peer-to-peer. Address the user by first name if provided.
Cover ONLY what the facts say is non-zero — never invent numbers, never pad, never list every metric.

Structure the briefing in two beats:
1. RECAP — what happened ${windowLabel} (the "sinceLastLogin" facts): content the agents created, social posts published, campaigns sent, invoices paid, new clients/contacts/meetings. Group it naturally; don't recite every field.
2. ATTENTION — what needs the owner now (the "needsAttention" facts), loudest first: overdue invoices (name count + dollar total), bookings awaiting confirmation, new inquiries, open tickets, scheduled social posts.

If both buckets are empty for a beat, skip that beat. If bookingsPreview has a name you may name one (e.g. "Sarah's booking is waiting") — never more than one.
End with a short forward-looking nudge (e.g. "Want to start with the overdue chase?" or "I can have the blog agent draft a follow-up.").

Output ONLY the briefing text — no JSON, no preamble, no "Here is your briefing", no quotes.`;

    let briefing = '';
    try {
      const raw = await callLLM(
        [{ role: 'user', content: `Facts:\n${JSON.stringify(facts, null, 2)}` }],
        systemPrompt,
        20000,
      );
      briefing = (raw || '').trim().replace(/^["']|["']$/g, '');
    } catch (e) {
      console.warn('[master-agent/briefing] LLM failed, falling back:', e.message);
    }

    // Deterministic fallback if the LLM is slow / unavailable.
    if (!briefing) {
      const recap = [];
      if (contentCreated) recap.push(`${plural(contentCreated, 'new content piece')} created`);
      if (socialPublished) recap.push(`${plural(socialPublished, 'social post')} published`);
      if (campaignsSent) recap.push(`${plural(campaignsSent, 'campaign')} sent`);
      if (invoicesPaidSince) recap.push(`${plural(invoicesPaidSince, 'invoice')} paid`);
      if (audienceNew) recap.push(`${plural(audienceNew, 'new contact')}`);

      const attention = [];
      if (overdueCount) attention.push(`${plural(overdueCount, 'overdue invoice')}${overdueAmount ? ` ($${overdueAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''} to chase`);
      if (bookingsNeedConfirm) attention.push(`${plural(bookingsNeedConfirm, 'booking')} to confirm`);
      if (inquiriesNew) attention.push(`${plural(inquiriesNew, 'new inquiry', 'new inquiries')}`);
      if (ticketsOpen) attention.push(`${plural(ticketsOpen, 'open ticket')}`);

      const greeting = firstName ? `Hi ${firstName} — ` : '';
      const brandStr = brandName ? ` at ${brandName}` : '';
      const recapStr = recap.length ? `${windowLabel === 'in the last day' ? 'Today' : 'Since you were last here'}${brandStr}: ${recap.join(', ')}. ` : '';
      const attnStr = attention.length ? `Needs you: ${attention.join(', ')}. ` : '';
      briefing = `${greeting}${recapStr}${attnStr}Where do you want to start?`;
    }

    res.json({ briefing, bullets, actions, facts });
  } catch (err) {
    console.error('[master-agent/briefing] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MCP HTTP endpoint — POST /admin/master-agent/mcp ─────────────────────────
// Threads the caller's tenant scope + brand context so stateful social tools can
// reach the right DB and every tool produces on-brand output. Brand context is
// loaded only for tool calls (not initialize/list) to keep those cheap.
router.post('/mcp', async (req, res) => {
  try {
    let ctx = { db: req.db, tenant: req.tenant };
    if (req.body?.method === 'tools/call' && req.tenant && req.db) {
      try { ctx.brandContext = await loadBrandContext(req.tenant, req.db); } catch { /* on-brand best-effort */ }
    }
    const response = await handleMcpRequest(req.body, ctx);
    if (response === null) return res.status(202).end();
    res.json(response);
  } catch (err) {
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: err.message } });
  }
});

// ── Response feedback — POST /admin/master-agent/feedback ────────────────────
// Thumbs up/down on an agent reply. A down vote may carry a comment. Stored in
// `agent_feedback` (tenant db) for later review of where the agent fell short.
router.post('/feedback', async (req, res) => {
  const { rating, comment, message, prompt, department } = req.body || {};
  if (rating !== 'up' && rating !== 'down') {
    return res.status(400).json({ error: 'rating must be "up" or "down"' });
  }
  try {
    await req.db.collection('agent_feedback').insertOne({
      rating,
      comment: comment ? String(comment).slice(0, 2000) : null,
      message: message ? String(message).slice(0, 4000) : null,
      prompt: prompt ? String(prompt).slice(0, 2000) : null,
      department: department || null,
      userEmail: req.adminUser?.email || null,
      createdAt: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
