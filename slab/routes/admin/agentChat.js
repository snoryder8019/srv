/**
 * Slab — Agent-chat capability endpoints (UNGATED beyond admin login)
 * ─────────────────────────────────────────────────────────────────────────────
 * Deliberately mounted at /admin/agent-chat, NOT under the feature-gated
 * /admin/chat control panel: per the architecture, the chat CAPABILITY is
 * untagged substrate (matchFeatureByPath finds no feature for this path, so
 * enforceFeatureAccess lets any authed admin/collaborator through), while the
 * control panel stays adminOnly + experimental.
 *
 * POST /resolve — find-or-create the ONE persistent thread for a
 * {kind, context.module} pair, so the ✦ launcher on e.g. the Design page always
 * reopens the same perpetual design conversation. Adds the requester as a
 * member on reuse (thread membership is the real per-thread gate).
 */

import express from 'express';
import { config } from '../../config/config.js';
import { createThread, addMember, THREAD_KINDS } from '../../plugins/chat.js';

const router = express.Router();

// Resolve an agent's configured engine/model into what it will ACTUALLY run on,
// for display. Mirrors resolveEngine's real decision (a tenant without a valid
// Anthropic key silently degrades to house), so the modal never claims Claude
// when the request is really going to the house model.
async function describeRuntime(tenant, engine, model) {
  const { resolveEngine } = await import('../../plugins/agentEngine.js');
  const chosen = resolveEngine({ tenant, engine, model });
  // `engineLabel`, not `label` — these fields get spread alongside an agent's own
  // `label` in /scope, and a plain `label` would silently overwrite the agent name.
  return chosen.engine === 'anthropic'
    ? { engine: 'anthropic', engineLabel: 'Claude', model: chosen.model }
    : { engine: 'house', engineLabel: 'House', model: config.OLLAMA_MODEL };
}

// ── Surface scope disclosure — GET /admin/agent-chat/scope?module=blog ────────
// Per-agent engine/model settings live in Agent Control (/admin/chat), which left
// the ✦ modal unable to show which agent handles a request or what it runs on —
// the settings felt disconnected from the runtime. This reports the surface's
// real scope: the agents reachable from THIS ✦ (after MODULE_DEPARTMENTS
// hard-scoping) and each one's effective engine/model after the full inheritance
// chain, so the modal can list it inline.
router.get('/scope', async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const module = req.query.module ? String(req.query.module).slice(0, 40) : null;
    const { AGENT_REGISTRY, getAgentConfigMap, getTenantDefault } = await import('../../plugins/agentRegistry.js');
    const { departmentsForModule, MODULE_PRIMARY } = await import('../../plugins/agentRouter.js');
    const [cfgMap, def] = await Promise.all([getAgentConfigMap(db), getTenantDefault(db)]);

    const scope = departmentsForModule(module);
    const agents = await Promise.all(AGENT_REGISTRY
      .filter((a) => a.scope === 'private' && a.tool !== '—' && (!scope || scope.has(a.key)))
      .map(async (a) => {
        const ac = cfgMap[a.key] || {};
        const rt = await describeRuntime(tenant, ac.engine || def.engine, ac.model || def.model);
        return {
          key: a.key, label: a.label, tool: a.tool, desc: a.desc,
          enabled: ac.enabled !== false, ...rt,
          // Where this agent's engine/model came from — so "why is this on House?"
          // is answerable without cross-referencing three settings screens.
          source: (ac.engine || ac.model) ? 'agent' : ((def.engine || def.model) ? 'tenant' : 'platform'),
        };
      }));

    res.json({
      ok: true, module, scoped: !!scope,
      primary: MODULE_PRIMARY[module] || null,
      tenantDefault: await describeRuntime(tenant, def.engine, def.model),
      agents, settingsUrl: '/admin/chat',
    });
  } catch (err) {
    console.error('[agent-chat/scope] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Ephemeral agentic turn — POST /admin/agent-chat/run ───────────────────────
// The admin personal-agent model: NO persistent thread. Short memory is the
// client-held `messages` array (last few turns); the server is stateless. A task
// message routes to the narrow-scoped department agent (which threads the
// tenant's engine/model + per-agent config and returns a proposed `fill` for the
// human to Apply); a conversational message gets a brief guardrailed reply. This
// is the "short memory + guardrail prompting + narrow MCP scope" agent — it
// replaces the resolve→thread→socket path for admin surfaces.
router.post('/run', async (req, res) => {
  try {
    const db = req.db, tenant = req.tenant;
    const module = req.body.module ? String(req.body.module).slice(0, 40) : null;
    const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-8) : [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const text = String(lastUser?.content || req.body.message || '').trim();
    if (!text) return res.json({ ok: true, reply: 'What would you like me to do?' });

    const msgs = messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
    let brand = '';
    try { const { loadBrandContext } = await import('../../plugins/brandContext.js'); brand = await loadBrandContext(tenant, db); } catch { /* non-fatal */ }
    const bizName = tenant?.brand?.name || tenant?.domain || 'this business';

    // Cross-reference the DB behind the view the ✦ is scoped to, so answers are
    // grounded in THIS tenant's real data (e.g. finance → live ledger/budget)
    // instead of generic advice or a misfired tool.
    let viewCtx = '';
    try { const { loadViewContext } = await import('../../plugins/agentViewContext.js'); viewCtx = await loadViewContext(db, tenant, module); } catch { /* non-fatal */ }

    // Tenant default (base of the inheritance chain). Its ENGINE is the master
    // switch: 'house' → Ollama route (no Claude spend); '' / 'anthropic' → the
    // Claude agentic loop when a key is present.
    const { getTenantDefault } = await import('../../plugins/agentRegistry.js');
    const def = await getTenantDefault(db);

    // ── Agentic path (keyed tenant → Claude): one agent, a NARROW set of scoped
    // tools, called in a short loop. Falls through to the house router on error. ──
    const { resolveEngine, callAnthropicAgentic, recordTokenUsage } = await import('../../plugins/agentEngine.js');
    const chosen = resolveEngine({ tenant, engine: def.engine });
    if (chosen.engine === 'anthropic') {
      try {
        const { MCP_TOOLS, runTool } = await import('../../plugins/agentMcp.js');
        const { AGENT_REGISTRY, getAgentConfigMap } = await import('../../plugins/agentRegistry.js');
        const { departmentsForModule } = await import('../../plugins/agentRouter.js');
        const cfgMap = await getAgentConfigMap(db);
        // Orchestrator (coordinator turn) model — Sonnet by default so Opus
        // doesn't run on every agentic turn; overridable via the 'coordinator'
        // agent config. The per-agent inner-generation models are separate.
        const orchModel = (cfgMap.coordinator && cfgMap.coordinator.model) || def.model || config.ANTHROPIC_COORDINATOR_MODEL || chosen.model;
        // HARD-SCOPE the orchestrator to the ✦ launcher's module. Without this the
        // Blog Agent would receive fill_site_copy / update_design / write_page too
        // and could propose changes that overwrite the homepage. null module (the
        // dashboard coordinator) stays unrestricted. See MODULE_DEPARTMENTS.
        const deptScope = departmentsForModule(module);
        const allowed = AGENT_REGISTRY.filter((a) =>
          a.scope === 'private' && a.tool !== '—' &&
          (cfgMap[a.key]?.enabled !== false) &&
          (!deptScope || deptScope.has(a.key)));
        const toolToDept = {}; allowed.forEach((a) => { toolToDept[a.tool] = a.key; });
        const names = new Set(allowed.map((a) => a.tool));
        const tools = MCP_TOOLS.filter((t) => names.has(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
        const ws = MCP_TOOLS.find((t) => t.name === 'web_search');
        if (ws && !tools.some((t) => t.name === 'web_search')) tools.push({ name: ws.name, description: ws.description, input_schema: ws.inputSchema });

        const sys = `You are ${bizName}'s own operations agent, working inside their admin panel with the owner/staff. You already know this business from the context below — never ask who they are, what they do, or what they're working on. Talk like a trusted colleague who's already up to speed: warm, plain, brief, never salesy or promotional. You have a NARROW set of tools; use them to actually do the work asked, then say briefly what you did. Only call a tool when the request needs it — for an analytical or "break it down" question, answer directly from the live data below rather than reaching for a tool. Never claim capabilities beyond your tools. Each tool proposes a change the user reviews and Applies; do not pretend a change is already live.
${brand}${viewCtx ? '\n\n' + viewCtx : ''}`.trim();

        const out = await callAnthropicAgentic(
          msgs.length ? msgs : [{ role: 'user', content: text }], sys, tools,
          // Apply each agent's own engine/model to its INNER generation — so
          // Blog→Haiku actually writes the blog on Haiku instead of Opus. This is
          // the main cost lever: the orchestrator can stay smart while the
          // heavy content generation runs on a cheaper model.
          (name, input) => {
            const dept = toolToDept[name];
            const ac = dept ? cfgMap[dept] : null;
            return runTool(name, input || {}, {
              db, tenant, brandContext: brand,
              engine: (ac && ac.engine) || def.engine || undefined,
              model: (ac && ac.model) || def.model || undefined,
            });
          },
          { apiKey: chosen.apiKey, model: orchModel,
            onUsage: (u) => recordTokenUsage({ tenant, model: u.model, engine: 'anthropic', usage: u.usage }) },
        );
        const fills = (out.toolResults || [])
          .filter((t) => t.result && ((t.result.fill && Object.keys(t.result.fill).length) || (Array.isArray(t.result.suggestedBlocks) && t.result.suggestedBlocks.length)))
          .map((t) => {
            const hasBlocks = Array.isArray(t.result.suggestedBlocks) && t.result.suggestedBlocks.length > 0;
            const fill = { ...(t.result.fill || {}) };
            // write_page returns the designed blocks separately — merge them into
            // the fill so Apply (executeDepartment 'page' reads fill.blocks) commits
            // ALL of them, not just the page shell. Blocks ⇒ it's a landing page.
            if (hasBlocks) fill.blocks = t.result.suggestedBlocks;
            return {
              department: toolToDept[t.name] || null, fill,
              section_type: t.result.section_type || null,
              page_type: hasBlocks ? 'landing' : (t.result.page_type || (t.input && t.input.page_type) || null),
            };
          });
        return res.json({
          ok: true, reply: out.reply || 'Done.', fills, agentic: true,
          // Orchestrator runtime. Each fill's own agent may run a different inner
          // model — the /scope list shows those per-agent.
          runtime: { ...(await describeRuntime(tenant, 'anthropic', orchModel)), agent: 'coordinator' },
        });
      } catch (e) {
        console.warn('[agent-chat/run] agentic loop failed, falling back to router:', e.message);
        // fall through to the house router path below
      }
    }

    const { routeMessage, runDepartment, departmentsForModule, MODULE_PRIMARY, isSmallTalk, isNavCommand } =
      await import('../../plugins/agentRouter.js');
    const deptScope = departmentsForModule(module);
    const primary = MODULE_PRIMARY[module];

    // Single-purpose surface (blog, pages, email, print, assets, onboarding): a
    // real request just runs the job. The house router model misclassifies even
    // explicit asks to 'assist', which is why the blog ✦ kept "going
    // conversational" and never wrote. Only defer to the LLM router for genuine
    // small talk or a navigation command; everything else does the job directly.
    let route;
    if (primary && !isSmallTalk(text) && !isNavCommand(text)) {
      route = { department: primary, task: text, section_type: 'text', page_type: 'content' };
    } else {
      route = await routeMessage(text, { contextModule: module });
    }

    // Same hard-scope as the agentic path: the router only BIASES toward a
    // module's department, so a blog-surface ask that "clearly names" copy can
    // still route to copy. If the routed department is outside this ✦'s module
    // scope, don't run its tool — drop to the conversational reply below, which
    // points the user at the right agent instead of mutating another surface.
    const inScope = !deptScope || deptScope.has(route.department);

    // Task → run the scoped department agent (engine/model/config resolved inside).
    if (route.department && route.department !== 'assist' && inScope) {
      const out = await runDepartment(db, tenant, { ...route, audience: 'admin' });
      return res.json({
        ok: true,
        reply: out.message || 'Done.',
        department: out.department || null,
        runtime: { ...(await describeRuntime(tenant, out.engine, out.model)), agent: out.department || null },
        fill: out.fill && Object.keys(out.fill).length ? out.fill : null,
        action: out.action || null,
        navigate: out.navigate || null,
        section_type: out.section_type || null,
        page_type: out.page_type || null,
      });
    }

    // Conversational → brief, guardrailed reply. Ephemeral: short client context,
    // no persistence. Engine follows the tenant key (Claude) or house.
    const { callLLM } = await import('../../plugins/agentMcp.js');
    const sys = `You are the ${module ? module + ' ' : ''}operations agent inside ${bizName}'s admin panel, talking to the owner/staff — peer-to-peer, direct, brief. ${viewCtx ? 'Answer their question DIRECTLY using the live data below — break it down with the real figures, call out what stands out (over/under budget, biggest lines), and be specific. Do not draft an invoice or any document unless they explicitly ask for one. ' : 'You coordinate the business\'s agents (blog, copy, design, social, email, invoices, clients, etc.). When they name a task, say exactly which agent will do it or ask for the one missing specific; keep replies short. '}Treat the brand context as reference, not your speaking style.
${brand}${viewCtx ? '\n\n' + viewCtx : ''}`.trim();
    const reply = await callLLM(msgs.length ? msgs : [{ role: 'user', content: text }], sys, 90000, { tenant, engine: def.engine, model: def.model });
    return res.json({
      ok: true, reply: reply || 'How can I help?',
      runtime: { ...(await describeRuntime(tenant, def.engine, def.model)), agent: 'conversation' },
    });
  } catch (err) {
    console.error('[agent-chat/run] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/resolve', async (req, res) => {
  try {
    const db = req.db;
    const kind = THREAD_KINDS.includes(req.body.kind) ? req.body.kind : 'agent';
    const module = req.body.module ? String(req.body.module).slice(0, 40) : null;
    const title = (req.body.title ? String(req.body.title).slice(0, 200) : '')
      || kind.charAt(0).toUpperCase() + kind.slice(1) + ' agent';
    const uid = req.adminUser?.id;

    // Canonical thread for this scope = the OLDEST active one (stable identity,
    // so the launcher always reopens the same conversation instead of the most
    // recently touched). refId is null for launcher/resolve threads.
    const scopeQ = module
      ? { kind, status: 'active', 'context.module': module, 'context.refId': null }
      : { kind, status: 'active', 'context.module': null };
    const findCanonical = () => db.collection('chat_threads').findOne(scopeQ, { sort: { createdAt: 1 } });

    let thread = await findCanonical();
    let created = false;
    if (!thread) {
      try {
        thread = await createThread(db, {
          kind, title,
          context: module ? { module } : null,
          createdBy: uid,
          members: uid ? [{ userId: uid, role: 'owner' }] : [],
        });
        created = true;
      } catch (e) {
        // Lost a create race against a concurrent open (unique index) — the
        // winner exists now; reuse it instead of minting a duplicate.
        if (e && e.code === 11000) thread = await findCanonical();
        else throw e;
      }
    }
    // Add the requester as a member only when reusing (create already sets owner).
    if (thread && !created && uid) await addMember(db, thread._id, { userId: uid, role: 'collaborator' });

    res.json({
      ok: true,
      threadId: String(thread._id),
      title: thread.title,
      kind: thread.kind,
      tenantDb: req.tenant?.db || '',
    });
  } catch (err) {
    console.error('[agent-chat/resolve] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
