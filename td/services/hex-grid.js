/**
 * Hex grid constants and shared math.
 * Uses axial coordinates (q, r) - the cleanest hex system.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 *
 * COORDINATE SYSTEM:
 *   - axial:  { q, r }                  - storage & logic
 *   - cube:   { x, y, z }  where x+y+z=0 - distance & rotation math
 *   - world:  { x, y, z } in Three.js   - rendering position
 *
 * ORIENTATION: pointy-top hexes (flat sides on left/right)
 */

export const HEX = {
  // Visual size in Three.js world units (radius = center to corner)
  SIZE: 1.0,

  // Pointy-top hexagon dimensions
  WIDTH: Math.sqrt(3),       // SIZE * sqrt(3)
  HEIGHT: 2,                 // SIZE * 2

  // Spacing between adjacent hex centers
  HORIZ_SPACING: Math.sqrt(3),  // width
  VERT_SPACING: 1.5,            // 3/4 of height

  // Y position of board surface (towers placed on top)
  BOARD_Y: 0,
  TOWER_Y: 0.1,
};

// Six neighbor directions in axial coordinates (pointy-top)
export const HEX_DIRECTIONS = [
  { q: 1, r: 0 },   // east
  { q: 1, r: -1 },  // northeast
  { q: 0, r: -1 },  // northwest
  { q: -1, r: 0 },  // west
  { q: -1, r: 1 },  // southwest
  { q: 0, r: 1 },   // southeast
];

/**
 * Convert axial hex coords to Three.js world position.
 */
export function axialToWorld(q, r, size = HEX.SIZE) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const z = size * 1.5 * r;
  return { x, y: HEX.BOARD_Y, z };
}

/**
 * Convert world position back to nearest axial hex coords.
 */
export function worldToAxial(x, z, size = HEX.SIZE) {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * z) / size;
  const r = (2 / 3 * z) / size;
  return hexRound(q, r);
}

/**
 * Round fractional axial coords to the nearest valid hex.
 */
export function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
  else if (rDiff > sDiff) rr = -rq - rs;

  return { q: rq, r: rr };
}

/**
 * Distance between two hexes in axial coords.
 */
export function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * Get neighbors of a hex.
 */
export function hexNeighbors({ q, r }) {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

/**
 * Generate all hexes within radius of origin (a hex-shaped board).
 */
export function generateHexBoard(radius) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}

/**
 * Stable string key for an axial hex (for Map/Set lookups).
 */
export function hexKey(q, r) {
  return `${q},${r}`;
}

export function parseHexKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}
