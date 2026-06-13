import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// BUG 1: the ON puck never flips because the point cycle is now phase 'bets'
// (it used to be 'roll'). The puck should be ON whenever a point is set and we're
// past the come-out — regardless of phase.
s = s.replace(
  `  const on = v.phase !== 'bets' && !v.comeout && v.point != null;`,
  `  const on = !v.comeout && v.point != null;   // point established (any phase)`
);

// BUG 2: can't bet the board on the point. The gate required priv.yourTurn, but
// the more reliable signal is "do my legal actions include a bet for this zone".
// Place the bet whenever the engine offers a matching bet action; this also keeps
// line bets come-out-only (the engine only offers pass/dontpass on the come-out).
s = s.replace(
  `function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  const priv = C.priv;
  if (!priv || !priv.yourTurn || priv.phase !== 'bets') return;
  // line bets are only legal on the come-out; ignore a stale tap otherwise
  if ((zone.side === 'pass' || zone.side === 'dontpass') && priv.comeout === false) return;
  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  if (T.Sound) T.Sound.click && T.Sound.click();
}`,
  `function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  const priv = C.priv || {};
  if (priv.phase !== 'bets') return;
  const legal = priv.legal || [];
  // accept the tap if the engine currently offers a bet on this side (covers both
  // come-out line bets and point-cycle field/prop/hardway bets). Falls back to a
  // yourTurn check if legal actions aren't enumerated for this side.
  const offered = legal.some((a) => a.type === 'bet' && a.side === zone.side);
  const canBetSomething = legal.some((a) => a.type === 'bet');
  if (!offered && !(canBetSomething && priv.yourTurn)) return;
  // line bets are come-out-only (engine enforces too)
  if ((zone.side === 'pass' || zone.side === 'dontpass') && priv.comeout === false) return;
  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  if (T.Sound) T.Sound.click && T.Sound.click();
}`
);

// Also: the felt-tap dispatch only enters the bet branch when priv.yourTurn. During
// the point cycle a non-shooter who hasn't locked has yourTurn true, but make the
// gate "phase===bets AND I can bet" so it's not dependent on the turn flag alone.
s = s.replace(
  `  // BETS PHASE: a felt tap places a bet. The center is NOT a roll zone anymore,
  // so betting anywhere on the felt works.
  if (priv.phase === 'bets' && priv.yourTurn) {
    const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
    const tex = worldToTex(feltHit.point);
    if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
  }`,
  `  // BETS PHASE (incl. the point cycle): a felt tap places a bet.
  if (priv.phase === 'bets' && (priv.legal || []).some(a => a.type === 'bet')) {
    const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
    const tex = worldToTex(feltHit.point);
    if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
  }`
);

// Status hint: show the point clearly during the point cycle.
s = s.replace(
  `    } else if (priv.yourTurn && priv.phase === 'bets') {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      hint.innerHTML = placed
        ? \`Tap felt to add bets · tap the gold <b>ROLL</b> disc when ready · \${placed} bet\${placed>1?'s':''}\`
        : 'Tap a felt zone to place a bet · then tap the gold ROLL disc';
    } else if (priv.phase === 'bets') {`,
  `    } else if (priv.phase === 'bets' && (priv.legal||[]).some(a=>a.type==='bet')) {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      const pt = priv.point != null && priv.comeout === false;
      const ctx = pt ? \`Point is \${priv.point} — \` : '';
      hint.innerHTML = placed
        ? \`\${ctx}tap felt to add bets · tap the gold <b>ROLL</b> disc · \${placed} bet\${placed>1?'s':''}\`
        : \`\${ctx}tap a felt zone to bet · then tap the gold ROLL disc\`;
    } else if (priv.phase === 'bets') {`
);

fs.writeFileSync(F, s);
console.log('craps client: puck flips on point (any phase) + board bets work during point cycle');
