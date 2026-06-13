/**
 * Madlands config. Mirrors the towers (td) shape so platform SSO + AI gateway
 * line up exactly with the WEBGAMES_PROTOCOL contract.
 */
import dotenv from 'dotenv';
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3730', 10),
  domain: process.env.DOMAIN || 'madlands.madladslab.com',
  publicUrl: process.env.PUBLIC_URL || 'https://madlands.madladslab.com',

  db: {
    url: process.env.DB_URL || '',
    name: process.env.DB_NAME || 'madlands',
  },

  // Platform SSO — games.madladslab.com is the identity provider.
  platform: {
    url: (process.env.PLATFORM_URL || 'https://games.madladslab.com').replace(/\/+$/, ''),
    slug: process.env.PLATFORM_GAME_SLUG || 'madlands',
    bridgeSecret: process.env.BRIDGE_SECRET || '',
  },

  // Siege engine — where attack instances run (towers). Madlands signs an
  // InstanceDescriptor and 302s the player here; the engine returns them to
  // <publicUrl>/siege/return. See /srv/SIEGE_KIT_PROTOCOL.md.
  engine: {
    url: (process.env.SIEGE_ENGINE_URL || 'https://towers.madladslab.com').replace(/\/+$/, ''),
  },

  session: {
    secret: process.env.SESHSEC || 'dev_seshsec_change_me',
    jwtSecret: process.env.JWT_SECRET || 'dev_jwt_change_me',
  },

  // Shared GPU tunnel — the per-input builder agents will call this (LLM + SD).
  ai: {
    baseUrl: (process.env.OLLAMA_URL || 'https://ollama.madladslab.com').replace(/\/+$/, ''),
    key: process.env.OLLAMA_KEY || '',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  },
};

export function reportConfigStatus() {
  const ok = (b) => (b ? 'ok' : 'MISSING');
  console.log('[config] madlands', {
    port: config.port,
    db: ok(!!config.db.url),
    bridgeSecret: ok(!!config.platform.bridgeSecret),
    engine: config.engine.url,
    ollama: ok(!!config.ai.key),
  });
}

export default config;
