import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// Use the authoritative per-seat delta from the settle event for the banner +
// win/loss, falling back to the bankroll diff only if deltas aren't present.
s = s.replace(
  `  if (ev.type === 'settle') {
    if (T.Sound) T.Sound.trick && T.Sound.trick();
    const sum = ev.sum;
    const bal = myChips();
    const d = _delta.delta(bal);`,
  `  if (ev.type === 'settle') {
    if (T.Sound) T.Sound.trick && T.Sound.trick();
    const sum = ev.sum;
    const bal = myChips();
    // prefer the engine's exact per-seat delta for this roll; keep the tracker in
    // sync so a later fallback diff stays correct.
    let d = (Array.isArray(ev.deltas) && C.mySeat != null && typeof ev.deltas[C.mySeat] === 'number')
      ? ev.deltas[C.mySeat]
      : _delta.delta(bal);
    if (bal != null) _delta.prime(bal);`
);

// the win/loss tag + result coloring already key off d; make sure a 0 delta still
// shows the roll result clearly (no chip change but the number/outcome shows).
fs.writeFileSync(F, s);
console.log('craps client: banner uses authoritative per-roll delta');
