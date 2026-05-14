import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT || 3611,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DOMAIN: process.env.DOMAIN || 'http://localhost:3611',

  DB_URL: process.env.DB_URL,
  DB_NAME: process.env.DB_NAME || 'familyCalendar',

  SESHSEC: process.env.SESHSEC || 'dev_session_secret',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '',

  MASTER_KEY: process.env.MASTER_KEY,

  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,

  ZOHO_CID: process.env.ZOHO_CID,
  ZOHO_SEC: process.env.ZOHO_SEC,
  ZOHO_REGION: process.env.ZOHO_REGION || 'com',

  SLAB_BRIDGE_INTERNAL_KEY: process.env.SLAB_BRIDGE_INTERNAL_KEY,

  WEATHER_PROVIDER: process.env.WEATHER_PROVIDER || 'openweather',
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,

  OLLAMA_URL: process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'deepseek-r1:7b',
};
