/**
 * Slab — Shared agent brain (routing + department execution)
 * ─────────────────────────────────────────────────────────────────────────────
 * The master agent's intelligence (routing, the department→tool table, the
 * suggestion + nav maps) lived inline inside routes/admin/masterAgent.js, which
 * meant no other surface could reuse it. This module extracts the GENERATIVE half
 * so both consumers share one brain:
 *
 *   • routes/admin/masterAgent.js  — HTTP request/response for the dashboard
 *   • plugins/chat.js (dispatchAgent) — persistent socket threads
 *
 * "Design-via-chat" then needs NO new design agent: a chat thread just routes
 * through routeMessage() → runDepartment() and the 'design' department reuses the
 * existing update_design tool verbatim.
 *
 * NOTE: the COMMIT half (the per-department DB writers in masterAgent's /execute
 * handler — canvas render + S3 upload for assets, invoice helpers, etc.) is NOT
 * lifted here yet; it's large and touches several plugins. It should be extracted
 * next as executeDepartment(db, tenant, {department, fill, ...}) so chat's
 * "apply" affordance and the HTTP /execute route share one writer. Until then,
 * chat proposes changes (meta.fill) and the existing /execute route commits them.
 */

import { callLLM, webSearch, runTool } from './agentMcp.js';
import { loadBrandContext } from './brandContext.js';
import { assertDepartmentAllowed } from './agentAudience.js';
import { getAgentConfig, getTenantDefault } from './agentRegistry.js';

// ── Routing (mirrors ROUTING_PROMPT in masterAgent.js) ───────────────────────
export const ROUTING_PROMPT = `You are a routing assistant for a business admin panel.
Analyze the user's request and determine which department should handle it.

Output ONLY raw JSON — no prose, no fences:
{
  "department": "blog" | "copy" | "section" | "page" | "theme" | "typography" | "visibility" | "design" | "asset" | "email" | "social" | "print" | "invoice" | "outreach" | "research" | "onboarding" | "navigate" | "assist",
  "task": "concise task description for the specialist",
  "section_type": "text" | "split" | "cta" | "cards" | "faq",
  "page_type": "content" | "landing" | "data-list",
  "nav_target": "page name for navigate department"
}

Department guide:
- blog: writing/creating articles or blog posts
- copy: updating site headline/hero/services/about copy
- section: creating a website section (text, split, cta, cards, faq)
- page: creating a standalone page (content, landing, data-list)
- theme: changing site COLORS / palette (primary, accent, background)
- typography: changing FONTS (heading or body typeface)
- visibility: showing or hiding homepage SECTIONS (hero, services, portfolio, about, blog, etc.)
- design: changing LAYOUT style (portfolio/blog grid vs list) or logo display
- asset: creating a social-platform graphic/image (the picture itself)
- social: drafting the text/caption of ONE social post
- social_batch: generate a BATCH of social posts (several at once) / "post about X" / run the social agent
- carousel: build a multi-slide Instagram/Threads carousel about a topic
- story: build an Instagram story sequence about a topic
- social_insights: reporting social analytics/performance (followers, reach, engagement, "how are we doing on social")
- social_score: score live posts / "what's winning" / decision reliability
- autopilot: check or change the social Autopilot (cadence, on/off, what it posts about)
- print: a print piece (flyer, poster, card, sticker, brochure) — even if the user says "design"
- email: drafting an email marketing campaign/newsletter
- invoice: creating an invoice / billing a client
- outreach: drafting a direct email to a specific person/client
- research: researching a prospective/existing client business
- onboarding: building/suggesting client intake form fields
- navigate: going to / opening / showing a page (not creating anything)\n- assist: no actionable task \u2014 greetings, status questions, general conversation with the admin`;

// ── Department → MCP tool table (single source; was duplicated in masterAgent) ─
// Maps a routed department to the agentMcp tool + how to shape its args from a
// task string. brandContext + research context are injected by runDepartment.
const DEPARTMENT_TOOL = {
  blog:       (task, o) => ['write_blog_post',        { topic: task, context: o.context, brandContext: o.brand }],
  copy:       (task, o) => ['fill_site_copy',         { task, section: 'all', context: o.context, brandContext: o.brand }],
  section:    (task, o) => ['fill_section',           { section_type: o.section_type || 'text', task, context: o.context, brandContext: o.brand }],
  page:       (task, o) => ['write_page',             { title: task, page_type: o.page_type || 'content', task, context: o.context, brandContext: o.brand }],
  theme:      (task, o) => ['update_theme',           { task, context: o.context, brandContext: o.brand }],
  typography: (task, o) => ['update_typography',      { task, context: o.context, brandContext: o.brand }],
  visibility: (task, o) => ['set_section_visibility', { task, context: o.context, brandContext: o.brand }],
  design:     (task, o) => ['update_design',          { task, context: o.context, brandContext: o.brand }],
  asset:      (task, o) => ['generate_social_image',  { prompt: task, context: o.context, brandContext: o.brand }],
  social:     (task, o) => ['write_social_post',      { task, platforms: o.platforms, context: o.context, brandContext: o.brand }],
  social_batch:    (task, o) => ['generate_social_batch',   { topic: task, platforms: o.platforms }],
  carousel:        (task, o) => ['build_seamless_carousel', { topic: task }],
  story:           (task, o) => ['build_story_sequence',    { topic: task }],
  social_insights: ()       => ['get_social_insights',      { days: 30 }],
  social_score:    ()       => ['score_live_posts',         {}],
  autopilot:       ()       => ['get_autopilot_config',     {}],
  print:      (task, o) => ['write_print_copy',       { task, context: o.context, brandContext: o.brand }],
  email:      (task, o) => ['write_campaign',         { task, context: o.context, brandContext: o.brand }],
  invoice:    (task, o) => ['draft_invoice',          { task, context: o.context, brandContext: o.brand }],
  outreach:   (task, o) => ['draft_client_email',     { task, context: o.context, brandContext: o.brand }],
  research:   (task, o) => ['research_client',        { prompt: task, notes: o.context, brandContext: o.brand }],
  onboarding: (task, o) => ['suggest_onboarding_fields', { prompt: task, brandContext: o.brand }],
};

// Post-generation destinations (label + where the human goes to review/commit).
// MCP scope alignment: given an agent's configured tool list (MCP tool names
// from the chatflow matrix), return the Set of departments it may route to —
// i.e. departments whose committing tool is in the agent's scope. 'assist' and
// 'navigate' are always allowed (no mutating tool). Returns null when the agent
// has no tools configured, meaning "unrestricted" (the audience gate in
// runDepartment still applies). This is what keeps a scoped support bot from
// ever reaching, say, the invoice or design tools.
export function departmentsForTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return null; // unrestricted
  const wanted = new Set(tools);
  const set = new Set(['assist', 'navigate']);
  for (const [dept, build] of Object.entries(DEPARTMENT_TOOL)) {
    try { const [toolName] = build('', {}); if (wanted.has(toolName)) set.add(dept); } catch { /* skip */ }
  }
  return set;
}

export const DEPT_ACTIONS = {
  blog:       { label: 'Open Blog Editor',     url: '/admin/blog/new' },
  copy:       { label: 'Go to Site Copy',      url: '/admin/copy' },
  section:    { label: 'Go to Sections',       url: '/admin/sections' },
  page:       { label: 'Open Page Editor',     url: '/admin/pages/new' },
  theme:      { label: 'Go to Design',         url: '/admin/design' },
  typography: { label: 'Go to Design',         url: '/admin/design' },
  visibility: { label: 'Go to Design',         url: '/admin/design' },
  design:     { label: 'Go to Design',         url: '/admin/design' },
  asset:      { label: 'Open Asset Center',    url: '/admin/assets' },
  social:     { label: 'Open Social',          url: '/admin/social' },
  social_batch:    { label: 'Review in Agent Studio', url: '/admin/social?tab=agents' },
  carousel:        { label: 'Review in Agent Studio', url: '/admin/social?tab=agents' },
  story:           { label: 'Review in Agent Studio', url: '/admin/social?tab=agents' },
  social_insights: { label: 'Open Analytics',         url: '/admin/social?tab=analytics' },
  social_score:    { label: 'Open Agent Studio',      url: '/admin/social?tab=agents' },
  autopilot:       { label: 'Open Agent Studio',      url: '/admin/social?tab=agents' },
  print:      { label: 'Open Print Studio',    url: '/admin/print-studio' },
  email:      { label: 'Open Email Marketing', url: '/admin/email-marketing' },
  invoice:    { label: 'Open Bookkeeping',     url: '/admin/bookkeeping' },
  outreach:   { label: 'Open Clients',         url: '/admin/clients' },
  research:   { label: 'Open Clients',         url: '/admin/clients' },
  onboarding: { label: 'Open Onboarding',      url: '/admin/onboarding' },
  navigate:   { label: 'Go',                   url: '/admin' },
};

// Trimmed nav map for the navigate department (fast-path, no LLM).
export const NAV_MAP = {
  dashboard: '/admin', home: '/admin', blog: '/admin/blog', pages: '/admin/pages',
  copy: '/admin/copy', design: '/admin/design', settings: '/admin/settings',
  assets: '/admin/assets', clients: '/admin/clients', meetings: '/admin/meetings',
  bookkeeping: '/admin/bookkeeping', invoices: '/admin/bookkeeping',
  'email marketing': '/admin/email-marketing', social: '/admin/social',
  'print studio': '/admin/print-studio', portfolio: '/admin/portfolio',
  sections: '/admin/sections', analytics: '/admin/analytics', onboarding: '/admin/onboarding',
  inquiries: '/admin/inquiries', tickets: '/admin/tickets', chat: '/admin/chat',
  site: '/', 'live site': '/',
};

// Thread-context → preferred department (biases routing inside a module's chat).
export const MODULE_DEPARTMENT = {
  design: 'design', pages: 'page', blog: 'blog', clients: 'research',
  social: 'social', 'email-marketing': 'email',
  assets: 'asset', onboarding: 'onboarding', 'print-studio': 'print',
  copy: 'copy', layout: 'visibility',
  // NOTE: 'bookkeeping' intentionally has NO bias. The only finance tool is
  // draft_invoice, and biasing to it turned analytical asks ("break down our
  // budget") into invoices. Finance now falls to the conversational path, which
  // is fed the live ledger/budget via agentViewContext.js. Explicit "draft an
  // invoice…" still routes to invoice on its own.
};

const stripToJson = (raw) => {
  const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
};

/** Route a single message → { department, task, section_type, page_type, nav_target }. */
export async function routeMessage(message, { contextModule = null, kind = null } = {}) {
  const fallback = { department: 'assist', task: message, section_type: 'text', page_type: 'content' };

  // Fast-path navigation without burning an LLM call.
  const lower = String(message || '').toLowerCase().trim();
  if (['go to ', 'open ', 'show me ', 'take me to ', 'navigate to ', 'show '].some((p) => lower.startsWith(p))) {
    let url = '/admin';
    for (const [key, val] of Object.entries(NAV_MAP)) if (lower.includes(key)) { url = val; break; }
    return { department: 'navigate', task: message, nav_target: url };
  }

  const pref = contextModule ? MODULE_DEPARTMENT[contextModule] : null;
  let prompt = ROUTING_PROMPT;
  if (pref) prompt += `\n\nCONTEXT: This chat lives inside the "${contextModule}" module of the admin panel. When the request is ambiguous, prefer the "${pref}" department; only route elsewhere when the request clearly names another job.`;
  try {
    const json = stripToJson(await callLLM([{ role: 'user', content: message }], prompt));
    if (json) return { ...fallback, ...JSON.parse(json) };
  } catch { /* fall through */ }
  return fallback;
}

/**
 * Run one department: web research → the department's MCP tool → parsed result.
 * Returns { department, message, fill, suggestedBlocks, tool_used, action, navigate }.
 * This is the exact pipeline masterAgent /run-task uses — now callable anywhere.
 */
export async function runDepartment(db, tenant, { department, task, section_type, page_type, platforms, extraContext = '', audience = 'admin', engine = '', model = '', ctx = {} } = {}) {
  if (department === 'navigate') {
    const lower = String(task || '').toLowerCase();
    let url = '/admin';
    for (const [key, val] of Object.entries(NAV_MAP)) if (lower.includes(key)) { url = val; break; }
    return { department: 'navigate', message: `Opening ${url.split('/').pop() || 'dashboard'}…`, fill: {}, navigate: url, action: { label: 'Go', url } };
  }

  // Non-task route — nothing to run; caller converses instead.
  if (department === 'assist') {
    return { department: 'assist', message: '', fill: {} };
  }

  try { assertDepartmentAllowed(audience, department, ctx); }
  catch (e) {
    if (e.code === 'AGENT_FORBIDDEN') {
      return { department: 'assist', message: "That action isn't available with your current access.", fill: {}, forbidden: true };
    }
    throw e;
  }

  // Per-agent override (Agent Control registry): an agent can be turned off, or
  // pinned to a specific engine/model. Precedence: agent config > thread kind >
  // platform default. Empty override → inherit the value passed in.
  const [aCfg, def] = await Promise.all([getAgentConfig(db, department), getTenantDefault(db)]);
  if (aCfg && aCfg.enabled === false) {
    return { department: 'assist', message: `The ${department} agent is turned off in Agent Control.`, fill: {}, disabled: true };
  }
  // Inheritance chain: agent override > passed-in (thread kind) > tenant default > platform.
  const effEngine = (aCfg && aCfg.engine) || engine || def.engine || undefined;
  const effModel = (aCfg && aCfg.model) || model || def.model || undefined;

  let research = '';
  try { research = await webSearch(task); } catch { /* non-fatal */ }
  const context = (research ? '\n\nResearch findings:\n' + research : '') + (extraContext || '');
  const brand = await loadBrandContext(tenant, db);

  const build = DEPARTMENT_TOOL[department] || DEPARTMENT_TOOL.copy;
  const [toolName, toolArgs] = build(task, { context, brand, section_type, page_type, platforms });
  // Pass tenant scope so stateful social tools reach the right DB; brandContext
  // keeps every tool's output on-brand.
  const result = await runTool(toolName, toolArgs, { db, tenant, brandContext: brand, engine: effEngine, model: effModel });

  return {
    department,
    message: result.message || 'Done.',
    fill: result.fill || {},
    suggestedBlocks: result.suggestedBlocks || null,
    tool_used: toolName,
    action: DEPT_ACTIONS[department] || DEPT_ACTIONS.copy,
    section_type: section_type || null,
    page_type: page_type || null,
  };
}

/** Convenience: route + run in one call (what a chat agent turn needs). */
export async function routeAndRun(db, tenant, message, opts = {}) {
  const route = await routeMessage(message);
  const result = await runDepartment(db, tenant, { ...route, ...opts });
  return { route, ...result };
}


// ═══════════════════════════════════════════════════════════════════════════
// COMMIT HALF — executeDepartment(db, tenant, {...})
// Faithful extraction of the per-department DB writers that lived inline in
// routes/admin/masterAgent.js /execute, so the dashboard route AND chat's
// Apply affordance share ONE committer. Heavy deps (canvas, S3, invoice
// helpers) are lazy-imported per branch so chat-path consumers stay light.
// Returns { ok:true, message, editUrl } or { ok:false, message } on validation
// misses; throws (err.status = 400) for an unknown department.
// ═══════════════════════════════════════════════════════════════════════════

const _slug = (str) => String(str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function executeDepartment(db, tenant, { department, fill, section_type, page_type, label, userEmail = null } = {}) {
  if (!department || !fill || typeof fill !== 'object') {
    const e = new Error('department and fill required'); e.status = 400; throw e;
  }
  const now = new Date();
  let summary = '';
  let editUrl = '';

  if (department === 'copy') {
    const entries = Object.entries(fill).filter(([, v]) => v && String(v).trim());
    if (!entries.length) return { ok: false, message: 'No copy fields to save.' };
    await Promise.all(entries.map(([key, value]) =>
      db.collection('copy').updateOne({ key }, { $set: { key, value: String(value), updatedAt: now } }, { upsert: true })));
    summary = `Updated ${entries.length} copy field${entries.length > 1 ? 's' : ''}: ${entries.slice(0,3).map(([k]) => k.replace(/_/g,' ')).join(', ')}${entries.length > 3 ? '…' : ''}.`;
    editUrl = '/admin/copy';

  } else if (department === 'blog') {
    const { title, excerpt, content, category, tags } = fill;
    if (!title) return { ok: false, message: 'Blog post needs a title.' };
    let slug = _slug(title);
    if (await db.collection('blog').findOne({ slug })) slug = slug + '-' + Date.now();
    const result = await db.collection('blog').insertOne({
      title, slug, excerpt: excerpt || '', content: content || '', category: category || '',
      tags: tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
      featuredImageUrl: '', status: 'draft', publishedAt: null, createdAt: now, updatedAt: now,
    });
    summary = `Created draft blog post: "${title}".`;
    editUrl = `/admin/blog/${result.insertedId}/edit`;

  } else if (department === 'section') {
    const type = section_type || 'text';
    const sectionLabel = label || fill.heading || `New ${type} section`;
    await db.collection('custom_sections').insertOne({
      type, label: sectionLabel, fields: fill, images: {}, visible: true, createdAt: now, updatedAt: now,
    });
    summary = `Created new "${type}" section: "${sectionLabel}".`;
    editUrl = '/admin/sections';

  } else if (department === 'page') {
    // write_page emits `metaDescription`; accept both spellings so the meta
    // description isn't silently dropped on Apply.
    const { title, metaTitle, metaDesc, metaDescription, content, blocks } = fill;
    if (!title) return { ok: false, message: 'Page needs a title.' };
    let slug = _slug(title);
    if (await db.collection('pages').findOne({ slug })) slug = slug + '-' + Date.now();
    const pageType = page_type || 'content';
    const result = await db.collection('pages').insertOne({
      title, slug, pageType, status: 'draft', metaTitle: metaTitle || title, metaDesc: metaDesc || metaDescription || '',
      content: pageType === 'content' ? (content || '') : '',
      blocks: pageType === 'landing' ? (blocks || []) : [],
      dataCollection: pageType === 'data-list' ? 'blog' : '', dataPageSize: 9,
      robotsMeta: 'index,follow', sitemapPriority: 0.5, sitemapChangefreq: 'monthly',
      canonicalUrl: '', ogImage: '', createdAt: now, updatedAt: now,
    });
    summary = `Created draft page: "${title}" (${pageType}).`;
    editUrl = `/admin/pages/${result.insertedId}/edit`;

  } else if (department === 'design' || department === 'theme' || department === 'typography' || department === 'visibility') {
    // All four design-family departments write the same design collection as
    // key/value pairs — the split is only about which fields each generator may
    // emit (see agentMcp handlers); the commit is identical.
    const entries = Object.entries(fill).filter(([, v]) => v && String(v).trim());
    if (!entries.length) return { ok: false, message: 'No design fields to save.' };
    await Promise.all(entries.map(([key, value]) =>
      db.collection('design').updateOne({ key }, { $set: { key, value: String(value), updatedAt: now } }, { upsert: true })));
    summary = `Updated ${entries.length} design setting${entries.length > 1 ? 's' : ''}: ${entries.slice(0,3).map(([k]) => k.replace(/_/g,' ')).join(', ')}${entries.length > 3 ? '…' : ''}.`;
    editUrl = '/admin/design';

  } else if (department === 'asset') {
    const { createCanvas } = await import('canvas');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { s3Client, BUCKET, bucketUrl } = await import('./s3.js');
    const design = { size: fill.size || 'ig-post', bgColor: fill.bgColor || '#F5F3EF', layers: fill.layers || [] };
    const title = fill.title || 'Social Asset';
    const SIZE_MAP = {
      'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
      'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
      'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
    };
    const [cw, ch] = SIZE_MAP[design.size] || [1080, 1080];
    const canvas = createCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = design.bgColor; ctx.fillRect(0, 0, cw, ch);
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
    const folder = 'clients';
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const filename = `${ts}-${rand}-${safeName}.png`;
    const s3Prefix = tenant?.s3Prefix || 'default';
    const s3key = `${s3Prefix}/assets/${folder}/${filename}`;
    await s3Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: s3key, Body: pngBuffer, ContentType: 'image/png', ACL: 'public-read' }));
    const publicUrl = bucketUrl(s3key);
    await db.collection('assets').insertOne({
      filename, originalName: `${title}.png`, folders: [folder], folder,
      clientId: null, publicUrl, bucketKey: s3key,
      fileType: 'image', mimeType: 'image/png', size: pngBuffer.length,
      title, tags: ['social', 'ai-generated'],
      generatedFrom: { design, createdAt: now }, uploadedAt: now,
    });
    summary = `Created social image: "${title}".`;
    editUrl = '/admin/assets';

  } else if (department === 'email') {
    const { subject, preheader, body, targetFunnel } = fill;
    if (!subject) return { ok: false, message: 'Campaign needs a subject line.' };
    const result = await db.collection('campaigns').insertOne({
      subject, preheader: preheader || '', body: body || '',
      targetFunnel: targetFunnel || 'all', targetTags: '', targetContactIds: null,
      status: 'draft', sentCount: 0, failedCount: 0, sentAt: null,
      parentCampaignId: null, parentSegment: null, createdAt: now, updatedAt: now,
    });
    summary = `Created draft campaign: "${subject}".`;
    editUrl = `/admin/email-marketing/campaigns/${result.insertedId}`;

  } else if (department === 'invoice') {
    const { generateInvoiceNumber, generatePaymentToken, calculateTotal } = await import('./invoiceHelpers.js');
    const { title, lineItems, notes, dueInDays } = fill;
    if (!title) return { ok: false, message: 'Invoice needs a title.' };
    const items = (Array.isArray(lineItems) ? lineItems : []).map(li => ({
      description: li.description || 'Service', quantity: Number(li.quantity) || 1, unitPrice: Number(li.unitPrice) || 0,
    }));
    const amount = calculateTotal(items);
    const invoiceNumber = await generateInvoiceNumber(db, tenant);
    const paymentToken = generatePaymentToken();
    const dueDate = new Date(now.getTime() + (Number(dueInDays) || 30) * 86400000);
    await db.collection('invoices').insertOne({
      clientId: null, invoiceNumber, title, lineItems: items, amount, status: 'draft',
      dueDate, notes: notes || '', paymentToken, payments: [], discounts: [], refunds: [],
      emailSentAt: null, emailSentTo: null, recurring: { enabled: false }, createdAt: now, updatedAt: now,
    });
    summary = `Created draft invoice ${invoiceNumber}: "${title}" — $${amount.toFixed(2)}.`;
    editUrl = '/admin/bookkeeping';

  } else if (department === 'social') {
    const body = (fill.body || '').trim();
    if (!body) return { ok: false, message: 'Social post needs body text.' };
    const VALID_PLATFORMS = ['facebook', 'instagram', 'threads', 'x', 'linkedin'];
    const platforms = String(fill.platforms || '')
      .split(',').map(p => p.trim().toLowerCase()).filter(p => VALID_PLATFORMS.includes(p));
    await db.collection('social_posts').insertOne({
      body, link: (fill.link || '').trim(), mediaUrls: [], platforms,
      status: 'draft', scheduledAt: null, publishedAt: null, results: [],
      createdBy: userEmail || null, createdAt: now, updatedAt: now,
    });
    summary = `Staged a social post draft${platforms.length ? ` for ${platforms.join(', ')}` : ''} — review and send from Social.`;
    editUrl = '/admin/social?tab=compose';

  } else if (department === 'print') {
    const COPY_KEYS = ['headline', 'subhead', 'body', 'offer', 'cta', 'tagline'];
    const fields = {};
    for (const k of COPY_KEYS) if (fill[k] != null && String(fill[k]).trim()) fields[k] = String(fill[k]).trim();
    if (!fields.headline && !fields.body) return { ok: false, message: 'Print copy needs at least a headline or body.' };
    const result = await db.collection('print_materials').insertOne({
      name: fill.name || fields.headline || 'AI draft campaign', theme: '', fields,
      showLogo: true, logoSlot: 'logo_primary', qrLinkId: '', qrCaption: '',
      bgType: 'theme', bgColor: '', bgColor2: '', bgImageUrl: '',
      enabled: {}, layouts: {}, createdAt: now, updatedAt: now,
    });
    summary = `Staged a print campaign draft: "${fill.name || fields.headline || 'AI draft campaign'}" — lay it out in Print Studio.`;
    editUrl = `/admin/print-studio?saved=1#m-${result.insertedId}`;

  } else if (department === 'outreach') {
    summary = `Drafted client email: "${fill.subject || 'Email'}". Go to a client page to send it.`;
    editUrl = '/admin/clients';

  } else if (department === 'onboarding') {
    const formName = (fill.name && String(fill.name).trim()) || label || 'New onboarding form';
    const fields = Array.isArray(fill.fields) ? fill.fields : [];
    if (!fields.length) return { ok: false, message: 'No form fields to save.' };
    let slug = _slug(formName);
    if (await db.collection('onboarding_forms').findOne({ slug })) slug = slug + '-' + Date.now().toString(36);
    const result = await db.collection('onboarding_forms').insertOne({
      name: formName, slug, description: (fill.description || '').trim(),
      status: 'draft', fields, assignTo: [], createdAt: now, updatedAt: now,
    });
    summary = `Created draft onboarding form "${formName}" with ${fields.length} field${fields.length > 1 ? 's' : ''}.`;
    editUrl = `/admin/onboarding/${result.insertedId}`;

  } else {
    const e = new Error('Unknown department: ' + department); e.status = 400; throw e;
  }

  return { ok: true, message: summary, editUrl };
}
