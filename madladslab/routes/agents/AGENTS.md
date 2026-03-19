# Agents Module — Coding Reference

Mounted at `/agents/*` inside **madladslab** (port 3000). All routes require `isAdmin` middleware (`req.user.isAdmin === true`), except `forwardchat` plugin endpoints which use `pluginCors` + token auth.

---

## Package Structure

```
routes/agents/
  index.js          — combines all sub-routers
  agents.js         — CRUD, hierarchy, status, views
  chat.js           — agentic chat loop + internal agent-to-agent messaging
  background.js     — autonomous background process manager
  mcp.js            — MCP tool definitions, executors, config routes
  memory.js         — memory layer CRUD (KB, conversations, summary, notes)
  actions.js        — AgentAction log, task queue, crons, notes, namespace reset
  tuning.js         — systemPrompt, LLM params
  forwardchat.js    — site registration, plugin verification, forwardChat deployment
  middleware.js     — isAdmin/requireAgents guards, researcher/vibecoder pre-processing
  reports.js        — agent activity reports
  task-helpers.js   — shared task queue utilities

views/agents/
  hub.ejs                     — main two-panel hub (sidebar + detail)
  digest.ejs                  — background activity feed
  display.ejs                 — TV/wall dashboard
  reports.ejs                 — reports viewer
  partials/_modal-chat.ejs    — chat modal
  partials/_modal-create.ejs  — create/edit agent modal
  partials/_modal-logs.ejs    — logs viewer modal

public/javascripts/
  agents-hub.js       — hub two-panel client (sidebar, tabs, socket, header actions)
  agents-ui.js        — chat modal, create modal, forwardChat panel, card interactions
  agents-client.js    — detail modal tabs, socket subscriptions
  agents-presets.js   — AGENT_PRESETS definitions, librarian/clone utilities
  agents-digest.js    — digest page client
```

---

## Data Models

### Agent (`api/v1/models/Agent.js`)

| Field | Type | Notes |
|---|---|---|
| `name`, `description` | String | |
| `role` | String | `assistant \| researcher \| vibecoder \| forwardChat` |
| `model`, `provider` | String | provider always `ollama` |
| `tier` | String | `apex \| executive \| manager \| worker` |
| `parentAgent` | ObjectId | ref Agent; apex always null |
| `status` | String | `idle \| running \| stopped \| error` |
| `config` | Object | `systemPrompt`, `temperature`, `contextWindow`, `maxTokens`, `topP`, `topK`, `repeatPenalty`, `backgroundPrompt`, `backgroundInterval`, `backgroundRunning` |
| `memory` | Object | see Memory Layers |
| `mcpConfig` | Object | `enabledTools[]`, `backgroundEnabledTools[]` |
| `forwardChat` | Object | `bihEnabled`, `sites[]` (`{ siteId, enabled }`), `guardrails` (consumer limits) |
| `bihBot` | Object | `enabled`, `trigger`, `displayName`, `avatar`, `chatMode` (`passive\|active\|agent`), `allowedRoles[]`, `rateMs` |
| `bgProductivity` | Object | `score`, `consecutiveIdle`, `totalTicks`, `activeTicks` |
| `bgTickHistory[]` | Array | last 10 tick records: `title`, `summary`, `nextFocus`, `idle`, `timestamp` |
| `logs[]` | Array | last 50 log entries: `level`, `message`, `timestamp` |
| `capabilities[]` | Array | string tags |
| `project`, `category` | String | organisation fields |

### AgentAction (`api/v1/models/AgentAction.js`)
Types: `background`, `tldr`, `task_list`, `image`, `finding`.

### agent_tasks (raw collection)
Fields: `agentId`, `title`, `description`, `priority` (`high|medium|low`), `priorityScore` (3/2/1), `status` (`pending|complete|cancelled|needs_human`), `source` (`operator|self|promoted`), `humanReply`.

### agent_notes (raw collection)
Agent-writable via `mongo_write` MCP tool. Fields: `agentId` + arbitrary agent-defined fields.

### agent_crons (raw collection)
Fields: `agentId`, `title`, `content`, `intervalMinutes`, `nextRun`, `lastRun`, `active`.

---

## Page Routes

| Route | View | Notes |
|---|---|---|
| `GET /` | — | redirects to `/agents/hub` |
| `GET /hub` | `hub.ejs` | main hub; passes `agents[]` + `user` |
| `GET /digest` | `digest.ejs` | background activity feed |
| `GET /display` | `display.ejs` | TV/wall dashboard; agents grouped by category |
| `GET /reports` | `reports.ejs` | activity reports |

---

## Agent CRUD (`agents.js`)

```
GET    /api/agents                    — all agents
GET    /api/agents/:id
POST   /api/agents                    — create (required: name, model)
PUT    /api/agents/:id                — update fields
DELETE /api/agents/:id
PATCH  /api/agents/:id/status         — set status (idle/running/stopped/error)
GET    /api/agents/:id/logs           — last 50 logs (reversed)
GET    /api/agents/hierarchy          — org chart (name/role/status/tier/parentAgent)
PUT    /api/agents/:id/hierarchy      — set tier + parentAgent
PUT    /api/agents/:id/capabilities   — replace capabilities array
PATCH  /api/agents/:id/bih-bot        — toggle bihBot (enabled, trigger, displayName, avatar)
PUT    /api/agents/:id/bih-bot/chat-mode
PUT    /api/agents/:id/bih-bot/roles
GET    /api/ollama/test               — list models from OLLAMA_BASE_URL
```

`PUT /api/agents/:id` accepts flat fields including: `name`, `description`, `model`, `role`, `category`, `systemPrompt`, `temperature`, `maxTokens`, `topP`, `topK`, `repeatPenalty`, `backgroundPrompt`.

**Support relationship roles (16 values):** `prompt-cleaner`, `kb-curator`, `reviewer`, `background-support`, `summarizer`, `fact-checker`, `tone-adjuster`, `context-injector`, `quality-gate`, `escalation-handler`, `data-validator`, `memory-manager`, `task-planner`, `output-formatter`, `content-filter`, `custom`.

---

## Chat Pipeline (`chat.js`)

### `POST /api/agents/:id/chat`

**Message assembly order:**
1. System prompt
2. Live session context (agent name, user identity, timestamp, agent roster)
3. Thread summary (`memory.threadSummary`)
4. Long-term memory/notes (`memory.longTermMemory`)
5. Background findings (`memory.bgFindings`, capped last 1500 chars)
6. Knowledge base (last 12 entries, 300 chars each)
7. Recent conversations (last 10)
8. User message

**Role middleware (pre-loop):**
- `researcher` → `runResearcherMiddleware` → structured TLDR → `AgentAction(tldr)` → injected as system message
- `vibecoder` → `runVibecoderMiddleware` → numbered task breakdown → `AgentAction(task_list)` → injected as system message

**Agentic tool loop (max 10 iterations):**
- Builds enabled tool list from `agent.mcpConfig.enabledTools`
- Image intent intercept: if `generate-image` enabled and message matches image pattern, fires `generate_image` directly before loop
- Each iteration: `POST OLLAMA_BASE_URL/v1/chat/completions`
- `tool_calls` in response → `executeMcpTool` → push result → loop
- Text response → `finalResponse` → break

**Post-loop (fire-and-forget):**
- `updateThreadSummary` — LLM rewrites thread summary
- `updateLongTermMemory` — LLM extracts decisions/action items → merged into notes
- `extractKnowledge` — every 5 turns: LLM extracts reusable facts → KB entry
- **Conversation compaction** — at 20 convos: oldest 10 → summarised into KB, trimmed

### `POST /api/agents/:id/chat-internal`
No session auth — uses `BOT_ALERT_SECRET`. Simplified loop (no tools, last 5 convos). Used by `message_agent` MCP tool and bih service.

---

## Background Process System (`background.js`)

In-memory Map: `backgroundProcesses` — `agentId → { intervalId, startedAt, lastRun, runCount, intervalMs }`.

**Lifecycle:**
- `startBackgroundProcess(io, agent)` / `stopBackgroundProcess(io, agentId)`
- Persists state to `agent.config.backgroundRunning`
- `resumeBackgroundProcesses()` on server start re-attaches all agents with `backgroundRunning: true`

**Tick logic (`runBackgroundTick`):**
1. Fresh agent fetch from DB
2. Build `bgTools` from `mcpConfig.backgroundEnabledTools`
3. Fetch up to 5 pending tasks (sorted by priorityScore desc)
4. Evaluate productivity: `consecutiveIdle >= 2` → `stuck = true`
5. Build reasoning context from last 6 tick history entries
6. Directive mode selection:
   - Custom `backgroundPrompt` set → use it with reasoning context prepended
   - Pending tasks → task execution directive
   - `stuck` → task invention mode (forces `newTasks` in output)
   - Default → generic autonomous tick with JSON output schema
7. Inject memory layers + subordinate briefings (for manager/executive/apex)
8. `POST OLLAMA_BASE_URL/api/chat` (native Ollama, not `/v1/`)
9. One round of tool execution if tool calls returned
10. Parse JSON: `{ title, content, pushToChat, completedTaskIds, newTasks, nextFocus, productivityNote }`
11. **Dedup check**: before saving, queries for existing AgentAction with same `agentId+type+title` within `2 × backgroundInterval` minutes — updates content instead of inserting to prevent repeated entries
12. Save AgentAction, emit sockets, append to `bgFindings`, update tick history + productivity
13. Every 5 active ticks → distill `bgFindings` into KB entry

**Routes:**
```
GET  /api/background/status
POST /api/agents/:id/background/start
POST /api/agents/:id/background/stop
PUT  /api/agents/:id/background/config   — backgroundPrompt, backgroundInterval (1–1440 min)
PUT  /api/agents/:id/background/tools    — set backgroundEnabledTools
```

**Hierarchy briefings:**

| Tier | parentAgent | Briefed on |
|---|---|---|
| `apex` | always null | ALL other agents |
| `executive` | any apex | direct children |
| `manager` | any executive | direct children |
| `worker` | any manager | none |

Each briefing: subordinate name/role/status + last 250 chars of `longTermMemory`.

---

## MCP Tool System (`mcp.js`)

Defined in `MCP_TOOL_DEFINITIONS` (Ollama function-calling format). Executed via `executeMcpTool(toolName, args)`.

### Tool Catalog

| Key | Function | Category | Constraints |
|---|---|---|---|
| `read-file` | `read_file` | filesystem | `/srv` only, max 10 MB |
| `write-file` | `write_file` | filesystem | `/srv` only, blocks `.env` files, creates dirs |
| `list-directory` | `list_directory` | filesystem | `/srv` only |
| `file-find` | `file_find` | filesystem | `/srv` only, maxDepth 8 |
| `grep-search` | `grep_search` | filesystem | ripgrep-style, max 200 results |
| `log-tail` | `log_tail` | filesystem | `/srv` or `/var/log`, max 500 lines |
| `git-status` | `git_status` | git | read-only: status/log/diff/branch/show |
| `execute` | `execute` | shell | blocks: `killall`, `pkill -9`, `rm -rf /`, `dd if=`, `mkfs`, `reboot`, `shutdown`, `init 0/6` |
| `process-list` | `process_list` | shell | `ps aux` with optional filter |
| `tmux-sessions` | `tmux_sessions` | shell | `tmux ls` |
| `tmux-logs` | `tmux_logs` | shell | `tmux capture-pane` |
| `service-port` | `service_port` | shell | `lsof -ti` |
| `npm-run` | `npm_run` | shell | allowed scripts: `test/lint/build/check/typecheck/validate` |
| `http-request` | `http_request` | network | `localhost`, `127.0.0.1`, `*.madladslab.com` only |
| `web-search` | `web_search` | network | Brave Search API (`SEARCH_API_KEY`) |
| `fetch-url` | `fetch_url` | network | any public URL, strips HTML, max 20k chars |
| `mongo-find` | `mongo_find` | database | read-only; allowed: agents/users/threads/agent_actions/sessions/agent_tasks/agent_notes |
| `mongo-write` | `mongo_write` | database | write to `agent_notes` or `agent_tasks` only |
| `bih-chat` | `bih_chat` | integrations | `POST localhost:3055/api/bot-alert` |
| `context` | `get_context` | meta | reads `/srv/{project}/docs/CLAUDE.md` |
| `cron-job` | `cron_job` | shell | manage `/etc/cron.d/agent-*` files |
| `message-agent` | `message_agent` | agents | `POST /agents/api/agents/:id/chat-internal` |
| `generate-image` | `generate_image` | media | SD v1.5 via `ollama.madladslab.com`, uploads to Linode, returns URL + markdown |

**Internal execute endpoint:** `POST /api/mcp/execute-internal` — authenticated by `BOT_ALERT_SECRET`, verifies tool is in agent's `enabledTools`.

**Config routes:**
```
GET  /api/mcp/available-tools     — full tool list with descriptions + categories
GET  /api/agents/:id/mcp          — agent's current mcpConfig
POST /api/agents/:id/mcp/enable   — set enabledTools[]
```

---

## Memory Layers (`memory.js`)

| Layer | Field | Written by | Used in chat context |
|---|---|---|---|
| Thread summary | `memory.threadSummary` | Auto after each chat turn | ✓ |
| Long-term memory | `memory.longTermMemory` | Auto extracted + manual | ✓ |
| Background findings | `memory.bgFindings` (max 5000 chars) | BG tick appends | Last 1500 chars |
| Knowledge base | `memory.knowledgeBase[]` | Extracted every 5 turns / promoted | Last 12 entries |
| Conversations | `memory.conversations[]` | Each chat turn | Last 10 |
| Tick history | `bgTickHistory[]` | BG tick | Last 6 in BG reasoning |

**Routes:**
```
GET    /api/agents/:id/memory
GET    /api/agents/:id/memory/stats
POST   /api/agents/:id/memory/knowledge
DELETE /api/agents/:id/memory/knowledge/:knowledgeId
PUT    /api/agents/:id/memory/summary
PUT    /api/agents/:id/memory/notes
DELETE /api/agents/:id/memory              — full clear
```

---

## Actions, Tasks, Crons, Notes (`actions.js`)

```
GET    /api/agents/:id/actions?type=&limit=
GET    /api/actions?type=&limit=                        — global feed
POST   /api/agents/:id/actions/:actionId/promote        — → knowledge KB or longterm notes
POST   /api/agents/:id/actions/:actionId/promote-task   — create task from action
DELETE /api/agents/:id/actions/:actionId
POST   /api/agents/:id/actions                          — operator-inject action

GET    /api/agents/:id/tasks?status=
POST   /api/agents/:id/tasks
DELETE /api/agents/:id/tasks/:taskId
POST   /api/agents/:id/tasks/:taskId/reply              — human reply to needs_human task
GET    /api/tasks/scorecard                             — per-agent pending + needs_human counts
GET    /api/tasks/approval-queue                        — all needs_human tasks

GET    /api/agents/:id/crons
POST   /api/agents/:id/crons
DELETE /api/agents/:id/cronns/:cronId

GET    /api/agents/:id/notes
DELETE /api/agents/:id/notes/:noteId

POST   /api/agents/:id/namespaces/reset                 — bulk wipe collections for one agent
POST   /api/agents/namespaces/reset-all                 — bulk wipe org-wide
```

---

## Tuning (`tuning.js`)

```
GET /api/agents/:id/tuning    — systemPrompt, systemPromptHistory, adjustableParams, LLM config, bihBot
PUT /api/agents/:id/tuning    — update systemPrompt (logged to history), temp, maxTokens,
                                contextWindow, topP, topK, repeatPenalty,
                                bihBot.displayName / avatar / rateMs
```

---

## forwardChat (`forwardchat.js`)

External site chat deployment system. Sites register a plugin token; the plugin widget posts messages to the verify endpoint which routes to the assigned agent.

```
GET    /api/forwardchat/sites
GET    /api/forwardchat/sites/:id
POST   /api/forwardchat/sites                   — register site (siteName, siteUrl, origin)
PUT    /api/forwardchat/sites/:id
DELETE /api/forwardchat/sites/:id
PATCH  /api/forwardchat/sites/:id/agent         — assign/unassign agent to site

PATCH  /api/agents/:id/forwardchat/bih          — toggle bih platform deployment
PATCH  /api/agents/:id/forwardchat/config       — forwardChat agent config

POST   /api/forwardchat/verify/:token           — plugin endpoint (CORS, no auth)
GET    /api/forwardchat/meta                    — plugin endpoint, returns site metadata
```

---

## Role-Based Middleware (`middleware.js`)

Pre-processing hooks applied before the main LLM loop on each `POST /chat`:

- **`researcher`** — generates structured TLDR (core question, key points, context) at temp 0.3. Saves `AgentAction(tldr)`, injects as system message.
- **`vibecoder`** — generates numbered task breakdown. Saves `AgentAction(task_list)`, injects as system message.
- All other roles — raw system prompt + memory context, no pre-processing.

---

## Socket Events

Namespace: `/agents`. Emitted via `req.app.get('io')`:

| Event | Payload | Description |
|---|---|---|
| `memory:update` | `{ agentId, type, data }` | conversation add, KB change, clear |
| `tool:call` | `{ agentId, callId, tool, args }` | tool fired |
| `tool:result` | `{ agentId, callId, tool, success, error? }` | tool result |
| `action:new` | `{ agentId, action }` | new AgentAction saved |
| `background:started` | `{ agentId }` | BG process started |
| `background:stopped` | `{ agentId }` | BG process stopped |
| `background:tick` | `{ agentId, tick }` | BG tick completed |
| `agent:push` | `{ agentId, type, title, content, actionId }` | push BG finding to chat UI |
| `status:change` | `{ agentId, status }` | agent status changed |
| `log:new` | `{ agentId, log }` | new log entry |
| `tuning:update` | `{ agentId, data }` | tuning saved |

Clients call `socket.emit('subscribe', agentId)` / `socket.emit('unsubscribe', agentId)` to scope event delivery.

---

## Hub Client (`agents-hub.js`)

Two-panel layout: sidebar (agent list + search + spawn) and detail panel (header + tabs).

**Key state:** `hubAgentId`, `hubCurrentTab`, `hubSocket`, `hubAgentsCache`.

**Hub header actions** (rendered by `hubRefreshHeader`):
- **Chat** → `openChat(id, name)` from `agents-ui.js`
- **Start BG / Stop BG** → `startBackground` / `stopBackground`
- **Start / Stop** → `toggleStatus(id, status)` from `agents-ui.js`, re-renders header after 400ms
- **Clone** → `hubCloneAgent(id)` — opens create modal pre-filled with agent's config ("Copy of …")
- **forwardChat panel** → built by `hubBuildFwdChatPanel(agent)`, uses all `toggleFwdChatBih` / `onFwdChatSiteSelect` / `removeFwdChatSite` functions from `agents-ui.js`
- **Reset NSP** → `hubConfirmReset(id, name)` — opens namespace wipe modal

**Hub tabs:** `notes`, `actions`, `tasks`, `crons`, `memory`, `logs`, `background`, `settings`.

Each tab has a `hubLoad{Tab}Tab(agentId)` loader that fetches from the corresponding API and renders inline HTML. Tabs are lazy-loaded on first switch.

**Settings tab** (`hubLoadSettingsTab`) — 5 sections, each with independent Save:
1. **Identity** — name, description, model, pipeline role, category, tier → `PUT /api/agents/:id` + `PUT /api/agents/:id/hierarchy`
2. **LLM Parameters** — system prompt, temperature, maxTokens, contextWindow, topP, topK, repeatPenalty. 14 quick-apply preset chips (Balanced / Short / Bullets / Precise / Code / Creative / etc.) → `PUT /api/agents/:id/tuning`
3. **bihBot Config** — enabled, chatMode, trigger, displayName, avatar, rateMs → PATCH bih-bot + PUT bih-bot/chat-mode + PUT tuning
4. **Guardrails** — enabled, profanityFilter, systemPromptLock, maxResponseLength, allowedTopics, blockedKeywords, offTopicResponse, rate limits → `PUT /api/agents/:id/guardrails`
5. **MCP Tools** — checkbox grid (Chat column + BG column) for all available tools, grouped by category → `POST /api/agents/:id/mcp/enable` + `PUT /api/agents/:id/background/tools`

**Librarian / Clone** (`agents-presets.js`):
- `loadAgentAsPreset(agentId)` — fetches any existing agent and pre-fills the create modal with its config (name prefixed "Copy of …", all LLM params, MCP tools, working dir, domain capabilities)
- `populateExistingAgentsOptgroup()` — called on modal open; populates a "From Existing Agent" optgroup in the preset dropdown from `GET /api/agents`
- `hubCloneAgent(agentId)` in `agents-hub.js` — Clone button in header calls `openCreateAgentModal()` then `loadAgentAsPreset()`

**Org stats** (`hubLoadOrgStats`): fetches `/api/agents` + `/api/tasks/scorecard`, updates topbar stat chips and per-agent sidebar badges.

---

## Agents-UI Client (`agents-ui.js`)

- Socket: `io('/agents')` on page load
- **`agent:push`** — if chat modal open + matching agent: injects proactive bubble; otherwise increments `#chat-badge-{id}`
- **Create modal** — `openCreateAgentModal()` resets form, loads projects dropdown, adds `.active` to `#agentModal`. Form submit → `POST /api/agents` or `PUT /api/agents/:id`, then `location.reload()`
- **Chat modal** — `openChat(agentId, agentName)`: loads memory, renders conversation history (markdown via `marked`), subscribes to socket. `sendMessage()` POSTs to `/api/agents/:id/chat`, shows live tool indicators via `tool:call`/`tool:result`
- **forwardChat panel** — `toggleFwdChatPanel(agentId)` portals dropdown to `<body>` to escape `overflow:hidden`. `toggleFwdChatBih`, `onFwdChatSiteSelect`, `removeFwdChatSite`, `refreshFwdChatBadge`.

---

## Env Vars

| Var | Used for |
|---|---|
| `OLLAMA_BASE_URL` | LLM + image gen base (default: `https://ollama.madladslab.com`) |
| `OLLAMA_API_KEY` | Bearer token for Ollama API |
| `SEARCH_API_KEY` | Brave Search API key (`web-search` tool) |
| `BOT_ALERT_SECRET` | Shared secret for internal agent-to-agent + bih endpoints |

---

## Key Invariants

- **One agent per pepeChat** — enforced at API level on `PATCH /pepe-chat`
- **Apex tier** — `parentAgent` always null; enforced at `PUT /hierarchy`
- **`execute` tool blocklist** — `killall`, `pkill -9`, `rm -rf /`, `dd if=`, `mkfs`, `reboot`, `shutdown`, `init 0/6`
- **`write_file` blocklist** — `/srv/*.env` files
- **`http_request` allowlist** — `localhost`, `127.0.0.1`, `0.0.0.0`, `*.madladslab.com`
- **Chat endpoint** — Ollama `/v1/chat/completions` (OpenAI-compat)
- **Background endpoint** — Ollama `/api/chat` (native)
- **Conversation compaction** — at 20 convos: oldest 10 → KB entry, trimmed
- **bgFindings cap** — 5000 chars, rolling trim
- **Max tool iterations per chat** — 10
- **Max tasks per BG tick** — 5
