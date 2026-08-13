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

  // WebRTC TURN relay for meetings. STUN alone can't hole-punch through the
  // symmetric NAT/CGNAT most mobile carriers use, so without a TURN relay a
  // share of 5G participants never connect at all. Unset ⇒ STUN only.
  //
  // Comma-separated so you can offer both plain and TLS transports, e.g.
  //   turn:turn.madladslab.com:3478,turns:turn.madladslab.com:5349
  // (turns:5349 rides 443-style TLS and is what gets through locked-down
  // mobile/corporate networks that block raw UDP.)
  TURN_URL: process.env.TURN_URL || '',
  // Preferred: ephemeral credentials. Share this ONE secret with coturn
  // (`use-auth-secret` / `static-auth-secret`); the app mints a short-lived
  // HMAC username:credential per page-load, so nothing reusable is exposed in
  // page source. Set TURN_SECRET and leave USERNAME/CREDENTIAL blank.
  TURN_SECRET: process.env.TURN_SECRET || '',
  TURN_TTL: parseInt(process.env.TURN_TTL || '', 10) || 43200, // cred lifetime (s); 12h covers long meetings + late ICE restarts
  // Fallback: a static long-lived credential (managed providers, or coturn
  // with lt-cred-mech). Only used when TURN_SECRET is unset.
  TURN_USERNAME: process.env.TURN_USERNAME || '',
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || '',

  // Ollama LLM — shared "house" AI infra (the default engine)
  OLLAMA_URL: process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions',
  OLLAMA_KEY: process.env.OLLAMA_KEY || '',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',

  // Anthropic (Claude) — BYO engine seam. Tenants bring their own key via the
  // custom-key vault (/admin/settings/keys → name "anthropic_api_key"); when a
  // tenant has one, their MCP/dash agents run on Claude instead of the house
  // model. ANTHROPIC_API_KEY here is the OPTIONAL platform-level fallback used by
  // unscoped/superadmin paths (e.g. tickets). Unset ⇒ those paths stay on house.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  // The multi-tool agentic loop's ORCHESTRATOR model (the coordinator turn that
  // decides which tools to call). Defaults to Sonnet — smart enough to
  // orchestrate, far cheaper than Opus — so Opus doesn't run on every agentic
  // turn. Overridable per tenant via the 'coordinator' agent in Agent Control.
  ANTHROPIC_COORDINATOR_MODEL: process.env.ANTHROPIC_COORDINATOR_MODEL || 'claude-sonnet-5',

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

  // Facebook Login — platform-wide sign-in. App at developers.facebook.com →
  // Use cases → Authentication and account creation, with `email` added (standard
  // tier, no App Review) and the redirect URI below listed under Valid OAuth
  // Redirect URIs. `email` is required: dispatchAuth keys users by email, so a
  // profile without one cannot be matched to an account.
  FB_AUTH_APPID: process.env.FB_AUTH_APPID,
  FB_AUTH_APPSEC: process.env.FB_AUTH_APPSEC,
  FB_AUTH_REDIRECT: process.env.FB_AUTH_REDIRECT,
  FB_AUTH_SCOPE: process.env.FB_AUTH_SCOPE || 'email,public_profile',

  // Master encryption key for tenant secrets
  MASTER_KEY: process.env.MASTER_KEY,

  // Linode API — domain provisioning
  LINODE_API_TOKEN: process.env.LINODE_API_TOKEN,
  LINODE_DOMAIN_ID: process.env.LINODE_DOMAIN_ID,   // madladslab.com domain ID
  LINODE_IP: process.env.LINODE_IP || '104.237.138.28',

  // Slab platform Stripe (MadLadsLab account — go-live card payments).
  // Falls back to STRIPE_SEC/STRIPE_PUB, the names the platform keys already use in .env.
  SLAB_STRIPE_SECRET: process.env.SLAB_STRIPE_SECRET || process.env.STRIPE_SEC,
  SLAB_STRIPE_PUBLISHABLE: process.env.SLAB_STRIPE_PUBLISHABLE || process.env.STRIPE_PUB,
  SLAB_STRIPE_WEBHOOK_SECRET: process.env.SLAB_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WHSEC,
  SLAB_STRIPE_PRICE_ID: process.env.SLAB_STRIPE_PRICE_ID,  // optional — go-live uses ad-hoc price_data, not a fixed price ID

  // Slab platform PayPal (for go-live activation payments)
  PAYPAL_CID: process.env.PAYPAL_CID,
  PAYPAL_SEC: process.env.PAYPAL_SEC,
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'live',
};
