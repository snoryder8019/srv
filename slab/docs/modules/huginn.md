# Huginn Module — Platform Intelligence

Superadmin AI assistant with two-sided architecture: **Huginn Chat** (input) and **Control Center** (output).

## Architecture

```
plugins/
  huginnMcp.js              # Data layer: task/note/conversation CRUD, DB read, context builder
  socketio.js               # /huginn namespace — operator↔display real-time comms
routes/
  superadmin.js             # Chat UI, streaming LLM proxy, control-center view
  huginn-mcp.js             # JSON-RPC 2.0 + REST endpoints for LLM machine
  huginn-webhook.js         # External event ingestion, health check
views/
  superadmin/huginn.ejs     # Chat interface — text + voice input, 3D orb, task sidebar
  superadmin/control-center.ejs  # Display — full-screen 3D orb, message panel, weather
```

## Data Model

**Collections** (slab registry DB, not per-tenant):

### `huginn_tasks`

| Field | Type | Description |
|---|---|---|
| `title` | String | Task title |
| `body` | String | Task details |
| `status` | String | `pending`, `in_progress`, `done`, `blocked` |
| `priority` | String | `low`, `normal`, `high`, `urgent` |
| `tags` | Array | Classification tags |
| `context` | String | What triggered this task (auto or manual) |
| `createdAt` | Date | Creation timestamp |
| `updatedAt` | Date | Last update |

### `huginn_notes`

| Field | Type | Description |
|---|---|---|
| `topic` | String | Note category (default: `general`) |
| `content` | String | Note text |
| `tags` | Array | Classification tags |
| `createdAt` | Date | Creation timestamp |

### `huginn_conversations`

| Field | Type | Description |
|---|---|---|
| `session` | String | Session identifier |
| `role` | String | `user`, `assistant`, `system` |
| `content` | String | Message content |
| `createdAt` | Date | Timestamp |

## Key Flows

### Chat Flow
```
Operator → POST /superadmin/huginn/chat
  → buildHuginnContext() assembles live platform data (stats, tasks, notes, tenants, weather)
  → System prompt + context injected into messages
  → Proxied to LLM (deepseek-r1:7b at OLLAMA_URL)
  → Response streamed back (SSE)
  → parseAndSaveIntents() detects TASK: and NOTE: lines → auto-saves to DB
  → Operator deploys messages to Control Center via Socket.IO
```

### Webhook Flow
```
External system → POST /huginn/webhook
  → Optional secret validation (HUGINN_WEBHOOK_SECRET)
  → Builds deployment payload
  → Socket.IO /huginn namespace → control-center room
```

### MCP Flow (LLM machine → Slab)
```
LLM machine → POST /huginn/mcp (JSON-RPC 2.0)
  → Auth: Bearer OLLAMA_KEY or superadmin cookie
  → Tool dispatch (huginn.*, slab.*, codebase.*, platform.*)
  → Returns result
```

## Socket.IO `/huginn` Namespace

**Rooms:** `huginn-chat` (operator), `control-center` (displays), `display-{id}` (individual displays)

| Event | Direction | Description |
|---|---|---|
| `join-huginn` | client→server | Operator joins as chat user |
| `join-control-center` | client→server | Display joins viewer room |
| `deploy` | operator→displays | Push message to displays |
| `deploy-ack` | server→operator | Deployment confirmation |
| `huginn-state` | operator→displays | Orb state: thinking, speaking, idle, dreaming |
| `clear-display` | operator→displays | Clear messages (all or specific display) |
| `displays-updated` | server→operator | List of connected displays |
| `operator-status` | server→displays | Operator online/offline |

Auth: JWT handshake — requires `isAdmin` + superadmin email match.

## Frontend

### Huginn Chat (`/superadmin/huginn`)
- Text input with send button
- Voice input via Web Speech API (browser-native)
- 3D animated orb (Three.js, 200px sidebar) — states: idle, thinking, speaking, dreaming
- Auto-TTS toggle (persisted in localStorage)
- Task sidebar showing pending `huginn_tasks`
- Deploy button pushes response to Control Center displays

### Control Center (`/superadmin/control-center`)
- Full-screen 3D orb visualization (center stage)
- Right-side message panel (420px, accordion-style collapsible)
- TTS on every received message with voice selection
- Message type colors: alert (purple), text (green), code (blue)
- Weather widget via `/huginn/mcp/weather`
- Stats bar showing deployment count and session info

## Environment Variables

| Var | Required | Description |
|---|---|---|
| `OLLAMA_URL` | Yes | LLM endpoint base URL |
| `OLLAMA_KEY` | Yes | Bearer auth for LLM + MCP auth |
| `HUGINN_WEBHOOK_SECRET` | No | Validates inbound webhook events |
| MCP secret | No | Read from `/root/.ssh/mcp_0001` for platform MCP passthrough |
