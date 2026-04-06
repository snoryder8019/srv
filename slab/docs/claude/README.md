---
scope: full platform
---

# Slab — AI Tooling Context

## Architecture
- [architecture.md](architecture.md) — Multi-tenant system: tenant resolution, DB isolation, S3, encryption
- [conventions.md](conventions.md) — Code patterns, rules, anti-patterns

## AI System
- [agents.md](agents.md) — Agent architecture, MCP, LLM patterns, brand context, Huginn platform intelligence

## Module Context
Module-specific CLAUDE.md files live in their own directories:
- `routes/admin/CLAUDE.md` — All 17 admin modules
- `plugins/CLAUDE.md` — Plugin system (crypto, mongo, agents, mail, payments, storage)
- `middleware/CLAUDE.md` — Tenant resolution, JWT auth, uploads
