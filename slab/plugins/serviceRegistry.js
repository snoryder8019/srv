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
  // ── Platform / core infra ──
  { name: 'slab',            dir: '/srv/slab',               port: 3602, domain: 'slab.madladslab.com',        tmux: 'slab',                       category: 'platform',  description: 'Multi-tenant SaaS platform' },
  { name: 'mllOauth',        dir: '/srv/mllOauth',           port: 3651, domain: 'mcp.madladslab.com',          tmux: 'mllOauth',                   category: 'platform',  description: 'mllOauth — OAuth 2.1 / JWT issuer for MCP' },

  // ── Games ──
  { name: 'games',           dir: '/srv/games',              port: 3500, domain: 'games.madladslab.com',        tmux: 'games',                      category: 'game',      description: 'Game server portal (Rust, Valheim, etc.)' },
  { name: 'game-state',      dir: '/srv/game-state-service', port: 3502, domain: 'svc.madladslab.com',          tmux: 'game-state-service_session', category: 'game',      description: 'Game state microservice' },
  { name: 'discord-games',   dir: '/srv/games',              port: null, domain: null,                          tmux: 'discord-games',              category: 'game',      description: 'Discord bot for Games' },
  { name: 'tiles',           dir: '/srv/tiles',              port: 3625, domain: 'tiles.madladslab.com',        tmux: 'tiles_session',              category: 'game',      description: '3D arcade table games (supersedes cards)' },
  { name: 'cards',           dir: '/srv/cards',              port: 3600, domain: 'cards.madladslab.com',        tmux: 'cards_session',              category: 'game',      description: 'Legacy card games portal' },
  { name: 'matchmaking',     dir: '/srv/matchmaking',        port: 3610, domain: 'match.madladslab.com',        tmux: 'matchmaking_session',        category: 'game',      description: 'Match — cross-game live dashboard / matchmaking' },
  { name: 'madlands',        dir: '/srv/madlands',           port: 3730, domain: 'madlands.madladslab.com',      tmux: 'madlands',                   category: 'game',      description: 'Madlands world' },
  { name: 'ps',              dir: '/srv/ps',                 port: 3399, domain: 'ps.madladslab.com',           tmux: 'ps_session',                 category: 'game',      description: 'Stringborn Universe — sci-fi MMO dashboard' },
  { name: 'triple-twenty',   dir: '/srv/triple-twenty',      port: 3710, domain: 'tripletwenty.madladslab.com', tmux: 'triple-twenty_session',      category: 'game',      description: 'AI darts scoring with camera' },

  // ── Media ──
  { name: 'graffiti-tv',     dir: '/srv/graffiti-tv',        port: 3001, domain: 'graffititv.madladslab.com',   tmux: 'graffiti-tv_session',        category: 'media',     description: 'Graffiti TV — media streaming' },
  { name: 'greealitytv',     dir: '/srv/greealitytv',        port: 3400, domain: 'greealitytv.com',             tmux: 'greealitytv_session',        category: 'media',     description: 'GreeAlity TV — local community TV' },

  // ── Tools ──
  { name: 'mllPitches',      dir: '/srv/mllPitches',         port: 3608, domain: 'pitch.madladslab.com',        tmux: 'mllPitches_session',         category: 'tool',      description: 'Client pitch platform' },
  { name: 'coDevs',          dir: '/srv/coDevs',             port: 3620, domain: 'preview.madladslab.com',       tmux: 'coDevs_session',             category: 'tool',      description: 'coDevs — preview / tenant build host' },
  { name: 'servers',         dir: '/srv/servers',            port: 3600, domain: 'servers.madladslab.com',      tmux: 'servers',                    category: 'tool',      description: 'Server monitoring dashboard' },
  { name: 'opsTrain',        dir: '/srv/opsTrain',           port: 3603, domain: 'ops-train.madladslab.com',    tmux: 'opsTrain_session',           category: 'tool',      description: 'QR-driven ops training & task management' },
  { name: 'piper-tts',       dir: '/srv/piper-tts',          port: null, domain: null,                          tmux: 'piper-tts_session',          category: 'tool',      description: 'OpenAI-compatible TTS wrapper' },
  { name: 'mcp',             dir: '/srv/mcp',                port: null, domain: null,                          tmux: 'mcp_session',                category: 'tool',      description: 'MCP server for Claude Android' },
  { name: 'mcp-streamable',  dir: '/srv/mcp',                port: 3650, domain: 'mcp.madladslab.com',          tmux: 'mcp-streamable',             category: 'tool',      description: 'Streamable MCP server variant' },
];

// External infrastructure — not tmux-based, pinged remotely. Live status comes from /api/ops/infra.
const INFRA_SERVICES = [
  { name: 'ollama',      port: null, domain: 'ollama.madladslab.com', tmux: null, category: 'infra', description: 'Ollama LLM cluster (DeepSeek-R1)', kind: 'ollama-llm' },
  { name: 'ollama-sd',   port: null, domain: 'ollama.madladslab.com', tmux: null, category: 'infra', description: 'Stable Diffusion (SD v1.5)',       kind: 'ollama-sd' },
  { name: 'mongo',       port: null, domain: null,                    tmux: null, category: 'infra', description: 'MongoDB cluster (registry + tenant DBs)', kind: 'mongo' },
  { name: 'bucket',      port: null, domain: 'madladslab.us-ord-1.linodeobjects.com', tmux: null, category: 'infra', description: 'Linode Object Storage (madladslab)', kind: 'bucket' },
];

const CATEGORIES = {
  platform: { label: 'Platform',  icon: '⚡', color: '#c9a848' },
  client:   { label: 'Clients',   icon: '👤', color: '#38bdf8' },
  game:     { label: 'Games',     icon: '🎮', color: '#34d399' },
  media:    { label: 'Media',     icon: '📺', color: '#a78bfa' },
  tool:     { label: 'Tools',     icon: '🔧', color: '#f97316' },
  infra:    { label: 'Infra',     icon: '☁️', color: '#22d3ee' },
};

/**
 * MadLadsLab product registry — top-level products that have their own user bases.
 * Used by superadmin to query users across all products from one panel.
 *
 * Hierarchy:  MadLadsLab (parent)
 *             ├── Slab (white-label SaaS — has its own tenants, each with users)
 *             ├── OpsTrain (standalone SaaS — has its own tenants/users)
 *             ├── Games/BIH (standalone app — direct users)
 *             └── MadLadsLab (parent site — direct users)
 *
 * 'slab' is special: its users live in per-tenant DBs (slab_<slug>).
 * Other products store users directly in their main DB.
 */
const PRODUCTS = {
  slab: {
    label: 'Slab',
    icon: '&#9830;',
    color: '#c9a848',
    bg: '#1a1510',
    border: '#362a10',
    type: 'multi-tenant',    // users spread across tenant DBs
    usersCollection: 'users',
  },
  opstrain: {
    label: 'OpsTrain',
    icon: '&#9881;',
    color: '#a78bfa',
    bg: '#1a0f2e',
    border: '#3b1e6f',
    type: 'standalone',
    db: 'opsTrain',
    usersCollection: 'users',
  },
  games: {
    label: 'Games',
    icon: '&#127918;',
    color: '#34d399',
    bg: '#0f2e1a',
    border: '#14532d',
    type: 'standalone',
    db: 'test',
    usersCollection: 'users',
  },
  stringborn: {
    label: 'Stringborn',
    icon: '&#128640;',
    color: '#f97316',
    bg: '#1a0f05',
    border: '#431407',
    type: 'standalone',
    db: 'projectStringborne',
    usersCollection: 'users',
  },
  madladslab: {
    label: 'MadLadsLab',
    icon: '&#9733;',
    color: '#38bdf8',
    bg: '#0f1a2e',
    border: '#1e3a5f',
    type: 'standalone',
    db: 'madLadsLab',
    usersCollection: 'users',
  },
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

/**
 * External infra entries (ollama, sd, bucket, mongo). Live status is filled in by
 * /api/ops/infra; this just returns the static definitions so the harmony 3D scene
 * can render them as nodes even before the first ping completes.
 */
export function getInfraServices() {
  return INFRA_SERVICES.map(svc => ({ ...svc, alive: null, portOpen: null, hasDir: null }));
}

export { SERVICES, INFRA_SERVICES, CATEGORIES, PRODUCTS };
