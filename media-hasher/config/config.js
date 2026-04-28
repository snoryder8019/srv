import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: parseInt(process.env.PORT, 10) || 3604,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DOMAIN: process.env.DOMAIN || 'https://mediahasher.madladslab.com',

  // MongoDB
  DB_URL: process.env.DB_URL,
  DB_NAME: process.env.DB_NAME || 'mediaHasher',

  // Sessions / JWT
  SESHSEC: process.env.SESHSEC || 'dev_session_secret',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret',

  // Google OAuth
  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,

  // PayPal (primary)
  PAYPAL_CID: process.env.PAYPAL_CID,
  PAYPAL_SEC: process.env.PAYPAL_SEC,
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox',
  paypalEnabled() { return !!(this.PAYPAL_CID && this.PAYPAL_SEC); },

  // Stripe (optional)
  STRIPE_SECRET: process.env.STRIPE_SECRET,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  stripeEnabled() { return !!(this.STRIPE_SECRET && this.STRIPE_WEBHOOK_SECRET); },

  // Linode Object Storage
  LINODE_KEY: process.env.LINODE_ACCESS,
  LINODE_SECRET: process.env.LINODE_SECRET,
  LINODE_ENDPOINT: process.env.LINODE_URL || 'https://us-ord-1.linodeobjects.com',
  LINODE_REGION: process.env.LINODE_REGION || 'us-ord-1',
  LINODE_BUCKET: process.env.LINODE_BUCKET || 'madladslab',
  LINODE_PREFIX: process.env.LINODE_PREFIX || 'mediahasher/installers',

  // Zoho mail
  ZOHO_USER: process.env.ZOHO_USER,
  ZOHO_PASS: process.env.ZOHO_PASS,
  ZOHO_FROM_NAME: process.env.ZOHO_FROM_NAME || 'MediaHasher',
  mailEnabled() { return !!(this.ZOHO_USER && this.ZOHO_PASS); },

  // Product
  PRODUCT_NAME: 'MediaHasher',
  PRODUCT_PRICE_CENTS: parseInt(process.env.PRODUCT_PRICE_CENTS, 10) || 499,
  TRIAL_DAYS: parseInt(process.env.TRIAL_DAYS, 10) || 7,
  MAX_ACTIVATIONS: parseInt(process.env.MAX_ACTIVATIONS, 10) || 2,
  LICENSE_HEARTBEAT_DAYS: parseInt(process.env.LICENSE_HEARTBEAT_DAYS, 10) || 14,
};

if (!config.DB_URL) {
  console.warn('[media-hasher] WARNING: DB_URL is not set');
}
