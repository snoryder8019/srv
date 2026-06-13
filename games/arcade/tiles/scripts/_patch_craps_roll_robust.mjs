import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// 1) Make the roll prompt bigger + higher so it's easy to see and tap.
s = s.replace(
  `  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  disc.rotation.x = -Math.PI/2; disc.position.set(0, 1.2, 4); disc.name = 'rollprompt';
  ROLLPROMPT.add(disc);`,
  `  const disc = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  disc.rotation.x = -Math.PI/2; disc.position.set(0, 2.2, 6); disc.name = 'rollprompt'; disc.renderOrder = 999;
  ROLLPROMPT.add(disc);`
);

// 2) Rewrite feltBetZones so roll is robust: if you're the shooter in the roll
//    phase, ANY tap rolls (not just on the disc). If you can finish betting, a
//    tap on the prompt or center finishes. Otherwise place a felt bet.
const oldFn = `function feltBetZones(clientX, clientY) {
  const hits = T.raycast(clientX, clientY, [ROLLPROMPT, DICE, FELT]);
  if (!hits.length) return;
  // a tap on the roll prompt disc: roll if allowed, else finish betting
  const hitPrompt = hits.some(h => h.object && h.object.name === 'rollprompt');
  if (hitPrompt) {
    const priv = C.priv || {};
    if ((priv.legal || []).some(a => a.type === 'roll')) { C.emitAction({ type: 'roll' }); return; }
    if (priv.phase === 'bets' && priv.yourTurn) { C.emitAction({ type: 'done' }); return; }
    return;
  }
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
const newFn = `function feltBetZones(clientX, clientY) {
  const priv = C.priv || {};
  const canRoll = (priv.legal || []).some(a => a.type === 'roll');

  // ROLL PHASE (you're the shooter): ANY tap rolls. No need to hit a tiny target.
  if (priv.phase === 'roll' && canRoll) { C.emitAction({ type: 'roll' }); return; }

  // BETS PHASE: raycast the felt to see what was tapped.
  const hits = T.raycast(clientX, clientY, [ROLLPROMPT, FELT]);
  if (!hits.length) return;
  const hitPrompt = hits.some(h => h.object && h.object.name === 'rollprompt');
  const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
  const tex = worldToTex(feltHit.point);

  if (priv.phase === 'bets' && priv.yourTurn) {
    // tap the glowing prompt OR the center area = finish betting (advances to roll)
    if (hitPrompt || (tex && isCenterArea(tex.px, tex.py))) { C.emitAction({ type: 'done' }); return; }
    if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
  }
}`;
if (!s.includes(oldFn)) { console.log('feltBetZones anchor not found'); process.exit(1); }
s = s.replace(oldFn, newFn);

// 3) Fix the action-bar hint to match the buttonless tap model.
s = s.replace(
  `    if (legal.some((a) => a.type === 'roll')) {
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
    }`,
  `    if (legal.some((a) => a.type === 'roll')) {
      hint.innerHTML = '<b>Tap anywhere to roll</b> 🎲';
    } else if (priv.yourTurn && priv.phase === 'bets') {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      hint.innerHTML = placed
        ? \`Tap felt to add bets · tap center (<b>ROLL</b>) when ready · \${placed} bet\${placed>1?'s':''}\`
        : 'Tap a felt zone to bet · tap center to roll';
    } else if (priv.phase === 'bets') {
      hint.textContent = 'Betting… (waiting on other players)';
    } else if (priv.phase === 'roll') {
      hint.textContent = 'Shooter is rolling…';
    } else {
      hint.textContent = '';
    }`
);

fs.writeFileSync(F, s);
console.log('craps: roll is now tap-anywhere when shooter; prompt bigger + always-on-top');
