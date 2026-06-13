/**
 * config — matchmaking service. Same SSO/bridge shape as cards + towers so the
 * platform identity flow is identical. Values from /srv/matchmaking/.env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.MATCH_PORT || '3610', 10),
  publicUrl: (process.env.PUBLIC_URL || 'https://match.madladslab.com').replace(/\/+$/, ''),

  platform: {
    url: (process.env.PLATFORM_URL || 'https://games.madladslab.com').replace(/\/+$/, ''),
    bridgeSecret: process.env.BRIDGE_SECRET || '',
  },

  // Game-hosting platforms matchmaking hands off to. Each exposes the same
  // contract (/catalog, /internal/seat, /lobby/:game). Match reads every
  // platform's catalog, tags each game with its platform key, and routes a game
  // to its own platform's public lobby + internal API. Add a platform here and
  // its games appear in matchmaking automatically.
  platforms: {
    cards: {
      internal: (process.env.CARDS_INTERNAL || 'http://127.0.0.1:3600').replace(/\/+$/, ''),
      public: (process.env.CARDS_URL || 'https://cards.madladslab.com').replace(/\/+$/, ''),
    },
    tiles: {
      internal: (process.env.TILES_INTERNAL || 'http://127.0.0.1:3625').replace(/\/+$/, ''),
      public: (process.env.TILES_URL || 'https://tiles.madladslab.com').replace(/\/+$/, ''),
    },
  },

  // back-compat: some code referenced config.cards directly.
  get cards() { return this.platforms.cards; },

  session: { secret: process.env.SESSION_SECRET || 'mm-dev-secret-change-me' },

  allowedOrigins: [
    'https://games.madladslab.com',
    'https://match.madladslab.com',
    'https://cards.madladslab.com',
    'https://tiles.madladslab.com',
    'https://madladslab.com',
    'https://www.madladslab.com',
  ],
};

export function reportConfigStatus() {
  const lines = [];
  if (!config.platform.bridgeSecret) lines.push('⚠  BRIDGE_SECRET empty — SSO + ticket signing will fail.');
  if (config.session.secret.includes('change-me')) lines.push('⚠  SESSION_SECRET is the dev default.');
  return lines;
}

export default config;
