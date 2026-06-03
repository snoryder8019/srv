import fs from 'fs';
const F = '/srv/td/services/game/pathfinding.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('findAllPaths')) { console.log('already'); process.exit(0); }

// Add multi-spawn pathfinding: one path per spawn hex, each routed to the nearest
// base hex. Returns an array of paths (skips spawns with no route).
s = s.replace(
  `/**
 * Convenience: find path from first spawn to first base.
 */
export function findDefaultPath(map) {
  if (!map.spawnHexes?.length || !map.baseHexes?.length) return null;
  return findPath(map, map.spawnHexes[0], map.baseHexes[0]);
}`,
  `/**
 * Convenience: find path from first spawn to first base.
 */
export function findDefaultPath(map) {
  if (!map.spawnHexes?.length || !map.baseHexes?.length) return null;
  return findPath(map, map.spawnHexes[0], map.baseHexes[0]);
}

/**
 * Multi-spawn: a path from EACH spawn to the nearest reachable base hex.
 * Returns an array of { spawn, goal, hexes } (hexes is the ordered path).
 * Spawns with no route are skipped. Used by Siege/center-defense mode.
 */
export function findAllPaths(map) {
  const spawns = map.spawnHexes || [];
  const bases = map.baseHexes || [];
  if (!spawns.length || !bases.length) return [];
  const out = [];
  for (const spawn of spawns) {
    // try the nearest base first, then any base, until one routes
    const ordered = bases
      .map(b => ({ b, d: hexDistance(spawn, b) }))
      .sort((a, b) => a.d - b.d)
      .map(x => x.b);
    let best = null;
    for (const goal of ordered) {
      const hexes = findPath(map, spawn, goal);
      if (hexes && hexes.length) { best = { spawn, goal, hexes }; break; }
    }
    if (best) out.push(best);
  }
  return out;
}`
);

fs.writeFileSync(F, s);
console.log('pathfinding: findAllPaths (multi-spawn -> nearest base) added');
