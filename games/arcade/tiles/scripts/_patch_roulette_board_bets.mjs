import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('function renderAllBets')) { console.log('already renders all bets'); process.exit(0); }

// 1) Add texToWorld + betToTex + renderAllBets after worldToTex.
const anchor = `function numAt(col, row) { // col 0..11, row 0..2 (top row = 3,6,9..)`;
const inject = `// inverse of worldToTex: texture px/py -> world point on the felt
function texToWorld(px, py) {
  const u = px / TEX_W, v = py / TEX_H;
  const lx = (u - 0.5) * FELT_W, lz = (v - 0.5) * FELT_H;
  return { x: lx + FELT.position.x, z: lz + FELT.position.z };
}

// center texture px/py for a given bet (mirror of zoneAt / felt3d layout)
function colRowOfNum(n) {
  // inverse of numAt: n = col*3 + (3-row)  => for n in 1..36
  const col = Math.floor((n - 1) / 3);
  const row = 3 - (n - col * 3);
  return { col, row };
}
function betToTex(bet) {
  const gx0 = gridX, gy0 = gridY;
  const side = bet.side;
  if (side === 'number') {
    if (bet.n === 0) return { px: gridX - cellW / 2, py: gy0 + cellH * 1.5 };
    const { col, row } = colRowOfNum(bet.n);
    return { px: gx0 + col * cellW + cellW / 2, py: gy0 + row * cellH + cellH / 2 };
  }
  if ((side === 'split' || side === 'street' || side === 'corner' || side === 'line') && Array.isArray(bet.nums) && bet.nums.length) {
    // place the chip at the average center of its covered cells (sits on the shared edge/corner)
    let sx = 0, sy = 0, k = 0;
    for (const n of bet.nums) {
      if (n === 0) { sx += gridX - cellW / 2; sy += gy0 + cellH * 1.5; k++; continue; }
      const { col, row } = colRowOfNum(n);
      sx += gx0 + col * cellW + cellW / 2; sy += gy0 + row * cellH + cellH / 2; k++;
    }
    return { px: sx / k, py: sy / k };
  }
  // 2:1 columns (right of grid)
  if (side === 'col3') return { px: gx0 + 12 * cellW + cellW / 2, py: gy0 + 0 * cellH + cellH / 2 };
  if (side === 'col2') return { px: gx0 + 12 * cellW + cellW / 2, py: gy0 + 1 * cellH + cellH / 2 };
  if (side === 'col1') return { px: gx0 + 12 * cellW + cellW / 2, py: gy0 + 2 * cellH + cellH / 2 };
  // dozens
  const dy = gy0 + 3 * cellH;
  if (side === 'dozen1') return { px: gx0 + 0 * 4 * cellW + 2 * cellW, py: dy + 45 };
  if (side === 'dozen2') return { px: gx0 + 1 * 4 * cellW + 2 * cellW, py: dy + 45 };
  if (side === 'dozen3') return { px: gx0 + 2 * 4 * cellW + 2 * cellW, py: dy + 45 };
  // even-money bar
  const ey = dy + 90;
  const evIdx = { low: 0, even: 1, red: 2, black: 3, odd: 4, high: 5 }[side];
  if (evIdx != null) return { px: gx0 + evIdx * 2 * cellW + cellW, py: ey + 45 };
  return null;
}

// Render EVERY seat's bets on the board from authoritative state (humans + bots).
// Cleared and redrawn whenever the set of bets changes.
let _betsKey = '';
function renderAllBets(v) {
  const bets = v.bets || [];
  const key = (v.round || 0) + '|' + JSON.stringify(bets);
  if (key === _betsKey) return;        // nothing changed
  _betsKey = key;
  for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  for (let seat = 0; seat < bets.length; seat++) {
    const list = bets[seat]; if (!Array.isArray(list)) continue;
    for (let bi = 0; bi < list.length; bi++) {
      const bet = list[bi];
      const tex = betToTex(bet);
      if (!tex) continue;
      const w = texToWorld(tex.px, tex.py);
      // fan multiple chips on the same spot slightly by seat so they don't fully overlap
      const ox = ((seat % 3) - 1) * 0.7 + (Math.random() - 0.5) * 0.3;
      const oz = (Math.floor(seat / 3) - 0.5) * 0.7 + (Math.random() - 0.5) * 0.3;
      dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1 });
    }
  }
}

function numAt(col, row) { // col 0..11, row 0..2 (top row = 3,6,9..)`;
s = s.replace(anchor, inject);

// 2) Drive renderAllBets from onState (after updateSeats).
s = s.replace(
  `  updateSeats(s, v);\n  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }\n  maybeSpin(v);`,
  `  updateSeats(s, v);\n  renderAllBets(v);\n  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }\n  maybeSpin(v);`
);

// 3) On tap, don't drop a local chip (the authoritative render handles it) — just
//    emit + click sound. Prevents duplicate/ghost chips that never clear.
s = s.replace(
  `  C.emitAction(action);
  dropStack(CHIPS, worldPoint.x, worldPoint.z, stake);
  if (T.Sound) T.Sound.click && T.Sound.click();`,
  `  C.emitAction(action);
  if (T.Sound) T.Sound.click && T.Sound.click();`
);

// 4) Replace the round-only clear with the bets-key driven clear (renderAllBets
//    already clears on change; keep a round reset for safety).
s = s.replace(
  `function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  }
}`,
  `function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    _betsKey = '';   // force a fresh bet render next state
  }
}`
);

fs.writeFileSync(F, s);
console.log('roulette board bets wired');
