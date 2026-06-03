/**
 * baccarat3d.js — Baccarat (punto banco) on the shared 3D table.
 *
 * Everyone bets the same hand. Pick a chip, tap a felt zone: PLAYER / BANKER /
 * TIE, the P-PAIR / B-PAIR side spots, the DEALER toke, or TIP. Hit Ready and the
 * dealer tosses each card in — a tumbling, physics-style throw that lands face-
 * down on a natural askew stack — then flips it; the last card holds a beat, the
 * winning zone pulses, the winning hand celebrates, and the result lands.
 */
import { createTable3D } from './table3d.js?v=1780540000000';
import { createTableClient } from './tableclient3d.js?v=1780348653535';
import { createHUD } from './hud3d.js?v=1780348653535';
import { buildCard, CARD_W } from './card3d.js?v=1780348653535';
import { dropStack } from './chip3d.js?v=1780348653535';
import { showResult, renderHistory, makeDeltaTracker, setWallet } from './casino-fx.js?v=1780490000000';
import { createBetBar } from './betbar.js?v=1780510000000';
import { createAudioBus } from './audiobus.js?v=1780540000000';
import { createDealerFx } from './dealerfx.js?v=1780413600000';
import { createChipBurst } from './chipburst.js?v=1780520000000';

const T = createTable3D({
  tableRadius: 32, feltColor: 0x0b4a6a, bgScene: 'baccarat',
  cameraStart: { x: 0, y: 50, z: 64 }, cameraTarget: { x: 0, y: 1, z: 3 },
});
T.setCamera({ maxDistance: 260 });
const THREE = T.THREE;
const _delta = makeDeltaTracker();
const _hist = [];

const ZONE_COLOR = { player: 0x5ab0ff, banker: 0xff8f6b, tie: 0x6be08a, ppair: 0x9fd9ff, bpair: 0xffc59e, dealer: 0xe3c567, tip: 0xd8b6ff };
// felt layout (z<0 = dealer side / north, z>0 = toward you / south)
const PLAYER_CARDS = { x: -7.5, z: -3.5 }, BANKER_CARDS = { x: 7.5, z: -3.5 };
const SHOE_ORIGIN = { x: 0, y: 0.5, z: -12.5 };
const ZONES = [
  { spot: 'ppair',  label: 'P PAIR', x: -10.5, z: 1.5,  w: 5.5, h: 3 },
  { spot: 'bpair',  label: 'B PAIR', x: 10.5,  z: 1.5,  w: 5.5, h: 3 },
  { spot: 'player', label: 'PLAYER', x: -10.5, z: 7.5,  w: 8.5, h: 5, big: true },
  { spot: 'tie',    label: 'TIE 8:1', x: 0,    z: 7.0,  w: 6.5, h: 4 },
  { spot: 'banker', label: 'BANKER', x: 10.5,  z: 7.5,  w: 8.5, h: 5, big: true },
  { spot: 'dealer', label: 'DEALER', x: -4,    z: 13.5, w: 5,   h: 3 },
  { spot: 'tip',    label: 'TIP',    x: 4,     z: 13.5, w: 5,   h: 3 },
];

const CARDS = new THREE.Group(); T.scene.add(CARDS);
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
const ZGROUP = new THREE.Group(); T.scene.add(ZGROUP);
const SHUF = new THREE.Group(); T.scene.add(SHUF);
const BURST = createChipBurst(T);   // shared gold chip-burst (SD gold skin)

const _anims = [];
function tween(dur, apply, onDone) { _anims.push({ t0: performance.now(), dur, apply, onDone }); apply(0); }
function clearGroup(g) { for (const m of g.children.slice()) g.remove(m); }

// ── printed betting zones ───────────────────────────────────────────────────
function zoneLabel(text, cx, cz, colorHex, px, w) {
  const S = 256, cvs = document.createElement('canvas'); cvs.width = S; cvs.height = 128;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, S, 128);
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0'); c.globalAlpha = 0.95;
  c.font = `bold ${px}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, S / 2, 64);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.06, cz); m.renderOrder = 845; return m;
}
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
let _zoneTargets = [], _zoneFx = {};
function buildZones() {
  clearGroup(ZGROUP); _zoneTargets = []; _zoneFx = {};
  for (const z of ZONES) {
    const col = ZONE_COLOR[z.spot];
    const shape = roundedRectShape(z.w, z.h, 0.8);
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(z.x, 0.04, z.z); fill.renderOrder = 818; ZGROUP.add(fill);
    const pts = shape.getPoints(48).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
    line.position.set(z.x, 0.05, z.z); line.renderOrder = 820; ZGROUP.add(line);
    ZGROUP.add(zoneLabel(z.label, z.x, z.z + z.h / 2 - 0.85, col, z.big ? 46 : 32, z.w));
    const hit = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ visible: false }));
    hit.rotation.x = -Math.PI / 2; hit.position.set(z.x, 0.03, z.z); hit.userData.spot = z.spot; ZGROUP.add(hit); _zoneTargets.push(hit);
    _zoneFx[z.spot] = { fill, line };
  }
}
function pulseZone(spot) {
  const fx = _zoneFx[spot]; if (!fx) return;
  let cyc = 0;
  const one = () => tween(520, (e) => { const k = Math.sin(Math.PI * e); fx.line.material.opacity = 0.7 + 0.3 * k; fx.fill.material.opacity = 0.1 + 0.42 * k; },
    () => { fx.line.material.opacity = 0.7; fx.fill.material.opacity = 0.1; if (++cyc < 2) one(); });
  one();
}
// 3D celebration on the winning hand: staggered expanding rings, a soft glow
// disc, the winning cards lift + tumble (win) or dip (loss), and on a win a
// ballistic chip burst rains over the felt.
function winnerFx(side, kind) {
  const color = kind === 'win' ? 0x43e08a : (kind === 'loss' ? 0xff6f52 : 0xe3c567);
  const base = side === 'player' ? PLAYER_CARDS : (side === 'banker' ? BANKER_CARDS : { x: 0, z: -4 });
  const rings = kind === 'win' ? 3 : 1;
  for (let r = 0; r < rings; r++) RT(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.5, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(base.x, 0.08, base.z); ring.renderOrder = 860; T.scene.add(ring);
    tween(900, (e) => { const sc = 1 + e * 5; ring.scale.set(sc, sc, sc); ring.material.opacity = 0.85 * (1 - e); }, () => T.scene.remove(ring));
  }, r * 150);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(base.x, 0.07, base.z); glow.renderOrder = 855; T.scene.add(glow);
  tween(820, (e) => { glow.material.opacity = 0.42 * Math.sin(Math.PI * e); }, () => T.scene.remove(glow));
  const sides = side === 'tie' ? ['player', 'banker'] : [side];
  for (const m of CARDS.children) if (m.userData && sides.includes(m.userData.side)) {
    const y0 = m.position.y, rz0 = m.rotation.z;
    if (kind === 'win') tween(780, (e) => { m.position.y = y0 + Math.sin(Math.PI * e) * 2.4; m.rotation.z = rz0 + Math.sin(Math.PI * e * 2) * 0.25; }, () => { m.position.y = y0; m.rotation.z = rz0; });
    else tween(420, (e) => { m.position.y = y0 + Math.sin(Math.PI * e) * 0.5; }, () => { m.position.y = y0; });
  }
  if (kind === 'win') BURST.spawn(base.x, base.z, { n: 18 });
  else if (kind === 'tie') BURST.spawn(base.x, base.z, { n: 8 });
}

// ── paced reveal: tumbling toss face-down, flip; last card holds a beat ─────
const REVEAL_STEP = 520;
let _revealRound = -1, _pending = null, _fallback = null, _revTimers = [];
let _lastResultAt = 0; const RESULT_HOLD = 1300;   // keep the dealt hand on the felt a beat before the next deal wipes it
let _revealing = false;   // while a hand is revealing, DON'T touch the wallet (it would spoil the result)
function RT(fn, ms) { const id = setTimeout(fn, ms); _revTimers.push(id); return id; }
function cancelReveal() { _revTimers.forEach(clearTimeout); _revTimers = []; }
// physics-style toss: a ballistic arc with a tumble (forward axis flip + a little
// flat spin), landing face-down on a slightly askew stack for a natural feel.
function dealCard(side, code, idx, onLand) {
  const base = side === 'player' ? PLAYER_CARDS : BANKER_CARDS;
  const jx = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.5, jrot = (Math.random() - 0.5) * 0.22;
  const tx = base.x + idx * (CARD_W * 0.64) + jx, tz = base.z + jz, ty = 0.18 + idx * 0.06;
  const m = buildCard(code); m.userData.side = side; m.userData.rest = { y: jrot };
  const sx = SHOE_ORIGIN.x, sy = SHOE_ORIGIN.y + 0.4, sz = SHOE_ORIGIN.z;
  m.position.set(sx, sy, sz);
  const x0 = Math.PI * 2 * 2 + Math.PI;              // 2 forward tumbles (axis flip), ends face-down
  const y0 = (Math.random() - 0.5) * Math.PI * 1.2;  // a little flat-spin
  const z0 = (Math.random() - 0.5) * 0.7;
  m.rotation.set(x0, y0, z0);
  CARDS.add(m);
  if (T.Sound && T.Sound.deal) T.Sound.deal();
  const peak = 4.2 + idx * 0.2;
  tween(520, (e) => {
    m.position.x = sx + (tx - sx) * e; m.position.z = sz + (tz - sz) * e;
    m.position.y = (sy + (ty - sy) * e) + Math.sin(Math.PI * e) * peak;
    m.rotation.x = Math.PI + (x0 - Math.PI) * (1 - e);   // tumble down to face-down
    m.rotation.y = jrot + (y0 - jrot) * (1 - e);
    m.rotation.z = z0 * (1 - e);
  }, () => {
    m.position.set(tx, ty, tz); m.rotation.set(Math.PI, jrot, 0);
    tween(170, (e2) => { m.position.y = ty + Math.sin(Math.PI * e2) * 0.5; }, () => { m.position.y = ty; });
    if (onLand) onLand(m);
  });
}
function flipCard(m, onDone) {
  if (T.Sound && T.Sound.click) T.Sound.click();
  const y0 = m.position.y, ry = (m.userData.rest && m.userData.rest.y) || 0;
  tween(380, (e) => { m.rotation.x = Math.PI * (1 - e); m.position.y = y0 + Math.sin(Math.PI * e) * 0.9; },
    () => { m.rotation.x = 0; m.rotation.y = ry; m.position.y = y0; if (onDone) onDone(); });
}
function startReveal(ev) {
  const go = () => {
    _revealRound = ev.round; clearGroup(CARDS); clearGroup(CHIPS);
    const p = ev.playerCards || [], b = ev.bankerCards || [], n = Math.max(p.length, b.length), steps = [];
    for (let i = 0; i < n; i++) { if (p[i]) steps.push({ side: 'player', code: p[i], idx: i }); if (b[i]) steps.push({ side: 'banker', code: b[i], idx: i }); }
    steps.forEach((s, k) => { s.last = (k === steps.length - 1); });
    runReveal(steps, 0);
  };
  cancelReveal();
  const wait = Math.max(0, RESULT_HOLD - (performance.now() - _lastResultAt));
  if (wait > 0) RT(go, wait); else go();
}
function runReveal(steps, k) {
  if (k >= steps.length) return;
  const s = steps[k], last = s.last;
  dealCard(s.side, s.code, s.idx, (mesh) => {
    if (last) RT(() => flipCard(mesh, () => RT(finishReveal, 560)), 680);   // land · beat · flip · beat · result
    else flipCard(mesh);
  });
  if (!last) RT(() => runReveal(steps, k + 1), REVEAL_STEP);
}
function finishReveal() {
  if (!_pending) return;
  const R = _pending; _pending = null;
  if (_fallback) { clearTimeout(_fallback); _fallback = null; }
  if (R.outcomeSpot) { pulseZone(R.outcomeSpot); winnerFx(R.outcomeSpot, R.d > 0 ? 'win' : (R.d < 0 ? 'loss' : 'push')); }
  if (R.d > 0) { try { T.Sound.coin && T.Sound.coin(); if (R.d >= 100) AUDIO.applause(); } catch (e) {} }
  RT(() => fireResult(R), 280);
}
function fireResult(R) {
  _lastResultAt = performance.now();
  _revealing = false;
  if (T.Sound && T.Sound.trick) T.Sound.trick();
  showResult(R.payload);
  if (R.d > 0) DEALER.bigWin(R.call); else DEALER.onRoll(R.call);
  _hist.push(R.hist); renderHistory(_hist);
}
function playShuffle() {
  clearGroup(SHUF);
  const N = 10, cx = 0, cz = SHOE_ORIGIN.z, backs = [];
  for (let k = 0; k < N; k++) { const m = buildCard(null); m.position.set(cx, 0.2 + k * 0.05, cz); SHUF.add(m); backs.push(m); }
  tween(1100, (e) => { backs.forEach((m, k) => { const half = (k % 2 === 0) ? -1 : 1; m.position.x = cx + half * 3 * Math.sin(e * Math.PI); m.position.y = 0.2 + k * 0.05 + Math.sin(e * Math.PI) * 2; }); }, () => clearGroup(SHUF));
}

const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { HUD.render(); syncBetBar(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

function myChips() {
  const s = C.state; if (!s) return null; const v = s.view || {};
  if (v.bankrolls && typeof v.bankrolls[C.mySeat] === 'number') return v.bankrolls[C.mySeat];
  const me = (s.seats || [])[C.mySeat]; return me && typeof me.chips === 'number' ? me.chips : null;
}
let _builtZones = false;
function onState(s) {
  const v = s.view || {};
  if (!_builtZones && (v.pool || v.phase)) { buildZones(); _builtZones = true; }
  if (s.phase !== 'lobby' && v.phase === 'bets') renderChips(v);
  if (s.phase === 'lobby') { clearGroup(CARDS); clearGroup(CHIPS); _revealRound = -1; }
  const _wb = myChips(); if (_wb != null && !_revealing) setWallet(_wb);
  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }
  syncBetBar(); HUD.render(); HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}
function renderChips(v) {
  clearGroup(CHIPS);
  const pool = v.pool || {}, mine = (C.priv && C.priv.bets) || {};
  for (const z of ZONES) {
    const amt = pool[z.spot] || 0;
    if (amt > 0) dropStack(CHIPS, z.x, z.z, amt, { dur: 1, seatColor: ZONE_COLOR[z.spot] });
    if ((mine[z.spot] || 0) > 0) CHIPS.add(zoneLabel('you ' + mine[z.spot], z.x, z.z - z.h / 2 + 0.7, 0xffffff, 24, z.w * 0.8));
  }
}

const SAY = { player: 'Player wins!', banker: 'Banker wins!', tie: 'Tie!' };
function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'shuffle') playShuffle();
  if (ev.type === 'persona' && ev.text) toast('💬 ' + ev.name + ': ' + ev.text);
  if (ev.type === 'settle') {
    _revealing = true;
    const newBal = (Array.isArray(ev.bankrolls) && C.mySeat != null && typeof ev.bankrolls[C.mySeat] === 'number') ? ev.bankrolls[C.mySeat] : myChips();
    let d = (Array.isArray(ev.deltas) && C.mySeat != null && typeof ev.deltas[C.mySeat] === 'number') ? ev.deltas[C.mySeat] : _delta.delta(newBal);
    if (newBal != null) _delta.prime(newBal);
    const oc = ev.outcome;
    const title = oc === 'player' ? 'PLAYER' : (oc === 'banker' ? 'BANKER' : 'TIE');
    const sub = `Player ${ev.playerTotal} · Banker ${ev.bankerTotal}` + (ev.pPair ? ' · P pair' : '') + (ev.bPair ? ' · B pair' : '');
    const mine = (Array.isArray(ev.breakdown) ? ev.breakdown : []).filter((b) => b.seat === C.mySeat).map((b) => ({ label: b.spot, delta: b.delta, note: b.note }));
    _pending = {
      payload: { title, titleColor: (oc === 'banker' ? 'red' : (oc === 'player' ? 'green' : null)), sub, delta: d, balance: newBal, breakdown: mine },
      call: SAY[oc] || 'Result', d, outcomeSpot: oc,
      hist: { label: oc === 'player' ? 'P' : (oc === 'banker' ? 'B' : 'T'), color: (oc === 'tie' ? 'gold' : (oc === 'banker' ? 'red' : 'green')), tip: `${ev.recap || sub} · you ${d > 0 ? '+' + d : d}` },
    };
    startReveal(ev);
    if (_fallback) clearTimeout(_fallback);
    _fallback = setTimeout(() => { if (_pending) { const R = _pending; _pending = null; fireResult(R); } }, 9000);
  }
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

let _tEl = null, _tT = null;
function toast(text) {
  if (!_tEl) { _tEl = document.createElement('div'); _tEl.style.cssText = 'position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:7;pointer-events:none;font:800 16px system-ui;padding:8px 15px;border-radius:11px;opacity:0;transition:opacity .25s;background:rgba(10,30,44,.92);color:#bfe0ff;border:1px solid #2a5a72'; document.body.appendChild(_tEl); }
  _tEl.textContent = text; _tEl.style.opacity = '1'; if (_tT) clearTimeout(_tT); _tT = setTimeout(() => { if (_tEl) _tEl.style.opacity = '0'; }, 2200);
}

// ── bet bar + audio ─────────────────────────────────────────────────────────
const BAR = createBetBar({ Sound: T.Sound, action: { label: 'Ready ▸', onClick: () => { const p = C.priv || {}; if (p.phase !== 'bets' || p.locked) return; C.emitAction({ type: 'done' }); } } });
const AUDIO = createAudioBus({ ttsBase: '/tts', voice: 'ryan', onMuteChange: (m) => { try { T.Sound.setMuted(m); } catch (e) {} } });
try { AUDIO.setMuted(T.Sound.isMuted()); } catch (e) {}
AUDIO.buildMixer(document.getElementById('mutebtn')); AUDIO.startBeds();
const DEALER = createDealerFx({ audio: AUDIO, callFor: () => null });
const _camhint = document.getElementById('camhint'); if (_camhint) _camhint.style.display = 'none';

function syncBetBar() {
  const p = C.priv || {};
  const betting = p.phase === 'bets' && !p.locked && p.bankroll > 0;
  const hasBet = (p.reserved || 0) > 0;
  BAR.setVisible(!!betting); BAR.setActionVisible(!!betting);
  BAR.armMeter && BAR.armMeter(betting && hasBet);
}
function placeBet(spot) {
  const p = C.priv || {};
  if (p.phase !== 'bets' || p.locked) return;
  const amount = BAR.getStake(); if (!amount) return;
  C.emitAction({ type: 'bet', spot, amount });
  BAR.kick && BAR.kick();
  if (T.Sound) (T.Sound.chip ? T.Sound.chip() : (T.Sound.click && T.Sound.click()));
}

const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'BACCARAT', lowerWins: false, scoreLabel: 'Most chips wins',
  onResetCam: () => T.resetCamera(),
  statusLine(v) {
    if (v.phase === 'bets') return (C.priv && C.priv.locked) ? 'Waiting for the deal…' : '<b>Place your bets</b>';
    return 'Dealing…';
  },
  renderActions() { /* intentionally empty — the bottom bar carries the controls */ },
  scoreFor(v, seat) { return { score: (v.bankrolls && v.bankrolls[seat] != null) ? v.bankrolls[seat] : 0, sub: 'chips' }; },
  scoreFootText: (v) => `Hand ${v.round ?? '—'} · dealer pool ${v.dealerPool ?? 0} · table runs until you leave`,
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>Bet which hand hits closest to 9</b></div>
      <ul>
        <li><b>PLAYER</b> pays 1:1 · <b>BANKER</b> pays 0.95:1 (5% commission) · <b>TIE</b> pays 8:1 (Player/Banker push on a tie).</li>
        <li><b>P PAIR / B PAIR</b> 11:1 — that side's first two cards are a pair.</li>
        <li>Cards: A=1, 2–9 face value, 10/J/Q/K=0. Hand total is the ones digit; third cards follow fixed rules (no decisions).</li>
        <li><b>DEALER</b> is a toke bet for the dealer on Banker; <b>TIP</b> is a flat gift — both feed the dealer pool.</li>
        <li>Everyone bets the same hand. The table runs until you leave.</li>
      </ul>`;
  },
});
document.title = 'Baccarat · tiles.madladslab';

// ── tap-to-place (tap-vs-drag) ──────────────────────────────────────────────
let _tap = null; const TAP_MOVE_PX = 10, TAP_MS = 500;
T.renderer.domElement.addEventListener('pointerdown', (e) => { _tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; }, false);
T.renderer.domElement.addEventListener('pointermove', (e) => { if (_tap && e.pointerId === _tap.id && Math.hypot(e.clientX - _tap.x, e.clientY - _tap.y) > TAP_MOVE_PX) _tap = null; }, false);
T.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_tap || e.pointerId !== _tap.id) { _tap = null; return; }
  const moved = Math.hypot(e.clientX - _tap.x, e.clientY - _tap.y), dt = performance.now() - _tap.t, wasTap = moved <= TAP_MOVE_PX && dt <= TAP_MS;
  _tap = null; if (!wasTap) return;
  const p = C.priv || {}; if (p.phase !== 'bets' || p.locked || !_zoneTargets.length) return;
  const hits = T.raycast(e.clientX, e.clientY, _zoneTargets);
  if (hits.length && hits[0].object && hits[0].object.userData.spot) placeBet(hits[0].object.userData.spot);
}, false);
T.renderer.domElement.addEventListener('pointercancel', () => { _tap = null; }, false);

T.onFrame(() => {
  const now = performance.now();
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i]; let pr = (now - a.t0) / a.dur; if (pr < 0) pr = 0; const done = pr >= 1; if (done) pr = 1;
    a.apply(1 - Math.pow(1 - pr, 3)); if (done) { _anims.splice(i, 1); if (a.onDone) a.onDone(); }
  }
});
