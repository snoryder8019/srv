/**
 * siege-kit/descriptor.js
 * -----------------------
 * The InstanceDescriptor: the single payload a WORLD (madlands) hands to an
 * ENGINE (towers) to open an instance, plus the contract for the exit back to
 * the world. Pure + browser-safe (no node builtins, no deps).
 *
 * Two orthogonal dimensions describe an instance:
 *   - MODE  : what the player DOES        -> siege | defend | explore
 *   - KIND  : what it LOOKS like (theme)  -> dungeon | building | ground | space
 *
 * MODE drives mechanics/placement + the OBJECTIVE; KIND drives skins + scenery.
 *
 * The descriptor answers:
 *   - WHAT action is this?                -> mode
 *   - WHAT is the goal?                   -> objective {type,text,goal}
 *   - WHAT does it look like?             -> kind, biome
 *   - WHERE in the world did it open?     -> origin (world/path/hexKey/tier)
 *   - WHAT board + pacing should run?     -> board, pacing
 *   - WHERE does the player go on exit?   -> ret.url
 *
 * Signing/verification lives in token.js (server-only).
 */

export const PROTOCOL_VERSION = 1;

// The four themes. Mechanics are identical across them; only skins/scenery change.
export const SIEGE_KINDS = ['dungeon', 'building', 'ground', 'space'];

// What the player is doing in the instance.
//   siege   : player is the ATTACKER — places on the OUTER ring, pushes INWARD
//             toward a central objective (the inverse of classic TD).
//   defend  : player is the DEFENDER — MIDDLE-OUT: protect the center while
//             enemies arrive from the edges (classic towers play).
//   explore : free-roam a zone (collect/traverse) — no placement combat.
export const SIEGE_MODES = ['siege', 'defend', 'explore'];

export const DEFAULT_WORLD = 'madlands';

/**
 * The OBJECTIVE — the instance's win condition, surfaced in the launch intro and
 * checked by the engine. One per mode (kind can flavour the text later).
 *   siege   -> breach: reach/seize the center within the wave budget
 *   defend  -> hold:   keep the center alive for N waves
 *   explore -> recover: collect the relics in the zone
 */
export function defaultObjective(mode, kind = 'ground') {
  switch (mode) {
    case 'siege':
      return { type: 'breach', goal: 'center', text: 'Breach the core — push your line inward and seize the center.' };
    case 'defend':
      return { type: 'hold', goal: 'center', waves: 5, text: 'Hold the core — survive the assault from the edges.' };
    case 'explore':
      return { type: 'recover', goal: 'relics', count: 8, text: 'Recover the relics scattered through the zone.' };
    default:
      return { type: 'hold', goal: 'center', text: 'Hold the core.' };
  }
}

/**
 * Placement semantics for a mode. The engine reads this to decide who spawns
 * where and where the player may place defenders/attackers.
 */
export function placementFor(mode) {
  switch (mode) {
    case 'siege':   // attacking IN
      return { playerPlaces: 'outer', advanceToward: 'center', enemyHolds: 'center', combat: true };
    case 'defend':  // middle-OUT
      return { playerPlaces: 'inner', protect: 'center', enemyArrivesFrom: 'edges', combat: true };
    case 'explore':
      return { playerPlaces: 'none', combat: false };
    default:
      return { playerPlaces: 'inner', protect: 'center', enemyArrivesFrom: 'edges', combat: true };
  }
}

/**
 * Map a madlands scale/interior selection onto a siege KIND (theme).
 *   interior+dungeon -> dungeon · interior+building -> building
 *   interior+ship    -> space   · zone -> ground · default -> ground
 */
export function kindFromMadlands(tier, interiorKind) {
  if (tier === 'interior') {
    if (interiorKind === 'dungeon') return 'dungeon';
    if (interiorKind === 'building') return 'building';
    if (interiorKind === 'ship') return 'space';
  }
  if (tier === 'space') return 'space';
  return 'ground';
}

/**
 * Build a descriptor. Throws on missing required fields so a bad launch fails
 * loudly in the world app rather than silently in the engine.
 *
 * @param {object} o
 * @param {string} o.mode          one of SIEGE_MODES (default 'siege')
 * @param {string} o.kind          one of SIEGE_KINDS
 * @param {string} o.biome         art/palette key (drives skins + scenery)
 * @param {string} o.path          madlands hex path, e.g. "3,-1/0,2"
 * @param {string} o.returnUrl     absolute URL back into the world at this path
 * @param {object} [o.objective]   override the default objective for the mode
 * @param {string} [o.hexKey]      the specific hex the instance opened on
 * @param {string} [o.tier]        madlands tier (interior|zone|body|space)
 * @param {string} [o.world]       defaults to 'madlands'
 * @param {string} [o.mapId]       explicit engine map id (else engine picks by kind/biome)
 * @param {number} [o.seed]        deterministic board-generation seed
 * @param {number} [o.radius]      board radius override
 * @param {number} [o.pacing]      wave-speed multiplier (1 = normal, <1 slower)
 * @param {string} [o.location]    inventory bucket key to deploy from (default: the path)
 * @param {string} [o.platformId]  platform identity, for engine-side wallet/score
 */
export function buildDescriptor(o = {}) {
  const kind = String(o.kind || '').toLowerCase();
  if (!SIEGE_KINDS.includes(kind)) {
    throw new Error(`siege: unknown kind "${o.kind}" (expected ${SIEGE_KINDS.join('|')})`);
  }
  const mode = String(o.mode || 'siege').toLowerCase();
  if (!SIEGE_MODES.includes(mode)) {
    throw new Error(`siege: unknown mode "${o.mode}" (expected ${SIEGE_MODES.join('|')})`);
  }
  if (!o.path) throw new Error('siege: descriptor requires a world path');
  if (!o.returnUrl) throw new Error('siege: descriptor requires a returnUrl');

  const path = String(o.path);
  return {
    v: PROTOCOL_VERSION,
    mode,
    kind,
    biome: o.biome ? String(o.biome) : kind,
    objective: o.objective || defaultObjective(mode, kind),
    origin: {
      world: o.world || DEFAULT_WORLD,
      path,
      hexKey: o.hexKey || lastSegment(path),
      tier: o.tier || 'interior',
    },
    board: {
      mapId: o.mapId || null,
      seed: Number.isFinite(o.seed) ? o.seed : hashSeed(path),
      radius: Number.isFinite(o.radius) ? o.radius : null,
    },
    loadout: {
      location: o.location || path,   // locational inventory: deploy from here
    },
    ret: { url: String(o.returnUrl) },
    pacing: clampPacing(o.pacing),
    platformId: o.platformId ? String(o.platformId) : null,
    iat: Date.now(),
  };
}

/** Validate a (parsed) descriptor object. Returns { ok, errors:[] }. */
export function validateDescriptor(d) {
  const errors = [];
  if (!d || typeof d !== 'object') return { ok: false, errors: ['not an object'] };
  if (d.v !== PROTOCOL_VERSION) errors.push(`version ${d.v} != ${PROTOCOL_VERSION}`);
  if (!SIEGE_KINDS.includes(d.kind)) errors.push(`bad kind "${d.kind}"`);
  if (!SIEGE_MODES.includes(d.mode)) errors.push(`bad mode "${d.mode}"`);
  if (!d.origin || !d.origin.path) errors.push('missing origin.path');
  if (!d.ret || !d.ret.url) errors.push('missing ret.url');
  return { ok: errors.length === 0, errors };
}

// ---- URL helpers (the browser-visible launch carries only the opaque token) ----

/**
 * The world builds this URL to send the player into the engine. The descriptor
 * travels as an opaque, signed token (token.js) — never readable params, so a
 * player can't forge a richer loadout or an easier board.
 *   -> "<engineOrigin>/play?siege=<token>"
 */
export function launchUrl(engineOrigin, token) {
  const base = String(engineOrigin).replace(/\/+$/, '');
  return `${base}/play?siege=${encodeURIComponent(token)}`;
}

/**
 * The engine builds this URL to send the player home when the instance ends.
 * Carries the outcome so the world can react (apply salvage, credit coins,
 * advance the map, drop a recoverable cache) without trusting the client.
 *   result = { status:'won'|'lost'|'abandoned', score, wave, coins, durationMs }
 */
export function returnUrl(descriptor, result = {}) {
  const u = new URL(descriptor.ret.url);
  u.searchParams.set('siegeResult', result.status || 'abandoned');
  if (result.score != null) u.searchParams.set('score', String(result.score));
  if (result.wave != null) u.searchParams.set('wave', String(result.wave));
  if (result.coins != null) u.searchParams.set('coins', String(result.coins));
  u.searchParams.set('path', descriptor.origin.path);
  return u.toString();
}

// ---- small pure helpers ----

function lastSegment(path) {
  const segs = String(path).split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}

// Deterministic non-crypto seed from a path string (FNV-1a 32-bit).
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function clampPacing(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.25, Math.min(2, n));
}
