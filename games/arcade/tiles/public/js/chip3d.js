/**
 * chip3d.js — casino chip stacks for the felt.
 *
 * buildChipStack(amount, opts) returns a THREE.Group of stacked chip discs whose
 * height encodes the wager. Chips have an edge-stripe ring and a value pip on top.
 * dropStack(parent, x, z, amount, opts) animates a stack falling with a bounce.
 *
 * By default chips are colored by denomination (5 red, 10 blue, 25 green, 100
 * black). Pass opts.seatColor (a hex int) to tint the whole stack to a player's
 * colour instead — used on the casino boards so each player's bets are tellable
 * apart. The denomination value still reads on top; a coloured edge band carries
 * the player colour.
 */
import * as THREE from 'three';

const CHIP_R = 1.15, CHIP_T = 0.28;

export const CHIP_COLORS = {
  5: 0xb5482f, 10: 0x2f5fb0, 25: 0x2f8f5b, 100: 0x15171a, default: 0xc9a24b,
};
function colorFor(denom) { return CHIP_COLORS[denom] || CHIP_COLORS.default; }

// Distinct, high-contrast per-seat chip colours (up to 8 seats).
export const SEAT_CHIP_COLORS = [
  0xe23b3b, // red
  0x2f7fe0, // blue
  0x2fbf71, // green
  0xe3c567, // gold
  0xb060d0, // purple
  0xe07b2f, // orange
  0x35c9c9, // teal
  0xe060a0, // pink
];
export function seatColor(seat) { return SEAT_CHIP_COLORS[seat % SEAT_CHIP_COLORS.length]; }

const _topCache = new Map();
function topTexture(denom, faceHex, ringHex) {
  const key = denom + ':' + faceHex + ':' + ringHex;
  if (_topCache.has(key)) return _topCache.get(key);
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  // base face (the player/denom colour)
  c.fillStyle = '#' + faceHex.toString(16).padStart(6, '0'); c.beginPath(); c.arc(S/2, S/2, S/2, 0, Math.PI*2); c.fill();
  // edge dashes in the RING colour (player colour when tinted, else white)
  c.strokeStyle = '#' + ringHex.toString(16).padStart(6, '0'); c.lineWidth = 12;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.beginPath(); c.arc(S/2, S/2, S/2 - 9, a, a + 0.32); c.stroke(); }
  // center disc + value
  c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(S/2, S/2, S*0.30, 0, Math.PI*2); c.fill();
  c.fillStyle = '#1a1a1a'; c.font = 'bold 46px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(denom), S/2, S/2 + 2);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _topCache.set(key, tex); return tex;
}

function denominate(amount) {
  const denoms = [100, 25, 10, 5];
  const out = [];
  let rem = amount;
  for (const d of denoms) { while (rem >= d && out.length < 14) { out.push(d); rem -= d; } }
  if (!out.length) out.push(5);
  return out;
}

function buildChip(denom, seatHex) {
  // When a seat colour is given, the chip BODY is that colour and the top face is
  // a slightly lighter shade with a white edge band, so the player colour reads
  // strongly while the value stays legible. Otherwise fall back to denom colours.
  const bodyHex = (seatHex != null) ? seatHex : colorFor(denom);
  const faceHex = (seatHex != null) ? seatHex : colorFor(denom);
  const ringHex = (seatHex != null) ? 0xffffff : 0xffffff;
  const body = new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.5 });
  const top = new THREE.MeshStandardMaterial({ map: topTexture(denom, faceHex, ringHex), roughness: 0.45 });
  const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 28);
  const mesh = new THREE.Mesh(geo, [body, top, body]);   // [side, top, bottom]
  mesh.castShadow = true;
  return mesh;
}

export function buildChipStack(amount, opts = {}) {
  const seatHex = (typeof opts.seatColor === 'number') ? opts.seatColor : null;
  const g = new THREE.Group();
  const chips = denominate(amount);
  chips.forEach((d, i) => {
    const ch = buildChip(d, seatHex);
    ch.position.y = CHIP_T / 2 + i * CHIP_T;
    ch.rotation.y = Math.random() * 0.4;
    g.add(ch);
  });
  g.userData = { amount, h: chips.length * CHIP_T };
  return g;
}

/** Drop a chip stack onto the felt at (x,z) with a short bounce. opts.seatColor
 *  tints the stack to a player's colour; opts.dur=1 places it instantly. */
export function dropStack(parent, x, z, amount, opts = {}) {
  const g = buildChipStack(amount, opts);
  g.position.set(x, 10, z);
  parent.add(g);
  const instant = opts.dur === 1;
  if (instant) { g.position.y = 0.05; return g; }
  const start = performance.now();
  const dur = opts.dur || 420;
  const restY = 0.05;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    const bounce = Math.sin(t * Math.PI) * (1 - t) * 1.2;
    g.position.y = 10 + (restY - 10) * e + bounce;
    if (t < 1) requestAnimationFrame(frame);
    else g.position.y = restY;
  }
  requestAnimationFrame(frame);
  return g;
}

export default { buildChipStack, dropStack, CHIP_COLORS, SEAT_CHIP_COLORS, seatColor };
