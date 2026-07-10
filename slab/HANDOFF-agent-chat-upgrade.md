# HANDOFF — Agent + Chat Master Upgrade

Status: Phases 0+1 LIVE (verified 2026-07-02). Chat substrate wired into the running
systemd service (srv-slab); admin modal at /admin/chat confirmed working end-to-end
from a real admin browser session (join/send/persist/replay + reconnect self-heal).
Phase 1 COMPLETE (2026-07-02): executeDepartment extracted to plugins/agentRouter.js
(heavy deps lazy-loaded); masterAgent /execute is now a thin delegating wrapper —
one shared committer for dashboard Apply and chat Apply. Verified with live writes.
BONUS shipped early from Phase 3: contact-capture chatflow (captureContact per kind
→ inline Name/Phone/Email form message → native inquiries lead + thread stamp). This doc is the single reference for the chat-substrate +
unified-agent + design-overhaul upgrade. It supersedes the per-module agent cards
and the templates approach.

---

## Vision (why)

Chat is not a page — it's a **substrate** that appears anywhere an agent is useful
(dashboard, design, clients, meetings, the public site). Every agent interaction
uses ONE pattern:

    ✦ launcher → chat modal → task-scoped tooling → input + workflow + suggestions

The launcher is universal. What it can DO is scoped by two inputs:
  • context (where it was clicked) → the task/department
  • audience (who clicked it)      → the allowed toolset

This collapses ~600 lines of bespoke dashboard agent UI (and every per-module
copy of it) into one parameterized component, backed by one shared brain, with
one permission gate. Stronger models (BYO) plug in at a single seam.

---

## Architecture decisions locked this session

1. **Chat persistence = dedicated collections**, never embedded arrays.
   `chat_threads` + `chat_messages` (messages own docs, indexed
   {threadId, createdAt}). Mongo is source of truth; sockets are live delivery.

2. **Two-layer access.** Capability (can you use chat) is untagged substrate —
   an embedded thread inherits the permission of its host module
   (thread.context.module). Membership (can you see THIS thread) is the
   members[] array, enforced at socket join. Only the control panel is feature-
   tagged (adminOnly + experimental).

3. **One shared agent brain.** Routing + department→tool table + committer live
   in plugins/*, reused by BOTH the dashboard HTTP master agent AND the chat
   socket. No second chat client, no duplicated routing.

4. **Audience gating is server-side and central.** plugins/agentAudience.js is
   the only gate. public → concierge (assist + inquiry only); collaborator →
   departments their features allow; admin → all. A visitor can never reach a
   mutating/finance tool regardless of client payload.

5. **Design = tokens + blocks, templates retired.**
   • tokens  = THEME (flat, serializable, agent-targetable) — colors/fonts/style
   • blocks  = LAYOUT (ordered block array) — the drag-drop / interactive surface
   • copy    = kept, but FIELD-TARGETED (each copy input gets its own ✦ scoped to
               {section, field, current value})
   Both tokens and blocks are MCP-controllable, so any agent — or a stronger BYO
   engine — can drive design. Templates freeze combinations the agent should set
   freely, so they go away.

6. **BYO engine at one chokepoint (callLLM).** house (Ollama) | anthropic (BYO
   API key, stored in the existing AES-256 tenant secret vault) | claude-code
   (BYO Pro/Max via the Claude Code Agent SDK — different surface than the raw
   Messages API; a subscription is NOT an API key). Per-agent engine chosen in
   the chatflow matrix.

---

## Built this session (additive, unwired — nothing live touched)

  plugins/chat.js          Chat substrate: threads/messages, membership,
                           canAccessThread, chatflow matrix, dispatchAgent,
                           chatbotEnabled(tenant).
  plugins/chatSocket.js    /chat Socket.IO namespace (join/message/history/typing),
                           membership enforced at join + re-checked on write.
  routes/admin/chat.js     Control surface: thread lock/archive/delete, membership,
                           transcript inspect, chatflow matrix CRUD. adminOnly.
  plugins/agentRouter.js   Shared brain (generative half): routeMessage,
                           runDepartment, routeAndRun, department→tool table.
  plugins/agentAudience.js Audience policy: resolveAudience, departmentsForAudience,
                           assertDepartmentAllowed, suggestionsFor.

---

## Phased plan

### Phase 0 — Wire the foundation (turn built code on)
- featureRegistry: add { key:'chat', section:'Admin', url:'/admin/chat',
  adminOnly:true, experimental:true }.
- routes/admin.js: import + mount adminChatRouter at '/chat'.
- plugins/socketio.js: call initChatNamespace(io) before `return io;`.
- settings.js: add 'chatbotEnabled' to PUBLIC_FIELDS + boolean normalization;
  add the toggle to the settings view.
- Smoke-test a /chat round-trip on the madladslab tenant.
Depends on: nothing. Unblocks everything.

### Phase 1 — Complete the shared brain
- Extract masterAgent /execute writers → executeDepartment(db, tenant, {...}) in
  agentRouter (so chat's Apply and the dashboard share one committer).
- Wire assertDepartmentAllowed() into runDepartment (add {audience, ctx}); degrade
  gracefully on AGENT_FORBIDDEN.
- Add GET /agent/suggestions (audience-aware, safe for unauthed).
- (Optional, DRY) point routes/admin/masterAgent.js at agentRouter — zero behavior
  change, proves reuse.
Depends on: none (can parallel Phase 0).

### Phase 2 — Universal ✦ launcher
- Build ONE shared launcher component: glyph + modal with input + workflow +
  suggestions + message-level Apply/Open affordances (meta.fill seam already
  exists). Parameterized by {context/department, audience}.
- Field-level ✦ on copy inputs → modal pre-scoped to {section, field, current
  value} for TARGETED copy completion (the "better frame per input" win).
- Retire the dashboard bespoke agent card → slim launcher or compact mini-thread
  wired to a persistent kind:'agent' thread (agent history becomes perpetual).
Depends on: Phase 1.

### Phase 3 — Public surface
- Map the public tenant-site shell (layout + JS conventions).
- Public ✦ concierge: assist (brand-aware Q&A) + inquiry (lead capture) ONLY.
Depends on: Phase 2 + confirmed public scope.

### Phase 4 — Design overhaul
- New ordered block-array layout primitive + drag-drop UI (agent reorders the
  same array a human drags). Split theme tokens from layout blocks.
- Full-schema, single-source MCP design tool generated from DESIGN_DEFAULTS /
  COPY_SECTIONS (fixes the current 3-way schema drift across DESIGN_DEFAULTS, the
  design-agent prompt, and update_design).
- Kill templates.
Depends on: Phase 1 (brain), Phase 2 (field-level ✦).

### Phase 5 — BYO engine
- Provider layer at callLLM: house | anthropic (BYO key) | claude-code (BYO sub
  via Agent SDK).
- Per-agent engine via the chatflow matrix (already stubbed).
- Bonus: a reliable engine retires much of the fragile JSON-parsing scaffolding
  in agentMcp.js (sentinel blocks, single-quote fallbacks) in favor of native
  tool-calling — which is exactly what MCP-controllable design wants.
Depends on: highest value after Phase 4.

---

## Open decisions
- Public agent ceiling: assist + inquiry only? (no booking / no pricing quotes?)
- Does the ✦ appear on the public live site now, or admin-only until Phase 3?
- Collaborator UX when they hit a department they lack (explain vs. reroute).
- Dashboard agent card removal: permanent strip from dashboard.ejs?
