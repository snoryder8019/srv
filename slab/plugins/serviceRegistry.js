/**
 * Service Registry — inventory of all /srv services for the Overseer panel.
 *
 * Static registry + live status checks via tmux session detection.
 * Source of truth: /srv/.openclaw/CONTEXT.md (mirrored here as code).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Master service list. Add new services here when they go live.
 * category: 'platform' | 'client' | 'game' | 'media' | 'tool' | 'deprecated'
 */
const SERVICES = [
  { name: 'slab',            dir: '/srv/slab',               port: 3602, domain: 'slab.madladslab.com',        tmux: 'slab',              category: 'platform',  description: 'Multi-tenant SaaS platform' },
  { name: 'madladslab',      dir: '/srv/madladslab',         port: 3000, domain: 'madladslab.com',              tmux: 'madladslab',        category: 'platform',  description: 'Core platform — accounts, OAuth, admin' },
  { name: 'w2Marketing',     dir: '/srv/w2Marketing',        port: 3601, domain: 'w2marketing.biz',             tmux: 'w2marketing',       category: 'client',    description: 'W2 Marketing — digital agency SaaS' },
  { name: 'bih',             dir: '/srv/bih',                port: 3055, domain: 'ballzinholez.com',            tmux: 'bih',               category: 'game',      description: 'BallzInHolez — gaming hub + streaming' },
  { name: 'ps',              dir: '/srv/ps',                 port: 3399, domain: 'ps.madladslab.com',           tmux: 'ps_session',        category: 'game',      description: 'Stringborn Universe — sci-fi MMO dashboard' },
  { name: 'games',           dir: '/srv/games',              port: 3500, domain: 'games.madladslab.com',        tmux: 'games',             category: 'game',      description: 'Game server portal (Rust, Valheim, etc.)' },
  { name: 'game-state',      dir: '/srv/game-state-service', port: 3500, domain: 'svc.madladslab.com',         tmux: 'game-state-service', category: 'game',     description: 'Game state microservice' },
  { name: 'servers',         dir: '/srv/servers',            port: 3600, domain: 'servers.madladslab.com',      tmux: 'servers',           category: 'tool',      description: 'Server monitoring dashboard' },
  { name: 'acm',             dir: '/srv/acm',                port: 3004, domain: 'acmcreativeconcepts.com',     tmux: 'acm_session',       category: 'client',    description: 'ACM Creative Concepts — marketing site' },
  { name: 'sna',             dir: '/srv/sna',                port: 3010, domain: 'somenewsarticle.com',         tmux: 'sna',               category: 'media',     description: 'Some News Article — news aggregation' },
  { name: 'twww',            dir: '/srv/twww',               port: 3008, domain: 'theworldwidewallet.com',      tmux: 'twww_session',      category: 'client',    description: 'The World Wide Wallet' },
  { name: 'madThree',        dir: '/srv/madThree',           port: 3007, domain: 'three.madladslab.com',        tmux: 'madThree',          category: 'tool',      description: 'MadThree — admin tool' },
  { name: 'graffiti-tv',     dir: '/srv/graffiti-tv',        port: 3001, domain: 'graffititv.madladslab.com',   tmux: 'graffiti-tv',       category: 'media',     description: 'Graffiti TV — media streaming' },
  { name: 'nocometalworkz',  dir: '/srv/nocometalworkz',     port: 3002, domain: 'nocometalworkz.com',          tmux: 'nocometalworkz',    category: 'media',     description: 'No Cometal Workz — music/media platform' },
  { name: 'greealitytv',     dir: '/srv/greealitytv',        port: 3400, domain: 'greealitytv.com',             tmux: 'greealitytv_session', category: 'media',   description: 'GreeAlity TV — local community TV' },
  { name: 'candaceWallace',  dir: '/srv/candaceWallace',     port: null, domain: null,                          tmux: 'candaceWallace_session', category: 'client', description: 'Candace Wallace — marketing strategy (dev)' },
  { name: 'opsTrain',        dir: '/srv/opsTrain',           port: 3004, domain: null,                          tmux: 'opsTrain',          category: 'tool',      description: 'QR-driven ops training & task management' },
  { name: 'piper-tts',       dir: '/srv/piper-tts',          port: null, domain: null,                          tmux: 'piper-tts',         category: 'tool',      description: 'OpenAI-compatible TTS wrapper' },
  { name: 'mcp',             dir: '/srv/mcp',                port: null, domain: null,                          tmux: 'mcp_session',       category: 'tool',      description: 'MCP server for Claude Android' },
];

const CATEGORIES = {
  platform: { label: 'Platform',  icon: '⚡', color: '#c9a848' },
  client:   { label: 'Clients',   icon: '👤', color: '#38bdf8' },
  game:     { label: 'Games',     icon: '🎮', color: '#34d399' },
  media:    { label: 'Media',     icon: '📺', color: '#a78bfa' },
  tool:     { label: 'Tools',     icon: '🔧', color: '#f97316' },
};

/**
 * Returns live tmux sessions as a Set of session names.
 */
function getActiveSessions() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' });
    return new Set(out.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Quick port check — is something listening?
 */
function isPortOpen(port) {
  if (!port) return null;
  try {
    execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the full service inventory with live status.
 */
export function getServices() {
  const sessions = getActiveSessions();
  return SERVICES.map(svc => ({
    ...svc,
    alive: svc.tmux ? sessions.has(svc.tmux) : null,
    portOpen: isPortOpen(svc.port),
    hasDir: fs.existsSync(svc.dir),
  }));
}

/**
 * Get services grouped by category.
 */
export function getServicesByCategory() {
  const services = getServices();
  const grouped = {};
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    grouped[key] = {
      ...meta,
      services: services.filter(s => s.category === key),
    };
  }
  return grouped;
}

/**
 * Get a single service by name.
 */
export function getService(name) {
  const sessions = getActiveSessions();
  const svc = SERVICES.find(s => s.name === name);
  if (!svc) return null;
  return {
    ...svc,
    alive: svc.tmux ? sessions.has(svc.tmux) : null,
    portOpen: isPortOpen(svc.port),
    hasDir: fs.existsSync(svc.dir),
  };
}

export { SERVICES, CATEGORIES };
