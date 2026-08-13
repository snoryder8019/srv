---
scope: AI agent system
updated: 2026-07-20
---

# AI Agent System

The March 2026 "five agents" model is gone. Today there is **one shared brain**
(routing + department execution), a **registry** of ~25 configurable department
agents, an **engine seam** that picks the LLM backend, and an **audience gate**
that decides who may drive which department.

## Layers

```
                       ┌─ routes/admin/masterAgent.js   (dashboard HTTP)
plugins/agentRouter.js ┼─ routes/admin/agentChat.js     (ephemeral ✦ turn)
   routeMessage()      └─ plugins/chat.js dispatchAgent (persistent threads)
   runDepartment()
   executeDepartment()
        │
        ├─ plugins/agentAudience.js   who may reach this department
        ├─ plugins/agentRegistry.js   which agent / per-tenant config
        ├─ plugins/agentEngine.js     house (Ollama) vs Anthropic
        └─ plugins/agentMcp.js        MCP_TOOLS + runTool + callLLM
```

## `plugins/agentRegistry.js` — the agent catalog
The single catalog of every "assigned agent", surfaced as first-class and
configurable in Agent Control (`/admin/chat`). Keep `key` + `tool` in sync with
`agentRouter.js`'s `DEPARTMENT_TOOL` and `agentAudience.js`'s
`DEPARTMENT_FEATURE`.

Each entry: `{ key, label, category, scope, tool, feature, desc }` where
`scope` is `public` (visitor-facing, guardrail hard, assist only) or `private`
(staff/admin only).

`AGENT_CATEGORIES = ['Coordinator', 'Support', 'Content', 'Design', 'Marketing',
'Finance', 'Clients']`

| Category | Agents (key → tool) |
|----------|---------------------|
| Coordinator | `coordinator` — the multi-tool orchestrator; its MODEL drives every multi-tool turn (default Sonnet, much cheaper than Opus). Engine/enabled don't apply. |
| Support | `assist` — the **only** agent a public visitor can reach |
| Content | `blog`→`write_blog_post`, `copy`→`fill_site_copy`, `section`→`fill_section`, `page`→`write_page` |
| Design | `design`→`update_design`, `theme`→`update_theme`, `typography`→`update_typography`, `visibility`→`set_section_visibility` |
| Marketing | `social`→`write_social_post`, `social_batch`→`generate_social_batch`, `carousel`→`build_seamless_carousel`, `story`→`build_story_sequence`, `social_insights`→`get_social_insights`, `social_score`→`score_live_posts`, `autopilot`→`get_autopilot_config`, `asset`→`generate_social_image`, `email`→`write_campaign`, `print`→`write_print_copy` |
| Finance | `invoice`→`draft_invoice` |
| Clients | `outreach`→`draft_client_email`, `research`→`research_client`, `onboarding`→`suggest_onboarding_fields` |

**Per-agent config** lives in the per-tenant `agent_config` collection. A row
overrides one agent's `engine`/`model` and can disable it. No row = enabled,
engine/model inherit. Precedence: **agent > thread kind > tenant default >
platform default**, applied in `runDepartment`.

Exports: `agentsByCategory()`, `agentByKey()`, `getAgentConfigMap(db)`,
`getAgentConfig(db, key)`, `setAgentConfig(db, key, {...})`,
`getTenantDefault(db)`, `setTenantDefault(db, {...})`, `agentLLMOpts(db, tenant, key)`.

## `plugins/agentRouter.js` — the shared brain
Extracted from `masterAgent.js` so the dashboard, the ✦ launcher and socket chat
threads all share one routing implementation. "Design-via-chat" needed no new
agent: a chat thread routes through `routeMessage()` → `runDepartment()` and the
`design` department reuses `update_design` verbatim.

| Export | Purpose |
|--------|---------|
| `ROUTING_PROMPT` | Classifier prompt → `{ department, task, section_type, page_type, nav_target }` |
| `routeMessage(message, { contextModule, kind })` | Route one message. Has an LLM-free fast path for `navigate`. |
| `runDepartment(db, tenant, {...})` | Generate — returns a proposed `fill` |
| `routeAndRun(db, tenant, message, opts)` | The two combined |
| `executeDepartment(db, tenant, {...})` | Commit the `fill` to the DB |
| `departmentsForTools(tools)` | Given an agent's configured MCP tool list, the Set of departments it may route to. `assist` + `navigate` always allowed. `null` = unrestricted. This is what keeps a scoped support bot away from the invoice or design tools. |
| `DEPT_ACTIONS` | Per-department "where the human goes to review/commit" label + URL |
| `NAV_MAP` | Trimmed name → admin URL map for the `navigate` fast path |
| `MODULE_DEPARTMENT` | Thread-context → preferred department, biasing routing inside a module's chat |

`MODULE_DEPARTMENT` deliberately has **no** `bookkeeping` entry: the only finance
tool is `draft_invoice`, and biasing to it turned analytical asks ("break down
our budget") into invoices. Finance falls through to the conversational path,
which is fed live ledger/budget data via `plugins/agentViewContext.js`.

> The docstring notes the commit half was originally not lifted out of
> `masterAgent.js`. `executeDepartment` now exists in `agentRouter.js`; the
> `/admin/master-agent/execute` route still exists too. Which one a given surface
> uses is **not fully verified** — check the caller before assuming.

## `plugins/agentAudience.js` — who may drive what
The ✦ launcher is universal (visitors, collaborators, admins). What it may DO is
not. `routeMessage`/`runDepartment` MUST call `assertDepartmentAllowed()` after
routing.

| Tier | Allowed |
|------|---------|
| `public` | `PUBLIC_DEPARTMENTS = ['assist']`. No mutating departments. Lead capture is a deterministic `captureContact` form flow in `plugins/chat.js`, **not** an agent department. |
| `collaborator` | Departments whose backing feature they can see — reuses `featureRegistry.canSeeFeature`, one source of truth, not a parallel model |
| `admin` | Owner or unrestricted admin — all departments |

`DEPARTMENT_FEATURE` maps each mutating department to its governing admin
feature (copy/section → `design`; research/outreach → `clients`;
theme/typography/visibility → `design`; invoice → `bookkeeping`; …).

Also exports `resolveAudience(user, ctx)`, `departmentsForAudience()`,
`suggestionsFor(audience, brand, ctx, n, module)` (the ✦ chips).

## `plugins/agentEngine.js` — the BYO-Claude seam
ONE chokepoint deciding which LLM backend a generation runs on:

- `house` → Ollama (`callLLM` in `agentMcp.js`) — the shared default
- `anthropic` → Claude, via a key the **tenant** brought to the custom-key vault
  (`/admin/settings/keys` → `anthropic_api_key`), or the platform-level
  `config.ANTHROPIC_API_KEY` for unscoped paths

`resolveEngine({ tenant, engine, model })`:
- `engine === 'house'` → house (explicit opt-out wins even if a key exists)
- `engine === 'claude-code'` → house. BYO Pro/Max via the Agent SDK is a
  different surface and **is not built** — the panel marks it "soon" and promises
  a House fallback
- a key is available → `{ engine: 'anthropic', apiKey, model }`
- `engine === 'anthropic'` with no key → **degrades to house**, never errors

`ANTHROPIC_MODELS` is the single source for the model selector, its
save-validation, and `resolveEngine`: `claude-opus-4-8` (default,
`config.ANTHROPIC_MODEL`), `claude-sonnet-5`, `claude-haiku-4-5`.
`config.ANTHROPIC_COORDINATOR_MODEL` defaults to Sonnet.

**Tenant scope crosses un-plumbed call sites via `AsyncLocalStorage`.** MCP tool
handlers receive `ctx` but not per-call opts, so interactive entry points wrap
their work in `withEngine({ tenant, engine })` and `callLLM` reads that scope
when no explicit `opts.tenant` is passed. This is concurrency-safe — unlike a
module global, each async chain sees only its own tenant.

Other exports: `callAnthropic()`, `callAnthropicAgentic()` (multi-round tool
loop, Claude only — never do this with the house model),
`recordTokenUsage()` → `slab.token_usage`.

## `plugins/agentMcp.js` — tools + house LLM
Shared tool registry and the JSON-RPC handler.

**Core pattern for house (small) models — search-first, inject-context, single
call.** `qwen2.5:7b` does not reliably loop through tool calls:
1. `webSearch(query)` (Brave, `SEARCH_API_KEY`)
2. inject results into the system prompt as context
3. one completion
4. parse with `tryParseAgentResponse()` — a 3-layer parser (standard,
   newline-fix, regex fallback). **Never raw `JSON.parse`.**

`MCP_TOOLS` (server name `slab-agents`), ~28 tools:
```
web_search  fill_site_copy  write_blog_post  fill_section  write_page
generate_social_image  update_theme  update_typography  set_section_visibility
update_design  manage_assets  write_campaign  draft_invoice  draft_client_email
research_client  analyze_metrics  suggest_onboarding_fields  write_social_post
write_print_copy  generate_social_batch  build_seamless_carousel
build_story_sequence  generate_spotlight_post  score_live_posts
get_social_reliability  get_social_insights  get_autopilot_config
set_autopilot_config
```

Other exports: `callLLM`, `callVisionLLM` (`OLLAMA_VISION_MODEL`, default
`minicpm-v:latest`), `generateSdImage` / `buildBrandedSdPrompt` (Stable
Diffusion on the same backend), `fetchUrl`, `stripThink`, `stripCJK`,
`runTool(name, args, ctx)`, `handleMcpRequest(body, ctx)`,
`readToolUsage()` (→ `slab.mcp_tool_usage`), `recordTrainingCandidate()`
(→ `slab.training_candidates`).

## Routes

| Route | Purpose |
|-------|---------|
| `POST /admin/master-agent` | Generate (dashboard) |
| `POST /admin/master-agent/research` | Step 1 — classify + one web search |
| `POST /admin/master-agent/plan` | Multi-step plan |
| `POST /admin/master-agent/run-task` | Run one planned task |
| `POST /admin/master-agent/execute` | Commit to DB |
| `POST /admin/master-agent/mcp` | JSON-RPC 2.0 (`handleMcpRequest`) |
| `GET /admin/master-agent/mcp` | Discovery |
| `GET /admin/master-agent/suggestions` \| `/digest` \| `/usage` \| `/tool-usage` \| `/briefing` | Read surfaces |
| `POST /admin/master-agent/feedback` | → `agent_feedback` (TTL-free on purpose) |
| `POST /admin/agent-chat/run` | **Ephemeral** agentic turn — no persistent thread |
| `POST /admin/agent-chat/resolve` | Find-or-create the one persistent thread per `{kind, context.module}` |
| `GET /agent/suggestions` | Public — mounted outside `/admin`, audience-scoped chips |
| `/admin/chat` | Agent Control panel — `adminOnly` + `experimental` |

`/admin/agent-chat` is deliberately **not** under the feature-gated
`/admin/chat`: `matchFeatureByPath` finds no feature for that path, so
`enforceFeatureAccess` lets any authed admin/collaborator through. The chat
*capability* is untagged substrate; the *control panel* is gated.

`POST /admin/agent-chat/run` is the current admin personal-agent model: **no
persistent thread**, short memory is the client-held `messages` array, the server
is stateless. A task message routes to the narrow-scoped department agent and
returns a proposed `fill` for the human to Apply; a conversational message gets a
brief guardrailed reply. This replaces the older resolve→thread→socket path for
admin surfaces.

## Chat substrate (`plugins/chat.js` + `chatSocket.js`)
Chat is not a page — it's an embeddable substrate inside Design, Clients,
Meetings, agent panels. Two **per-tenant** collections: `chat_threads` and
`chat_messages` (one doc per message, not an embedded array — perpetual chat
would blow the 16MB doc cap and can't paginate). Mongo is the source of truth;
the `/chat` Socket.IO namespace is live delivery only, so history survives
reconnects and restarts.

Access control is two deliberately separate layers:
1. **Capability** — chat is untagged infra; an embedded thread inherits the
   permission of whatever hosts it (design-chat needs `design`, client-chat needs
   `clients`). Enforced via `thread.context` + `canAccessThread()`. Standalone
   threads fall back to explicit membership.
2. **Membership** — the `members[]` array, enforced **server-side at socket
   join** in `chatSocket.js`.

## Brand Context (`plugins/brandContext.js`)
All agent prompts inject the tenant brand profile:
- `buildBrandContext(brand, design)` — from loaded objects
- `loadBrandContext(tenant, db)` — from DB

`plugins/agentViewContext.js` supplies live module data (e.g. ledger/budget) to
the conversational path.

## LLM Config
- House endpoint: `OLLAMA_URL` (default
  `https://ollama.madladslab.com/v1/chat/completions`), Bearer `OLLAMA_KEY`
- House model: `OLLAMA_MODEL` (default `qwen2.5:7b`)
- Vision: `OLLAMA_VISION_MODEL` (default `minicpm-v:latest`)
- Anthropic: `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` /
  `ANTHROPIC_COORDINATOR_MODEL`, or the per-tenant vault key
- Search: Brave via `SEARCH_API_KEY`
- The Ollama backend runs on a GPU box with a history of flaky-GPU TDR resets —
  guard against non-JSON responses, never assume a well-formed reply

## Huginn — DORMANT
Huginn was the superadmin AI assistant (chat, Control Center, `/huginn/mcp`
JSON-RPC, `/huginn/webhook`, a `/huginn` Socket.IO namespace). As of 2026-07-20:

- `routes/huginn-mcp.js` and `routes/huginn-webhook.js` imports **and** mounts
  are commented out in `app.js`
- `routes/admin/huginn.js` is commented out in `routes/admin.js`
- The `/huginn` Socket.IO namespace no longer exists in `plugins/socketio.js`

`plugins/huginnMcp.js` and the `huginn_tasks` / `huginn_notes` /
`huginn_conversations` registry collections still exist but nothing reachable
reads them. Design notes are in `docs/archive/huginn-dev-notes/`. Treat as
historical — the platform-intelligence role has effectively been taken over by
`/superadmin/reports` (`plugins/observe.js`) and the route-usage dashboard.
