/**
 * config — cards platform. Mirrors the Towers (/srv/td) config shape so the
 * platform SSO consumer is identical and proven. Values come from /srv/cards/.env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.CARDS_PORT || '3600', 10),
  publicUrl: (process.env.PUBLIC_URL || 'https://cards.madladslab.com').replace(/\/+$/, ''),

  // games.madladslab.com is the identity provider (SSO bridge).
  platform: {
    url: (process.env.PLATFORM_URL || 'https://games.madladslab.com').replace(/\/+$/, ''),
    bridgeSecret: process.env.BRIDGE_SECRET || '',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'cards-dev-secret-change-me',
  },

  // Origins allowed to open sockets / be CORS-trusted by the cards platform.
  allowedOrigins: [
    'https://games.madladslab.com',
    'https://cards.madladslab.com',
    'https://madladslab.com',
    'https://www.madladslab.com',
  ],
};

export function reportConfigStatus() {
  const lines = [];
  if (!config.platform.bridgeSecret) lines.push('⚠  BRIDGE_SECRET empty — SSO will fail. Set in /srv/cards/.env');
  if (config.session.secret.includes('change-me')) lines.push('⚠  SESSION_SECRET is the dev default.');
  return lines;
}

export default config;
