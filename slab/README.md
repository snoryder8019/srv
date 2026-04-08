# Slab — Multi-Tenant White-Label Platform

A multi-tenant SaaS platform that serves multiple brands from a single codebase. Each tenant gets their own database, file storage, encrypted credentials, and AI-powered admin panel.

> Full documentation: [`docs/`](docs/)

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 18, ESM |
| Framework | Express 4 + EJS |
| Database | MongoDB (per-tenant isolation) |
| Auth | Google OAuth 2.0 + JWT (white-label support) |
| Storage | Linode Object Storage (S3-compatible) |
| AI | Ollama qwen2.5:7b + Brave Search |
| Encryption | AES-256-GCM (tenant secrets at rest) |
| Real-time | Socket.io + WebRTC (meetings) |

## Quick Start

```bash
tmux attach -t slab         # Attach to running session
npx nodemon bin/www.js       # Start dev server (port 3602)
fuser -k 3602/tcp            # Kill stale port if needed
```

## Documentation

| Section | Path | Description |
|---------|------|-------------|
| Architecture | [`docs/platform/architecture.md`](docs/platform/architecture.md) | System design & multi-tenancy |
| Authentication | [`docs/platform/authentication.md`](docs/platform/authentication.md) | OAuth, JWT, white-label login |
| Encryption | [`docs/platform/encryption.md`](docs/platform/encryption.md) | Secret management |
| Provisioning | [`docs/platform/provisioning.md`](docs/platform/provisioning.md) | Tenant onboarding pipeline |
| AI Agents | [`docs/platform/ai-agents.md`](docs/platform/ai-agents.md) | Agent system & MCP |
| Blog | [`docs/modules/blog.md`](docs/modules/blog.md) | Blog module |
| Portfolio | [`docs/modules/portfolio.md`](docs/modules/portfolio.md) | Portfolio module |
| Clients | [`docs/modules/clients.md`](docs/modules/clients.md) | Client management |
| Bookkeeping | [`docs/modules/bookkeeping.md`](docs/modules/bookkeeping.md) | Invoicing & payments |
| Email Marketing | [`docs/modules/email-marketing.md`](docs/modules/email-marketing.md) | Campaigns & contacts |
| Pages | [`docs/modules/pages.md`](docs/modules/pages.md) | Custom page builder |
| Sections | [`docs/modules/sections.md`](docs/modules/sections.md) | Landing page sections |
| Meetings | [`docs/modules/meetings.md`](docs/modules/meetings.md) | Video meetings & AI notes |
| Assets | [`docs/modules/assets.md`](docs/modules/assets.md) | Asset library |
| Design | [`docs/modules/design.md`](docs/modules/design.md) | Design tokens & themes |
| Copy | [`docs/modules/copy.md`](docs/modules/copy.md) | Site copy editor |
| Settings | [`docs/modules/settings.md`](docs/modules/settings.md) | Brand profile & integrations |
| Delegates | [`docs/modules/delegates.md`](docs/modules/delegates.md) | Sales delegate portal, referral promo, lead CRM |

## AI Context

For AI tooling (Claude Code, MCP, agent development): [`docs/claude/`](docs/claude/)
