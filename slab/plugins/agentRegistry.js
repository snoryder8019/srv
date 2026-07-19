/**
 * Slab — Agent Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * The single catalog of every "assigned agent" in the system. Each entry is a
 * department from agentRouter's DEPARTMENT_TOOL, surfaced as a first-class,
 * configurable agent in Agent Control (/admin/chat) — so blog, page, design,
 * marketing, support etc. are visible and manageable, not buried in the router.
 *
 * Keep `key` + `tool` in sync with:
 *   • plugins/agentRouter.js  → DEPARTMENT_TOOL  (key → committing MCP tool)
 *   • plugins/agentAudience.js → DEPARTMENT_FEATURE (key → permission feature)
 *
 * scope: 'public'  → a visitor-facing agent (guardrail hard; assist only)
 *        'private' → staff/admin only
 */
export const AGENT_REGISTRY = [
  // ── Coordinator (the multi-tool orchestrator) ──
  { key: 'coordinator', label: 'Coordinator (orchestrator)', category: 'Coordinator', scope: 'private', tool: '—', feature: null,
    desc: 'The agentic orchestrator — decides which agents/tools to call each turn. Its MODEL drives every multi-tool turn; default Sonnet (much cheaper than Opus). Engine/enabled don’t apply here.' },

  // ── Support (the one public-facing agent) ──
  { key: 'assist', label: 'Support Concierge', category: 'Support', scope: 'public', tool: '—', feature: null,
    desc: 'Public brand-aware Q&A + lead capture. The only agent a public visitor can reach.' },

  // ── Content ──
  { key: 'blog', label: 'Blog', category: 'Content', scope: 'private', tool: 'write_blog_post', feature: 'blog',
    desc: 'Writes blog posts — topic → title, excerpt, tags, HTML body.' },
  { key: 'copy', label: 'Site Copy', category: 'Content', scope: 'private', tool: 'fill_site_copy', feature: 'design',
    desc: 'Fills homepage / site copy sections, on brand.' },
  { key: 'section', label: 'Section', category: 'Content', scope: 'private', tool: 'fill_section', feature: 'design',
    desc: 'Fills a single section (hero, cards, FAQ…) with copy.' },
  { key: 'page', label: 'Page', category: 'Content', scope: 'private', tool: 'write_page', feature: 'pages',
    desc: 'Builds a full page — landing blocks or content HTML.' },

  // ── Design ──
  { key: 'design', label: 'Design', category: 'Design', scope: 'private', tool: 'update_design', feature: 'design',
    desc: 'Updates design tokens — colors, layout, style.' },
  { key: 'theme', label: 'Theme', category: 'Design', scope: 'private', tool: 'update_theme', feature: 'design',
    desc: 'Adjusts color / theme tokens.' },
  { key: 'typography', label: 'Typography', category: 'Design', scope: 'private', tool: 'update_typography', feature: 'design',
    desc: 'Adjusts fonts and the type scale.' },
  { key: 'visibility', label: 'Section Visibility', category: 'Design', scope: 'private', tool: 'set_section_visibility', feature: 'design',
    desc: 'Shows / hides page sections.' },

  // ── Marketing ──
  { key: 'social', label: 'Social Post', category: 'Marketing', scope: 'private', tool: 'write_social_post', feature: 'social',
    desc: 'Writes a social post for the chosen platforms.' },
  { key: 'social_batch', label: 'Social Batch', category: 'Marketing', scope: 'private', tool: 'generate_social_batch', feature: 'social',
    desc: 'Generates a batch of social posts.' },
  { key: 'carousel', label: 'Carousel', category: 'Marketing', scope: 'private', tool: 'build_seamless_carousel', feature: 'social',
    desc: 'Builds a seamless Instagram carousel.' },
  { key: 'story', label: 'Story Sequence', category: 'Marketing', scope: 'private', tool: 'build_story_sequence', feature: 'social',
    desc: 'Builds a story sequence.' },
  { key: 'social_insights', label: 'Social Insights', category: 'Marketing', scope: 'private', tool: 'get_social_insights', feature: 'social',
    desc: 'Reports social reach / engagement.' },
  { key: 'social_score', label: 'Social Scoring', category: 'Marketing', scope: 'private', tool: 'score_live_posts', feature: 'social',
    desc: 'Scores live posts.' },
  { key: 'autopilot', label: 'Social Autopilot', category: 'Marketing', scope: 'private', tool: 'get_autopilot_config', feature: 'social',
    desc: 'Reads the social autopilot config.' },
  { key: 'asset', label: 'Asset / Image', category: 'Marketing', scope: 'private', tool: 'generate_social_image', feature: 'assets',
    desc: 'Generates social / design graphics.' },
  { key: 'email', label: 'Email Campaign', category: 'Marketing', scope: 'private', tool: 'write_campaign', feature: 'email-marketing',
    desc: 'Drafts an email campaign.' },
  { key: 'print', label: 'Print Copy', category: 'Marketing', scope: 'private', tool: 'write_print_copy', feature: 'print-studio',
    desc: 'Writes print campaign copy.' },

  // ── Finance ──
  { key: 'invoice', label: 'Invoice', category: 'Finance', scope: 'private', tool: 'draft_invoice', feature: 'bookkeeping',
    desc: 'Drafts an invoice from a description.' },

  // ── Clients ──
  { key: 'outreach', label: 'Client Outreach', category: 'Clients', scope: 'private', tool: 'draft_client_email', feature: 'clients',
    desc: 'Drafts client emails and follow-ups.' },
  { key: 'research', label: 'Client Research', category: 'Clients', scope: 'private', tool: 'research_client', feature: 'clients',
    desc: 'Researches a client / lead.' },
  { key: 'onboarding', label: 'Onboarding', category: 'Clients', scope: 'private', tool: 'suggest_onboarding_fields', feature: 'onboarding',
    desc: 'Suggests onboarding fields.' },
];

export const AGENT_CATEGORIES = ['Coordinator', 'Support', 'Content', 'Design', 'Marketing', 'Finance', 'Clients'];

/** Registry grouped by category, in AGENT_CATEGORIES order (empty groups dropped). */
export function agentsByCategory() {
  const out = [];
  for (const cat of AGENT_CATEGORIES) {
    const agents = AGENT_REGISTRY.filter((a) => a.category === cat);
    if (agents.length) out.push({ category: cat, agents });
  }
  return out;
}

export function agentByKey(key) {
  return AGENT_REGISTRY.find((a) => a.key === key) || null;
}

// ── Per-agent config (per tenant, collection: agent_config) ───────────────────
// A row overrides a single agent's engine/model and can disable it. No row =
// agent enabled, engine/model inherit (empty = inherit from the thread kind /
// tenant default). This is the "configurable agents" layer: agent > kind >
// platform default. Runtime precedence is applied in agentRouter.runDepartment.
export async function getAgentConfigMap(db) {
  try {
    const rows = await db.collection('agent_config').find({}).toArray();
    const map = {};
    for (const r of rows) map[r.key] = { enabled: r.enabled !== false, engine: r.engine || '', model: r.model || '' };
    return map;
  } catch { return {}; }
}

export async function getAgentConfig(db, key) {
  try {
    const r = await db.collection('agent_config').findOne({ key });
    return r ? { enabled: r.enabled !== false, engine: r.engine || '', model: r.model || '' } : null;
  } catch { return null; }
}

export async function setAgentConfig(db, key, { enabled, engine, model } = {}) {
  if (!agentByKey(key)) throw new Error('unknown agent');
  await db.collection('agent_config').updateOne(
    { key },
    { $set: { key, enabled: enabled !== false, engine: engine || '', model: model || '', updatedAt: new Date() } },
    { upsert: true },
  );
}

// ── Tenant default (the base of the inheritance chain) ────────────────────────
// One engine + model the whole tenant inherits when an agent leaves its own on
// "inherit". engine '' = inherit the platform behaviour (tenant key → Claude);
// 'house' forces Ollama; 'anthropic' forces Claude. model '' = platform default.
// Precedence everywhere: agent override > tenant default > platform default.
const DEFAULT_KEY = '__tenant_default__';
export async function getTenantDefault(db) {
  try {
    const r = await db.collection('agent_config').findOne({ key: DEFAULT_KEY });
    return { engine: r?.engine || '', model: r?.model || '' };
  } catch { return { engine: '', model: '' }; }
}
export async function setTenantDefault(db, { engine, model } = {}) {
  await db.collection('agent_config').updateOne(
    { key: DEFAULT_KEY },
    { $set: { key: DEFAULT_KEY, engine: engine || '', model: model || '', updatedAt: new Date() } },
    { upsert: true },
  );
}

// Resolve the callLLM opts for a given agent, applying the full inheritance
// chain — agent override > tenant default > platform. Drop-in for any in-page
// "generate" route so its button obeys the same settings as the ✦ agents:
//   const raw = await callLLM(msgs, sys, 90000, await agentLLMOpts(req.db, req.tenant, 'page'));
export async function agentLLMOpts(db, tenant, agentKey) {
  const [aCfg, def] = await Promise.all([getAgentConfig(db, agentKey), getTenantDefault(db)]);
  return {
    tenant,
    engine: (aCfg && aCfg.engine) || def.engine || undefined,
    model: (aCfg && aCfg.model) || def.model || undefined,
  };
}
