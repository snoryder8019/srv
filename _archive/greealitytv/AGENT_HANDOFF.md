# Agentic Admin Panel — Handoff & Integration Guide

**Reference implementation:** `w2Marketing` (port 3601)
**Date:** 2026-03-21
**Status:** Production — fully operational

---

## What Was Built

A full AI-powered admin panel layer on top of standard Express/EJS/MongoDB projects. The system gives every admin editor an AI assistant that can research, write, and auto-fill content directly into the CMS — from blog posts and site copy to custom landing page sections.

---

## Agent Architecture

Five agents total — four specialists + one master orchestrator:

| Agent | Route | Purpose |
|---|---|---|
| **Copy Agent** | `POST /admin/copy/agent` | Fills site copy fields (hero, services, about, contact) |
| **Blog Agent** | `POST /admin/blog/agent` | Writes full blog posts with live Brave web search |
| **Section Agent** | `POST /admin/sections/agent` | Fills custom landing section fields |
| **Page Agent** | `POST /admin/pages/agent` | Writes content, landing block, and data-list pages |
| **Master Agent** | `POST /admin/master-agent` | Orchestrates all four via two-step research → generate flow |

### Core Pattern: Search-First, Inject-Context, Single Call

**Never use LLM tool-call loops with Qwen 2.5 7b (or similar small models).** These models do not reliably return final responses when looping through tool calls. The proven pattern is:

1. Call Brave Search API first
2. Inject results into the system prompt as context
3. Single LLM completion call
4. Parse and return `{ message, fill: { fieldKey: value } }`

### Master Agent Two-Step Flow

The master agent splits work into two fast sequential requests to avoid timeout and give instant UI feedback:

**Step 1 — Research** `POST /admin/master-agent/research`
- LLM classifies the task into a department (`blog`, `copy`, `section`, `page`)
- Runs one Brave web search
- Returns `{ department, task, searchQuery, searchResult }` immediately
- Dashboard shows `🔍 Searched: {query}` bubble right away

**Step 2 — Generate** `POST /admin/master-agent` (with `research` in body)
- Skips re-routing (already classified)
- Injects search results into MCP tool context
- Runs the appropriate MCP tool
- Returns `{ message, department, fill, suggestions, action }`

**Execute flow:** `POST /admin/master-agent/execute` writes directly to DB by department — no editor redirect needed for "just save it" requests.

**Editor relay flow:** Dashboard → `sessionStorage.setItem('w2_agent_fill', ...)` → redirect to editor → editor reads and pre-fills fields on load, clears sessionStorage on read.

---

## Shared Plugin: `plugins/agentMcp.js`

All agent utilities live here. **Import from here — do not duplicate logic across routes.**

Key exports:

### `callLLM(messages, options)`
- POST to `https://ollama.madladslab.com/v1/chat/completions`
- Model: `qwen2.5:7b`
- Handles auth header automatically

### `braveSearch(query)`
- Brave Search API call
- Returns top result snippets as a string block for prompt injection

### `tryParseAgentResponse(raw)`
- **3-layer JSON parser** — critical for reliability:
  1. Standard `JSON.parse`
  2. Newline-escape fix → `JSON.parse`
  3. Per-field regex fallback (extracts values even if JSON is malformed)
- **Always use this instead of `JSON.parse` directly on LLM output.** LLM responses with large HTML content will break standard parsing.

### `getSuggestions(department)`
- Returns 3 contextual follow-up prompt chips for the dashboard quick-action bar
- Update when adding new departments

### MCP Tools (exposed via `POST /admin/mcp`)
- `web_search` — Brave search
- `fetch_url` — fetch and extract page text
- `fill_site_copy` — populate copy fields
- `write_blog_post` — full blog post generation
- `fill_section` — custom section fields
- `write_page` — page content generation

**MCP endpoint** is JSON-RPC 2.0, protected by admin auth. Compatible with Claude Desktop and Claude Code MCP config.

---

## Frontend Agent Panel Pattern

Every editor page gets a slide-in `#agentPanel`:

```html
<div id="agentPanel">
  <div id="ap-chat"><!-- message bubbles --></div>
  <textarea id="ap-input"></textarea>
  <button id="ap-send">Ask Agent</button>
  <div id="ma-quick"><!-- 3 suggestion chips --></div>
</div>
<button id="ap-toggle">✦ AI</button>
```

**Field highlighting:** When agent fills a field, it adds class `ai-filled` (green border) + a small revert `↩` button per field. Clearing clears the highlight.

**CSS lives in `views/admin/partials/head.ejs`** — responsive breakpoints:
- `820px`: panel width `min(420px, 100vw)`, sidebar becomes drawer
- `520px`: panel goes full-screen `100vw`

**Open/close** via `classList.add/remove('open')` — CSS handles the slide animation.

---

## Critical Architectural Rules

1. **Route ordering is first-wins in Express.** Named routes (`/agent`, `/mcp`, `/execute`) MUST be declared before wildcard routes (`/:id`, `/:section`) or they'll be matched as IDs/params.

2. **`w2_agent_fill` in sessionStorage** — cleared immediately on read in each editor. Never let it persist across multiple page loads — stale pre-fills will confuse editors.

3. **EJS escaping** — use `<%-` (unescaped) for HTML content and human-readable agent output. `<%= %>` double-escapes angle brackets and breaks rendered HTML.

4. **`fuser -k PORT/tcp`** before any restart to clear port. Nodemon restart race causes `EADDRINUSE`.

5. **Design fields** must be added to `DESIGN_DEFAULTS` in `routes/admin/design.js` or they won't persist on save (the save handler iterates that object's keys).

---

## Porting to a New Project

To add this agentic layer to any Express/EJS/MongoDB project in this stack:

### 1. Copy the plugin
```
cp w2Marketing/plugins/agentMcp.js <project>/plugins/agentMcp.js
```
Update the `Authorization` bearer token and model URL if needed (both in `config/config.js`).

### 2. Add specialist agent routes
Copy the relevant route files from `w2Marketing/routes/admin/` and update:
- MongoDB collection names
- Field names in the `fill` response to match your schema
- System prompt text to match the project/client

### 3. Add master agent
Copy `routes/admin/masterAgent.js` and update:
- `departments` map to match your route set
- `getSuggestions()` chips to match your content types
- `execute` handler collection names

### 4. Register routes in admin.js
```js
import masterAgent from './admin/masterAgent.js';
import copyAgent from './admin/copy.js';
// ... etc

// IMPORTANT: master agent BEFORE other routers
router.use('/master-agent', masterAgent);
router.use('/copy', copyAgent);
```

### 5. Add agent panels to editor views
Copy the `#agentPanel` HTML block from any `w2Marketing` editor view and update:
- The fetch URL to match your route
- Field IDs to match your form inputs
- The `fill` key mapping in the JS response handler

### 6. Add MCP endpoint (optional)
```js
router.use('/mcp', masterAgent); // already included in masterAgent.js
```
Add to Claude Desktop config or Claude Code `.mcp.json` for Claude-native tool access.

---

## LLM / API Config

| Setting | Value |
|---|---|
| Base URL | `https://ollama.madladslab.com/v1/chat/completions` |
| Model | `qwen2.5:7b` |
| Auth | Bearer token in `config/config.js` → `OLLAMA_KEY` |
| Web search | Brave Search API — `SEARCH_API_KEY` in env |

---

## MongoDB Collections (w2Marketing reference)

| Collection | Purpose |
|---|---|
| `w2_copy` | Site copy key/value pairs |
| `w2_design` | Design tokens, visibility flags, agent settings |
| `w2_blog` | Blog posts |
| `w2_portfolio` | Portfolio items |
| `w2_clients` | Client records |
| `w2_pages` | Dynamic custom pages |
| `w2_custom_sections` | Admin-created landing sections |

Name your collections with a project-specific prefix to avoid collisions in the shared `madLadsLab` database.

---

## Project-Specific Notes

This document applies to the following client projects in `/srv`:

- `nocometalworkz` — metal fabrication / no-come band
- `sna` — SNA project
- `acm` — ACM project
- `candaceWallace` — Candace Wallace (see also `w2Marketing` which IS the Candace Wallace/W2 Marketing site)
- `greealitytv` — Greealitytv
- `madladslab` — MadLads Lab main platform

Each project should copy relevant pieces from `w2Marketing` as the canonical reference. When in doubt, read `w2Marketing/CLAUDE.md` — it is the source of truth for all architectural decisions made during the agent buildout.

---

## Files to Reference

```
w2Marketing/
├── plugins/agentMcp.js           ← copy this first
├── routes/admin/masterAgent.js   ← master orchestrator
├── routes/admin/copy.js          ← copy agent pattern
├── routes/admin/blog.js          ← blog agent + Brave search pattern
├── routes/admin/sections.js      ← section agent pattern
├── routes/admin/pages.js         ← page agent + landing block pattern
├── views/admin/dashboard.ejs     ← master agent chat UI
├── views/admin/copy/index.ejs    ← agent panel UI pattern
├── views/admin/partials/head.ejs ← global responsive CSS
└── CLAUDE.md                     ← full architecture reference
```
