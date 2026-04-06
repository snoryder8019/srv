---
scope: platform architecture
updated: 2026-03-26
---

# Multi-Tenant Architecture

## Tenant Resolution Flow
1. Request arrives with `Host: w2marketing.biz`
2. `middleware/tenant.js` looks up domain in `slab.tenants` (cached 5min)
3. Decrypts secrets in memory (AES-256-GCM)
4. Sets `req.tenant`, `req.db` (tenant-specific MongoDB), `res.locals.brand`
5. All routes use `req.db` — **never** `getDb()` or `getSlabDb()` in route handlers

## Tenant Document (`slab.tenants`)
```js
{
  domain: "w2marketing.madladslab.com",
  db: "slab_w2marketing",        // per-tenant MongoDB database
  status: "active",               // active | preview | suspended | cancelled
  brand: { name, businessType, industry, tagline, description, location,
           serviceArea, phone, email, ownerName, services[], pricingNotes,
           targetAudience, brandVoice, socialLinks{} },
  s3Prefix: "w2marketing",       // isolates uploads in shared bucket
  public: { stripePublishable, paypalClientId, paypalMode, zohoUser,
            googlePlacesKey, googlePlaceId, googleOAuthClientId, customDomain },
  secrets: {                      // AES-256-GCM encrypted at rest
    stripeSecret, stripeWebhookSecret, paypalSecret, zohoPass, googleOAuthSecret
  },
  meta: { subdomain, customDomain, ownerEmail, plan, provisionedAt,
          activatedAt, expiresAt }
}
```

## Database Isolation
- Registry DB: `slab` — holds `tenants`, `signups`, `plans`, `sessions`
- Tenant DBs: `slab_{slug}` — identical collection names across all tenants
- `plugins/mongo.js`: `getSlabDb()` for registry, `getTenantDb(name)` for tenant

## Collections (per tenant database)
`blog`, `copy`, `design`, `portfolio`, `clients`, `pages`, `custom_sections`,
`section_media`, `invoices`, `invoice_counter`, `themes`, `brand_images`,
`assets`, `asset_folders`, `contacts`, `campaigns`, `campaign_events`,
`client_emails`, `meetings`, `reviews_cache`, `sessions`, `users`

## Collections (slab registry — Huginn)
`huginn_tasks`, `huginn_notes`, `huginn_conversations` — superadmin AI assistant data, stored in the slab registry DB (not per-tenant)

## S3 Isolation
- Shared bucket: `madladslab` on Linode Object Storage
- Per-tenant prefix: `{s3Prefix}/portfolio/`, `{s3Prefix}/clients/`, etc.
- `middleware/upload.js` reads `req.tenant.s3Prefix`

## Encryption
- `plugins/crypto.js` — AES-256-GCM, `MASTER_KEY` env var (64-char hex)
- Format: `{iv_hex}:{ciphertext_hex}:{tag_hex}`
- Secrets decrypted once per tenant resolution, held in memory cache only

## Authentication
- Google OAuth 2.0 with white-label support (tenant can override OAuth app)
- Custom flow in `routes/auth.js` — signed `state` JWT carries context through redirect
- Three JWT cookies (all `.madladslab.com` scoped in production):
  - `slab_token` — admin (8h)
  - `slab_portal` — client/collaborator (24h)
  - `slab_super` — superadmin (12h)
- Superadmin email list in `middleware/superadmin.js` supersedes tenant admin flags

## Environment Variables (platform-level only)
`PORT`, `NODE_ENV`, `DB_URL`, `SLAB_DB`, `JWT_SECRET`, `SESHSEC`, `MASTER_KEY`,
`LINODE_ACCESS`, `LINODE_SECRET`, `LINODE_BUCKET`, `LINODE_URL`, `LINODE_REGION`,
`OLLAMA_URL`, `OLLAMA_KEY`, `OLLAMA_MODEL`, `SEARCH_API_KEY`,
`GGLCID`, `GGLSEC`, `DOMAIN`,
`HUGINN_WEBHOOK_SECRET` (optional — validates inbound webhook events)

Per-tenant keys live in `slab.tenants` document, encrypted.

## Provisioning Pipeline (`plugins/provision.js`)
1. Validate subdomain → create tenant doc (status: preview)
2. Create `slab_{slug}` database, seed 17+ collections
3. Create admin user
4. Optional: Linode DNS A record, Apache vhost, SSL cert

## Key File Map
```
app.js                    Express setup + tenant middleware
bin/www.js                Entry point (port 3602)
config/config.js          Platform env vars
plugins/crypto.js         AES-256-GCM
plugins/mongo.js          DB connections
middleware/tenant.js       Domain → tenant resolution
middleware/jwtAuth.js      Admin/portal JWT
middleware/superadmin.js   Superadmin auth
routes/auth.js            Google OAuth (custom, not Passport)
routes/admin.js           Admin router
routes/superadmin.js       Platform management + Huginn chat/control-center views
routes/huginn-mcp.js       Huginn MCP (JSON-RPC 2.0 + REST shortcuts)
routes/huginn-webhook.js   Huginn webhook (external event ingestion)
plugins/huginnMcp.js       Huginn data layer (tasks, notes, conversations, context)
plugins/provision.js       Tenant provisioning
```
