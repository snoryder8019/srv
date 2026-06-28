/**
 * config — tiles platform. Mirrors the cards platform config shape so the SSO
 * consumer, ticket handoff, and stats export are identical and proven. Values
 * come from /srv/tiles/.env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.TILES_PORT || '3625', 10),
  publicUrl: (process.env.PUBLIC_URL || 'https://tiles.madladslab.com').replace(/\/+$/, ''),

  // games.madladslab.com is the identity provider (SSO bridge).
  platform: {
    url: (process.env.PLATFORM_URL || 'https://games.madladslab.com').replace(/\/+$/, ''),
    bridgeSecret: process.env.BRIDGE_SECRET || '',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'tiles-dev-secret-change-me',
  },

  // madLadsLab shared GPU tunnel (ollama.madladslab.com) — OpenAI-compatible.
  //   POST /v1/chat/completions   (qwen2.5:7b)  -> text
  //   POST /v1/images/generations (SD v1.5)     -> scene backgrounds / art
  // tiles keeps its OWN key entry; mirrors td's services/ai client exactly.
  ai: {
    baseUrl: (process.env.OLLAMA_URL || 'https://ollama.madladslab.com').replace(/\/+$/, ''),
    key: process.env.OLLAMA_KEY || '',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  },

  allowedOrigins: [
    'https://games.madladslab.com',
    'https://tiles.madladslab.com',
    'https://reels.madladslab.com',   // reels reads the live tables/board cross-origin
    'https://match.madladslab.com',
    'https://madladslab.com',
    'https://www.madladslab.com',
  ],
};

export function reportConfigStatus() {
  const lines = [];
  if (!config.platform.bridgeSecret) lines.push('⚠  BRIDGE_SECRET empty — SSO will fail. Set in /srv/tiles/.env');
  if (config.session.secret.includes('change-me')) lines.push('⚠  SESSION_SECRET is the dev default.');
  if (!config.ai.key) lines.push('⚠  OLLAMA_KEY empty — SD scene backgrounds disabled. Set in /srv/tiles/.env');
  return lines;
}

export default config;
