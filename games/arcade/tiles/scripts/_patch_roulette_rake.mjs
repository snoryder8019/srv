import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('rakeChips')) { console.log('already'); process.exit(0); }

// ── 1) Capture settle (deltas/wonBets/stats) via onEvent, hold the chips up for a
//        beat, then rake. Suppress the round-change auto-clear while a rake pends. ──
s = s.replace(
  `function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'gameWon' && T.Sound) T.Sound.win && T.Sound.win();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}`,
  `let _pendingRake = null;   // { wonBets, deltas } captured at settle, raked after a beat
let _rakeHoldUntil = 0;
function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'gameWon' && T.Sound) T.Sound.win && T.Sound.win();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
  if (ev.type === 'settle') {
    // hold the board so the winning stacks stay visible, then rake.
    _pendingRake = { wonBets: ev.wonBets || [], deltas: ev.deltas || [] };
    _rakeHoldUntil = performance.now() + 1200;   // ~1.2s before the rake
    if (ev.stats) renderScoreboard(ev.stats);
  }
}

// Visually settle the board: winning stacks glow + pop briefly, losing stacks slide
// off toward the wheel, then everything clears (raked) and the next round renders.
function rakeChips() {
  const won = new Set((_pendingRake.wonBets || []).map((w) => w.seat + ':' + w.idx));
  const kids = CHIPS.children.slice();
  // tag each chip group we created with seat/idx so we can tell winners from losers
  for (const g of kids) {
    const isWin = g.userData && g.userData.betRef && won.has(g.userData.betRef);
    if (isWin) {
      // pop the winners up briefly, then clear
      const t0 = performance.now();
      const baseY = g.position.y;
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / 420);
        g.position.y = baseY + Math.sin(p * Math.PI) * 1.6;
        if (p < 1) requestAnimationFrame(tick); else CHIPS.remove(g);
      };
      requestAnimationFrame(tick);
    } else {
      // rake losers toward the wheel (-Z) and fade by dropping through the felt
      const t0 = performance.now();
      const fromX = g.position.x, fromZ = g.position.z;
      const toX = 0, toZ = WHEEL.position.z;   // sweep toward the wheel
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / 380);
        const e = 1 - Math.pow(1 - p, 2);
        g.position.x = fromX + (toX - fromX) * e;
        g.position.z = fromZ + (toZ - fromZ) * e;
        g.position.y = 0.05 - p * 0.4;   // sink slightly
        if (p < 1) requestAnimationFrame(tick); else CHIPS.remove(g);
      };
      requestAnimationFrame(tick);
    }
  }
  if (T.Sound) T.Sound.click && T.Sound.click();
  _pendingRake = null;
  _betsKey = '__raked__';   // force a fresh render for the next round's bets
}`
);

// ── 2) tag chip groups with their seat:idx so the rake can identify winners ──
s = s.replace(
  `    for (let bi = 0; bi < list.length; bi++) {
      const bet = list[bi];
      const tex = betToTex(bet);
      if (!tex) continue;
      const w = texToWorld(tex.px, tex.py);
      // fan multiple chips on the same spot slightly by seat so they don't fully overlap
      const ox = ((seat % 3) - 1) * 0.7 + (Math.random() - 0.5) * 0.3;
      const oz = (Math.floor(seat / 3) - 0.5) * 0.7 + (Math.random() - 0.5) * 0.3;
      dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1, seatColor: seatColor(seat) });
    }`,
  `    for (let bi = 0; bi < list.length; bi++) {
      const bet = list[bi];
      const tex = betToTex(bet);
      if (!tex) continue;
      const w = texToWorld(tex.px, tex.py);
      const ox = ((seat % 3) - 1) * 0.7 + (Math.random() - 0.5) * 0.3;
      const oz = (Math.floor(seat / 3) - 0.5) * 0.7 + (Math.random() - 0.5) * 0.3;
      const g = dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1, seatColor: seatColor(seat) });
      if (g) g.userData.betRef = seat + ':' + bi;
    }`
);

// ── 3) don't re-render bets while a rake is pending (keeps the won stacks up) ──
s = s.replace(
  `function renderAllBets(v) {
  const bets = v.bets || [];
  const key = (v.round || 0) + '|' + JSON.stringify(bets);
  if (key === _betsKey) return;        // nothing changed`,
  `function renderAllBets(v) {
  if (_pendingRake || performance.now() < _rakeHoldUntil) return;   // holding the settled board
  const bets = v.bets || [];
  const key = (v.round || 0) + '|' + JSON.stringify(bets);
  if (key === _betsKey) return;        // nothing changed`
);

// ── 4) drive the rake from the frame loop once the hold elapses ──
s = s.replace(
  `// hook round-clear into the render loop
T.onFrame(() => { clearChipsIfNewRound(); });`,
  `// hook round-clear + delayed rake into the render loop
T.onFrame(() => {
  if (_pendingRake && performance.now() >= _rakeHoldUntil) rakeChips();
  if (!_pendingRake) clearChipsIfNewRound();
});`
);

// ── 5) the round-clear shouldn't fire while we're mid-hold/rake ──
s = s.replace(
  `function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    _betsKey = '';   // force a fresh bet render next state
  }
}`,
  `function clearChipsIfNewRound() {
  if (_pendingRake || performance.now() < _rakeHoldUntil) return;
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    if (_betsKey !== '__raked__') _betsKey = '';   // fresh render unless we just raked
  }
}`
);

fs.writeFileSync(F, s);
console.log('roulette client: delayed rake (hold winning stacks ~1.2s then rake)');
