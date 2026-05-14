/**
 * Central configuration for Towers (TD)
 *
 * td is an INDEPENDENT app - it does not share env, credentials, or DB
 * with any other service on this VM. Every value comes from /srv/td/.env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3700', 10),
  domain: process.env.DOMAIN || 'towers.madladslab.com',
  publicUrl: process.env.PUBLIC_URL || 'https://towers.madladslab.com',

  paths: {
    root: ROOT,
    public: path.join(ROOT, 'public'),
    views: path.join(ROOT, 'views'),
    assets: path.join(ROOT, 'public', 'assets'),
    gltf: path.join(ROOT, 'public', 'assets', 'gltf'),
    uploads: path.join(ROOT, 'public', 'assets', 'gltf', 'uploads'),
  },

  db: {
    url: process.env.DB_URL || '',
    name: process.env.DB_NAME || 'td',
  },

  oauth: {
    google: {
      clientId: process.env.GGLCID || '',
      clientSecret: process.env.GGLSEC || '',
      callbackPath: '/auth/google/callback',
      callbackUrl: (process.env.PUBLIC_URL || 'https://towers.madladslab.com') + '/auth/google/callback',
    },
  },

  session: {
    secret: process.env.SESHSEC || 'dev_seshsec_change_me',
    jwtSecret: process.env.JWT_SECRET || 'dev_jwt_change_me',
  },

  upload: {
    maxSizeMb: parseInt(process.env.ASSET_MAX_SIZE_MB || '25', 10),
    allowedExt: ['.gltf', '.glb'],
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

/**
 * Boot-time sanity warnings - log loudly but don't crash.
 */
export function reportConfigStatus() {
  const lines = [];
  if (!config.db.url) lines.push('⚠  DB_URL is empty - set it in /srv/td/.env');
  if (!config.oauth.google.clientId) lines.push('⚠  GGLCID missing - OAuth disabled');
  if (!config.oauth.google.clientSecret) lines.push('⚠  GGLSEC missing - OAuth disabled');
  if (config.session.secret === 'dev_seshsec_change_me') lines.push('⚠  SESHSEC is the default - rotate before prod');
  if (lines.length) {
    console.log('[config]');
    for (const l of lines) console.log('  ' + l);
  } else {
    console.log('[config] all required values present');
  }
}

export default config;
