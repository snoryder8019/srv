/**
 * blackjack3d.js — Blackjack (BOX model) on the shared 3D table.
 *
 * 7 betting circles printed on a half-moon felt. Pick a chip, tap a circle to
 * claim + stake that BOX (you can claim several — multi-hand). 21+3 and PAIRS
 * sit beside each box. Boxes play left\u2192right; the owner hits/stands/doubles/
 * splits, then the dealer plays once and every box settles to its owner.
 */
import { createTable3D } from './table3d.js?v=1781441125092';
import { createTableClient } from './tableclient3d.js?v=1781441125092';
import { createHUD } from './hud3d.js?v=1781441125092';
import { buildCard, CARD_W, CARD_H, CARD_T } from './card3d.js?v=1781441125092';
import { dropStack, seatColor } from './chip3d.js?v=1781441125092';
import { showResult, renderHistory, makeDeltaTracker } from './casino-fx.js?v=1781441125092';
import { createBetBar } from './betbar.js?v=1781441125092';
import { createChipBurst } from './chipburst.js?v=1781441125092';
import { createAudioBus } from 'https://games.madladslab.com/shared/js/audiobus.js';
import { createDealerFx } from './dealerfx.js?v=1781441125092';

const T = createTable3D({
  tableRadius: 34, feltColor: 0x0e5c3a,
  bgScene: 'blackjack',
  cameraStart: { x: 0, y: 54, z: 72 },
  cameraTarget: { x: 0, y: 1, z: 3 },
});
T.setCamera({ maxDistance: 280 });
const THREE = T.THREE;
const _delta = makeDeltaTracker();
const _hist = [];
const BURST = createChipBurst(T);   // shared gold win burst
const SIDE_COLOR = { '21+3': 0x7fd3ff, pairs: 0xff9ed1 };

// ── half-moon box geometry ──────────────────────────────────────────────────
const DEALER_Z = -13, ARC_R = 31, SPAN = 62 * Math.PI / 180;
let NBOX = 7;
function boxAnchor(i, n) {
  const a = -SPAN + (n > 1 ? (i / (n - 1)) : 0.5) * 2 * SPAN;
  return { x: Math.sin(a) * ARC_R, z: DEALER_Z + Math.cos(a) * ARC_R, a };
}
function boxGeom(i, n) {
  const A = boxAnchor(i, n);
  const dx = -A.x, dz = DEALER_Z - A.z, dl = Math.hypot(dx, dz) || 1;
  const inx = dx / dl, inz = dz / dl;          // unit toward dealer
  return { A, inx, inz, px: -inz, pz: inx, yaw: Math.atan2(inx, inz) };
}
// side-bet spots sit NORTH of the main circle at 10 o'clock (21+3) and 2 o'clock
// (pairs) — up toward the dealer and out, so adjacent boxes don't crowd.
function sideSpots(g) {
  const A = g.A, RR = 3.8, C = 0.9, Sx = 0.42;   // pulled north of the main circle, tighter together
  return {
    three: { x: A.x + (g.inx * C - g.px * Sx) * RR, z: A.z + (g.inz * C - g.pz * Sx) * RR },
    pair:  { x: A.x + (g.inx * C + g.px * Sx) * RR, z: A.z + (g.inz * C + g.pz * Sx) * RR },
  };
}

// felt flavor
(function feltText() {
  const S = 1024, cvs = document.createElement('canvas'); cvs.width = S; cvs.height = 256;
  const c = cvs.getContext('2d');
  c.fillStyle = 'rgba(255,233,168,.8)'; c.font = 'bold 70px Georgia,serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('BLACKJACK  PAYS  3  TO  2', S / 2, 110);
  c.font = '600 34px Georgia,serif'; c.fillStyle = 'rgba(207,231,216,.55)';
  c.fillText('Dealer must stand on 17 · Insurance pays 2 to 1', S / 2, 180);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.04, DEALER_Z + 5); T.scene.add(m);
})();

const CARDS = new THREE.Group(); T.scene.add(CARDS);
const DCARDS = new THREE.Group(); T.scene.add(DCARDS);
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
const CIRCLES = new THREE.Group(); T.scene.add(CIRCLES);
const LABELS = new THREE.Group(); T.scene.add(LABELS);
const SHUF = new THREE.Group(); T.scene.add(SHUF);
const SPREAD = CARD_W * 0.7;

// ── tween engine ────────────────────────────────────────────────────────────
const _anims = [];
function tween(dur, apply, onDone) { _anims.push({ t0: performance.now(), dur, apply, onDone }); apply(0); }
function clearGroup(g) { for (const m of g.children.slice()) g.remove(m); }
function rankOf(code) { return code ? code.slice(0, -1) : ''; }

// ── printed circles on the felt ─────────────────────────────────────────────
function feltCircle(cx, cz, rIn, rOut, colorHex, opacity) {
  const m = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 56),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.05, cz); m.renderOrder = 820; return m;
}
function feltLabel(text, cx, cz, colorHex, px, wpx) {
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, S, S);
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0'); c.globalAlpha = 0.8;
  c.font = `bold ${px}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, S / 2, S / 2);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wpx, wpx), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.06, cz); m.renderOrder = 845; return m;
}
let _boxTargets = [];
function buildCircles(n) {
  clearGroup(CIRCLES); _boxTargets = [];
  for (let i = 0; i < n; i++) {
    const g = boxGeom(i, n), A = g.A;
    // main bet circle
    CIRCLES.add(feltCircle(A.x, A.z, 2.5, 2.9, 0xead9a0, 0.55));
    CIRCLES.add(feltLabel('BET', A.x, A.z, 0xead9a0, 30, 3.4));
    // side spots flanking, toward the dealer a touch
    const ss = sideSpots(g); const s3 = ss.three, sp = ss.pair;
    CIRCLES.add(feltCircle(s3.x, s3.z, 1.2, 1.5, SIDE_COLOR['21+3'], 0.5));
    CIRCLES.add(feltLabel('21+3', s3.x, s3.z, SIDE_COLOR['21+3'], 20, 2.0));
    CIRCLES.add(feltCircle(sp.x, sp.z, 1.2, 1.5, SIDE_COLOR.pairs, 0.5));
    CIRCLES.add(feltLabel('PR', sp.x, sp.z, SIDE_COLOR.pairs, 22, 1.7));
    // invisible hit discs
    const mk = (cx, cz, r, kind) => { const h = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ visible: false })); h.rotation.x = -Math.PI / 2; h.position.set(cx, 0.04, cz); h.userData.bet = { box: i, kind }; CIRCLES.add(h); _boxTargets.push(h); };
    mk(A.x, A.z, 3.0, 'main'); mk(s3.x, s3.z, 1.7, '21+3'); mk(sp.x, sp.z, 1.7, 'pairs');
  }
  // dealer TOKE (a bet FOR the dealer that rides with your hand) + TIP (flat gift),
  // laid toward the dealer between the dealer and the boxes. Engine accepts
  // {type:'bet', side:'dealer'|'tip'} from any seated, solvent player.
  {
    const dz = DEALER_Z + 11;
    const ds = [{ x: -5, z: dz, side: 'dealer', label: 'TOKE' }, { x: 5, z: dz, side: 'tip', label: 'TIP' }];
    for (const sp of ds) {
      CIRCLES.add(feltCircle(sp.x, sp.z, 1.15, 1.45, 0xe3c567, 0.5));
      CIRCLES.add(feltLabel(sp.label, sp.x, sp.z, 0xe3c567, 20, 1.9));
      const hd = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), new THREE.MeshBasicMaterial({ visible: false }));
      hd.rotation.x = -Math.PI / 2; hd.position.set(sp.x, 0.04, sp.z); hd.userData.bet = { dealer: true, side: sp.side };
      CIRCLES.add(hd); _boxTargets.push(hd);
    }
  }
}

// ── dealer cards: paced reveal (flip + draws don't burst) ───────────────────
const DEALER_STEP_MS = 800;
let _dealerRound = -1, _dealerShown = [], _dealerMeshes = [], _dealerTarget = [], _dealerPhase = '', _pumpT = null;
function dealerPos(i) { return { x: -4 + i * SPREAD, y: 0.18 + i * 0.03, z: DEALER_Z + 6 + i * 0.5 }; }  // +6 = nudged south for visibility
function addDealerCard(i, code, draw) {
  const m = buildCard(code); const p = dealerPos(i); m.position.set(p.x, p.y, p.z); DCARDS.add(m); _dealerMeshes[i] = m;
  if (draw) { tween(300, (e) => { m.position.y = p.y + 3 * (1 - e); }); if (T.Sound) T.Sound.deal && T.Sound.deal(); }
}
function addDealerBack(i) { const m = buildCard(null); const p = dealerPos(i); m.position.set(p.x, p.y, p.z); DCARDS.add(m); _dealerMeshes[i] = m; }
function flipDealerHole(i, code) {
  const old = _dealerMeshes[i]; if (old) DCARDS.remove(old);
  const m = buildCard(code); const p = dealerPos(i); m.position.set(p.x, p.y, p.z); m.rotation.x = Math.PI; DCARDS.add(m); _dealerMeshes[i] = m;
  tween(620, (e) => { m.rotation.x = Math.PI * (1 - e); m.position.y = p.y + Math.sin(e * Math.PI) * 1.3; });
  if (T.Sound) T.Sound.deal && T.Sound.deal();
}
function nextDealerChange() {
  for (let i = 0; i < _dealerTarget.length; i++) {
    const want = _dealerTarget[i], have = _dealerShown[i];
    if (have === undefined) return { i, kind: want ? 'add' : 'back', code: want };
    if (have === null && want) return { i, kind: 'flip', code: want };
  }
  return null;
}
function pumpDealer() {
  _pumpT = null;
  const ch = nextDealerChange();
  if (!ch) { maybeFireResult(); return; }
  if (ch.kind === 'back') { addDealerBack(ch.i); _dealerShown[ch.i] = null; }
  else if (ch.kind === 'flip') { flipDealerHole(ch.i, ch.code); _dealerShown[ch.i] = ch.code; }
  else { addDealerCard(ch.i, ch.code, ch.i >= 2 && _dealerPhase === 'dealer'); _dealerShown[ch.i] = ch.code; }
  if (nextDealerChange()) _pumpT = setTimeout(pumpDealer, _dealerPhase === 'dealer' ? DEALER_STEP_MS : 110);
  else maybeFireResult();
}
function renderDealer(v) {
  const cards = (v.dealer && v.dealer.cards) || [];
  const round = v.round || 0;
  if (round !== _dealerRound) { _dealerRound = round; _dealerShown = []; _dealerMeshes = []; clearGroup(DCARDS); if (_pumpT) { clearTimeout(_pumpT); _pumpT = null; } }
  _dealerTarget = cards; _dealerPhase = v.phase;
  if (!_pumpT) pumpDealer();
}

// ── result held until the dealer finishes revealing ─────────────────────────
let _pendingResult = null, _resultFallback = null;
let _pendingSide = { delta: 0, rows: [] };   // 21+3 / pairs result, folded into the next settle
function maybeFireResult() {
  if (!_pendingResult || nextDealerChange()) return;
  const R = _pendingResult; _pendingResult = null;
  if (_resultFallback) { clearTimeout(_resultFallback); _resultFallback = null; }
  setTimeout(() => fireResult(R), 400);
}
function fireResult(R) {
  if (T.Sound) T.Sound.trick && T.Sound.trick();
  showResult(R.payload);
  if (R.d > 0 && (R.bj || R.d >= 50)) DEALER.bigWin(R.call); else DEALER.onRoll(R.call);
  if (R.d > 0) { const pts = R.burstAt || [{ x: 0, z: DEALER_Z + 18 }]; const each = R.bj ? 18 : 13; for (const q of pts) BURST.spawn(q.x, q.z, { n: each }); try { T.Sound.coin && T.Sound.coin(); if (R.d >= 100) AUDIO.applause(); } catch (e) {} }
  _hist.push(R.hist); renderHistory(_hist);
}

// ── per-box render: chips, cards, labels, active highlight ──────────────────
function ownerName(i) {
  const v = C.state && C.state.view; if (!v) return '';
  const owner = v.boxes && v.boxes[i] && v.boxes[i].owner;
  if (owner == null) return '';
  const seat = C.state.seats && C.state.seats[owner];
  return seat ? (seat.displayName || ('P' + owner)) : ('P' + owner);
}
function placeBoxCards(codes, g, clusterOff) {
  const n = codes.length, cx = g.A.x + g.inx * 4.6 + g.px * clusterOff, cz = g.A.z + g.inz * 4.6 + g.pz * clusterOff;
  codes.forEach((code, k) => {
    const off = (k - (n - 1) / 2) * (CARD_W * 0.5);
    const m = buildCard(code);
    m.position.set(cx + g.px * off, 0.18 + k * 0.03, cz + g.pz * off);
    m.rotation.y = g.yaw;
    CARDS.add(m);
  });
}
function boxTotalLabel(text, g, colorHex) {
  const cx = g.A.x - g.inx * 4.2, cz = g.A.z - g.inz * 4.2;
  LABELS.add(feltLabel(text, cx, cz, colorHex, 34, 4.2));
}
let _renderKey = '';
function renderBoxes(v) {
  const key = (v.round || 0) + '|' + v.phase + '|' + (C.mySeat) + '|' + JSON.stringify((v.boxes || []).map((b) => [b.owner, b.bet, b.side, b.hands.map((h) => [h.cards, h.done, h.doubled]), b.active])) + '|' + v.turn + '|' + ((C.priv && C.priv.myToke) || 0) + '|' + ((C.priv && C.priv.myTip) || 0) + '|' + (v.dealerPool || 0);
  if (key === _renderKey) return;
  _renderKey = key;
  clearGroup(CHIPS); clearGroup(CARDS); clearGroup(LABELS);
  // your own TOKE/TIP stacks + the shared dealer pool
  { const dz = DEALER_Z + 11;
    const myToke = (C.priv && C.priv.myToke) || 0, myTip = (C.priv && C.priv.myTip) || 0;
    if (myToke > 0) dropStack(CHIPS, -5, dz, myToke, { dur: 1, seatColor: 0xe3c567 });
    if (myTip > 0) dropStack(CHIPS, 5, dz, myTip, { dur: 1, seatColor: 0xe3c567 });
    if ((v.dealerPool || 0) > 0) LABELS.add(feltLabel('DEALER POOL  ' + v.dealerPool, 0, DEALER_Z + 2.5, 0xe3c567, 24, 9));
  }
  const n = (v.boxes || []).length || NBOX;
  (v.boxes || []).forEach((b, i) => {
    const g = boxGeom(i, n);
    // chips on the circles
    if (b.bet > 0) dropStack(CHIPS, g.A.x, g.A.z, b.bet, { dur: 1, seatColor: b.owner != null ? seatColor(b.owner) : 0xead9a0 });
    const s3 = b.side && b.side['21+3'], pr = b.side && b.side.pairs;
    const ss = sideSpots(g);
    if (s3) dropStack(CHIPS, ss.three.x, ss.three.z, s3, { dur: 1, seatColor: SIDE_COLOR['21+3'] });
    if (pr) dropStack(CHIPS, ss.pair.x, ss.pair.z, pr, { dur: 1, seatColor: SIDE_COLOR.pairs });
    // cards per hand (split → offset clusters)
    const hs = b.hands || [];
    const cnt = hs.length;
    hs.forEach((hand, hi) => {
      const clusterOff = cnt > 1 ? (hi - (cnt - 1) / 2) * (CARD_W * 1.7) : 0;
      if (hand.cards && hand.cards.length) placeBoxCards(hand.cards, g, clusterOff);
    });
    // active-box ring during play
    if (v.phase === 'play' && v.turn === i) {
      const r = feltCircle(g.A.x + g.inx * 4.6, g.A.z + g.inz * 4.6, CARD_W * 0.9, CARD_W * 1.05, 0xffe9a8, 0.6);
      CARDS.add(r);
    }
    // label: total while playing, else owner/bet
    if (cnt && hs[0].cards.length) {
      const prim = hs[b.active] || hs[0];
      const t = prim.busted ? 'BUST' : (prim.blackjack ? '21' : String(prim.total));
      boxTotalLabel((cnt > 1 ? '◧ ' : '') + t, g, prim.busted ? 0xff8f8f : 0xffe9a8);
    } else if (b.owner != null && (b.bet > 0 || s3 || pr)) {
      const nm = ownerName(i);
      boxTotalLabel(nm ? (nm + (b.bet ? ' · ' + b.bet : '')) : String(b.bet || ''), g, 0xcfe7d8);
    }
  });
}

// ── toasts ──────────────────────────────────────────────────────────────────
let _btEl = null, _btT = null;
function bjToast(text) {
  if (!_btEl) { _btEl = document.createElement('div'); _btEl.style.cssText = 'position:fixed;left:50%;top:118px;transform:translateX(-50%);z-index:7;pointer-events:none;text-align:center;font:800 16px system-ui;padding:8px 15px;border-radius:11px;opacity:0;transition:opacity .25s;background:rgba(20,28,24,.92);color:#ffe9a8;border:1px solid #6b5a2a;box-shadow:0 8px 28px rgba(0,0,0,.5)'; document.body.appendChild(_btEl); }
  _btEl.textContent = text; _btEl.style.opacity = '1'; if (_btT) clearTimeout(_btT); _btT = setTimeout(() => { if (_btEl) _btEl.style.opacity = '0'; }, 1900);
}
let _sbEl = null, _sbT = null;
function sideToast(text, win) {
  if (!_sbEl) { _sbEl = document.createElement('div'); _sbEl.style.cssText = 'position:fixed;left:50%;top:150px;transform:translateX(-50%);z-index:7;pointer-events:none;text-align:center;font:800 17px system-ui;padding:9px 16px;border-radius:12px;opacity:0;transition:opacity .25s;box-shadow:0 8px 30px rgba(0,0,0,.5)'; document.body.appendChild(_sbEl); }
  _sbEl.style.background = win ? 'rgba(20,80,45,.94)' : 'rgba(44,22,22,.92)';
  _sbEl.style.color = win ? '#c8f6d8' : '#e9c9c9'; _sbEl.style.border = '1px solid ' + (win ? '#2fbf71' : '#7a4a4a');
  _sbEl.textContent = text; _sbEl.style.opacity = '1'; if (_sbT) clearTimeout(_sbT); _sbT = setTimeout(() => { if (_sbEl) _sbEl.style.opacity = '0'; }, 2400);
}

function playShuffle() {
  clearGroup(SHUF);
  const N = 12, cx = 17, cz = DEALER_Z - 1, backs = [];
  for (let k = 0; k < N; k++) { const m = buildCard(null); m.position.set(cx, 0.2 + k * 0.05, cz); SHUF.add(m); backs.push(m); }
  tween(1150, (e) => {
    const spread = Math.sin(Math.min(1, e * 2) * Math.PI * 0.5), merge = e < 0.5 ? 0 : Math.sin((e - 0.5) * 2 * Math.PI * 0.5);
    backs.forEach((m, k) => { const half = (k % 2 === 0) ? -1 : 1; m.position.x = cx + half * 3 * spread - half * 3 * merge; m.position.y = 0.2 + k * 0.05 + Math.sin(e * Math.PI) * 2.2; m.rotation.z = half * 0.5 * spread * (1 - merge); });
  }, () => clearGroup(SHUF));
}

const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { HUD.render(); syncBetBar(); if (C.state && C.state.view && C.state.phase !== 'lobby') renderBoxes(C.state.view); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

function myChips() {
  const s = C.state; if (!s) return null;
  const v = s.view || {};
  if (v.bankrolls && typeof v.bankrolls[C.mySeat] === 'number') return v.bankrolls[C.mySeat];
  const me = (s.seats || [])[C.mySeat];
  return me && typeof me.chips === 'number' ? me.chips : null;
}

let _builtCircles = false;
function onState(s) {
  const v = s.view || {};
  if (v.boxCount) NBOX = v.boxCount;
  if (!_builtCircles && (v.boxes || v.phase)) { buildCircles(NBOX); _builtCircles = true; }
  if (s.phase !== 'lobby') { renderDealer(v); renderBoxes(v); }
  else { clearGroup(CARDS); clearGroup(DCARDS); clearGroup(CHIPS); clearGroup(LABELS); _dealerRound = -1; _dealerShown = []; _dealerMeshes = []; _renderKey = ''; }
  CIRCLES.visible = true;   // circles are printed on the felt — always shown
  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }
  syncBetBar();
  HUD.render(); HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}

function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'hit' || ev.type === 'double' || ev.type === 'deal') { if (T.Sound) T.Sound.deal && T.Sound.deal(); }
  if (ev.type === 'shuffle') { playShuffle(); bjToast('🔀  New shoe — shuffling'); try { AUDIO.speak('Shuffling up.'); } catch (e) {} }
  if (ev.type === 'split') { if (T.Sound) T.Sound.deal && T.Sound.deal(); bjToast(ev.aces ? 'Split aces' : 'Split!'); }
  if (ev.type === 'persona' && ev.text) bjToast('\uD83D\uDCAC ' + ev.name + ': ' + ev.text);
  if (ev.type === 'sidebets') onSidebets(ev);
  if (ev.type === 'settle') {
    const bal = myChips();
    let d = (Array.isArray(ev.deltas) && C.mySeat != null && typeof ev.deltas[C.mySeat] === 'number') ? ev.deltas[C.mySeat] : _delta.delta(bal);
    if (bal != null) _delta.prime(bal);
    // fold in any 21+3 / pairs result (resolved earlier in a separate 'sidebets'
    // event) so the headline delta + breakdown reflect the TRUE net for the hand.
    const sideDelta = _pendingSide.delta || 0; const sideRows = _pendingSide.rows.slice(); _pendingSide = { delta: 0, rows: [] };
    d = d + sideDelta;
    const mine = (ev.breakdown || []).filter((b) => b.seat === C.mySeat);
    const boxRows = mine.filter((b) => b.total != null);     // main hand rows carry a total
    const bj = boxRows.some((b) => b.result === 'blackjack');
    const mainDelta = boxRows.reduce((a, b) => a + (b.delta || 0), 0);   // main hands only (excl. side / toke / tip)
    // The HEADLINE describes the hand: a blackjack or a winning hand is never
    // shown as a loss just because a side bet missed. The big +/- and the bar
    // still reflect the TRUE net (so they match the wallet); the breakdown itemises.
    let word;
    if (!boxRows.length) word = d > 0 ? 'WIN' : (d < 0 ? 'LOSS' : 'PUSH');
    else if (bj && boxRows.length === 1) word = 'BLACKJACK';
    else word = mainDelta > 0 ? 'YOU WIN' : (mainDelta < 0 ? 'DEALER WINS' : 'PUSH');
    const sideNote = sideDelta !== 0 ? (sideDelta > 0 ? ' · side +' + sideDelta : ' · side ' + sideDelta) : '';
    const sub = (boxRows.length
      ? boxRows.map((b) => (b.result === 'win' || b.result === 'blackjack' ? '✓' : (b.result === 'push' ? '=' : '✗')) + b.total).join('  ') + ' · dealer ' + ev.dealerTotal
      : ('Dealer ' + ev.dealerTotal + (ev.dealerBust ? ' bust' : ''))) + sideNote;
    const call = (mainDelta > 0 || bj) ? 'Winner!' : (mainDelta < 0 ? 'Dealer wins.' : 'Push.');
    const brk = [];
    for (const b of boxRows) brk.push({ label: 'Box ' + ((b.box != null ? b.box : 0) + 1), delta: b.delta, note: b.result === 'blackjack' ? 'blackjack' : (b.result === 'push' ? 'push' : null) });
    for (const b of mine.filter((x) => x.spot === 'tip' || x.spot === 'dealer')) brk.push({ label: b.spot === 'tip' ? 'Tip' : 'Toke', delta: b.delta, note: b.note || null });
    for (const r of sideRows) brk.push(r);
    let burstAt = [];
    try {
      const bxs = (C.state && C.state.view && C.state.view.boxes) || [];
      const nb = bxs.length || NBOX;
      for (let i = 0; i < bxs.length; i++) if (bxs[i] && bxs[i].owner === C.mySeat) { const A = boxAnchor(i, nb); burstAt.push({ x: A.x, z: A.z }); }
    } catch (e) {}
    if (!burstAt.length) burstAt = [{ x: 0, z: DEALER_Z + 18 }];
    _pendingResult = { payload: { word, title: null, titleColor: ((mainDelta > 0 || bj) ? 'green' : (mainDelta < 0 ? 'red' : null)), sub, delta: d, balance: bal, breakdown: brk }, call, d, bj, burstAt, hist: { label: String(ev.dealerTotal), color: (d > 0 ? 'green' : (d < 0 ? 'red' : 'black')), tip: `Dealer ${ev.dealerTotal}${ev.dealerBust ? ' bust' : ''} · you ${d > 0 ? '+' + d : d}` } };
    if (_resultFallback) clearTimeout(_resultFallback);
    _resultFallback = setTimeout(() => { if (_pendingResult) { const R = _pendingResult; _pendingResult = null; fireResult(R); } }, 5000);
  }
  if (ev.type === 'gameWon' && T.Sound) T.Sound.win && T.Sound.win();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

const SIDE_CALL = { 'straight flush': 'Straight flush!', 'three of a kind': 'Three of a kind!', 'straight': 'Straight!', 'flush': 'Flush!', 'suited trips': 'Suited trips!', 'perfect pair': 'Perfect pair!', 'colored pair': 'Coloured pair!', 'mixed pair': 'Pair pays!' };
function onSidebets(ev) {
  const bal = myChips(); if (bal != null) _delta.prime(bal);
  const mine = (ev.breakdown || []).filter((b) => b.seat === C.mySeat);
  if (!mine.length) return;
  for (const b of mine) {
    _pendingSide.delta += (b.delta || 0);
    _pendingSide.rows.push({ label: (b.kind === '21+3' ? '21+3' : 'Pairs') + (b.delta > 0 ? ' ' + b.cat : ' no win'), delta: b.delta || 0 });
  }
  const wins = mine.filter((b) => b.delta > 0).sort((a, b) => b.delta - a.delta);
  sideToast(mine.map((b) => (b.kind === '21+3' ? '21+3' : 'Pairs') + (b.delta > 0 ? ' ' + b.cat + ' +' + b.delta : ' \u2212' + b.amount)).join('   ·   '), wins.length > 0);
  if (wins.length) { if (T.Sound) T.Sound.win && T.Sound.win(); DEALER.bigWin(SIDE_CALL[wins[0].cat] || 'Side bet pays!'); }
}

// ── bet bar ─────────────────────────────────────────────────────────────────
const BAR = createBetBar({
  Sound: T.Sound,
  action: { label: 'Ready ▸', onClick: () => { const p = C.priv || {}; if (p.phase !== 'bets' || p.locked) return; C.emitAction({ type: 'done' }); } },
});
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
function placeBoxBet(box, kind) {
  const p = C.priv || {};
  if (p.phase !== 'bets' || p.locked) return;
  const amount = BAR.getStake(); if (!amount) return;
  if (kind === 'main') C.emitAction({ type: 'bet', box, amount });
  else C.emitAction({ type: 'bet', box, side: kind, amount });
  BAR.kick && BAR.kick();
  if (T.Sound) (T.Sound.chip ? T.Sound.chip() : (T.Sound.click && T.Sound.click()));
}
function placeDealerBet(side) {
  const p = C.priv || {};
  if (p.phase !== 'bets' || p.locked) return;
  const amount = BAR.getStake(); if (!amount) return;
  const offered = (p.legal || []).some((a) => a.type === 'bet' && a.side === side);
  if (!offered) { if (T.Sound) T.Sound.alert && T.Sound.alert(); if (HUD.setStatus) HUD.setStatus('Take a seat with chips to ' + (side === 'dealer' ? 'toke' : 'tip') + ' the dealer'); return; }
  C.emitAction({ type: 'bet', side, amount });
  BAR.kick && BAR.kick();
  if (T.Sound) (T.Sound.chip ? T.Sound.chip() : (T.Sound.click && T.Sound.click()));
}

function rankWord(code) { const r = rankOf(code); return ({ J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace', '10': 'ten' })[r] || r; }

const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'BLACKJACK', lowerWins: false, scoreLabel: 'Most chips wins',
  onResetCam: () => T.resetCamera(),
  statusLine(v, c) {
    if (v.phase === 'bets') return (C.priv && C.priv.locked) ? 'Waiting for the deal…' : '<b>Claim a box & bet</b>';
    if (v.phase === 'play') {
      const up = v.dealer && v.dealer.cards && v.dealer.cards[0];
      const d = up ? (' · dealer shows ' + rankWord(up)) : '';
      return (v.turnSeat === c.mySeat ? '<b>Your move</b>' : ('Box ' + ((v.turn ?? 0) + 1) + ' playing')) + d;
    }
    if (v.phase === 'dealer') return 'Dealer ' + (v.dealer && v.dealer.total != null ? v.dealer.total : '…');
    return '…';
  },
  renderActions(box, { priv }) {
    if (!priv) return;
    if (priv.phase === 'play' && priv.activeBox != null) {
      const legal = priv.legal || [];
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;width:100%';
      const mk = (label, type, bg, fg) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `background:${bg};color:${fg};border:none;border-radius:10px;padding:11px 16px;font:800 15px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)`; b.onclick = () => { C.emitAction({ type }); if (T.Sound) T.Sound.click && T.Sound.click(); }; return b; };
      if (legal.some((a) => a.type === 'hit')) row.appendChild(mk('HIT', 'hit', '#2fbf71', '#05230f'));
      if (legal.some((a) => a.type === 'stand')) row.appendChild(mk('STAND', 'stand', '#e3c567', '#241d05'));
      if (legal.some((a) => a.type === 'double')) row.appendChild(mk('DOUBLE', 'double', '#5ab0ff', '#04203a'));
      if (legal.some((a) => a.type === 'split')) row.appendChild(mk('SPLIT', 'split', '#c98bff', '#1f0a33'));
      box.appendChild(row);
      const tot = document.createElement('div'); tot.style.cssText = 'color:#bfe0cd;font-size:13px;text-align:center;width:100%;margin-top:6px';
      tot.textContent = 'Box ' + (priv.activeBox + 1) + ' · ' + priv.myTotal + (priv.soft ? ' (soft)' : '');
      box.appendChild(tot);
    }
    // otherwise nothing: betting uses the bottom bar's Ready button; bot/other-box
    // turns and the dealer draw show no controls (the top status line covers state).
  },
  scoreFor(v, seat) { return { score: (v.bankrolls && v.bankrolls[seat] != null) ? v.bankrolls[seat] : 0, sub: 'chips' }; },
  scoreFootText: (v) => `Hand ${v.round ?? '—'} · 7 boxes · table runs until you leave`,
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>Beat the dealer to 21</b></div>
      <ul>
        <li><b>7 betting boxes</b> on the felt. Pick a chip, tap a box's <b>BET</b> circle to claim + stake it. Tap several boxes to play <b>multiple hands</b>.</li>
        <li><b>21+3</b> / <b>PR</b> (pairs) are optional side bets beside each box, paid on the deal.</li>
        <li><b>Hit / Stand / Double / Split</b> each box in turn (left→right), then the dealer plays once.</li>
        <li>Two-card 21 is a <b>blackjack</b> (3:2). Dealer draws to 17 and peeks for a natural.</li>
        <li>Other players can sit at open boxes; empty boxes sit out. The table runs until you leave.</li>
      </ul>`;
  },
});
document.title = 'Blackjack · tiles.madladslab';

// ── tap-to-claim on the printed circles (tap-vs-drag) ───────────────────────
let _tapStart = null; const TAP_MOVE_PX = 10, TAP_MS = 500;
T.renderer.domElement.addEventListener('pointerdown', (e) => { _tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; }, false);
T.renderer.domElement.addEventListener('pointermove', (e) => { if (!_tapStart || e.pointerId !== _tapStart.id) return; if (Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y) > TAP_MOVE_PX) _tapStart = null; }, false);
T.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) { _tapStart = null; return; }
  const moved = Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y), dt = performance.now() - _tapStart.t, wasTap = moved <= TAP_MOVE_PX && dt <= TAP_MS;
  _tapStart = null; if (!wasTap) return;
  const p = C.priv || {}; if (p.phase !== 'bets' || p.locked || !_boxTargets.length) return;
  const hits = T.raycast(e.clientX, e.clientY, _boxTargets);
  if (hits.length && hits[0].object && hits[0].object.userData.bet) { const d = hits[0].object.userData.bet; if (d.dealer) placeDealerBet(d.side); else placeBoxBet(d.box, d.kind); }
}, false);
T.renderer.domElement.addEventListener('pointercancel', () => { _tapStart = null; }, false);

T.onFrame(() => {
  const now = performance.now();
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i]; let pr = (now - a.t0) / a.dur; if (pr < 0) pr = 0; const done = pr >= 1; if (done) pr = 1;
    a.apply(1 - Math.pow(1 - pr, 3)); if (done) { _anims.splice(i, 1); if (a.onDone) a.onDone(); }
  }
});
