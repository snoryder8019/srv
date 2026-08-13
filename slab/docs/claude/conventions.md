---
scope: code conventions
updated: 2026-07-20
---

# Code Conventions & Rules

## Runtime
- ESM (`"type": "module"`) — no CommonJS. (Two deliberate `.cjs` exceptions
  exist: `plugins/notify.cjs`, `plugins/comms-log.cjs`.)
- The host runs **Node 22**. The March docs said "Node 18, no Node 20+ APIs" —
  that constraint is stale, but nothing in the tree currently depends on a
  Node 20+ API, so prefer conservative APIs unless you have a reason.
- Never `killall node` or `pkill node` — use `fuser -k PORT/tcp`
- Dev: `npx nodemon bin/www.js`. Local port 3602; `config.PORT` defaults to 3601.
- Prod runs as a systemd unit (`srv-slab.service`), not tmux.

## Single Sources of Truth — do not fork these
| Don't hardcode | Read from |
|----------------|-----------|
| Sidebar links, permission checkboxes, feature stages | `plugins/featureRegistry.js` |
| Design token names/defaults | `config/schema.js` |
| Block types + field lists | `config/blocks.js` |
| Prices, discounts, commission rates | `config/pricing.js` |
| Pipeable page modules | `plugins/pageSources.js` |
| Agent catalog + tool mapping | `plugins/agentRegistry.js` |

**Adding an admin feature** = add one `FEATURES` entry + mount the router. The
sidebar, the Users & Permissions checkboxes, the Labs opt-in list and the
superadmin visibility board all pick it up. Never add a nav `<li>` by hand.

Ship risky features as `experimental: true` — hidden until a tenant opts in at
`/admin/labs`, and the superadmin can promote to `beta` / `visible` from
`/superadmin/features` without a deploy.

## Database Access
- Routes MUST use `req.db` (set by tenant middleware) — never `getDb()` or
  `getSlabDb()` in route handlers
- Registry operations use `getSlabDb()` only in plugins/middleware
- `getTenantDb(name, host)` for cross-tenant lookups (superadmin, provisioning).
  **Pass `host` when you have it** — `tenant.dbHost` is `atlas` or `gpu`. Omitting
  it falls back to the boot-loaded host map, which is correct but only if the
  tenant was in the registry at boot.
- **Never swallow errors in a cross-tenant loop.** All tenants may sit on one
  cluster; a silent `catch {}` turns a tunnel blip into "zero results" with no
  signal. Collect failures and surface them (see `routes/superadmin/users.js`).

## Route Ordering
Express is first-wins. Named routes (`/agent`, `/mcp`, `/execute`) MUST be
declared before wildcards (`/:id`, `/:section`).

## Authentication
- `requireAdmin` on all `/admin/*` routes (except `/admin/login`)
- `requireSuperAdmin` on all `/superadmin/*` routes
- Superadmin is derived from the **email** on `slab_token` against
  `SUPERADMIN_EMAILS` in `middleware/superadmin.js` — there is no separate
  superadmin cookie. It supersedes tenant admin flags.
- JWT cookies scoped to `.madladslab.com` in production; logout must clear with
  the same domain option
- `enforceFeatureAccess` is a second, softer layer over `/admin/*`. A path that
  matches no `FEATURES` entry is intentionally ungated substrate — if you add a
  route that *should* be gated, make sure it lives under a feature's `url`.

## Public Token Surfaces
`/engage/:token`, `/pay/:token`, `/field/:token` are unauthenticated. Rules:
- The token is the credential — mint it with `crypto.randomBytes`, never derive
  it from an id
- **Re-check `validUntil` on every request.** Never trust a cron to have flipped
  a status to `expired` first
- Never re-implement payment or signature logic — `fieldPortal.js` aggregates and
  hands off to `/engage` and `/pay`

## Encryption
- Secrets: `encrypt(value)` before DB write, `decrypt(blob)` on read
- Never log decrypted secrets. `plugins/secretGuard.js` redacts key-shaped
  strings from all console output as a backstop — treat it as defence-in-depth,
  not permission to log keys
- `MASTER_KEY` must be 64-char hex (32 bytes)
- Tenant-supplied API keys go in the key vault (`/admin/settings/keys`) and are
  read with `getTenantKey(req.tenant, name)` — AES-encrypted, not hashed

## EJS Templates
- `<%-` for HTML content (unescaped)
- `<%= %>` for text (escaped)
- `brand.*` via `res.locals.brand`; `tenant.*` via `res.locals.tenant`
- `t('some.key')` via `res.locals.t` for user-facing strings — see i18n below
- Nav comes from the precomputed groups `loadUserAccess` puts on `res.locals`

## i18n
- New user-facing copy goes through `t('nav.home')`, with the key added to
  **both** `locales/en.json` and `locales/es.json` (nested objects, dot-path)
- A missing key falls back English → the key itself, so a partial dictionary
  never throws — but it does render an ugly key, so add both
- `<html lang>` comes from `res.locals.htmlLang`
- The language switcher only renders when the tenant enabled multilang
  (`res.locals.multilangOn`, set at `/admin/settings` → Language; default off)
- Admin and public locales are independent contexts with separate cookies —
  don't collapse them
- Coverage as of 2026-07-20: chrome + switcher + `field.*` are done; public
  views, route copy, emails and dynamic content are **not yet** translated

## Scheduled Jobs
Never `cron.schedule` a job you care about — `node-cron` drops ticks on this
WSL2 host, and a daily job pinned to one tick can be skipped for the entire day.
Use `scheduleDailyJob` / `scheduleIntervalJob` from `plugins/cronSafe.js`, which
add catch-up, a `cron_state` claim before running (so billing never
double-fires), and automatic `cron_runs` recording.

## Error Handling
- Views: dashboard catches DB errors and renders zero counts (graceful
  degradation); settings/profile redirect to `/admin` if tenant or user missing;
  public routes render generic fallbacks
- Observability is best-effort by design — a failure to log must never break the
  request, the cron, or the process
- Front-end crashes report to `POST /api/client-error` via
  `public/js/errorReporter.js`; both feeds surface at `/superadmin/reports`

## LLM / Agent Code
- Search-first, inject-context, single-call for house (small) models
- Never use tool-call loops with small models — the agentic loop
  (`callAnthropicAgentic`) is Claude-only
- Always parse with `tryParseAgentResponse()` — never raw `JSON.parse`
- All LLM calls go through `plugins/agentEngine.js` so the house/Anthropic choice
  stays in one place. Wrap interactive entry points in `withEngine({ tenant })`
  so deep `callLLM` call sites can resolve the tenant.
- Routing MUST call `assertDepartmentAllowed()` (`plugins/agentAudience.js`)
  after routing so a public visitor can never reach a mutating or finance tool
- New design fields must exist in `config/schema.js` `DESIGN_DEFAULTS` or they
  won't persist (the old pointer to `routes/admin/design.js` is now just a
  re-export shim)

## Front-End Conventions
- Every POST surface gets the double-click guard + tenant-branded flash:
  `data-guard` / `SlabLoader.post` / `SlabFlash.fromUrl` in
  `public/js/loadingWheel.js`
- Don't add new fixed bottom-right buttons. Register with the collapsible corner
  dock (`public/js/dockController.js`) instead.

## S3 Uploads
- Prefix all uploads with `req.tenant.s3Prefix`
- Use `middleware/upload.js` handlers — never upload directly
- PII (résumés, signed docs) uses `uploadPrivateBuffer` + `getObjectStream`,
  never a public-read ACL

## Repo Hygiene
`plugins/`, `routes/` and `routes/admin/` contain a number of `*.bak-*`,
`*.prerefactor-*` and `*.authdbg.*` files. They are **not** loaded and are stale
— exclude them from greps and never edit them.
