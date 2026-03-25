import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT || 3601,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DOMAIN: process.env.DOMAIN || 'http://localhost:3601',
  DB_URL: process.env.DB_URL,
  DB_NAME: process.env.DB_NAME || 'madLadsLab',
  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  SESHSEC: process.env.SESHSEC || 'dev_session_secret',
  LINODE_ENDPOINT: process.env.LINODE_URL || 'https://us-ord-1.linodeobjects.com',
  LINODE_REGION: process.env.LINODE_REGION || 'us-ord-1',
  LINODE_BUCKET: process.env.LINODE_BUCKET || 'madladslab',
  LINODE_KEY: process.env.LINODE_ACCESS,  // env var is LINODE_ACCESS
  LINODE_SECRET: process.env.LINODE_SECRET,
  GOOGLE_PLACES_KEY: process.env.GOOGLE_PLACES_KEY || process.env.GGLAPI,
  GOOGLE_PLACE_ID: process.env.GOOGLE_PLACE_ID,
  SEARCH_API_KEY: process.env.SEARCH_API_KEY,
  ZOHO_USER: process.env.ZOHO_USER,
  ZOHO_PASS: process.env.ZOHO_PASS,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_SEC,
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox',
};
