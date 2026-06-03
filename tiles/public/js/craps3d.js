/**
 * craps3d.js — Craps on the shared 3D table.
 *
 * Bet-driven (not turn-based card play): every solvent seat places a pass /
 * don't-pass wager, then the shooter rolls 3D dice on the felt. Rendering:
 *   • two pipped dice that tumble and land on the server's result (dice3d)
 *   • a POINT puck in the center once a point is set; "COME OUT" otherwise
 *   • each seat's bankroll + current bet shown on its plate
 *   • bet buttons during betting; a big ROLL button for the shooter
 */
import { createTable3D } from './table3d.js?v=1780540000000';
import { createTableClient } from './tableclient3d.js?v=1780348653535';
import { createHUD } from './hud3d.js?v=1780348653535';
import { rollDice, DIE } from './dice3d.js?v=1780348653535';
import { buildCrapsFelt, CRAPS_LAYOUT } from './felt3d.js?v=1780348653535';
import { dropStack, seatColor } from './chip3d.js?v=1780348653535';
import { showResult, renderHistory, makeDeltaTracker } from './casino-fx.js?v=1780490000000';
import { createBetBar } from './betbar.js?v=1780480000000';
import { createAudioBus } from './audiobus.js?v=1780540000000';
import { createDealerFx } from './dealerfx.js?v=1780413600000';
import { panel } from './casino-ui.js?v=1780413000000';
import { createChipBurst } from './chipburst.js?v=1780520000000';

const T = createTable3D({
  tableRadius: 34, feltColor: 0x0e5c3a,
  bgScene: 'craps',
  cameraStart: { x: 0, y: 52, z: 120 },
  cameraTarget: { x: 0, y: 6, z: 0 },
});
T.setCamera({ maxDistance: 320 });
const THREE = T.THREE;
const BURST = createChipBurst(T);   // shared gold win burst
const _delta = makeDeltaTracker();
const _diceHistory = [];
const _ledger = []; let _cycleTotal = 0, _sessionTotal = 0;   // per-roll +/- ledger
const FELT = buildCrapsFelt(); FELT.position.set(0, 0.03, 0); T.scene.add(FELT);

const DICE = new THREE.Group(); T.scene.add(DICE);
const PUCK = new THREE.Group(); T.scene.add(PUCK);

// ── ROLLPROMPT: a glowing tappable disc in the center that says TAP TO ROLL /
// TAP TO BET-AND-ROLL. Visible only when the local seat can roll (shooter, roll
// phase) or can finish betting. It is itself the raycast target for rolling. ──
const ROLLPROMPT = new THREE.Group(); T.scene.add(ROLLPROMPT);
let _promptMode = null;   // 'roll' | null
function rollPromptTexture(text, glow) {
  const S = 256, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  c.clearRect(0,0,S,S);
  c.beginPath(); c.arc(S/2,S/2,S/2-6,0,Math.PI*2);
  c.fillStyle = glow ? 'rgba(227,197,103,.92)' : 'rgba(47,143,91,.92)'; c.fill();
  c.lineWidth = 8; c.strokeStyle = '#fff8e0'; c.stroke();
  c.fillStyle = glow ? '#241d05' : '#06210f';
  c.font = 'bold 34px system-ui'; c.textAlign='center'; c.textBaseline='middle';
  const lines = text.split('\n');
  lines.forEach((ln,i)=>c.fillText(ln, S/2, S/2 + (i-(lines.length-1)/2)*38));
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function renderRollPrompt(priv) {
  const legal = (priv && priv.legal) || [];
  const canRoll = legal.some(a => a.type === 'roll');
  // The board token is ROLL-ONLY now. Finishing betting ("Ready") lives in the
  // bet bar; here a green ROLL DICE token rises only when it's your turn to roll.
  const mode = canRoll ? 'roll' : null;
  if (mode === _promptMode) return;
  _promptMode = mode;
  for (const m of ROLLPROMPT.children.slice()) ROLLPROMPT.remove(m);
  if (!mode) return;
  const tex = rollPromptTexture('ROLL\nDICE', false);   // false => green token
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  disc.rotation.x = -Math.PI/2; disc.position.set(20, 2.4, 14); disc.name = 'rollprompt'; disc.renderOrder = 999;
  ROLLPROMPT.add(disc);
}

// --- point puck (ON/OFF) — rides on the point's PLACE box, parks off to the
// side during come-out so it never sits in the middle blocking the dice/view ---
let _puckPoint = null, _puckOn = null;
const PUCK_OFF_TEX = { px: 150, py: 40 };   // empty felt margin above the place row (out of play)
// world coordinate of the point-number PLACE box (e.g. point 6 → the "6" box)
function puckTarget(on, point) {
  if (on) {
    const b = (CRAPS_LAYOUT.place || []).find((x) => x.num === point || x.side === 'place' + point);
    if (b) { const t = boxCenter(b); return texToWorld(t.px, t.py); }
  }
  return texToWorld(PUCK_OFF_TEX.px, PUCK_OFF_TEX.py);
}
function renderPuck(v) {
  const on = !v.comeout && v.point != null;   // point established (any phase)
  if (on === _puckOn && v.point === _puckPoint) return;
  const first = (_puckOn === null);           // initial placement → no slide
  _puckOn = on; _puckPoint = v.point;
  for (const m of PUCK.children.slice()) PUCK.remove(m);
  // children sit at the group's local origin; the GROUP is positioned/animated.
  const geo = new THREE.CylinderGeometry(2.8, 2.8, 0.7, 32);
  const color = on ? 0xffffff : 0x222222;
  const puck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  puck.position.set(0, 0.5, 0);
  PUCK.add(puck);
  // label
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  c.fillStyle = on ? '#fff' : '#222'; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); c.fill();
  c.fillStyle = on ? '#0a5c34' : '#888'; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (on) { c.font = 'bold 38px system-ui'; c.fillText('ON', S / 2, S / 2 - 18); c.font = 'bold 60px system-ui'; c.fillText(String(v.point), S / 2, S / 2 + 26); }
  else { c.font = 'bold 44px system-ui'; c.fillText('OFF', S / 2, S / 2); }
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const top = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshBasicMaterial({ map: tex }));
  top.rotation.x = -Math.PI / 2; top.position.set(0, 0.92, 0);
  PUCK.add(top);
  // slide the whole puck to its spot (place box when ON, side margin when OFF)
  const dest = puckTarget(on, v.point);
  if (first || !T.flyTo) { PUCK.position.set(dest.x, 0, dest.z); }
  else { PUCK.position.y = 0; T.flyTo(PUCK, { x: dest.x, y: 0, z: dest.z }, { dur: 420, arc: 1.5, spin: 0, tumble: 0 }); }
}

// --- dice: roll when a new result arrives ---
let _lastRollKey = null;
function maybeRoll(v, animate) {
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
}

const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { HUD.render(); renderRollPrompt(C.priv); renderPressPrompt(C.priv); syncBetBar(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

function myChips() {
  const s = C.state; if (!s) return null;
  const me = (s.seats || [])[C.mySeat];
  if (me && typeof me.chips === 'number') return me.chips;
  const v = s.view || {};
  if (v.bankrolls && typeof v.bankrolls[C.mySeat] === 'number') return v.bankrolls[C.mySeat];
  return null;
}
let lastSeatCount = 0;
function onState(s) {
  const v = s.view || {};
  const n = (s.seats || []).length;
  if (n && n !== lastSeatCount) { T.buildSeats(n, C.mySeat); lastSeatCount = n; }
  updateSeats(s, v);
  renderAllBets(v);
  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }
  if (s.phase !== 'lobby') { renderPuck(v); maybeRoll(v, true); }
  renderRollPrompt(C.priv);
  renderPressPrompt(C.priv);
  syncBetBar();
  HUD.render();
  HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}

function seatChips(seat, v, i) {
  if (seat && typeof seat.chips === 'number') return seat.chips;
  if (v.bankrolls && typeof v.bankrolls[i] === 'number') return v.bankrolls[i];
  return null;
}
function updateSeats(s, v) {
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const chips = seatChips(seat, v, i);
    const bet = v.bets && v.bets[i];
    const isShooter = v.shooter === i;
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '') + (isShooter ? ' 🎲' : '');
    let sub;
    if (s.phase === 'lobby') {
      sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    } else if (!seat.platformId && !seat.bot) {
      sub = 'open';
    } else {
      let betStr = '';
      if (Array.isArray(bet) && bet.length) {
        const total = bet.reduce((acc, x) => acc + (x.amount || 0), 0);
        betStr = ` · ${bet.length} bet${bet.length > 1 ? 's' : ''} (${total})`;
      }
      sub = (chips != null ? `${chips} chips` : '—') + betStr;
    }
    const turn = (v.phase === 'bets' && v.turn === i) || (v.phase === 'roll' && v.shooter === i);
    const occupied = !!(seat.platformId || seat.bot);
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat, color: occupied ? seatColor(i) : null });
    if (T.setSeatAvatar) T.setSeatAvatar(i, { present: occupied, color: seatColor(i), active: !!turn });
  }
}

let _ledgerEl = null;
function ensureLedger() {
  if (_ledgerEl) return _ledgerEl;
  _ledgerEl = document.createElement('div');
  _ledgerEl.style.cssText = 'position:fixed;left:8px;top:120px;z-index:14;pointer-events:none;width:172px;max-width:46vw;background:rgba(6,12,9,.82);border:1px solid rgba(111,132,120,.5);border-radius:10px;padding:8px 10px;font-family:system-ui;backdrop-filter:blur(3px);box-shadow:0 8px 22px rgba(0,0,0,.4);display:none';
  document.body.appendChild(_ledgerEl);
  return _ledgerEl;
}
function renderLedger() {
  const el = ensureLedger();
  if (!_ledger.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const cc = _cycleTotal > 0 ? '#43e08a' : (_cycleTotal < 0 ? '#ff7a5f' : '#cfe7d8');
  const sc = _sessionTotal > 0 ? '#9fd9b5' : (_sessionTotal < 0 ? '#e0a59a' : '#9fb0a6');
  const rows = _ledger.slice(0, 9).map((e) => {
    if (e.kind === 'roll') {
      const col = e.delta > 0 ? '#43e08a' : (e.delta < 0 ? '#ff7a5f' : '#9fb0a6');
      const amt = e.delta > 0 ? '+' + e.delta : String(e.delta);
      const tag = e.roundOver ? (e.sum === 7 && e.point ? ' out' : ' \u2713') : '';
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:1px 0"><span style="color:#cfe7d8;font-size:12px">\uD83C\uDFB2 ${e.sum}<span style="color:#7e9388">${tag}</span></span><span style="color:${col};font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${amt}</span></div>`;
    }
    return `<div style="font-size:10.5px;color:#e3c567;padding:1px 0 1px 10px">\u21B3 ${e.text} <span style="color:#7e9388">${e.sub || ''}</span></div>`;
  }).join('');
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:4px;margin-bottom:4px">
      <span style="font-size:10px;font-weight:800;letter-spacing:.1em;color:#9fb0a6">ROLL LEDGER</span>
      <span style="font-size:12.5px;font-weight:800;color:${cc};font-variant-numeric:tabular-nums">${_cycleTotal > 0 ? '+' : ''}${_cycleTotal}</span></div>
    ${rows}
    <div style="border-top:1px solid rgba(255,255,255,.1);margin-top:4px;padding-top:4px;font-size:10px;color:#7e9388;display:flex;justify-content:space-between"><span>session</span><span style="color:${sc};font-weight:700">${_sessionTotal > 0 ? '+' : ''}${_sessionTotal}</span></div>`;
}

function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'pressed' && ev.seat === C.mySeat && ev.amount > 0) { _ledger.unshift({ kind: 'note', text: 'pressed +' + ev.amount, sub: 're-risked' }); renderLedger(); }
  if (ev.type === 'pulled' && ev.seat === C.mySeat) { _ledger.unshift({ kind: 'note', text: 'took down', sub: 'bet back' }); renderLedger(); }
  if (ev.type === 'tookWin' && ev.seat === C.mySeat) { _ledger.unshift({ kind: 'note', text: 'took win', sub: 'left up' }); renderLedger(); }
  if (ev.type === 'bet') DEALER.onBet(ev);
  if (ev.type === 'settle') {
    if (T.Sound) T.Sound.trick && T.Sound.trick();
    const sum = ev.sum;
    const bal = myChips();
    // prefer the engine's exact per-seat delta for this roll; keep the tracker in
    // sync so a later fallback diff stays correct.
    let d = (Array.isArray(ev.deltas) && C.mySeat != null && typeof ev.deltas[C.mySeat] === 'number')
      ? ev.deltas[C.mySeat]
      : _delta.delta(bal);
    if (bal != null) _delta.prime(bal);
    _cycleTotal += d; _sessionTotal += d;
    _ledger.unshift({ kind: 'roll', sum, delta: d, roundOver: !!ev.roundOver, point: ev.point });
    if (_ledger.length > 14) _ledger.length = 14;
    renderLedger();
    if (ev.roundOver) _cycleTotal = 0;
    if (d > 0) { BURST.spawn(0, 4, { n: Math.max(10, Math.min(26, 10 + Math.round(d / 18))) }); try { T.Sound.coin && T.Sound.coin(); if (d >= 100) AUDIO.applause(); } catch (e) {} }
    // headline: the dice total; sub: hard/easy + round outcome context
    let sub = (ev.hard ? 'HARD ' : '') + numberWord(sum);
    if (ev.roundOver) {
      // a 7-out or point/comeout decision concluded the pass-line sequence
      if (sum === 7) sub = ev.point ? 'SEVEN OUT' : 'SEVEN';
      else if (ev.point && sum === ev.point) sub = 'POINT ' + sum + ' — WINNER';
      else if (!ev.point && (sum === 11)) sub = 'YO ELEVEN';
      else if (!ev.point && [2,3,12].includes(sum)) sub = 'CRAPS ' + sum;
    }
    const myBreak = Array.isArray(ev.breakdown)
      ? ev.breakdown.filter((r) => r.seat === C.mySeat).map((r) => ({ label: betLabel(r.side), delta: r.delta, note: r.result === 'down' ? 'down' : null }))
      : null;
    showResult({
      title: String(sum),
      titleColor: (d > 0 ? 'green' : (d < 0 ? 'red' : null)),
      sub,
      delta: d,
      balance: bal,
      breakdown: myBreak,
    });
    if (typeof d === 'number' && d >= 100) DEALER.bigWin('Winner!');
    DEALER.onRoll(rollCall(ev));
    _diceHistory.push({ label: String(sum), color: sum === 7 ? 'red' : (ev.point && sum === ev.point ? 'green' : 'black'), tip: `Roll ${sum} \u00b7 you ${d > 0 ? '+' + d : d}` });
    renderHistory(_diceHistory);
    if (Array.isArray(ev.deltas)) {
      for (let i = 0; i < ev.deltas.length; i++) {
        const av = T.seatAvatar && T.seatAvatar(i); if (!av || !av.userData || !av.userData.anim) continue;
        if (ev.deltas[i] > 0) av.userData.anim.cheer(); else if (ev.deltas[i] < 0) av.userData.anim.slump();
      }
    }
  }
  if (ev.type === 'gameWon' && T.Sound) T.Sound.win && T.Sound.win();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}
function betLabel(side) {
  const map = {
    pass: 'Pass', dontpass: "Don't Pass", field: 'Field', any7: 'Any 7',
    anycraps: 'Any Craps', ce: 'C & E',
    two: 'Aces (2)', three: 'Ace-Deuce (3)', yo: 'Yo (11)', twelve: 'Boxcars (12)', horn: 'Horn',
    big6: 'Big 6', big8: 'Big 8',
    hard4: 'Hard 4', hard6: 'Hard 6', hard8: 'Hard 8', hard10: 'Hard 10',
    place4: 'Place 4', place5: 'Place 5', place6: 'Place 6',
    place8: 'Place 8', place9: 'Place 9', place10: 'Place 10',
  };
  return map[side] || side;
}
function numberWord(n) {
  return ({2:'SNAKE EYES',3:'THREE',4:'FOUR',5:'FIVE',6:'SIX',7:'SEVEN',8:'EIGHT',9:'NINE',10:'TEN',11:'ELEVEN',12:'BOXCARS'})[n] || String(n);
}

// ── Dealer call-outs ────────────────────────────────────────────────────────
// When any seat places a bet, the stickman's call surfaces as faint ambient text
// in the background behind the table — the casino parlance for that wager.
// dice parlance for the roll itself — the dealer calls these on ~every 6th roll
const ROLL_WORD = { 2: 'Snake eyes', 3: 'Ace-deuce', 4: 'Little Joe', 5: 'Fever five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Niner', 10: 'Big ten', 11: 'Yo-eleven', 12: 'Boxcars' };
function rollCall(ev) {
  const s = ev.sum;
  if (ev.roundOver && s === 7 && ev.point) return 'Seven out!';
  if (ev.roundOver && ev.point && s === ev.point) return 'Point made!';
  if (ev.hard && (s === 4 || s === 6 || s === 8 || s === 10)) return 'Hard ' + ({ 4: 'four', 6: 'six', 8: 'eight', 10: 'ten' })[s] + '!';
  return (ROLL_WORD[s] || String(s)) + '!';
}

const CRAPS_CALLS = {
  dontpass: "Don't pass — wrong way!",
  field: 'In the field!', any7: 'Any seven — big red!', anycraps: 'Any craps!',
  ce: 'C and E!', two: 'Aces — snake eyes!', three: 'Ace-deuce!',
  yo: 'Yo-leven!', twelve: 'Boxcars — midnight!', horn: 'Horn high!',
  big6: 'Big six!', big8: 'Big eight!',
  hard4: 'Hard four — little Joe!', hard6: 'Hard six!', hard8: 'Hard eight!', hard10: 'Hard ten!',
  place4: 'Place the four!', place5: 'Fever five!', place6: 'Place the six!',
  place8: 'Place the eight!', place9: 'Nina — centre field nine!', place10: 'Place the ten!',
};
let _callEl = null, _callTimer = null, _lastBetCallAt = 0;
function ensureCallEl() {
  if (_callEl) return _callEl;
  const el = document.createElement('div');
  el.id = 'dealer-call';
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:108px', 'transform:translateX(-50%)',
    'z-index:6', 'pointer-events:none', 'text-align:center', 'max-width:92vw',
    'font-family:Georgia,serif', 'font-style:italic', 'font-weight:700', 'font-size:30px',
    'color:rgba(255,233,168,.92)', 'text-shadow:0 2px 16px rgba(0,0,0,.75)',
    'opacity:0', 'transition:opacity .25s ease', 'letter-spacing:.02em',
  ].join(';');
  document.body.appendChild(el);
  _callEl = el; return el;
}
function showCall(text) {
  const el = ensureCallEl();
  el.textContent = text;
  el.style.opacity = '0.92';
  if (_callTimer) clearTimeout(_callTimer);
  _callTimer = setTimeout(() => { el.style.opacity = '0'; }, 1700);
  try { AUDIO.speak(text); } catch (e) {}
}

const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'CRAPS',
  lowerWins: false, scoreLabel: 'Most chips wins',
  onResetCam: () => T.resetCamera(),
  statusLine(v, c) {
    if (v.phase === 'bets') return v.turn === c.mySeat ? '<b>Place your bet</b>' : 'Betting…';
    if (v.phase === 'roll') {
      const where = v.comeout ? 'come-out roll' : ('point is ' + v.point);
      return v.shooter === c.mySeat ? `<b>Your roll</b> · ${where}` : `Seat ${v.shooter} shooting · ${where}`;
    }
    return '…';
  },
  renderActions(box, { priv, myTurn }) {
    if (!priv) return;
    const legal = priv.legal || [];
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center;text-align:center;line-height:1.4';
    if (legal.some((a) => a.type === 'roll')) {
      hint.innerHTML = '<b>Tap the green ROLL DICE token</b> 🎲';
    } else if (priv.phase === 'bets' && (priv.legal||[]).some(a=>a.type==='bet')) {
      const placed = (priv.myBets && priv.myBets.length) || 0;
      const pt = priv.point != null && priv.comeout === false;
      const ctx = pt ? `Point is ${priv.point} — ` : '';
      hint.innerHTML = placed
        ? `${ctx}tap felt to add bets · tap <b>Ready</b> when set · ${placed} bet${placed>1?'s':''}`
        : `${ctx}tap a felt zone to bet · then tap <b>Ready</b>`;
    } else if (priv.phase === 'bets') {
      hint.textContent = 'Betting… (waiting on other players)';
    } else if (priv.phase === 'roll') {
      hint.textContent = 'Shooter is rolling…';
    } else {
      hint.textContent = '';
    }
    box.appendChild(hint);
  },
  scoreFor(v, seat) {
    return { score: (v.bankrolls && v.bankrolls[seat] != null) ? v.bankrolls[seat] : 0, sub: 'chips' };
  },
  scoreFootText: (v) => `Round ${v.round ?? '—'} · table runs until you leave`,
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>Most chips wins</b></div>
      <ul>
        <li><b>Pass</b> wins on a come-out 7 or 11, loses on 2/3/12. Any other number becomes the <b>point</b>.</li>
        <li>With a point set, <b>Pass</b> wins if the point rolls again before a 7.</li>
        <li><b>Don't pass</b> is the mirror bet.</li>
        <li><b>Field / Any 7 / Any craps / C&E</b> resolve every roll.</li>
        <li>One-roll number props: <b>Aces 2</b> (30:1), <b>Ace-Deuce 3</b> (15:1), <b>Yo 11</b> (15:1), <b>Boxcars 12</b> (30:1), and the <b>Horn</b> (split across 2·3·11·12).</li>
        <li><b>Hard 4/6/8/10</b> ride until they hit or seven-out; <b>Place 4/5/6/8/9/10</b> and <b>Big 6/8</b> ride until their number or a 7 rolls.</li>
        <li>Stack bets, tap <b>Ready</b>; the shooter taps the green <b>ROLL DICE</b> token. The table runs until you leave.</li>
      </ul>`;
  },
});
document.title = 'Craps · tiles.madladslab';



// ── Press / Pull prompt (riding place-bet wins) ─────────────────────────────
let _pressEl = null;
function ensurePressEl() {
  if (_pressEl) return _pressEl;
  _pressEl = panel({
    id: 'press-prompt', place: { left: '50%', bottom: '120px' }, center: true, z: 120,
    accent: '#e3c567', bg: 'rgba(6,12,9,.92)', radius: 16, pad: '14px 18px',
    minWidth: '240px', flexCol: true, display: 'flex',
  }).el;
  return _pressEl;
}
let _pressKey = '';
function renderPressPrompt(priv) {
  const list = (priv && priv.pressable) || [];
  const key = JSON.stringify(list.map((p) => [p.id, p.won]));
  if (key === _pressKey) return;     // no change
  _pressKey = key;
  const el = ensurePressEl();
  if (!list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = '';
  const title = document.createElement('div');
  title.style.cssText = 'color:#ffe9a8;font-weight:800;text-align:center;letter-spacing:.06em';
  title.textContent = list.length > 1 ? 'YOUR NUMBERS HIT!' : (betLabel(list[0].side).toUpperCase() + ' HIT!');
  el.appendChild(title);
  for (const p of list) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'color:#cfe7d8;font-size:14px;flex:1';
    lbl.textContent = betLabel(p.side) + ' won +' + p.won;
    const press = document.createElement('button');
    press.textContent = 'PRESS';
    press.style.cssText = 'background:#2f8f5b;color:#06210f;border:none;border-radius:9px;padding:8px 11px;font-weight:800;cursor:pointer';
    press.onclick = () => { C.emitAction({ type: 'press', id: p.id }); if (T.Sound) T.Sound.click && T.Sound.click(); };
    const takewin = document.createElement('button');
    takewin.textContent = 'TAKE WIN';
    takewin.style.cssText = 'background:#1d3b2b;color:#cfe7d8;border:none;border-radius:9px;padding:8px 11px;font-weight:800;cursor:pointer';
    takewin.onclick = () => { C.emitAction({ type: 'takewin', id: p.id }); if (T.Sound) T.Sound.click && T.Sound.click(); };
    const pull = document.createElement('button');
    pull.textContent = 'TAKE DOWN';
    pull.style.cssText = 'background:#243; color:#cfe7d8;border:1px solid #6f8478;border-radius:9px;padding:8px 11px;font-weight:800;cursor:pointer';
    pull.onclick = () => { C.emitAction({ type: 'pull', id: p.id }); if (T.Sound) T.Sound.click && T.Sound.click(); };
    row.appendChild(lbl); row.appendChild(press); row.appendChild(takewin); row.appendChild(pull);
    el.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#9fb0a6;font-size:11px;text-align:center';
  hint.textContent = 'PRESS rides it · TAKE WIN banks the win · TAKE DOWN returns your bet';
  el.appendChild(hint);
}

// ───────────────────────── tappable felt + chip stacks (craps) ─────────────────────────
// Felt plane 64x32, texture 2048x1024 (see felt3d.buildCrapsFelt). Every painted
// zone is tappable: PASS / DON'T PASS lines, FIELD, the PLACE row, BIG 6/8, and
// the center prop grid (hardways, single-number props, any-bets, horn).
const FELT_W = 64, FELT_H = 32, TEX_W = 2048, TEX_H = 1024;
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
const BAR = createBetBar({
  Sound: T.Sound,
  action: { label: 'Ready ▸', onClick: () => { C.emitAction({ type: 'done' }); } },
});
const AUDIO = createAudioBus({
  ttsBase: '/tts', voice: 'ryan',
  onMuteChange: (m) => { try { T.Sound.setMuted(m); } catch (e) {} },
});
try { AUDIO.setMuted(T.Sound.isMuted()); } catch (e) {}
AUDIO.buildMixer(document.getElementById('mutebtn'));
AUDIO.startBeds();
const DEALER = createDealerFx({ audio: AUDIO, every: 3, callFor: (b) => CRAPS_CALLS[b.side] });
function syncBetBar() {
  const p = C.priv || {};
  const legal = p.legal || [];
  const canBet = p.phase === 'bets' && legal.some((a) => a.type === 'bet');
  const canReady = p.phase === 'bets' && !!p.yourTurn && legal.some((a) => a.type === 'done');
  BAR.setVisible(!!(canBet || canReady));
  BAR.setActionVisible(!!canReady);
}

function worldToTex(point) {
  const lx = point.x - FELT.position.x;
  const lz = point.z - FELT.position.z;
  const u = (lx / FELT_W) + 0.5;
  const v = (lz / FELT_H) + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { px: u * TEX_W, py: v * TEX_H };
}

function texToWorld(px, py) {
  const u = px / TEX_W, v = py / TEX_H;
  const lx = (u - 0.5) * FELT_W, lz = (v - 0.5) * FELT_H;
  return { x: lx + FELT.position.x, z: lz + FELT.position.z };
}
// center px/py for a bet, from the shared CRAPS_LAYOUT (single source of truth)
function boxCenter(b) { return { px: b.x + b.w / 2, py: b.y + b.h / 2 }; }
function betToTex(bet) {
  const L = CRAPS_LAYOUT;
  const side = bet.side;
  if (side === 'field') return boxCenter(L.field);
  if (side === 'dontpass') return boxCenter(L.dontpass);
  if (side === 'pass') return boxCenter(L.pass);
  for (const group of [L.place, L.props, L.big]) {
    const hit = (group || []).find((b) => b.side === side);
    if (hit) return boxCenter(hit);
  }
  return null;
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
    // pile up: sum this seat's bets on the same zone into one growing stack
    const byZone = new Map();
    for (const bet of list) {
      const tex = betToTex(bet); if (!tex) continue;
      const cur = byZone.get(bet.side) || { tex, amount: 0 };
      cur.amount += (bet.amount || 0);
      byZone.set(bet.side, cur);
    }
    const ox = ((seat % 3) - 1) * 1.1;
    const oz = (Math.floor(seat / 3) - 0.5) * 1.1;
    for (const { tex, amount } of byZone.values()) {
      const w = texToWorld(tex.px, tex.py);
      dropStack(CHIPS, w.x + ox, w.z + oz, amount, { dur: 1, seatColor: seatColor(seat) });
    }
  }
}

function inBox(b, px, py) { return px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h; }
function zoneAt(px, py) {
  const L = CRAPS_LAYOUT;
  // point-number PLACE boxes (top row)
  for (const b of L.place) if (inBox(b, px, py)) return { side: b.side };
  // center PROP GRID (hardways, single-number props, any-bets + horn)
  for (const b of L.props) if (inBox(b, px, py)) return { side: b.side };
  // BIG 6 / BIG 8
  for (const b of (L.big || [])) if (inBox(b, px, py)) return { side: b.side };
  // line / field bands
  if (inBox(L.field, px, py)) return { side: 'field' };
  if (inBox(L.dontpass, px, py)) return { side: 'dontpass' };
  if (inBox(L.pass, px, py)) return { side: 'pass' };
  return null;
}
// The center prop/dice area — tapping here rolls (if shooter) or, during betting,
// finishes betting and rolls. felt3d draws the prop box around the center.
function isCenterArea(px, py) {
  return px >= 824 && px <= 1224 && py >= 482 && py <= 662;
}

function placeFeltBet(zone, worldPoint) {
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
  C.emitAction({ type: 'bet', side: zone.side, amount: BAR.getStake() });
  if (T.Sound) T.Sound.click && T.Sound.click();
}

function feltBetZones(clientX, clientY) {
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

  // BETS PHASE (incl. the point cycle): a felt tap places a bet.
  if (priv.phase === 'bets' && (priv.legal || []).some(a => a.type === 'bet')) {
    const feltHit = hits.find(h => h.object === FELT || (h.object.parent === FELT)) || hits[0];
    const tex = worldToTex(feltHit.point);
    if (tex) placeFeltBet(zoneAt(tex.px, tex.py), feltHit.point);
  }
}

let _lastRound = -1;
function clearChipsIfNewRound() {
  const v = (C.state && C.state.view) || {};
  if (v.round != null && v.round !== _lastRound) {
    _lastRound = v.round;
    _betsKey = '';
  }
}

// Tap-vs-drag: only a genuine tap (pointer down + up at ~same spot, quickly)
// places a bet. A drag — i.e. orbiting/panning the camera — must NOT bet.
let _tapStart = null;
const TAP_MOVE_PX = 10;     // max travel to still count as a tap
const TAP_MS = 500;         // max duration to still count as a tap
T.renderer.domElement.addEventListener('pointerdown', (e) => {
  _tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
}, false);
T.renderer.domElement.addEventListener('pointermove', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) return;
  const moved = Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y);
  if (moved > TAP_MOVE_PX) _tapStart = null;   // became a drag — cancel the tap
}, false);
T.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) { _tapStart = null; return; }
  const moved = Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y);
  const dt = performance.now() - _tapStart.t;
  const wasTap = moved <= TAP_MOVE_PX && dt <= TAP_MS;
  _tapStart = null;
  if (wasTap) feltBetZones(e.clientX, e.clientY);
}, false);
T.renderer.domElement.addEventListener('pointercancel', () => { _tapStart = null; }, false);
T.onFrame((now) => {
  clearChipsIfNewRound();
  const d = ROLLPROMPT.children[0];
  if (d) { const p = 1 + Math.sin((now||0)/260) * 0.06; d.scale.setScalar(p); }
});
