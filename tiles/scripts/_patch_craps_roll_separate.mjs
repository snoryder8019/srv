import fs from 'fs';
const F = '/srv/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// PROBLEM: the center "prop area" doubled as a roll/done tap zone, but it overlaps
// the betting felt — so taps meant as bets were finishing the round instead.
// FIX: the ONLY thing that finishes betting / rolls is the explicit glowing prompt
// disc. The felt itself is purely for placing bets. The disc sits ABOVE the felt
// (y=2.2) and is raycast first, so it never blocks felt bets when it's hidden.
const oldFn = `function feltBetZones(clientX, clientY) {
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
const newFn = `function feltBetZones(clientX, clientY) {
  const priv = C.priv || {};
  const canRoll = (priv.legal || []).some(a => a.type === 'roll');

  // The roll/done prompt disc is the ONLY roll/finish control. Raycast it first.
  const hits = T.raycast(clientX, clientY, [ROLLPROMPT, FELT]);
  if (!hits.length) return;
  const hitPrompt = hits.some(h => h.object && h.object.name === 'rollprompt');

  if (hitPrompt) {
    // tapping the glowing disc: roll if it's the roll phase, else finish betting
    if (canRoll) { C.emitAction({ type: 'roll' }); return; }
    if (priv.phase === 'bets' && priv.yourTurn) { C.emitAction({ type: 'done' }); return; }
    return;
  }

  // ROLL PHASE (you're the shooter) but you tapped the felt, not the disc: still
  // roll — there's nothing to bet on during the roll phase anyway.
  if (priv.phase === 'roll' && canRoll) { C.emitAction({ type: 'roll' }); return; }

  // BETS PHASE: a felt tap places a bet. The center is NOT a roll zone anymore,
  // so betting anywhere on the felt works.
  if (priv.phase === 'bets' && priv.yourTurn) {
    const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
    const tex = worldToTex(feltHit.point);
    if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
  }
}`;
if (!s.includes(oldFn)) { console.log('feltBetZones anchor not found'); process.exit(1); }
s = s.replace(oldFn, newFn);

// update the hint copy: roll is via the glowing disc, betting is on the felt
s = s.replace(
  `    if (legal.some((a) => a.type === 'roll')) {
      hint.innerHTML = '<b>Tap anywhere to roll</b> 🎲';
    } else if (priv.yourTurn && priv.phase === 'bets') {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      hint.innerHTML = placed
        ? \`Tap felt to add bets · tap center (<b>ROLL</b>) when ready · \${placed} bet\${placed>1?'s':''}\`
        : 'Tap a felt zone to bet · tap center to roll';
    } else if (priv.phase === 'bets') {`,
  `    if (legal.some((a) => a.type === 'roll')) {
      hint.innerHTML = '<b>Tap the glowing disc to roll</b> 🎲';
    } else if (priv.yourTurn && priv.phase === 'bets') {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      hint.innerHTML = placed
        ? \`Tap felt to add bets · tap the gold <b>ROLL</b> disc when ready · \${placed} bet\${placed>1?'s':''}\`
        : 'Tap a felt zone to place a bet · then tap the gold ROLL disc';
    } else if (priv.phase === 'bets') {`
);

fs.writeFileSync(F, s);
console.log('craps: roll/done only via the prompt disc; felt is purely for betting');
