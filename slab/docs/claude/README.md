---
scope: full platform
updated: 2026-07-20
---

# Slab — AI Tooling Context

Internal reference for engineers and coding agents. Not end-user docs
(those live in `docs/platform/` and `docs/modules/`).

## Architecture
- [architecture.md](architecture.md) — Tenant resolution, DB isolation (multi-cluster), collections, feature registry, single-source configs, platform plugins
- [conventions.md](conventions.md) — Code patterns, rules, anti-patterns
- [agents.md](agents.md) — Agent registry/router/engine, MCP tools, audience gating, chat substrate

## Single Sources of Truth
Change these files, not their consumers:

| Concern | File |
|---------|------|
| Admin nav, permissions, release stages | `plugins/featureRegistry.js` |
| Tenant design tokens | `config/schema.js` |
| Page/template block types | `config/blocks.js` |
| Pricing + delegate commission | `config/pricing.js` |
| Pipeable page data sources | `plugins/pageSources.js` |
| Agent catalog | `plugins/agentRegistry.js` |
| MCP tool definitions | `plugins/agentMcp.js` (`MCP_TOOLS`) |

## Module Context
- `routes/admin/README.md` — admin modules
- `plugins/README.md` — plugin system
- `middleware/README.md` — tenant resolution, JWT auth, uploads, permissions

> The March 2026 revision of these docs referenced `routes/admin/CLAUDE.md`,
> `plugins/CLAUDE.md`, `middleware/CLAUDE.md`. Those files no longer exist —
> the per-directory `README.md` files above replaced them.

## Archive
`docs/archive/huginn-dev-notes/` documents the Huginn superadmin assistant.
Huginn is **dormant**: its routers are commented out in `app.js` and
`routes/admin.js`, and its Socket.IO namespace is gone. Treat the archive as
historical; do not wire it back in without an explicit decision.
