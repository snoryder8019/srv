---
scope: platform architecture
updated: 2026-07-20
---

# Multi-Tenant Architecture

## Tenant Resolution Flow
1. Request arrives with `Host: w2marketing.biz`
2. `middleware/tenant.js` looks up domain in `slab.tenants` (in-memory cache, 5min TTL)
3. Decrypts `secrets` **and** `customKeys` in memory (AES-256-GCM)
4. Sets `req.tenant`, `req.db`, `res.locals.brand` / `.tenant`
5. All routes use `req.db` — **never** `getDb()` or `getSlabDb()` in route handlers

`req.db = getTenantDb(tenant.db, tenant.dbHost)` — the host argument matters, see
Database Isolation below.

Cache busting after a tenant-doc write: `bustTenantCache(domain)` from
`middleware/tenant.js`.

## Middleware Order (`app.js`)
```
helmet → session → passport → morgan
  → raw-body for /webhooks/stripe + /start/webhook   (before express.json)
  → json / urlencoded / cookieParser / static
  → resolveTenant        (middleware/tenant.js)
  → localeMiddleware     (middleware/locale.js — needs req.tenant)
  → trackRouteUsage      (plugins/routeUsage.js)
  → seoMiddleware        (middleware/seo.js)
  → routers
  → 404 → error handler (reports via plugins/observe.js)
```
Order is load-bearing: locale reads `req.tenant.public.language`, so it must
follow tenant resolution.

## Tenant Document (`slab.tenants`)
```js
{
  domain: "w2marketing.madladslab.com",
  db: "slab_w2marketing",        // per-tenant MongoDB database
  dbHost: "atlas" | "gpu",       // WHICH CLUSTER holds that database
  status: "active",              // active | preview | suspended | cancelled
  brand: { name, businessType, industry, tagline, description, location,
           serviceArea, phone, email, ownerName, services[], pricingNotes,
           targetAudience, brandVoice, socialLinks{} },
  s3Prefix: "w2marketing",       // isolates uploads in shared bucket
  public: { stripePublishable, paypalClientId, paypalMode, zohoUser,
            googlePlacesKey, googlePlaceId, googleOAuthClientId, customDomain,
            language, adminLanguage, multilang,        // i18n
            networkOptIn, chatbotEnabled, ... },
  secrets: {                     // AES-256-GCM encrypted at rest
    stripeSecret, stripeWebhookSecret, paypalSecret, zohoPass, googleOAuthSecret
  },
  customKeys: [                  // tenant key vault; `value` encrypted at rest
    { name: "anthropic_api_key", value: "<enc>" }
  ],
  meta: { subdomain, customDomain, ownerEmail, plan, provisionedAt,
          activatedAt, expiresAt }
}
```
`public.*` is anything safe to render client-side. `secrets.*` and
`customKeys[].value` are decrypted once per tenant-cache load and held in memory
only. Read a vault key with `getTenantKey(req.tenant, name)`.

## Database Isolation
- Registry DB: `slab` — always on **atlas**
- Tenant DBs: `slab_{slug}` — identical collection names across all tenants
- **Two physical clusters.** `dbHost` on the tenant doc selects one:
  - `atlas` — the default, hosted Atlas cluster
  - `gpu` — the self-hosted cluster, reached over an SSH tunnel (`TENANT_DB_URL`)
- `plugins/mongo.js`:
  - `getSlabDb()` — registry
  - `getTenantDb(dbName, host)` — host optional; when omitted it is resolved from
    a registry-backed `dbName → host` map loaded at boot (`loadTenantHostMap()`),
    defaulting to `atlas`
  - `tenantClusterReady()` — is the gpu tunnel up?
  - `registerTenantHost(dbName, host)` — keep the map current after provisioning
- The gpu cluster reconnects in the background on failure; a request for a gpu
  tenant while the tunnel is down throws rather than silently reading atlas.
- `NEW_TENANT_DB_HOST` decides where newly provisioned tenants land.

**Gotcha:** silent `catch {}` inside cross-tenant loops turns one tunnel blip
into "every user vanished". Surface failures (see the `failedTenants` banner in
`routes/superadmin/users.js`).

## Collections — per tenant database
Rebuilt 2026-07-20 by grepping actual `.collection(...)` access across
`routes/`, `plugins/`, `middleware/`. Most are created lazily on first write.

**Content & site**
`blog`, `pages`, `portfolio`, `copy`, `design`, `custom_sections`,
`section_media`, `nav_links`, `themes`, `brand_images`, `brand_models`,
`templates`, `active_template`, `template_switch_backups`, `calculators`,
`share_links`

**Assets**
`assets`, `asset_folders`, `asset_campaigns`, `files`, `print_assets`,
`print_materials`, `qr_links`

**Clients & CRM**
`clients`, `contacts`, `inquiries`, `client_emails`, `notes`, `note_tags`,
`onboarding_forms`, `onboarding_responses`, `signup_forms`, `spam_emails`,
`tickets`, `ticket_counter`, `agreements`, `deletion_requests`

**Engagements & finance**
`engagements`, `engagement_counter`, `services`, `package_templates`,
`invoices`, `invoice_counter`, `ledger_entries`, `ledger_settings`,
`ledger_budgets`, `ledger_adjustments`, `ledger_scans`, `ledger_statements`,
`ledger_statements_trash`, `ledger_vendor_rules`, `gl_categories`,
`mileage_log`, `utilities_log`

**Meetings & booking**
`meetings`, `bookings`, `booking_settings`, `calendar_slots`

**Marketing / social**
`campaigns`, `campaign_events`, `social_accounts`, `social_posts`,
`social_jobs`, `social_activity`, `social_listeners`, `social_digest`,
`social_scores`, `social_voice`, `social_presets`, `social_resources`,
`social_backgrounds`, `design_feedback`, `live_rtmp_targets`

**Careers & marketplace**
`jobs`, `job_applications`, `marketplace_listings`

**Field ops**
`field_jobs`

**Agents & chat**
`agent_config`, `agent_feedback`, `chat_threads`, `chat_messages`, `chat_flow`

**Platform / misc**
`users`, `roles`, `feature_optins`, `scan_results`, `reviews_cache`, `rants`,
`shorts`, `events`

Provisioning (`plugins/provision.js` `SEED_COLLECTIONS`) deliberately seeds only
18 of these: `assets, blog, brand_images, brand_models, clients, contacts, copy,
custom_sections, design, invoices, job_applications, jobs, onboarding_forms,
onboarding_responses, pages, portfolio, section_media, themes`. `design` is
seeded **empty** on purpose — see Design Schema below.

> Referenced only from one-off scripts, may not exist on live tenants:
> `design_examples`, `templates_legacy_archive`.
> Special case: `routes/superadmin/crossapp.js` hardcodes the `opsTrain` tenant
> and reads `brands`, `qrcodes`, `tasks` there — not part of the standard schema.

## Collections — slab registry database
**Platform**: `tenants`, `signups`, `plans`, `promos`, `sessions`,
`platform_features`, `platform_roles`, `platform_notifications`,
`platform_events`, `superadmin_messages`, `subscribers`, `changelog`,
`setup_requests`, `escalated_tickets`, `fix_handoffs`, `template_store`,
`template_votes`, `network_waitlist`, `global_spam`, `spam_reports`

**Delegates**: `sales_delegates`, `delegate_leads`, `delegate_referrals`,
`delegate_promo_codes`, `delegate_commission_accruals`, `delegate_payouts`,
`commission_expense`

**Observability**: `error_logs`, `client_errors`, `cron_runs`, `cron_state`,
`route_usage`, `activity_logs`, `comms_log`, `security_events`,
`security_snapshots`, `security_system_stats`

**Agents**: `token_usage`, `mcp_tool_usage`, `training_candidates`

**Gateway** (`routes/superadmin/scottsGateway.js`): `gateway_config`,
`gateway_state`, `gateway_tasks`, `gateway_tv_pairs`

**Huginn (dormant)**: `huginn_tasks`, `huginn_notes`, `huginn_conversations`

> `activity_log` (singular, `routes/delegates.js`) and `activity_logs` (plural,
> `plugins/activityLog.js`) both exist. This looks like an accidental split
> rather than two deliberate stores — **unverified**, confirm before relying on
> either as canonical.

## Feature Registry — single source of truth
`plugins/featureRegistry.js` declares every admin feature once. Three consumers
read it: the sidebar partial, the tenant Users & Permissions page, and the
superadmin Feature Visibility board. **Never hardcode a sidebar link.**

Two orthogonal gates, enforced in `middleware/permissions.js`:

**1. Release stage** (superadmin-chosen, per feature):

| Stage | Audience |
|-------|----------|
| `experimental` | hidden until the TENANT opts in at `/admin/labs`; badged once on |
| `beta` | all tenants, badged "beta" |
| `visible` | all tenants, no badge (GA) |
| `off` | hidden from all tenants |

`experimental: true` on a FEATURES entry only sets the *default* stage; the
superadmin override stored in `slab.platform_features` wins. Superadmins always
see every feature at every stage.

**2. Per-tenant access:**
- `perm: true` — owner + unrestricted admins always have it; a non-owner admin
  needs the feature key in their `permissions` array — **unless that array is
  empty, which means unrestricted**. Empty = full access is the safe default.
- `adminOnly: true` — sensitive tools (users, roles, settings, chat control):
  owner + unrestricted admins only; restricted collaborators are kept out.
- `hideNav: true` — routable and permission-gated, but no sidebar slot.
- `advanced: true` — deep tool; tenants can hide it from the sidebar at
  Settings → Slab Functions (`toggleableFunctions()`, nav-only, never enforcement).

Key exports: `FEATURES`, `NAV_SECTIONS`, `featureByKey`, `permissionCatalog`,
`permissionKeys`, `toggleableFunctions`, `matchFeatureByPath`, `resolveStage`,
`stageBadge`, `canSeeFeature`, `STAGES`.

`middleware/permissions.js`:
- `loadUserAccess` — resolves permissions/ownership + stage overrides + tenant
  opt-ins (`feature_optins`), precomputes the gated nav onto `res.locals`
- `enforceFeatureAccess` — soft guard across the admin router; blocks direct-URL
  access using `matchFeatureByPath`. Paths that match no feature (e.g.
  `/admin/agent-chat`) are deliberately ungated substrate.

## Design Schema — single source of truth
`config/schema.js` holds `DESIGN_DEFAULTS`, `THEME_KEYS`, `COPY_SECTIONS`.

- It must stay a **leaf**: import nothing from `routes/` or `plugins/`.
  (It was extracted from `routes/admin/design.js` to break an import cycle with
  `sections.js`; `routes/admin/design.js` re-exports the three symbols for
  back-compat, and several routes still import them from there.)
- **Storage is SPARSE.** A tenant's `design` collection holds only intentional
  overrides. Reads do `{ ...DESIGN_DEFAULTS }` then overlay stored rows. Adding a
  key here goes live on every tenant instantly — no backfill.
- `home_source` is a two-value model: `slab` (platform-rendered — the activated
  template from `active_template`, else the standard landing layout) or `custom`
  (`views/tenants/<sub>/home.ejs`, falling back to `slab` if the file is absent).
  Legacy `auto`/`layout`/`template` were migrated out and are no longer written.

`config/blocks.js` is the matching source of truth for block types, shared by
`routes/admin/pages.js` and `routes/admin/templates.js`
(`VALID_BLOCK_TYPES`, `BLOCK_FIELDS`, `BLOCK_DEFAULTS`, `BLOCK_META`,
`PAGE_BLOCK_TYPES`, `PAGE_BLOCK_META`, `PAGE_BLOCK_DEFAULTS`).

## Pricing — single source of truth
`config/pricing.js`. Consumed by `routes/onboarding.js` (checkout),
`routes/delegates.js` (commission), `routes/superadmin/dashboard.js` (MRR),
`plugins/platformComps.js`. **Do not re-hardcode amounts elsewhere.**

- `BASE_MONTHLY = 39.95`; `DISCOUNTS = { quarterly: 0.08, annual: 0.10 }`
- `TRIAL_DAYS = 14`
- `PLANS` — `monthly` / `quarterly` / `annual` / `trial` / `lifetime`. Each entry
  is `{ label, amount (fixed-2 string), days (null = no expiry), monthly, public }`.
  `amount` is the **charged total for the access window**, matching the
  "pay to unlock N days" model (both Stripe and PayPal are one-time charges).
- `lifetime` ($2,500) is `public: false` — superadmin-assign only, priced high
  as a failsafe against accidental exposure.
- `COMMISSION = { 1: 0.40, 2: 0.20, default: 0.10 }` — % of NET tenant revenue by
  delegate-relationship year.

## Platform Plugins
Cross-cutting infrastructure worth knowing before you build anything new.

| Plugin | Role |
|--------|------|
| `plugins/i18n.js` | Zero-dep SSR i18n. Dicts in `locales/<code>.json`, nested, dot-path lookup. Immutable after boot; every request gets its own bound `t` (no global mutable "current language" → no locale bleed across concurrent requests). `{{name}}` interpolation. Missing key → English → the key itself. `SUPPORTED_LOCALES` = en, es. |
| `middleware/locale.js` | Sets `res.locals.locale / htmlLang / t / locales / multilangOn`. **Two independent contexts**: `/admin` + `/superadmin` use `tenant.public.adminLanguage` and the `slab_admin_lang` cookie; everything else uses `tenant.public.language` and `slab_lang`. So an owner can run the dashboard in Spanish while serving an English storefront. |
| `plugins/observe.js` | Best-effort observability sinks in the registry DB, each with a 30-day TTL index: `error_logs` (Express error handler + process traps), `client_errors` (POST `/api/client-error` from `public/js/errorReporter.js`), `cron_runs`. Also writes health fields onto `cron_state`. `agent_feedback` is intentionally TTL-free. A logging failure must never break a request. Read side: `routes/superadmin/monitoring.js`. |
| `plugins/routeUsage.js` | Per-tenant endpoint popularity. In-memory buffer keyed by (day, tenant, method, normalized route), flushed to `slab.route_usage` via one `bulkWrite` every 60s — no per-request DB write. `normalizeRoute` collapses ObjectIds/UUIDs/long hex and caps at 6 segments to bound cardinality. `SKIP_PREFIXES` drops assets/infra/`/superadmin`. Powers the superadmin dashboard. |
| `plugins/cronSafe.js` | WSL2-tolerant scheduling — see Cron Gotcha below. |
| `plugins/platformLedger.js` | Posts MadLadsLab's own go-live revenue (Stripe + PayPal, from `routes/onboarding.js` return handlers) as income in the house tenant's ledger (`slab_madladslab`), category "Platform Subscriptions" `4020`. Idempotent on the processor transaction id; failures swallowed so they can never break payment activation. |
| `plugins/pageSources.js` | The module-pipe registry. A `datalist` page block pipes another module's published content into a page — read-only, one-directional. One choke point (`runSource`) shared by public render (`routes/index.js`) and the inline `{{module "blog" limit=3}}` helper (`plugins/pipes.js`). Adding a pipeable module = one `PAGE_SOURCES` entry. Imports nothing from its consumers; receives `db` as a parameter so it never crosses a tenant boundary. |
| `plugins/engagements.js` | Letters of engagement (quote → sign → invoice). `ENGAGEMENT_STATUSES`, `TERMINAL_STATUSES`, `SIGNABLE_STATUSES`, `DEFAULT_TERM_SECTIONS`, atomic `ENG-YYYY-NNNN` numbering, `hashDocument`, `logEvent` audit trail, `engagementToInvoice`. Note `expired` is deliberately absent from `SIGNABLE_STATUSES`' logic — `/sign` re-checks `validUntil` directly rather than trusting a cron to have run. |
| `plugins/fieldRoute.js` | Dependency-free commute/ETA math for field ops. `haversineKm` × 1.3 road factor ÷ 38 km/h assumed door-to-door speed. An estimate, not turn-by-turn — swap in a routing API later without touching callers. |
| `plugins/shareLink.js` | One per-tenant short-link system. Tokens live in the TENANT db, so `/s/:token` resolves differently per tenant by construction. Minted once per (collection, docId) and reused, so a piece of content always shares under a stable URL. |
| `plugins/secretGuard.js` | Patches `console.*` at boot (imported **first** in `bin/www.js`) to redact key-shaped secrets (`sk-ant-…`, `sk-…`, `whsec_…`) from every log line, including inspected objects/Errors. Defence-in-depth after a real leak. |
| `plugins/agentRegistry.js` / `agentEngine.js` / `agentRouter.js` | See [agents.md](agents.md). |

## Cron Gotcha — WSL2 drops ticks
`node-cron` **skips ticks** on this host's jittery VM clock. The every-minute
social scheduler was dropping ~4 consecutive ticks, and a daily job pinned to a
single tick (token refresh 4am, invoices 6am) can be dropped for the whole day —
expired tokens, missed billing.

Use `plugins/cronSafe.js` instead of `cron.schedule`:

```js
// Fires the first check at/after HH:MM that day; a skipped tick just means the
// next 10-min check runs it. Claims in `cron_state` BEFORE running → never
// double-fires, safe for billing.
scheduleDailyJob('recurring-invoices', 6, runRecurringInvoices, { label: '...' });

// Plain interval + reentrancy guard + early post-boot run. For pollers where
// "roughly every N" is enough.
scheduleIntervalJob('imap-poller', 2 * 60 * 1000, pollAllTenants, { bootDelayMs: 10000 });
```

Both record to `cron_runs` via `observe.js`. Current consumers:
`recurringCron.js`, `socialCron.js`, `imapPoller.js`. Jobs start in
`bin/www.js` inside the `server.listen` callback.

## S3 Isolation
- Shared bucket: `madladslab` on Linode Object Storage
- Per-tenant prefix: `{s3Prefix}/portfolio/`, `{s3Prefix}/clients/`, etc.
- `middleware/upload.js` reads `req.tenant.s3Prefix`
- `plugins/s3.js`: `uploadBuffer(..., { acl })`; `uploadPrivateBuffer` +
  `getObjectStream` for PII (résumés — used by the Careers module)
- Optional `CDN_BASE` rewrites public asset URLs

## Encryption
- `plugins/crypto.js` — AES-256-GCM, `MASTER_KEY` env var (64-char hex)
- Format: `{iv_hex}:{ciphertext_hex}:{tag_hex}`
- Covers `secrets.*` **and** `customKeys[].value`; both decrypted once per
  tenant-cache load, held in memory only

## Authentication
- Google OAuth 2.0 with white-label support (a tenant can override the OAuth app)
- Custom flow in `routes/auth.js` — a signed `state` JWT carries context through
  the redirect. Not Passport for this path.
- JWT cookies (`.madladslab.com`-scoped in production):
  - `slab_token` — admin (8h), sliding refresh
  - `slab_portal` — client/collaborator (24h)
- **There is no `slab_super` cookie.** `middleware/superadmin.js` derives
  superadmin from the *email* on `slab_token` against a hardcoded
  `SUPERADMIN_EMAILS` list, and it supersedes tenant admin flags.
- Public magic-link surfaces carry no cookie at all — the unguessable token IS
  the credential, gated by a `validUntil` expiry checked at request time (never
  trusting a cron to have flipped a status first): `/engage/:token`,
  `/pay/:token`, `/field/:token`.

## Socket.IO Namespaces (`plugins/socketio.js`)
| Namespace | Purpose |
|-----------|---------|
| `/meetings` | Video meetings |
| `/live` | Live Studio / RTMP targets |
| `/field` | Field-ops GPS tracking (client: `public/js/fieldLive.js` + Leaflet) |
| `/chat` | Chat substrate (`plugins/chatSocket.js`, wired from `initSocketIO`) |

The `/huginn` namespace documented in March no longer exists.

## Environment Variables (platform-level only)
```
PORT NODE_ENV DOMAIN
DB_URL SLAB_DB TENANT_DB_URL NEW_TENANT_DB_HOST
JWT_SECRET SESHSEC MASTER_KEY
LINODE_ACCESS LINODE_SECRET LINODE_BUCKET LINODE_URL LINODE_REGION
  S3_FORCE_PATH_STYLE CDN_BASE
LINODE_API_TOKEN LINODE_DOMAIN_ID LINODE_IP
OLLAMA_URL OLLAMA_KEY OLLAMA_MODEL OLLAMA_VISION_MODEL
ANTHROPIC_API_KEY ANTHROPIC_MODEL ANTHROPIC_COORDINATOR_MODEL
SEARCH_API_KEY GOOGLE_FONTS_API_KEY
GGLCID GGLSEC MSCID MSSEC MS_TENANT
SLAB_STRIPE_SECRET SLAB_STRIPE_PUBLISHABLE SLAB_STRIPE_WEBHOOK_SECRET
  SLAB_STRIPE_PRICE_ID
PAYPAL_CID PAYPAL_SEC PAYPAL_MODE
```
`config.PORT` defaults to `3601`; the local dev instance runs on `3602`.
Per-tenant keys live in the `slab.tenants` document, encrypted — not in env.

## Provisioning Pipeline (`plugins/provision.js`)
1. Validate subdomain → create tenant doc (status: `preview`), choosing `dbHost`
   from `NEW_TENANT_DB_HOST` and calling `registerTenantHost`
2. Create `slab_{slug}` database, seed the 18 `SEED_COLLECTIONS` (`design` empty)
3. Create admin user
4. Optional: Linode DNS A record, Apache vhost, SSL cert
   (`provisionSsl`, `setupCustomDomain`)

## Key File Map
```
app.js                     Express setup + middleware chain
bin/www.js                 Entry point; secretGuard first, then cron starts
config/config.js           Platform env vars
config/schema.js           Design token schema (LEAF — no route/plugin imports)
config/blocks.js           Block types for pages + templates
config/pricing.js          Plans + delegate commission
plugins/mongo.js           Multi-cluster DB connections (atlas | gpu)
plugins/crypto.js          AES-256-GCM
plugins/featureRegistry.js Admin nav / permissions / release stages
plugins/secretGuard.js     Console redaction
plugins/observe.js         Error + cron feeds
plugins/routeUsage.js      Per-tenant route usage
plugins/cronSafe.js        WSL2-tolerant scheduling
plugins/i18n.js            Translation engine
plugins/pageSources.js     Page module pipes
plugins/platformLedger.js  Platform revenue → house ledger
middleware/tenant.js       Domain → tenant resolution
middleware/locale.js       Locale resolution (admin vs public contexts)
middleware/permissions.js  Feature gating (stage + per-tenant access)
middleware/jwtAuth.js      Admin/portal JWT
middleware/superadmin.js   Superadmin auth (email-derived)
routes/auth.js             Google OAuth (custom, not Passport)
routes/admin.js            Admin router
routes/superadmin/index.js Superadmin router (mounts dashboard, tenants, users,
                           monitoring, tickets, ops, announcements, …)
routes/engage.js           Public /engage/:token — quote view + sign
routes/pay.js              Public /pay/:token — invoice pay
routes/fieldPortal.js      Public /field/:token — job status, delegates to the above
plugins/provision.js       Tenant provisioning
```
