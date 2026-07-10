import dotenv from 'dotenv';
dotenv.config();

// ── Slab platform config ────────────────────────────────────────────────────
// Infrastructure-only. Tenant-specific keys (Stripe, OAuth, Zoho, etc.)
// live in the slab.tenants collection, encrypted at rest.
export const config = {
  PORT: process.env.PORT || 3601,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // MongoDB — shared connection string, slab DB for tenant registry
  DB_URL: process.env.DB_URL,
  SLAB_DB: process.env.SLAB_DB || 'slab',

  // Self-hosted tenant Mongo (GPU box, via SSH reverse tunnel on VPS loopback).
  // When set, new tenants provision here instead of the Atlas shared cluster.
  TENANT_DB_URL: process.env.TENANT_DB_URL || '',
  // Host new tenants land on: 'gpu' (self-hosted) | 'atlas' (shared cluster).
  // Falls back to atlas if no TENANT_DB_URL is configured.
  NEW_TENANT_DB_HOST: process.env.NEW_TENANT_DB_HOST || (process.env.TENANT_DB_URL ? 'gpu' : 'atlas'),

  // Session & JWT — shared across all tenants (cookies are domain-scoped)
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  SESHSEC: process.env.SESHSEC || 'dev_session_secret',

  // Linode Object Storage — shared bucket, tenant files isolated by prefix
  LINODE_ENDPOINT: process.env.LINODE_URL || 'https://us-ord-1.linodeobjects.com',
  LINODE_REGION: process.env.LINODE_REGION || 'us-ord-1',
  LINODE_BUCKET: process.env.LINODE_BUCKET || 'madladslab',
  LINODE_KEY: process.env.LINODE_ACCESS,
  LINODE_SECRET: process.env.LINODE_SECRET,
  // Object-storage cutover (Linode → self-hosted MinIO/CDN). All inert until set:
  // - S3_FORCE_PATH_STYLE=true   → required for MinIO
  // - CDN_BASE=https://cdn.madladslab.com → public URL host for stored objects
  // When unset, behaviour is exactly the legacy Linode path.
  S3_FORCE_PATH_STYLE: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
  CDN_BASE: process.env.CDN_BASE || '',

  // Ollama LLM — shared AI infra
  OLLAMA_URL: process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions',
  OLLAMA_KEY: process.env.OLLAMA_KEY || '',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',

  // Brave Search — shared across tenants
  SEARCH_API_KEY: process.env.SEARCH_API_KEY,

  // Google Fonts (Web Fonts Developer API) — powers the full-catalog font picker
  GOOGLE_FONTS_API_KEY: process.env.GOOGLE_FONTS_API_KEY,

  // Google OAuth — shared for superadmin + tenant admin login
  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,
  DOMAIN: process.env.DOMAIN || 'https://slab.madladslab.com',

  // Microsoft OAuth (Azure AD / Entra ID) — platform-wide sign-in.
  // Register an app at https://portal.azure.com → App registrations. Add the
  // redirect URI `${DOMAIN}/auth/microsoft/callback` (Web platform). Client secret
  // under Certificates & secrets. MS_TENANT: 'common' = any Microsoft account
  // (work/school + personal), 'organizations' = work/school only, or a specific
  // Directory (tenant) ID to lock to one org. Tenants can override with their own
  // Azure app under /admin/settings (white glove).
  MSCID: process.env.MSCID,
  MSSEC: process.env.MSSEC,
  MS_TENANT: process.env.MS_TENANT || 'common',

  // Master encryption key for tenant secrets
  MASTER_KEY: process.env.MASTER_KEY,

  // Linode API — domain provisioning
  LINODE_API_TOKEN: process.env.LINODE_API_TOKEN,
  LINODE_DOMAIN_ID: process.env.LINODE_DOMAIN_ID,   // madladslab.com domain ID
  LINODE_IP: process.env.LINODE_IP || '104.237.138.28',

  // Slab platform Stripe (for subscription billing, not tenant payments)
  SLAB_STRIPE_SECRET: process.env.SLAB_STRIPE_SECRET,
  SLAB_STRIPE_PUBLISHABLE: process.env.SLAB_STRIPE_PUBLISHABLE,
  SLAB_STRIPE_WEBHOOK_SECRET: process.env.SLAB_STRIPE_WEBHOOK_SECRET,
  SLAB_STRIPE_PRICE_ID: process.env.SLAB_STRIPE_PRICE_ID,  // $50/mo price ID

  // Slab platform PayPal (for go-live activation payments)
  PAYPAL_CID: process.env.PAYPAL_CID,
  PAYPAL_SEC: process.env.PAYPAL_SEC,
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'live',
};
