import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(F, 'utf8');

// Decouple the history bar from the spin animation: push + render the moment a new
// result is seen (including the instant first-render on join), so history always
// populates even if onDone is delayed/missed. The banner still waits for the ball
// to land (onDone), which is the right moment for the win/loss reveal.
const old = `function maybeSpin(v) {
  if (v.lastPocket == null) return;
  const key = v.round + ':' + v.lastPocket;
  if (key === _lastPocketKey) return;
  const first = _lastPocketKey === '';
  _lastPocketKey = key;
  if (first) { spinTo(WHEEL, v.lastPocket, { dur: 1 }); return; }
  if (T.Sound) T.Sound.tick && T.Sound.tick();
  const pocket = v.lastPocket, color = v.lastColor || 'black';
  spinTo(WHEEL, pocket, {
    onTap: () => { if (T.Sound) T.Sound.tick && T.Sound.tick(); },
    onDone: () => {
      if (T.Sound) T.Sound.trick && T.Sound.trick();
      // my chip delta this spin (from authoritative seat.chips / bankroll)
      const bal = myChips();
      const d = _delta.delta(bal);
      showResult({
        title: String(pocket),
        titleColor: color,
        sub: color.toUpperCase(),
        delta: d,
        balance: bal,
      });
      _history.push({ label: String(pocket), color });
      renderHistory(_history);
    },
  });
}`;

const neu = `function pushHistory(pocket, color) {
  // de-dupe against the last entry (state can re-broadcast the same result)
  const lastEntry = _history[_history.length - 1];
  if (lastEntry && lastEntry.key === _lastPocketKey) return;
  _history.push({ label: String(pocket), color, key: _lastPocketKey });
  renderHistory(_history);
}

function maybeSpin(v) {
  if (v.lastPocket == null) return;
  const key = v.round + ':' + v.lastPocket;
  if (key === _lastPocketKey) return;
  const first = _lastPocketKey === '';
  _lastPocketKey = key;
  const pocket = v.lastPocket, color = v.lastColor || 'black';

  // History populates immediately on every new result (and on the instant
  // first-render when joining mid-table) — independent of the spin animation.
  pushHistory(pocket, color);

  if (first) { spinTo(WHEEL, pocket, { dur: 1 }); return; }
  if (T.Sound) T.Sound.tick && T.Sound.tick();
  spinTo(WHEEL, pocket, {
    onTap: () => { if (T.Sound) T.Sound.tick && T.Sound.tick(); },
    onDone: () => {
      if (T.Sound) T.Sound.trick && T.Sound.trick();
      const bal = myChips();
      const d = _delta.delta(bal);
      showResult({
        title: String(pocket),
        titleColor: color,
        sub: color.toUpperCase(),
        delta: d,
        balance: bal,
      });
    },
  });
}`;

if (!s.includes(old)) { console.log('anchor not found'); process.exit(1); }
s = s.replace(old, neu);
fs.writeFileSync(F, s);
console.log('roulette history now populates immediately on each result');
