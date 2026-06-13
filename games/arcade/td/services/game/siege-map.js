/**
 * Procedural map generator for the "Siege" mode: a large hex board with the
 * defense (base) at the CENTER and multiple spawn points around the rim, each
 * with its own path inward. Pure data — produces a Map-shaped object the engine
 * and renderer already understand (spawnHexes/baseHexes/pathHexes/blockedHexes +
 * waves), plus the new obstacles/objectives the upgraded schema carries.
 *
 * Used as a fallback/default so the new mode plays without hand-built maps, and
 * as the seed the admin builder can start from.
 */
import { generateHexBoard, hexKey, hexNeighbors, hexDistance } from './hex-grid.js';

// Ring of hexes at exactly `radius` from origin, in axial coords.
// Standard redblobgames ring walk: start at a corner, march each of the 6 sides.
function ringAt(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const dirs = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];
  const out = [];
  // start `radius` steps in direction 4 (southwest) from center — a corner
  let cur = { q: dirs[4].q * radius, r: dirs[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < radius; i++) {
      out.push({ q: cur.q, r: cur.r });
      cur = { q: cur.q + dirs[side].q, r: cur.r + dirs[side].r };
    }
  }
  return out;
}

// Straight-ish path from an outer hex to the center, hugging a line (greedy toward 0,0).
function lineToCenter(from) {
  const path = [];
  let cur = { q: from.q, r: from.r };
  let guard = 0;
  while ((cur.q !== 0 || cur.r !== 0) && guard++ < 200) {
    path.push({ q: cur.q, r: cur.r });
    // step to the neighbor that reduces hex distance to center the most
    let best = null, bestD = Infinity;
    for (const n of hexNeighbors(cur)) {
      const d = hexDistance(n, { q: 0, r: 0 });
      if (d < bestD) { bestD = d; best = n; }
    }
    cur = best;
  }
  path.push({ q: 0, r: 0 });
  return path;
}

/**
 * Build a Siege-mode map object.
 * @param {object} opts
 *   radius      board radius (default 10 — much bigger than the old 6)
 *   spawnCount  number of rim spawn points (default 6, spread around the ring)
 *   baseRadius  size of the central base cluster (0 = single hex, 1 = 7 hexes)
 *   waveCount   how many waves to generate
 *   obstacles   how many random blocked clusters to scatter (cover/maze)
 */
export function generateSiegeMap(opts = {}) {
  const radius = opts.radius ?? 14;
  const spawnCount = Math.max(1, opts.spawnCount ?? 6);
  const baseRadius = opts.baseRadius ?? 1;
  const waveCount = opts.waveCount ?? 12;
  const obstacleCount = opts.obstacles ?? 8;

  const all = generateHexBoard(radius);
  const allKeys = new Set(all.map(h => hexKey(h.q, h.r)));

  // --- central base cluster ---
  const baseHexes = [];
  for (const h of all) if (hexDistance(h, { q: 0, r: 0 }) <= baseRadius) baseHexes.push({ q: h.q, r: h.r });

  // --- spawn points evenly spaced around the rim ---
  const rim = ringAt(radius);
  const spawnHexes = [];
  for (let i = 0; i < spawnCount; i++) {
    const idx = Math.round((i / spawnCount) * rim.length) % rim.length;
    spawnHexes.push({ q: rim[idx].q, r: rim[idx].r });
  }

  // --- a path inward from each spawn (union of lines to center) ---
  const pathSet = new Set();
  const pathHexes = [];
  for (const sp of spawnHexes) {
    for (const p of lineToCenter(sp)) {
      const k = hexKey(p.q, p.r);
      // don't mark the base cluster or the spawn itself as 'path'
      if (baseHexes.some(b => b.q === p.q && b.r === p.r)) continue;
      if (sp.q === p.q && sp.r === p.r) continue;
      if (!pathSet.has(k)) { pathSet.add(k); pathHexes.push({ q: p.q, r: p.r }); }
    }
  }

  // --- scatter obstacle clusters on open ground (not path/base/spawn) ---
  const taken = new Set([
    ...baseHexes.map(h => hexKey(h.q, h.r)),
    ...spawnHexes.map(h => hexKey(h.q, h.r)),
    ...pathHexes.map(h => hexKey(h.q, h.r)),
  ]);
  const blockedHexes = [];
  const openPool = all.filter(h => !taken.has(hexKey(h.q, h.r)) && hexDistance(h, { q: 0, r: 0 }) > baseRadius + 1 && hexDistance(h, { q: 0, r: 0 }) < radius);
  for (let i = 0; i < obstacleCount && openPool.length; i++) {
    const pick = openPool[Math.floor(Math.random() * openPool.length)];
    const k = hexKey(pick.q, pick.r);
    if (taken.has(k)) continue;
    taken.add(k); blockedHexes.push({ q: pick.q, r: pick.r });
  }

  // --- LONGER WAVES: sustained pressure. Counts scale up but spawn delays stay
  //     moderate (they do NOT collapse toward instant), so each wave takes a real
  //     stretch to fully arrive. Groups stagger via startDelayMs so a wave layers
  //     grunts -> runners -> heavies instead of dumping everything at once. ---
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const tier = Math.floor(w / 3);
    const enemies = [];
    // main grunt column — big, steady stream (delay floor 420ms keeps it long)
    enemies.push({ type: 'grunt', count: 14 + w * 6, delayMs: Math.max(420, 720 - w * 14), startDelayMs: 0 });
    // runners join after a beat from wave 2
    if (w >= 2) enemies.push({ type: 'runner', count: 6 + w * 3, delayMs: Math.max(380, 560 - w * 12), startDelayMs: 2500 });
    // heavy machines grind in mid/late, slow cadence
    if (w >= 4) enemies.push({ type: 'machine', count: 2 + tier * 2, delayMs: 1400, startDelayMs: 4000 });
    // periodic flyer flights
    if (w >= 6 && w % 2 === 0) enemies.push({ type: 'flyer', count: 4 + tier * 2, delayMs: 700, startDelayMs: 6000 });
    // a late grunt "tail" so the wave doesn't end abruptly
    enemies.push({ type: 'grunt', count: 8 + w * 3, delayMs: Math.max(500, 800 - w * 10), startDelayMs: 8000 });
    waves.push({ enemies, intermissionMs: 7000 });
  }

  return {
    name: opts.name || 'Siege of the Core',
    slug: opts.slug || 'siege-core',
    description: 'Defend the core at the center. Enemies pour in from every direction.',
    mode: 'siege',
    radius,
    spawnHexes,
    baseHexes,
    pathHexes,
    blockedHexes,
    obstacles: [],     // decorative/cover obstacles (schema-supported; builder fills)
    objectives: [],    // e.g. support-the-broken-unit (schema-supported; builder fills)
    waves,
  };
}

export default { generateSiegeMap };
