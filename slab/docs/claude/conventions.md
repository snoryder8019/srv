---
scope: code conventions
updated: 2026-03-26
---

# Code Conventions & Rules

## Runtime
- Node 18, ESM (`"type": "module"`) — no CommonJS, no Node 20+ APIs
- Never `killall node` or `pkill node` — use `fuser -k PORT/tcp`
- Dev: `npx nodemon bin/www.js`

## Database Access
- Routes MUST use `req.db` (set by tenant middleware) — never `getDb()` or `getSlabDb()`
- Registry operations use `getSlabDb()` only in plugins/middleware
- `getTenantDb(name)` for cross-tenant lookups (superadmin, provisioning)

## Route Ordering
Express is first-wins. Named routes (`/agent`, `/mcp`, `/execute`) MUST be declared before wildcards (`/:id`, `/:section`).

## Authentication
- `requireAdmin` middleware on all `/admin/*` routes (except `/admin/login`)
- `requireSuperAdmin` on all `/superadmin/*` routes
- Superadmin email supersedes tenant admin flags — always gets access
- JWT cookies scoped to `.madladslab.com` in production

## Encryption
- Secrets: `encrypt(value)` before DB write, `decrypt(blob)` on read
- Never log decrypted secrets
- `MASTER_KEY` must be 64-char hex (32 bytes)

## EJS Templates
- `<%-` for HTML content (unescaped)
- `<%= %>` for text (escaped)
- `brand.*` available via `res.locals.brand` in all templates
- `tenant.*` available via `res.locals.tenant`

## LLM / Agent Code
- Always search-first, inject-context, single-call
- Never use tool-call loops with small models
- Always parse with `tryParseAgentResponse()` — never raw `JSON.parse`
- Design fields must be in `DESIGN_DEFAULTS` (`routes/admin/design.js`) or they won't persist

## Cookie Domain
All JWT cookies and session cookie use `.madladslab.com` domain in production for cross-subdomain auth. Logout must clear with same domain option.

## S3 Uploads
- Prefix all uploads with `req.tenant.s3Prefix`
- Use `middleware/upload.js` handlers — never upload directly

## Error Handling in Views
- Dashboard catches DB errors and renders with zero counts (graceful degradation)
- Settings/profile redirect to `/admin` if tenant or user not found
- Public routes catch errors and render generic fallbacks
