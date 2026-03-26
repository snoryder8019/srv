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

## LLM Config
- Endpoint: `OLLAMA_URL` (default: `https://ollama.madladslab.com/v1/chat/completions`)
- Model: `OLLAMA_MODEL` (default: `qwen2.5:7b`)
- Auth: Bearer `OLLAMA_KEY`
- Search: Brave Search via `SEARCH_API_KEY`
