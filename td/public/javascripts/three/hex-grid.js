/**
 * Client-side hex grid math (mirrors services/hex-grid.js).
 * Kept in sync manually for now - test both with the same fixtures.
 */
export const HEX = {
  SIZE: 1.0,
  BOARD_Y: 0,
  TOWER_Y: 0.1,
};

export const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function axialToWorld(q, r, size = HEX.SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: HEX.BOARD_Y,
    z: size * 1.5 * r,
  };
}

export function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const qd = Math.abs(rq - q), rd = Math.abs(rr - r), sd = Math.abs(rs - s);
  if (qd > rd && qd > sd) rq = -rr - rs;
  else if (rd > sd) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function worldToAxial(x, z, size = HEX.SIZE) {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * z) / size;
  const r = (2 / 3 * z) / size;
  return hexRound(q, r);
}

export function generateHexBoard(radius) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) hexes.push({ q, r });
  }
  return hexes;
}

export const hexKey = (q, r) => `${q},${r}`;
