import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// ── 1) NO BUTTONS. renderActions only shows a tiny status hint; all betting +
//      rolling happens by tapping the felt. ──
const raStart = s.indexOf('  renderActions(box, { priv, myTurn }) {');
const raEnd = s.indexOf('\n  },', raStart) + '\n  },'.length;
if (raStart < 0 || raEnd < 0) { console.log('renderActions not found'); process.exit(1); }
const newRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv) return;
    const legal = priv.legal || [];
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center;text-align:center;line-height:1.4';
    if (legal.some((a) => a.type === 'roll')) {
      hint.innerHTML = '<b>Tap the dice</b> to roll';
    } else if (myTurn && priv.phase === 'bets') {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      hint.innerHTML = placed
        ? 'Tap felt to add bets · <b>tap the dice to roll</b>'
        : 'Tap a felt zone to bet · tap the dice when ready';
    } else if (priv.phase === 'bets') {
      hint.textContent = 'Betting…';
    } else {
      hint.textContent = '';
    }
    box.appendChild(hint);
  },`;
s = s.slice(0, raStart) + newRA + s.slice(raEnd);

// ── 2) dice roll comes from the shooter's seat angle ──
s = s.replace(
  `  if (animate && fresh) {
    if (T.Sound) T.Sound.tick && T.Sound.tick();
    rollDice(DICE, lr, { onDone: () => { if (T.Sound) T.Sound.play && T.Sound.play(); } });
  } else {
    rollDice(DICE, lr, { dur: 1 });
  }`,
  `  const shooter = (C.state && C.state.view && C.state.view.shooter);
  const fromAngle = (shooter != null && T.seatAngleOf) ? T.seatAngleOf(shooter) : Math.PI / 2;
  if (animate && fresh) {
    if (T.Sound) T.Sound.tick && T.Sound.tick();
    rollDice(DICE, lr, { fromAngle, onDone: () => { if (T.Sound) T.Sound.play && T.Sound.play(); } });
  } else {
    rollDice(DICE, lr, { fromAngle, dur: 1 });
  }`
);

// ── 3) felt tap now also handles ROLLING: a tap in the center dice area (when
//      you're the shooter in the roll phase) throws the dice. Bets still tap the
//      felt zones. We add a center "roll zone" check before the bet zones. ──
const oldZone = `function zoneAt(px, py) {
  // mirror felt3d.buildCrapsFelt bands (H=1024):
  //   FIELD strip ~ y 392..502, DON'T PASS ~ y 664..774, PASS LINE ~ y 784..934
  if (py >= 392 && py < 502) return { side: 'field' };
  if (py >= 664 && py < 774) return { side: 'dontpass' };
  if (py >= 784 && py < 934) return { side: 'pass' };
  return null;
}`;
const newZone = `function zoneAt(px, py) {
  // mirror felt3d.buildCrapsFelt bands (H=1024):
  //   FIELD strip ~ y 392..502, DON'T PASS ~ y 664..774, PASS LINE ~ y 784..934
  if (py >= 392 && py < 502) return { side: 'field' };
  if (py >= 664 && py < 774) return { side: 'dontpass' };
  if (py >= 784 && py < 934) return { side: 'pass' };
  return null;
}
// The center prop/dice area — tapping here rolls (if shooter) or, during betting,
// finishes betting and rolls. felt3d draws the prop box around the center.
function isCenterArea(px, py) {
  return px >= 824 && px <= 1224 && py >= 482 && py <= 662;
}`;
s = s.replace(oldZone, newZone);

// ── 4) the felt tap handler: center tap = roll-intent; else place a bet ──
const oldFeltFn = `function feltBetZones(clientX, clientY) {
  const hits = T.raycast(clientX, clientY, [FELT]);
  if (!hits.length) return;
  const tex = worldToTex(hits[0].point);
  if (!tex) return;
  placeFeltBet(zoneAt(tex.px, tex.py), hits[0].point);
}`;
const newFeltFn = `function feltBetZones(clientX, clientY) {
  const hits = T.raycast(clientX, clientY, [FELT, DICE]);
  if (!hits.length) return;
  // a tap on the dice mesh itself always means "roll"
  const hitDice = hits[0].object && DICE.children.indexOf(hits[0].object) >= 0 || hits.some(h => DICE.children.indexOf(h.object) >= 0);
  const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
  const tex = worldToTex(feltHit.point);
  const priv = C.priv || {};
  // ROLL: shooter taps the dice or the center area during the roll phase
  if (priv.phase === 'roll' && (priv.legal || []).some(a => a.type === 'roll')) {
    if (hitDice || (tex && isCenterArea(tex.px, tex.py))) { C.emitAction({ type: 'roll' }); return; }
  }
  // BETS: a center-area tap finishes betting (rolls); otherwise place a bet
  if (priv.phase === 'bets' && priv.yourTurn) {
    if (tex && isCenterArea(tex.px, tex.py)) { C.emitAction({ type: 'done' }); return; }
  }
  if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
}`;
s = s.replace(oldFeltFn, newFeltFn);

fs.writeFileSync(F, s);
console.log('craps client: buttonless — tap felt to bet, tap dice/center to roll; dice from shooter seat');
