import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('function renderAllBets')) { console.log('already'); process.exit(0); }

// add texToWorld + betToTex (craps bands) + renderAllBets after worldToTex
const anchor = `function zoneAt(px, py) {`;
const inject = `function texToWorld(px, py) {
  const u = px / TEX_W, v = py / TEX_H;
  const lx = (u - 0.5) * FELT_W, lz = (v - 0.5) * FELT_H;
  return { x: lx + FELT.position.x, z: lz + FELT.position.z };
}
// center px/py for each craps bet band (mirror of felt3d.buildCrapsFelt)
function betToTex(bet) {
  const side = bet.side;
  if (side === 'field') return { px: 1024, py: 447 };
  if (side === 'dontpass') return { px: 1024, py: 719 };
  if (side === 'pass') return { px: 1024, py: 859 };
  // props/hardways live in the center prop box
  if (['any7','anycraps','ce','hard4','hard6','hard8','hard10'].includes(side)) return { px: 1024, py: 572 };
  return { px: 1024, py: 572 };
}
let _betsKey = '';
function renderAllBets(v) {
  const bets = v.bets || [];
  const key = (v.round || 0) + '|' + JSON.stringify(bets);
  if (key === _betsKey) return;
  _betsKey = key;
  for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  for (let seat = 0; seat < bets.length; seat++) {
    const list = bets[seat]; if (!Array.isArray(list)) continue;
    for (const bet of list) {
      const tex = betToTex(bet); if (!tex) continue;
      const w = texToWorld(tex.px, tex.py);
      const ox = ((seat % 3) - 1) * 1.1 + (Math.random() - 0.5) * 0.4;
      const oz = (Math.floor(seat / 3) - 0.5) * 1.1 + (Math.random() - 0.5) * 0.4;
      dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1 });
    }
  }
}

function zoneAt(px, py) {`;
s = s.replace(anchor, inject);

// drive it from onState (after updateSeats)
s = s.replace(
  `  updateSeats(s, v);\n  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }`,
  `  updateSeats(s, v);\n  renderAllBets(v);\n  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }`
);

// tap places: don't drop a local chip (state render handles it)
s = s.replace(
  `  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  dropStack(CHIPS, worldPoint.x, worldPoint.z, stake);
  if (T.Sound) T.Sound.click && T.Sound.click();`,
  `  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  if (T.Sound) T.Sound.click && T.Sound.click();`
);

// round clear -> reset bets key
s = s.replace(
  `  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    for (const m of CHIPS.children.slice()) CHIPS.remove(m);
  }`,
  `  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    _betsKey = '';
  }`
);

fs.writeFileSync(F, s);
console.log('craps board bets wired');
