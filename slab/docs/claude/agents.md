---
scope: AI agent system
updated: 2026-03-26
---

# AI Agent System

## Architecture
Five agents — four specialists + one master orchestrator. All use `plugins/agentMcp.js`.

| Agent | Route | Purpose |
|-------|-------|---------|
| Copy | `POST /admin/copy/agent` | Site copy fields (hero, services, about, contact) |
| Blog | `POST /admin/blog/agent` | Full blog posts with Brave web search |
| Section | `POST /admin/sections/agent` | Custom landing section fields |
| Page | `POST /admin/pages/agent` | Content, landing block, and data-list pages |
| Master | `POST /admin/master-agent` | Two-step orchestrator: research then generate |

## Core Pattern: Search-First, Inject-Context, Single Call
Small models (qwen2.5:7b) do not reliably loop through tool calls. The pattern:
1. Call Brave Search API first
2. Inject results into system prompt as context
3. Single LLM completion call
4. Parse with `tryParseAgentResponse()` — never raw `JSON.parse`

## Master Agent Two-Step Flow
**Step 1 — Research** (`POST /admin/master-agent/research`)
- LLM classifies task into department (blog, copy, section, page)
- Runs one Brave search
- Returns `{ department, task, searchQuery, searchResult }`

**Step 2 — Generate** (`POST /admin/master-agent`)
- Injects search context, runs MCP tool
- Returns `{ message, department, fill, suggestions, action }`

**Execute:** `POST /admin/master-agent/execute` — writes directly to DB

## Brand Context (`plugins/brandContext.js`)
All agent prompts inject tenant brand profile:
- `buildBrandContext(brand, design)` — from loaded objects
- `loadBrandContext(tenant, db)` — from DB
- Output: structured text block with all brand fields + agent name

## Shared Plugin: `plugins/agentMcp.js`
- `callLLM(messages, options)` — POST to Ollama endpoint
- `braveSearch(query)` — Brave Search API, returns snippet block
- `tryParseAgentResponse(raw)` — 3-layer JSON parser (standard, newline-fix, regex fallback)
- `getSuggestions(department)` — 3 follow-up prompt chips

## MCP Endpoint
JSON-RPC 2.0 at `/admin/master-agent/mcp` (admin auth required).
Tools: `web_search`, `fetch_url`, `fill_site_copy`, `write_blog_post`, `fill_section`, `write_page`

## Frontend Agent Panel Pattern
Every editor gets a slide-in `#agentPanel`:
- Field highlighting with `.ai-filled` class + revert button
- `sessionStorage('slab_agent_fill')` for cross-page relay
- Responsive: 420px panel → full-screen at 520px

## Huginn — Platform Intelligence

Huginn is the superadmin AI assistant. Two-sided architecture: **input** (Huginn Chat) and **output** (Control Center).

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `GET /superadmin/huginn` | `routes/superadmin.js` | Chat UI — text + voice input, 3D orb, task sidebar |
| `POST /superadmin/huginn/chat` | `routes/superadmin.js` | Streaming LLM proxy — injects platform context |
| `GET /superadmin/control-center` | `routes/superadmin.js` | Output display — full-screen orb, message panel, weather |
| `POST /huginn/mcp` | `routes/huginn-mcp.js` | JSON-RPC 2.0 for LLM machine tool calls |
| `POST /huginn/webhook` | `routes/huginn-webhook.js` | External event ingestion → Socket.IO broadcast |
| `GET /huginn/health` | `routes/huginn-webhook.js` | Display/operator connection status |

### Plugin: `plugins/huginnMcp.js`
Provides Huginn's data layer — CRUD for `huginn_tasks`, `huginn_notes`, `huginn_conversations` (all in slab registry DB), plus read-only access to platform DB and codebase.

Key exports:
- `createTask()`, `updateTask()`, `listTasks()`, `getTask()` — task CRUD
- `saveNote()`, `searchNotes()`, `listNotes()` — note CRUD
- `logConversation()`, `getConversationHistory()` — chat log
- `readSlabCollection()`, `readTenantCollection()` — DB read (capped at 100 docs)
- `readFile()`, `listDir()` — sandboxed codebase read (blocks `.env`)
- `buildHuginnContext()` — assembles live platform stats, tasks, notes, tenants, weather for LLM system prompt
- `parseAndSaveIntents()` — detects `TASK:` and `NOTE:` lines in LLM responses and auto-saves them
- `fetchWeather()` — ip-api geolocation → open-meteo forecast

### MCP Tool Registry (`routes/huginn-mcp.js`)
JSON-RPC 2.0 at `POST /huginn/mcp`. Auth: Bearer `OLLAMA_KEY` or superadmin cookie.

| Tool | Description |
|------|-------------|
| `huginn.tasks.*` | Task CRUD (create, update, list, get) |
| `huginn.notes.*` | Note CRUD (save, search, list) |
| `huginn.conversations.*` | Conversation log/history |
| `slab.*` | Registry DB read (collections, read, stats) |
| `slab.tenant.*` | Tenant DB read (collections, read) |
| `codebase.*` | Sandboxed file/dir read |
| `platform.*` | Passthrough to madladslab.com MCP (tmux, services, files, execute) |
| `huginn.weather` | Current weather via open-meteo |
| `tools.list` | Discovery — lists all available tools |

REST shortcuts: `GET /huginn/mcp/tasks`, `POST /huginn/mcp/tasks`, `PATCH /huginn/mcp/tasks/:id`, `GET /huginn/mcp/notes`, `GET /huginn/mcp/stats`, `GET /huginn/mcp/context`, `GET /huginn/mcp/weather`

### Socket.IO: `/huginn` Namespace (`plugins/socketio.js`)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `join-huginn` | client→server | Operator joins chat room |
| `join-control-center` | client→server | Display joins viewer room |
| `deploy` | operator→displays | Push message to Control Center |
| `deploy-ack` | server→operator | Deployment confirmation |
| `huginn-state` | operator→displays | Orb state (thinking/speaking/idle/dreaming) |
| `clear-display` | operator→displays | Clear all messages |
| `displays-updated` | server→operator | Connected display list |
| `operator-status` | server→displays | Operator online/offline |

Auth: JWT verification in handshake — requires `isAdmin` flag + superadmin email.

### Webhook (`POST /huginn/webhook`)
Receives external events (e.g. from SSH tunnel). Optional `HUGINN_WEBHOOK_SECRET` validation. Broadcasts to Control Center via Socket.IO `/huginn` namespace.

### Data Flow
```
Operator (Huginn Chat)
  → POST /superadmin/huginn/chat (streaming)
  → buildHuginnContext() injects live platform data
  → Proxied to LLM (deepseek-r1:7b via OLLAMA_URL)
  → Response streamed back + intents parsed (TASK:/NOTE:)
  → Socket.IO deploy → Control Center displays
```

## LLM Config
- Endpoint: `OLLAMA_URL` (default: `https://ollama.madladslab.com/v1/chat/completions`)
- Model: `OLLAMA_MODEL` (default: `qwen2.5:7b`) — Huginn uses `deepseek-r1:7b`
- Auth: Bearer `OLLAMA_KEY`
- Search: Brave Search via `SEARCH_API_KEY`
