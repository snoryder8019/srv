/**
 * Make the CRAPS felt tappable + drop chips: tap PASS LINE or DON'T PASS to place
 * the line bet (the only bets the engine supports today). Mirrors the felt3d
 * craps layout geometry. Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes('feltBetZones')) { console.log('already interactive'); process.exit(0); }

s = s.replace(
  "import { buildCrapsFelt } from './felt3d.js';",
  "import { buildCrapsFelt } from './felt3d.js';\nimport { dropStack } from './chip3d.js';"
);

const mod = `

// ───────────────────────── tappable felt + chip stacks (craps) ─────────────────────────
// Felt plane 64x32, texture 2048x1024 (see felt3d.buildCrapsFelt). Only the two
// line bets exist in the engine today; PASS LINE and DON'T PASS bands are tappable.
const FELT_W = 64, FELT_H = 32, TEX_W = 2048, TEX_H = 1024;
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
const stake = 10;

function worldToTex(point) {
  const lx = point.x - FELT.position.x;
  const lz = point.z - FELT.position.z;
  const u = (lx / FELT_W) + 0.5;
  const v = (lz / FELT_H) + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { px: u * TEX_W, py: v * TEX_H };
}

function zoneAt(px, py) {
  // from felt3d: DON'T PASS at y=H-360..H-250, PASS LINE at y=H-240..H-90 (H=1024)
  if (py >= 1024 - 360 && py < 1024 - 250) return { side: 'dontpass' };
  if (py >= 1024 - 240 && py < 1024 - 90) return { side: 'pass' };
  return null;
}

function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  const priv = C.priv;
  if (!priv || !priv.yourTurn || priv.phase !== 'bets') return;
  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  dropStack(CHIPS, worldPoint.x, worldPoint.z, stake);
  if (T.Sound) T.Sound.click && T.Sound.click();
}

function feltBetZones(clientX, clientY) {
  const hits = T.raycast(clientX, clientY, [FELT]);
  if (!hits.length) return;
  const tex = worldToTex(hits[0].point);
  if (!tex) return;
  placeFeltBet(zoneAt(tex.px, tex.py), hits[0].point);
}

let _lastRound = -1;
function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  }
}

T.renderer.domElement.addEventListener('pointerdown', (e) => { feltBetZones(e.clientX, e.clientY); }, false);
T.onFrame(() => { clearChipsIfNewRound(); });
`;
s = s + mod;
fs.writeFileSync(FILE, s);
console.log('craps felt is now tappable with chip stacks');
