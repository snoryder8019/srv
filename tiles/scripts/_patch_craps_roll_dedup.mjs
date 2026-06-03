import fs from 'fs';
const F = '/srv/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// The dice animated twice because the de-dup key included v.phase, which changes
// from 'roll' -> 'bets' after a point is set (same dice). Key on the engine's
// monotonic lastRollKey instead — it increments exactly once per real roll.
const old = `function maybeRoll(v, animate) {
  const lr = v.lastRoll;
  if (!lr) { for (const m of DICE.children.slice()) DICE.remove(m); _lastRollKey = ''; return; }
  const key = v.round + ':' + lr.join(',') + ':' + (v.phase);
  if (key === _lastRollKey) return;
  const fresh = _lastRollKey !== '' || !animate;
  _lastRollKey = key;
  const shooter = (C.state && C.state.view && C.state.view.shooter);
  const fromAngle = (shooter != null && T.seatAngleOf) ? T.seatAngleOf(shooter) : Math.PI / 2;
  if (animate && fresh) {
    if (T.Sound) T.Sound.tick && T.Sound.tick();
    rollDice(DICE, lr, { fromAngle, onDone: () => { if (T.Sound) T.Sound.play && T.Sound.play(); } });
  } else {
    rollDice(DICE, lr, { fromAngle, dur: 1 });
  }
}`;
const neu = `function maybeRoll(v, animate) {
  const lr = v.lastRoll;
  if (!lr) { for (const m of DICE.children.slice()) DICE.remove(m); _lastRollKey = null; return; }
  // de-dup on the engine's monotonic per-roll counter (NOT phase — phase flips
  // roll->bets when a point is set, which would otherwise re-trigger the animation)
  const key = (v.lastRollKey != null) ? v.lastRollKey : (v.round + ':' + lr.join(','));
  if (key === _lastRollKey) return;
  const first = (_lastRollKey == null);
  _lastRollKey = key;
  const shooter = (C.state && C.state.view && C.state.view.shooter);
  const fromAngle = (shooter != null && T.seatAngleOf) ? T.seatAngleOf(shooter) : Math.PI / 2;
  // animate only for a genuinely new roll while animation is on; the very first
  // roll a client sees (join/reconnect) is placed instantly.
  if (animate && !first) {
    if (T.Sound) T.Sound.tick && T.Sound.tick();
    rollDice(DICE, lr, { fromAngle, onDone: () => { if (T.Sound) T.Sound.play && T.Sound.play(); } });
  } else {
    rollDice(DICE, lr, { fromAngle, dur: 1 });
  }
}`;
if (!s.includes(old)) { console.log('maybeRoll anchor not found'); process.exit(1); }
s = s.replace(old, neu);

// _lastRollKey is initialised to '' elsewhere; make it null to match the new
// "first roll" sentinel.
s = s.replace(`let _lastRollKey = '';`, `let _lastRollKey = null;`);

fs.writeFileSync(F, s);
console.log('craps client: dice animation de-duped on lastRollKey (no double-roll on point set)');
