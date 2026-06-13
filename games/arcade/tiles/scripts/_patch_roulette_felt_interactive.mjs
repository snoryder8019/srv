/**
 * Make the roulette FELT tappable + drop chip stacks where you bet.
 *  - raycast taps against the felt mesh
 *  - map the local UV hit to a bet zone (number 0-36, column, dozen, outside)
 *  - place the bet via C.emitAction and drop a chip stack at the hit point
 * The felt canvas layout in felt3d.js defines the geometry we mirror here.
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes('feltBetZones')) { console.log('already interactive'); process.exit(0); }

// import chips
s = s.replace(
  "import { buildRouletteFelt } from './felt3d.js';",
  "import { buildRouletteFelt } from './felt3d.js';\nimport { dropStack } from './chip3d.js';"
);

// add the interaction module at the end of the file
const mod = `

// ───────────────────────── tappable felt + chip stacks ─────────────────────────
// The felt plane is 64x32 world units, centered at FELT.position, lying flat
// (rotation.x = -PI/2). Its texture is 2048x1024. We map a world-space hit on the
// felt to canvas coords, then to a bet zone matching the felt3d.js layout.
const FELT_W = 64, FELT_H = 32, TEX_W = 2048, TEX_H = 1024;
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
let curStake = 10;

// layout geometry (must mirror felt3d.buildRouletteFelt)
const gridX = 220, gridY = 360, cellW = 130, cellH = 130;

function worldToTex(point) {
  // local felt coords: felt lies in XZ; plane local x maps to world.x - FELT.x,
  // plane local y maps to -(world.z - FELT.z) because of the -PI/2 x-rotation.
  const lx = point.x - FELT.position.x;
  const lz = point.z - FELT.position.z;
  // u: 0..1 across width (left to right), v: 0..1 down the texture (top to bottom)
  const u = (lx / FELT_W) + 0.5;
  const v = (lz / FELT_H) + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { px: u * TEX_W, py: v * TEX_H };
}

function zoneAt(px, py) {
  // zero column (left of grid)
  if (px >= gridX - cellW && px < gridX && py >= gridY && py < gridY + cellH * 3) return { side: 'number', n: 0 };
  // number grid
  if (px >= gridX && px < gridX + 12 * cellW && py >= gridY && py < gridY + cellH * 3) {
    const col = Math.floor((px - gridX) / cellW);
    const row = Math.floor((py - gridY) / cellH);
    const n = col * 3 + (3 - row);
    if (n >= 1 && n <= 36) return { side: 'number', n };
  }
  // 2:1 column bets (right of grid)
  if (px >= gridX + 12 * cellW && px < gridX + 13 * cellW && py >= gridY && py < gridY + cellH * 3) {
    const row = Math.floor((py - gridY) / cellH);
    return { side: row === 0 ? 'col3' : (row === 1 ? 'col2' : 'col1') };
  }
  // dozens
  const dy = gridY + 3 * cellH;
  if (py >= dy && py < dy + 90 && px >= gridX && px < gridX + 12 * cellW) {
    const d = Math.floor((px - gridX) / (4 * cellW));
    return { side: 'dozen' + (d + 1) };
  }
  // even-money bar
  const ey = dy + 90;
  if (py >= ey && py < ey + 90 && px >= gridX && px < gridX + 12 * cellW) {
    const i = Math.floor((px - gridX) / (2 * cellW));
    return { side: ['low', 'even', 'red', 'black', 'odd', 'high'][i] };
  }
  return null;
}

function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  // only on my betting turn
  const priv = C.priv;
  if (!priv || !priv.yourTurn || priv.phase !== 'bets') return;
  const action = { type: 'bet', side: zone.side, amount: curStake };
  if (zone.side === 'number') action.n = zone.n;
  C.emitAction(action);
  dropStack(CHIPS, worldPoint.x, worldPoint.z, curStake);
  if (T.Sound) T.Sound.click && T.Sound.click();
}

function feltBetZones(clientX, clientY) {
  const hits = T.raycast(clientX, clientY, [FELT]);
  if (!hits.length) return;
  const tex = worldToTex(hits[0].point);
  if (!tex) return;
  const zone = zoneAt(tex.px, tex.py);
  placeFeltBet(zone, hits[0].point);
}

// clear chip stacks at the start of each new betting round (lastPocket changes / round bump)
let _lastRound = -1;
const _origOnState = onStateHook;
function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  }
}

// tap handler on the canvas
T.renderer.domElement.addEventListener('pointerdown', (e) => {
  // ignore taps that hit HUD controls (those have their own handlers); only felt
  feltBetZones(e.clientX, e.clientY);
}, false);

// hook round-clear into the render loop
T.onFrame(() => { clearChipsIfNewRound(); });
`;

// We reference onStateHook above but it's not defined; simpler: drop that line.
const modClean = mod.replace("const _origOnState = onStateHook;\n", "");
s = s + modClean;

fs.writeFileSync(FILE, s);
console.log('roulette felt is now tappable with chip stacks');
