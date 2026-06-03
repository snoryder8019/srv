/**
 * Live cross-game dashboard aggregator.
 *
 * Match is the only service that sees every game-hosting platform, so it is the
 * natural place to assemble a live, cross-game view of "what rooms / tables are
 * open right now." This module polls each platform's bridge-authed
 * `GET /internal/tables`, folds in the portal's online-player count, normalizes
 * everything into one snapshot, and (when it changes) broadcasts a delta to all
 * sockets in the `dashboard` room. The internal calls carry the bridge secret;
 * only screen-name-safe data ever reaches a client.
 */
import config from '../config/index.js';

const POLL_MS = 2500;

let io = null;
let timer = null;
let nameFor = (id) => id;           // game id -> display name (set from catalog)
let lastHash = '';
let state = emptyState();

function emptyState() {
  return {
    at: 0,
    online: 0,
    platforms: {},                  // { tiles: 'up'|'down', cards: 'up'|'down' }
    totals: { tables: 0, humans: 0, openSeats: 0, games: 0 },
    byGame: [],                     // [{ game, name, casino, tables, humans, openSeats }]
    tables: [],                     // flat, normalized, platform-tagged
    portalUrl: config.platform.url,
    matchUrl: config.publicUrl,
  };
}

// Inject a game-id -> name resolver (match already caches the merged catalog).
export function setNameResolver(fn) { if (typeof fn === 'function') nameFor = fn; }

async function platformTables(key) {
  const plat = config.platforms[key];
  const r = await fetch(`${plat.internal}/internal/tables`, {
    headers: { 'x-bridge-secret': config.platform.bridgeSecret },
    signal: AbortSignal.timeout(3500),
  });
  if (!r.ok) throw new Error('status ' + r.status);
  const j = await r.json();
  return (j.tables || []).map((t) => ({ ...t, platform: key }));
}

async function onlineCount() {
  try {
    const r = await fetch(`${config.platform.url}/internal/online-users`, {
      headers: { 'x-bridge-secret': config.platform.bridgeSecret },
      signal: AbortSignal.timeout(3000),
    });
    const j = await r.json();
    return Array.isArray(j.users) ? j.users.length : 0;
  } catch (e) { return 0; }
}

export async function poll() {
  const platforms = {};
  let tables = [];
  for (const key of Object.keys(config.platforms)) {
    try { tables = tables.concat(await platformTables(key)); platforms[key] = 'up'; }
    catch (e) { platforms[key] = 'down'; }
  }
  const online = await onlineCount();

  // group by game
  const byGameMap = {};
  let humans = 0, openSeats = 0;
  for (const t of tables) {
    humans += t.humans || 0;
    openSeats += t.openSeats || 0;
    const g = byGameMap[t.game] || (byGameMap[t.game] = {
      game: t.game, name: nameFor(t.game), casino: !!t.casino,
      tables: 0, humans: 0, openSeats: 0,
    });
    g.tables += 1; g.humans += t.humans || 0; g.openSeats += t.openSeats || 0;
  }
  const byGame = Object.values(byGameMap)
    .sort((a, b) => (b.humans - a.humans) || a.name.localeCompare(b.name));

  state = {
    at: Date.now(),
    online,
    platforms,
    totals: { tables: tables.length, humans, openSeats, games: byGame.length },
    byGame,
    tables,
    portalUrl: config.platform.url,
    matchUrl: config.publicUrl,
  };

  // Only push when something a client cares about actually changed (ignore `at`).
  const hash = JSON.stringify({ online, platforms, tables });
  if (hash !== lastHash) {
    lastHash = hash;
    if (io) io.to('dashboard').emit('dash:update', state);
  }
  return state;
}

export function getState() { return state; }

export function startDashboard(ioServer) {
  io = ioServer;
  const loop = () => { poll().catch(() => {}).finally(() => { timer = setTimeout(loop, POLL_MS); }); };
  loop();
}

export function stopDashboard() { if (timer) clearTimeout(timer); timer = null; }
