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

  // Session & JWT — shared across all tenants (cookies are domain-scoped)
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  SESHSEC: process.env.SESHSEC || 'dev_session_secret',

  // Linode Object Storage — shared bucket, tenant files isolated by prefix
  LINODE_ENDPOINT: process.env.LINODE_URL || 'https://us-ord-1.linodeobjects.com',
  LINODE_REGION: process.env.LINODE_REGION || 'us-ord-1',
  LINODE_BUCKET: process.env.LINODE_BUCKET || 'madladslab',
  LINODE_KEY: process.env.LINODE_ACCESS,
  LINODE_SECRET: process.env.LINODE_SECRET,

  // Ollama LLM — shared AI infra
  OLLAMA_URL: process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions',
  OLLAMA_KEY: process.env.OLLAMA_KEY || '',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',

  // Brave Search — shared across tenants
  SEARCH_API_KEY: process.env.SEARCH_API_KEY,

  // Google OAuth — shared for superadmin + tenant admin login
  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,
  DOMAIN: process.env.DOMAIN || 'https://slab.madladslab.com',

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
