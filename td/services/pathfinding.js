/**
 * A* pathfinding on the hex grid.
 *
 * Pure function: given a map definition and a start/end pair,
 * returns an ordered array of {q, r} hexes from start to end (inclusive),
 * or null if no path exists.
 *
 * Walkable hexes:
 *   - explicit pathHexes (preferred high-priority lane), OR
 *   - any hex NOT in blockedHexes AND NOT in baseHexes (towers may sit here too)
 *
 * For now: enemies prefer pathHexes and avoid blocked. Towers cannot occupy
 * pathHexes (enforced at placement time, not here).
 *
 * Cost model:
 *   - pathHex -> pathHex:  1
 *   - pathHex -> openHex:  3 (discourages leaving the path)
 *   - openHex -> openHex:  2
 *   - blocked:             impassable
 */
import { hexDistance, hexNeighbors, hexKey } from './hex-grid.js';

class PriorityQueue {
  constructor() { this.items = []; }
  push(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }
  pop() { return this.items.shift()?.item; }
  get size() { return this.items.length; }
}

/**
 * Build a fast-lookup index of hex roles for a map.
 */
export function buildHexIndex(map) {
  const index = new Map(); // hexKey -> 'path' | 'spawn' | 'base' | 'blocked'
  for (const { q, r } of map.spawnHexes || []) index.set(hexKey(q, r), 'spawn');
  for (const { q, r } of map.baseHexes || []) index.set(hexKey(q, r), 'base');
  for (const { q, r } of map.pathHexes || []) index.set(hexKey(q, r), 'path');
  for (const { q, r } of map.blockedHexes || []) index.set(hexKey(q, r), 'blocked');
  return index;
}

/**
 * Returns true if a hex can be walked over by an enemy.
 * blocked = no. Everything else = yes.
 */
function isWalkable(role) {
  return role !== 'blocked';
}

function moveCost(fromRole, toRole) {
  if (fromRole === 'path' && toRole === 'path') return 1;
  if (toRole === 'path') return 1;
  if (fromRole === 'path' && toRole !== 'path') return 3;
  return 2;
}

/**
 * A* search.
 * @param {object} map  Map document with hex role arrays + radius
 * @param {{q,r}} start
 * @param {{q,r}} goal
 * @returns {Array<{q,r}>|null}
 */
export function findPath(map, start, goal) {
  const index = buildHexIndex(map);
  const startKey = hexKey(start.q, start.r);
  const goalKey = hexKey(goal.q, goal.r);

  const open = new PriorityQueue();
  open.push(start, 0);

  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(startKey, 0);

  const inBounds = ({ q, r }) => {
    // hex-shaped board of given radius
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= map.radius;
  };

  while (open.size > 0) {
    const current = open.pop();
    const ck = hexKey(current.q, current.r);

    if (ck === goalKey) {
      // reconstruct
      const path = [current];
      let key = ck;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key);
        path.unshift(prev);
        key = hexKey(prev.q, prev.r);
      }
      return path;
    }

    const currentRole = index.get(ck) || 'open';

    for (const n of hexNeighbors(current)) {
      if (!inBounds(n)) continue;
      const nk = hexKey(n.q, n.r);
      const nRole = index.get(nk) || 'open';
      if (!isWalkable(nRole)) continue;

      const tentative = (gScore.get(ck) || 0) + moveCost(currentRole, nRole);
      const existing = gScore.get(nk);
      if (existing === undefined || tentative < existing) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentative);
        const f = tentative + hexDistance(n, goal);
        open.push(n, f);
      }
    }
  }

  return null;
}

/**
 * Convenience: find path from first spawn to first base.
 */
export function findDefaultPath(map) {
  if (!map.spawnHexes?.length || !map.baseHexes?.length) return null;
  return findPath(map, map.spawnHexes[0], map.baseHexes[0]);
}
