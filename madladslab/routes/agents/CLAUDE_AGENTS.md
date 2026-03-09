# AGENTS Package — Full Context

Mounted inside **madladslab** at `/agents/*`. Admin-only. All routes require `isAdmin` middleware (checks `req.user.isAdmin === true`).

## Package Structure

```
routes/agents/
  index.js        — combines all sub-routers
  agents.js       — CRUD, hierarchy, status, bihBot, pepeChat
  chat.js         — agentic chat loop + internal agent-to-agent messaging
  background.js   — autonomous background process manager
  mcp.js          — MCP tool definitions + executors + config routes
  memory.js       — memory layer CRUD (KB, conversations, summary, notes)
  actions.js      — AgentAction log, task queue, promote/demote
  tuning.js       — systemPrompt, LLM params (temp, topK, repeatPenalty, etc.)
  middleware.js   — isAdmin guard, researcher/vibecoder pre-processing middleware

views/agents/
  index.ejs                   — main dashboard (agent cards)
  digest.ejs                  — unified background activity feed
  partials/_card.ejs          — agent card component
  partials/_modal-chat.ejs    — chat modal UI
  partials/_modal-create.ejs  — create agent modal
  partials/_modal-logs.ejs    — logs viewer modal
  partials/_modal-detail.ejs  — agent detail/settings modal
  partials/_docs.ejs          — inline docs tab
```

## Data Models

**Agent** (`api/v1/models/Agent.js`) — core document. Key fields:
- `name`, `role`, `model`, `provider` (`ollama`)
- `tier` — `apex | executive | manager | worker`
- `parentAgent` — ObjectId ref (apex always null)
- `status` — `idle | running | stopped | error`
- `config` — `systemPrompt`, `temperature`, `contextWindow`, `maxTokens`, `topP`, `topK`, `repeatPenalty`, `backgroundPrompt`, `backgroundInterval`, `backgroundRunning`
- `memory` — see Memory Layers below
- `mcpConfig` — `enabledTools[]`, `backgroundEnabledTools[]`, `endpoints[]`
- `bihBot` — `enabled`, `trigger`, `displayName`, `avatar`, `chatMode` (`passive|active|agent`), `allowedRoles[]`, `rateMs`
- `pepeChat` — `enabled`, `sessionLimit`, `rateLimitPerHour`, `avatar` (only one agent can have pepeChat enabled at a time)
- `bgProductivity` — `score`, `consecutiveIdle`, `totalTicks`, `activeTicks`
- `bgTickHistory[]` — last 10 tick records (`title`, `summary`, `nextFocus`, `idle`, `timestamp`)
- `tuning` — `systemPromptHistory[]`, `adjustableParams`
- `logs[]` — last 50 log entries (`level`, `message`, `timestamp`)
- `capabilities[]` — string tags

**AgentAction** — stores findings, tool outputs, images, TLDR, task_list, background results.

**agent_tasks** (raw mongo collection) — task queue: `agentId`, `title`, `description`, `priority` (`high|medium|low`), `priorityScore` (3/2/1), `status` (`pending|complete|cancelled`), `source` (`operator|self|promoted`).

**agent_notes** (raw mongo collection) — agent writable notes via `mongo-write` MCP tool.

---

## Chat Pipeline (`chat.js`)

`POST /api/agents/:id/chat` — the main agentic loop.

**Message assembly order:**
1. System prompt
2. Live session context (agent name, user identity, timestamp, roster of other agents)
3. Thread summary (`memory.threadSummary`)
4. Long-term memory / notes (`memory.longTermMemory`)
5. Background findings (`memory.bgFindings`, capped at last 1500 chars)
6. Knowledge base (last 12 entries, 300 chars each)
7. Recent conversations (last 10)
8. User message

**Role-based middleware (pre-loop):**
- `researcher` → `runResearcherMiddleware` → generates research TLDR, saves as AgentAction(`tldr`), injects as system message
- `vibecoder` → `runVibecoderMiddleware` → breaks task into numbered list, saves as AgentAction(`task_list`), injects as system message

**Agentic tool loop (max 10 iterations):**
- Builds enabled tool list from `agent.mcpConfig.enabledTools`
- Image intent intercept: if `generate-image` is enabled and message matches image-request pattern, fires `generate_image` directly before loop (some models don't tool-call reliably)
- Each iteration: POST to Ollama `/v1/chat/completions`
- If response has `tool_calls` → execute via `executeMcpTool`, push tool result, loop again
- If response has text → set as `finalResponse`, break

**Post-loop (fire-and-forget background ops):**
- `updateThreadSummary` — LLM rewrites thread summary with new exchange
- `updateLongTermMemory` — LLM extracts action items/decisions, merges into notes
- `extractKnowledge` — every 5 turns: LLM extracts reusable facts → KB entry
- **Conversation compaction** — when `conversations.length >= 20`: oldest 10 summarised into KB entry, trimmed from history

**Internal agent-to-agent messaging:**
`POST /api/agents/:id/chat-internal` — no session auth, uses `BOT_ALERT_SECRET`. Used by `message_agent` MCP tool and bih service. Runs a simplified loop (no tools, last 5 convos injected).

---

## Background Process System (`background.js`)

In-memory Map: `backgroundProcesses` — `agentId → { intervalId, startedAt, lastRun, runCount, intervalMs }`

**Start/stop:** `startBackgroundProcess(io, agent)` / `stopBackgroundProcess(io, agentId)`. Persists state to `agent.config.backgroundRunning`. On server restart, `resumeBackgroundProcesses` re-attaches all agents with `backgroundRunning: true`.

**Tick logic (`runBackgroundTick`):**
1. Fresh agent fetch from DB
2. Build `bgTools` from `mcpConfig.backgroundEnabledTools`
3. Build agent roster
4. Fetch up to 5 pending tasks from `agent_tasks` (sorted by priorityScore desc)
5. Evaluate productivity: `bgProductivity.consecutiveIdle >= 2` → `stuck = true`
6. Build reasoning context from last 6 tick history entries
7. Choose directive mode:
   - Custom `backgroundPrompt` set → use it with reasoning context prepended
   - Pending tasks exist → task execution directive
   - `stuck` → task invention mode (forces `newTasks` in output)
   - Default → generic autonomous tick with JSON output schema
8. Inject memory layers (threadSummary, longTermMemory, bgFindings, KB)
9. Inject subordinate briefings for `manager/executive/apex` tiers
10. POST to Ollama `/api/chat` (native Ollama endpoint, not /v1/)
11. If tool calls returned → execute one round, call Ollama again
12. Parse JSON response: `{ title, content, pushToChat, completedTaskIds, newTasks, nextFocus, productivityNote }`
13. Save AgentAction, emit socket events, append to `bgFindings`, update tick history + productivity score
14. Task ops: mark `completedTaskIds` complete, insert `newTasks`

**Background KB extraction:** every 5 active ticks → LLM distills `bgFindings` into a KB entry.

**Routes:**
- `GET /api/background/status` — all running processes
- `POST /api/agents/:id/background/start`
- `POST /api/agents/:id/background/stop`
- `PUT /api/agents/:id/background/config` — backgroundPrompt, backgroundInterval (min 1, max 1440 min); restarts if running
- `PUT /api/agents/:id/background/tools` — set backgroundEnabledTools

---

## MCP Tool System (`mcp.js`)

Tools are defined in `MCP_TOOL_DEFINITIONS` (Ollama function-calling format). Executed via `executeMcpTool(toolName, args)`.

### Tool Catalog

| Tool key | Function name | Category | Notes |
|---|---|---|---|
| `read-file` | `read_file` | filesystem | /srv only, max 10MB |
| `write-file` | `write_file` | filesystem | /srv only, .env files blocked, creates dirs |
| `list-directory` | `list_directory` | filesystem | /srv only |
| `file-find` | `file_find` | filesystem | /srv only, maxDepth 8 |
| `grep-search` | `grep_search` | filesystem | ripgrep-style, max 200 results |
| `log-tail` | `log_tail` | filesystem | /srv or /var/log, max 500 lines |
| `git-status` | `git_status` | git | read-only: status/log/diff/branch/show/stash list |
| `execute` | `execute` | shell | FORBIDDEN: killall, pkill -9, rm -rf /, etc. |
| `process-list` | `process_list` | shell | ps aux, optional filter |
| `tmux-sessions` | `tmux_sessions` | shell | tmux ls |
| `tmux-logs` | `tmux_logs` | shell | tmux capture-pane |
| `service-port` | `service_port` | shell | lsof -ti |
| `npm-run` | `npm_run` | shell | allowed: test/lint/build/check/typecheck/validate |
| `http-request` | `http_request` | network | localhost + *.madladslab.com only |
| `web-search` | `web_search` | network | Brave Search API, env: SEARCH_API_KEY |
| `fetch-url` | `fetch_url` | network | any public URL, strips HTML, max 20k chars |
| `mongo-find` | `mongo_find` | database | read-only; allowed: agents/users/threads/agent_actions/sessions/agent_tasks/agent_notes |
| `mongo-write` | `mongo_write` | database | write to agent_notes or agent_tasks only |
| `bih-chat` | `bih_chat` | integrations | POST to localhost:3055/api/bot-alert |
| `context` | `get_context` | meta | reads /srv/{project}/docs/CLAUDE.md |
| `cron-job` | `cron_job` | shell | manage /etc/cron.d/agent-* files (list/read/write/delete) |
| `message-agent` | `message_agent` | agents | POST to /agents/api/agents/:id/chat-internal |
| `generate-image` | `generate_image` | media | SD v1.5 via ollama.madladslab.com, uploads to Linode, returns URL + markdown |

**Internal execute endpoint:** `POST /api/mcp/execute-internal` — authenticated by `BOT_ALERT_SECRET`, verifies tool is in agent's `enabledTools` before running. Used by bih.

**Config routes:**
- `GET /api/mcp/available-tools` — full tool list with descriptions + categories
- `GET /api/agents/:id/mcp` — agent's current mcpConfig
- `POST /api/agents/:id/mcp/enable` — set `enabledTools[]`

---

## Memory Layers (`memory.js`)

| Layer | Field | Source | Used in |
|---|---|---|---|
| Thread summary | `memory.threadSummary` | Auto-updated after each chat | Chat context, BG context |
| Long-term memory/notes | `memory.longTermMemory` | Auto-extracted tasks/decisions | Chat context, BG context, internal chat |
| Background findings | `memory.bgFindings` | BG tick appends (max 5000 chars) | Chat context (last 1500), BG context (last 2000) |
| Knowledge base | `memory.knowledgeBase[]` | Extracted every 5 turns / promoted | Chat context (last 12), BG context (last 8) |
| Conversations | `memory.conversations[]` | Stored per chat turn | Chat context (last 10), internal (last 5) |
| Tick history | `bgTickHistory[]` | BG tick, last 10 | BG reasoning context |

**Routes:**
- `GET /api/agents/:id/memory` — full memory object
- `GET /api/agents/:id/memory/stats` — counts + token totals
- `POST /api/agents/:id/memory/knowledge` — add KB entry
- `DELETE /api/agents/:id/memory/knowledge/:knowledgeId` — remove KB entry
- `PUT /api/agents/:id/memory/summary` — manually edit thread summary
- `PUT /api/agents/:id/memory/notes` — manually edit long-term notes
- `DELETE /api/agents/:id/memory` — full clear

---

## Actions & Task Queue (`actions.js`)

**AgentAction types:** `background`, `tldr`, `task_list`, `image`

**Routes:**
- `GET /api/agents/:id/actions?type=&limit=` — per-agent action log
- `GET /api/actions?type=&limit=` — global feed across all agents
- `POST /api/agents/:id/actions/:actionId/promote` — promote to `knowledge` KB or `longterm` notes
- `POST /api/agents/:id/actions/:actionId/promote-task` — create task from action
- `DELETE /api/agents/:id/actions/:actionId`
- `GET /api/agents/:id/tasks?status=` — task queue (default: pending)
- `POST /api/agents/:id/tasks` — operator-inject task
- `DELETE /api/agents/:id/tasks/:taskId` — cancel task

---

## Agent CRUD & Config (`agents.js`)

**Core CRUD:**
- `GET /` — dashboard render
- `GET /digest` — background activity feed render
- `GET /api/agents` — all agents
- `GET /api/agents/:id`
- `POST /api/agents` — create (required: name, model; default provider: ollama)
- `PUT /api/agents/:id` — update fields
- `DELETE /api/agents/:id`
- `PATCH /api/agents/:id/status` — set status (idle/running/stopped/error)
- `GET /api/agents/:id/logs` — last 50 logs (reversed)

**Hierarchy:**
- `GET /api/agents/hierarchy` — org chart (name/role/status/tier/parentAgent)
- `PUT /api/agents/:id/hierarchy` — set tier + parentAgent; apex forces parentAgent=null

**Capabilities:**
- `PUT /api/agents/:id/capabilities` — replace capabilities array

**bihBot deployment:**
- `PATCH /api/agents/:id/bih-bot` — toggle enabled, set trigger/displayName/avatar
- `PUT /api/agents/:id/bih-bot/chat-mode` — passive|active|agent
- `PUT /api/agents/:id/bih-bot/roles` — allowedRoles[]

**pepeChat deployment:**
- `PATCH /api/agents/:id/pepe-chat` — toggle enabled (disables all others first), sessionLimit, rateLimitPerHour, avatar

**Ollama connection:**
- `GET /api/ollama/test` — lists available models from `OLLAMA_BASE_URL/api/tags`

---

## Tuning (`tuning.js`)

- `GET /api/agents/:id/tuning` — systemPrompt, systemPromptHistory, adjustableParams, LLM config params, bihBot
- `PUT /api/agents/:id/tuning` — update systemPrompt (logged to history), temp, maxTokens, contextWindow, topP, topK, repeatPenalty, bihBot.displayName/avatar/rateMs

---

## Role-Based Middleware (`middleware.js`)

Pre-processing runs before the main LLM loop on each chat call:
- **researcher** — generates a structured TLDR (core question, key points, context). Low temp (0.3). Saves AgentAction(`tldr`), injects as system message.
- **vibecoder** — generates numbered task breakdown. Saves AgentAction(`task_list`), injects as system message.

Other roles get no pre-processing (raw system prompt + memory context only).

---

## Socket Events (agents plugin)

Emitted via `req.app.get('io')`:
- `emitMemoryUpdate(io, agentId, type, data)` — on conversation add, KB change, clear
- `emitToolCall(io, agentId, { callId, tool, args })` — tool fired
- `emitToolResult(io, agentId, { callId, tool, success, error? })` — tool result
- `emitActionNew(io, agentId, action)` — new AgentAction saved
- `emitBackgroundStatus(io, agentId, event, data)` — started/stopped/tick
- `emitAgentPush(io, agentId, { type, title, content, actionId })` — push background finding to chat UI
- `emitTuningUpdate(io, agentId, data)` — tuning changed

---

## Env Vars

| Var | Used for |
|---|---|
| `OLLAMA_BASE_URL` | LLM + image gen base URL (default: `https://ollama.madladslab.com`) |
| `OLLAMA_API_KEY` | Bearer token for Ollama API |
| `SEARCH_API_KEY` | Brave Search API key (`web-search` tool) |
| `BOT_ALERT_SECRET` | Shared secret for internal agent-to-agent + bih bot-alert endpoints |

---

---

## Views

### `views/agents/index.ejs` — Main Dashboard
- Renders agent grid via `_card.ejs` loop
- Injects two JS globals: `SPAWN_USER_NAME` (current user's display name or email), `SPAWN_AGENT_ROSTER` (comma list of name+role for all agents)
- Loads in order: `agents-presets.js` → `agents-ui.js` → `agents-client.js`
- Modals included inline: `_modal-create.ejs`, `_modal-chat.ejs`, `_modal-logs.ejs`, `_modal-detail.ejs`
- `_docs.ejs` renders inline docs tab above the grid

### `views/agents/partials/_card.ejs` — Agent Card
Each card shows: status badge, bg-badge (hidden until background starts, click to open Actions tab), context menu (edit/delete), name, description, model/role/temp meta, stats (messages, tokens, last active), footer buttons:
- **Chat** — opens chat modal; unread badge at `#chat-badge-{id}`
- **Manage** — opens detail modal
- **+ bih** / `bih: @trigger` — toggles bihBot deployment
- **+ madlads** / `madlads: {name}` — toggles pepeChat deployment
- **Start/Stop** — patches agent status

### `views/agents/digest.ejs` — Background Activity Feed
- Injects `DIGEST_AGENTS` global (array of `{_id, name, tier}`)
- Loads `agents-digest.js`
- Panels: live action feed (filterable by agent + type), stats panel, org chart, background controls, task queue

---

## Client-side JavaScript

### `agents-presets.js` — Personality Presets
Defines `AGENT_PRESETS` object. Uses `SPAWN_USER_NAME` and `SPAWN_AGENT_ROSTER` injected by EJS. Preset cards auto-fill the create form.

| Key | Name | Role | Temp | Purpose |
|---|---|---|---|---|
| `monitor` | Server Monitor | researcher | 0.3 | Service health watcher (tmux/ports/logs) |
| `vibecoder` | Vibecoder | vibecoder | 0.6 | Fullstack dev, reads/writes /srv codebase |
| `researcher` | Researcher | researcher | 0.4 | Deep file/code analysis with TLDR output |
| `debugger` | Debug Detective | assistant | 0.3 | Stack trace tracer, root cause analyst |
| `lorekeeper` | Lore Keeper | assistant | 0.85 | Narrative/world-building for /srv/ps |
| `auditor` | Security Auditor | researcher | 0.2 | OWASP Top 10 scanner |
| `scout` | Data Scout | researcher | 0.3 | MongoDB read-only query + pattern analysis |
| `jules` | Jules Winfield | assistant | 0.85 | Pulp Fiction persona for bih chat |
| `hype` | Hype Beast | assistant | 0.9 | Gaming hype man for bih community |
| `sage` | The Sage | assistant | 0.8 | Cryptic gaming mystic, short profound replies |
| `tinfoil` | Tinfoil | assistant | 0.88 | Gaming conspiracy theorist persona |
| `custom` | (blank) | assistant | 0.7 | Generic base template |

---

### `agents-ui.js` — Chat Modal + Card Interactions
- `chatSocket = io('/agents')` — persistent socket on page load
- **`agent:push`** socket event — if chat open + correct agent: injects proactive bubble with "background finding" label; otherwise increments `#chat-badge-{id}` unread counter
- **Create/Edit modal** — form submit → `POST /api/agents` or `PUT /api/agents/:id`, page reload on success
- **Test Ollama** — `GET /api/ollama/test` → alert with model list
- **`openChat(agentId, agentName)`** — loads memory via `/api/agents/:id/memory`, renders context strip (turns/KB count/summary/LTM flags), renders conversation history as markdown, subscribes to socket
- **`sendMessage()`** — POSTs to `/api/agents/:id/chat`, shows "thinking…" indicator, then per-tool live indicators via `tool:call`/`tool:result` socket events, renders final response via `marked`
- **`viewLogs(agentId)`** — opens logs modal, fetches last 50 logs
- **`toggleBihBot()`** / **`togglePepeChat()`** — PATCH endpoints, update button state inline (no page reload)
- **`toggleStatus()`** — PATCH status, page reload
- **`switchCardTab(agentId, tabName)`** — `overview` is inline-only; all other tabs open the detail modal and call `switchTab(tabName)` after 150ms delay

---

### `agents-client.js` — Detail Modal + Socket Subscriptions
Socket namespace `/agents` — emits `subscribe`/`unsubscribe` per agent on modal open/close.

**Socket event handlers:**
| Event | Handler |
|---|---|
| `log:new` | Appends log entry to logs panel, auto-scrolls |
| `status:change` | Updates status badge on card + modal |
| `memory:update` | Refreshes memory tab content |
| `tuning:update` | Updates tuning panel values live |
| `action:new` | Prepends new action card to actions feed |
| `background:tick` | Updates tick count, productivity score, bg-badge visibility on card |
| `background:started` | Updates bg controls panel + card badge |
| `background:stopped` | Same, resets state |

**Detail modal tabs:**
- `overview` — key info, system prompt preview, quick stats
- `tuning` — edit systemPrompt (with history), temperature, topK, topP, repeatPenalty, maxTokens, contextWindow; bihBot displayName/avatar/rateMs
- `memory` — thread summary (editable), long-term notes (editable), KB list (add/delete entries), conversation history (last 50)
- `actions` — AgentAction log, filterable by type; per-action promote buttons (→ KB, → Notes, → Task)
- `tasks` — pending task queue; operator can create + cancel tasks
- `background` — start/stop controls, backgroundPrompt editor, interval (min), background tool multi-select, productivity score + tick history display
- `mcp` — enable/disable chat tools + background tools per category (filesystem, shell, git, network, database, integrations, media, agents, meta)

---

### `agents-digest.js` — Digest Page
Requires `DIGEST_AGENTS` global injected by `digest.ejs`.

- Socket `/agents`, auto-subscribes to all agents on connect; `#liveDot` reflects connection status
- **Feed** — `GET /api/actions?limit=200`, agent + type filter chips; markdown rendered via `marked`; long content collapses with expand toggle; font size toggle (A±/A+/A++)
- **Stats panel** — action counts by agent + by type
- **Org chart** — `GET /api/agents/hierarchy`, tree rendered with tier-colored dots; clicking an agent node filters the feed
- **Background controls** — per-agent ▶/■ buttons; tick count; productivity score (green ≥60%, yellow ≥30%, red <30%); idle tooltip on score; "Start All" button
- **Task queue** — all agents or filtered by select; sorted by priorityScore desc; cancel button per task; operator-inject form
- **Live updates** — `action:new` prepends card + updates stats; `background:tick` updates ticks/score; `background:started/stopped` updates dot + button
- **Action operations** (no modal, all inline POST): → KB, → Notes, → Task (via `promoteDigestAction`, `promoteDigestToTask`)
- **Toast** via `showToast(msg, type)` — 3s auto-dismiss

---

## Hierarchy / Tier Behavior

| Tier | parentAgent | BG briefing |
|---|---|---|
| `apex` | always null | briefed on ALL other agents |
| `executive` | any apex | briefed on direct children |
| `manager` | any executive | briefed on direct children |
| `worker` | any manager | no briefing |

BG briefings inject each subordinate's name/role/status + last 250 chars of longTermMemory.

---

## Key Invariants

- Only **one agent** can have `pepeChat.enabled = true` at a time (enforced at API level)
- Apex tier agents cannot have a parentAgent
- `execute` tool blocks: `killall`, `pkill -9`, `rm -rf /`, `dd if=`, `mkfs`, `reboot`, `shutdown`, `init 0/6`
- `write_file` blocks: `/srv/*.env` files
- `http_request` restricted to `localhost`, `127.0.0.1`, `0.0.0.0`, `*.madladslab.com`
- Background ticks use Ollama native `/api/chat` endpoint; chat uses OpenAI-compat `/v1/chat/completions`
- Conversation compaction threshold: 20 convos → oldest 10 → KB entry, trimmed
- BG findings capped at 5000 chars (rolling trim)
- Max tool iterations per chat: 10
- Max tasks per background tick: 5 (via `newTasks` array)
