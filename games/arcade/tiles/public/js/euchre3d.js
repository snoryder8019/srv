/**
 * euchre3d.js — Euchre on the shared 3D table.
 *
 * Mirrors hearts3d (trick-taking cards on the shared core) and adds euchre's
 * bidding: the upcard sits face-up in the center during bid round 1; bid/call/
 * discard happen via HUD buttons; play is tap-a-card like hearts.
 *
 * Euchre-specific rendering:
 *   • my fanned 5-card hand (face-up, tap legal cards to play)
 *   • the center: the upcard during bidding, then the trick during play
 *   • opponents' face-down fans + a partner indicator (seat opposite me)
 *   • trump suit + tricks-won badges via seat plates and the action bar
 *
 * Data shape (euchre variant):
 *   priv.phase: 'bid1'|'bid2'|'discard'|'play'
 *   priv.legal: [{type:'orderUp'}|{type:'pass'}|{type:'callTrump',suit}|{type:'discard',card}|{type:'play',card}]
 *   priv.hand: ["JS","AD",…]  priv.trump  priv.upcard  priv.yourTurn
 *   view.upcard view.trump view.maker view.trick[] view.trickWins[] view.teamPoints[] view.dealer view.turn
 * Partners are seats (0,2) vs (1,3); first team to 10 wins.
 */
import { createTable3D } from './table3d.js?v=1781441125092';
import { createTableClient } from './tableclient3d.js';
import { createHUD } from './hud3d.js';
import { buildCard, applyLegalHighlight, CARD_W, CARD_H, CARD_T } from './card3d.js';

const SUIT_SYM = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SAME_COLOR = { hearts: 'diamonds', diamonds: 'hearts', clubs: 'spades', spades: 'clubs' };

// --- euchre trump logic (bowers count as trump, left bower's effective suit = trump) ---
const SUIT_BY_INI0 = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
// accept either a full suit name ('hearts') or an initial ('H')
function normSuit(t) { if (!t) return null; return SUIT_BY_INI0[t] ? SUIT_BY_INI0[t] : (SUIT_SYM[t] ? t : SUIT_BY_INI0[t.toUpperCase()] || null); }
function rankOf(code) { return code ? code.slice(0, -1) : ''; }
function isRightBower(code, trump) { const t = normSuit(trump); return !!t && code === 'J' + t[0].toUpperCase(); }
function isLeftBower(code, trump) { const t = normSuit(trump); return !!t && !!SAME_COLOR[t] && code === 'J' + SAME_COLOR[t][0].toUpperCase(); }
function isBower(code, trump) { return isRightBower(code, trump) || isLeftBower(code, trump); }
// effective suit of a card given trump (left bower plays as trump); returns full name
function effSuit(code, trump) {
  const t = normSuit(trump);
  if (t && isLeftBower(code, trump)) return t;
  return suitOf(code);
}
function isTrumpCard(code, trump) { const t = normSuit(trump); return !!t && effSuit(code, trump) === t; }
// euchre card strength within its effective suit (higher = stronger)
const RANK_ORDER = { '9': 0, T: 1, '10': 1, J: 2, Q: 3, K: 4, A: 5 };
function cardStrength(code, trump, ledSuit) {
  const t = normSuit(trump);
  const eff = effSuit(code, trump);
  if (t && eff === t) {
    if (isRightBower(code, trump)) return 1000;
    if (isLeftBower(code, trump)) return 999;
    return 500 + RANK_ORDER[rankOf(code)];   // trump beats all non-trump
  }
  if (ledSuit && eff === ledSuit) return 100 + RANK_ORDER[rankOf(code)];
  return RANK_ORDER[rankOf(code)] || 0;       // off-suit, can't win
}
// winner seat of the (possibly in-progress) trick array [{seat,card}]
function trickLeaderSeat(trick, trump) {
  if (!trick || !trick.length) return null;
  const ledSuit = effSuit(trick[0].card, trump);
  let best = trick[0], bestStr = cardStrength(trick[0].card, trump, ledSuit);
  for (let i = 1; i < trick.length; i++) {
    const str = cardStrength(trick[i].card, trump, ledSuit);
    if (str > bestStr) { bestStr = str; best = trick[i]; }
  }
  return best.seat;
}

const T = createTable3D({
  tableRadius: 34, feltColor: 0x14633f,
  bgScene: 'euchre',
  cameraStart: { x: 5.1, y: 46.5, z: 135.3 },
  cameraTarget: { x: 8.8, y: 22, z: 81.7 },
});
T.setCamera({ maxDistance: 320 });
const THREE = T.THREE;

const HAND = new THREE.Group(); T.scene.add(HAND);
const TRICK = new THREE.Group(); T.scene.add(TRICK);
const OPP = new THREE.Group(); T.scene.add(OPP);
const CENTER = new THREE.Group(); T.scene.add(CENTER);  // the upcard during bidding

const handMeshes = [];
let handOrder = [];
function reconcileHandOrder(serverHand) {
  const have = new Set(serverHand);
  handOrder = handOrder.filter((c) => have.has(c));
  for (const c of serverHand) if (!handOrder.includes(c)) handOrder.push(c);
}

// --- my hand: a shallow fan along the south rail (same geometry as hearts) ---
function renderHand() {
  for (const m of HAND.children.slice()) HAND.remove(m);
  handMeshes.length = 0;
  const priv = C.priv; if (!priv || !priv.hand) return;
  reconcileHandOrder(priv.hand);
  const hand = handOrder.slice();
  const n = hand.length; if (!n) return;

  const playable = new Set((priv.legal || []).filter((a) => a.type === 'play').map((a) => a.card));
  const discardable = new Set((priv.legal || []).filter((a) => a.type === 'discard').map((a) => a.card));
  const pickable = priv.phase === 'play' ? playable : (priv.phase === 'discard' ? discardable : new Set());
  const gating = pickable.size > 0;
  const trump = priv.trump || (C.state && C.state.view && C.state.view.trump) || null;

  const stepX = CARD_W * 0.55;
  const z0 = T.TABLE_R - 9.0;
  const HAND_Y = 4.5;
  const fanDeg = Math.min(40, n * 6);
  const arcDepth = 4.0;
  const mid = (n - 1) / 2;

  hand.forEach((code, i) => {
    const mesh = buildCard(code);
    const rel = i - mid;
    const frac = mid === 0 ? 0 : rel / mid;
    const x = rel * stepX;
    const arc = (1 - frac * frac) * arcDepth;
    const yaw = -frac * (fanDeg * Math.PI / 180);
    const canPick = gating ? pickable.has(code) : false;
    mesh.position.set(x, HAND_Y + i * 0.22, z0 - arc + (i / Math.max(1, n - 1)) * 0.9);
    mesh.rotation.set(Math.PI / 2 - 0.95, yaw, 0);
    mesh.userData = { code, canPick, kind: 'hand', slot: i, x };
    mesh.traverse((o) => { if (o.isMesh) { o.renderOrder = 1000 + i; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); } } });
    // legal cards glow green, dead cards dim to 0.55 (shared, centralized)
    if (gating) applyLegalHighlight(mesh, canPick, '#2fbf71');
    // tag the player's own bowers during play so trump hierarchy is readable in-hand
    if (trump && priv.phase === 'play' && isBower(code, trump)) {
      const tag = makeTagSprite(isRightBower(code, trump) ? 'R' : 'L',
        isRightBower(code, trump) ? '#e3c567' : '#c8cdd6', '#241d05');
      tag.position.set(x + CARD_W * 0.32, HAND_Y + i * 0.22 + 1.4, z0 - arc + (i / Math.max(1, n - 1)) * 0.9 - 0.4);
      tag.scale.set(0.95, 0.48, 1); HAND.add(tag);
    }
    HAND.add(mesh);
    handMeshes.push({ mesh, code, slot: i, x });
  });
}

// --- center: the upcard (bidding) OR nothing once trump is decided ---
function renderCenter() {
  for (const m of CENTER.children.slice()) CENTER.remove(m);
  const v = (C.state && C.state.view) || {};
  if ((v.phase === 'bid1' || v.phase === 'bid2') && v.upcard) {
    const mesh = buildCard(v.upcard);
    mesh.position.set(0, 1.4, 0);
    mesh.rotation.set(Math.PI / 2, 0, 0);     // flat, face up in the middle
    mesh.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); o.renderOrder = 400; } });
    CENTER.add(mesh);
  }
}

// --- a small flat label sprite (canvas) floated just above a trick card ---
function makeTagSprite(text, bg, fg) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.beginPath();
  const r = 14, w = cv.width, h = cv.height;
  g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
  g.fillStyle = fg; g.font = 'bold 36px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  spr.renderOrder = 1200; spr.scale.set(2.0, 1.0, 1);
  return spr;
}

// --- center trick during play (same as hearts) ---
let _prevTrick = '';
function renderTrick() {
  const v = (C.state && C.state.view) || {};
  const trick = v.trick || [];
  const trump = v.trump;
  const key = trick.map((p) => p.seat + p.card).join(',');
  const grew = trick.length > (_prevTrick ? _prevTrick.split(',').filter(Boolean).length : 0);
  _prevTrick = key;
  for (const m of TRICK.children.slice()) TRICK.remove(m);
  if (!trick.length) return;
  const TRICK_Y = 1.0;
  const leaderSeat = trump ? trickLeaderSeat(trick, trump) : null;
  trick.forEach((p, idx) => {
    const mesh = buildCard(p.card);
    const ang = T.seatAngleOf(p.seat);
    const r = 3.2;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const restY = TRICK_Y + idx * 0.08;
    const ry = -ang + Math.PI / 2;
    mesh.position.set(x, restY, z);
    mesh.rotation.set(Math.PI / 2, ry, 0);
    const winning = (p.seat === leaderSeat);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.renderOrder = 500 + idx; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); }
      }
    });
    // glow the currently-winning card (gold) so the trick leader is obvious
    if (winning) {
      mesh.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { if (mm.emissive) { mm.emissive.setHex(0x5a4a12); mm.emissiveIntensity = 1.0; } }); } });
      const crown = makeTagSprite('♔', 'rgba(26,18,6,0.0)', '#e3c567');
      crown.position.set(x, restY + 3.0, z); crown.scale.set(2.6, 2.6, 1); TRICK.add(crown);
    }
    // tag bowers (R = right bower / highest trump, L = left bower / 2nd) so trump strength is readable
    if (trump && isBower(p.card, trump)) {
      const tag = makeTagSprite(isRightBower(p.card, trump) ? 'R' : 'L',
        isRightBower(p.card, trump) ? '#e3c567' : '#c8cdd6', '#241d05');
      tag.position.set(x + 1.7, restY + 1.6, z - 1.7); tag.scale.set(1.1, 0.55, 1); TRICK.add(tag);
    }
    TRICK.add(mesh);
    if (grew && idx === trick.length - 1) {
      const from = T.seatPosition(p.seat) || { x, z };
      mesh.position.set(from.x * 0.9, restY + 8, (from.z || z) * 0.9);
      T.flyTo(mesh, { x, y: restY, z, rx: Math.PI / 2, ry, rz: 0 }, { dur: 460, arc: 7, spin: Math.PI });
    }
  });
}

// --- opponents' face-down fans (5 cards each at start) ---
function renderOpponents() {
  for (const m of OPP.children.slice()) OPP.remove(m);
  const s = C.state; if (!s) return;
  const v = s.view || {};
  const counts = v.handCounts || [];
  const n = (s.seats || []).length || 4;
  for (let seat = 0; seat < n; seat++) {
    if (seat === C.mySeat) continue;
    const cnt = counts[seat] || 0; if (!cnt) continue;
    const ang = T.seatAngleOf(seat);
    const inward = ang + Math.PI;
    const px = -Math.sin(ang), pz = Math.cos(ang);
    const show = Math.min(cnt, 5);
    const stepT = 0.85;
    const mid = (show - 1) / 2;
    const r = T.TABLE_R - 7.0;
    for (let i = 0; i < show; i++) {
      const mesh = buildCard(null);
      const rel = i - mid;
      const cx = Math.cos(ang) * r + px * rel * stepT;
      const cz = Math.sin(ang) * r + pz * rel * stepT;
      mesh.position.set(cx, 6.0, cz);
      mesh.rotation.set(Math.PI / 2 - 0.95, inward + Math.PI - rel * 0.06, 0);
      mesh.userData = { kind: 'opp', seat };
      OPP.add(mesh);
    }
  }
}

// ------------------------------------------------------------------ client + HUD
const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { if (!T.isDealing()) renderHand(); HUD.render(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

let lastSeatCount = 0, prevTurn = null, prevHandNo = null;
function renderTable() {
  if (T.isDealing()) return;
  renderCenter();
  renderTrick();
  renderHand();
  renderOpponents();
}

function onState(s) {
  const v = s.view || {};
  const n = (s.seats || []).length;
  if (n && n !== lastSeatCount) { T.buildSeats(n, C.mySeat); lastSeatCount = n; }
  updateSeats(s, v);

  const newHand = s.handNo && s.handNo !== prevHandNo && s.phase !== 'lobby';
  if (newHand && !T.isDealing()) {
    for (const g of [HAND, OPP, TRICK, CENTER]) for (const m of g.children.slice()) g.remove(m);
    T.dealAnimation({
      buildCard,
      seats: (s.seats || []).map((x) => x.seat),
      perSeat: 5,
      onDone: () => { renderTable(); HUD.render(); },
    });
  } else {
    renderTable();
  }

  if (T.Sound && v.turn === C.mySeat && prevTurn !== C.mySeat && s.phase === 'playing') T.Sound.yourTurn && T.Sound.yourTurn();
  prevTurn = v.turn; prevHandNo = s.handNo;
  HUD.render();
  HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}

function teamOf(seat) { return seat % 2; }
function updateSeats(s, v) {
  const inPlay = s.phase !== 'lobby' && s.phase !== 'gameOver';
  const trumpKnown = (v.phase === 'play' || s.phase === 'playing') && v.trump != null;
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const turn = v.turn === i && inPlay;
    const partner = C.mySeat != null && i !== C.mySeat && teamOf(i) === teamOf(C.mySeat);
    const team = teamOf(i);
    // v.maker is the team index (0/1) that called trump — golden plate during play
    const isMaker = trumpKnown && v.maker != null && team === v.maker;
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '');
    const pts = (v.teamPoints && v.teamPoints[team] != null) ? v.teamPoints[team] : 0;
    const tw = (v.trickWins && v.trickWins[i]) || 0;
    let sub, handInfo;
    if (s.phase === 'lobby') sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    else if (s.phase === 'bid1' || s.phase === 'bid2') sub = i === v.dealer ? 'dealer' : 'bidding…';
    else { sub = `team ${team === 0 ? 'A' : 'B'} · ${pts} pt`; handInfo = `${tw} trick${tw === 1 ? '' : 's'}`; }
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat, isTurn: turn, maker: isMaker, partner, handInfo });
  }
}

function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'play' && T.Sound) T.Sound.play && T.Sound.play();
  if (ev.type === 'trickWon') {
    const ws = (ev.seat != null) ? ev.seat : (ev.winner != null ? ev.winner : null);
    if (ws != null) {
      const nm = (C.state && C.state.seats && C.state.seats[ws] && C.state.seats[ws].displayName) || ('Seat ' + ws);
      HUD.showTrickWinner(ws, nm);
      T.highlightTrickWinner(ws);
    } else if (T.Sound) { T.Sound.trick && T.Sound.trick(); }
  }
  if ((ev.type === 'orderedUp' || ev.type === 'calledTrump') && T.Sound) T.Sound.deal && T.Sound.deal();
  if (ev.type === 'handScored' && T.Sound) T.Sound.trick && T.Sound.trick();
  if (ev.type === 'turn:timeout' && T.Sound) T.Sound.alert && T.Sound.alert();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

// ------------------------------------------------------------------ actions/info
const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'EUCHRE',
  lowerWins: false, scoreLabel: 'First team to 10',
  onResetCam: () => T.resetCamera(),
  // EUCHRE badges (under the top bar): persistent trump, led-suit, follow-suit hint.
  trumpBadge(v) { return v.trump ? { text: 'Trump', suit: v.trump } : null; },
  leadSuitBadge(v) {
    const led = v.trick && v.trick[0] && v.trick[0].card; if (!led) return null;
    // led suit accounts for the left bower playing as trump
    return { text: 'Led', suit: effSuit(led, v.trump) || suitOf(led) };
  },
  followSuitHint(v, priv) {
    if (!priv || priv.phase !== 'play' || !priv.yourTurn) return null;
    const plays = (priv.legal || []).filter((a) => a.type === 'play').map((a) => a.card);
    if (!plays.length) return null;
    const hand = priv.hand || [];
    // if the legal set is narrower than the hand, the player is being constrained to follow
    if (plays.length >= hand.length) return null;
    const trump = priv.trump || v.trump;
    const suits = new Set(plays.map((c) => effSuit(c, trump)));
    if (suits.size !== 1) return null;
    const s = [...suits][0];
    return { text: 'Must follow', suit: s };
  },
  statusLine(v, c) {
    const me = c.mySeat;
    if (v.phase === 'bid1') {
      const up = `${cardLabel(v.upcard)} up`;
      return (v.turn === me ? `<b style="color:var(--gold)">Order up?</b> ${SUIT_SYM[suitOf(v.upcard)] || ''} is up`
        : `${HUD.turnText(v.turn)} · ${up}`) + ` · round 1`;
    }
    if (v.phase === 'bid2') return (v.turn === me ? '<b style="color:var(--gold)">Call trump or pass</b>' : `${HUD.turnText(v.turn)}`) + ' · round 2 (turned down)';
    if (v.phase === 'discard') return v.turn === me ? '<b style="color:var(--gold)">Discard a card</b>' : 'Dealer discarding…';
    // play: prominent turn text + maker/tricks context
    const tA = (v.trickWins && v.trickWins[0] || 0) + (v.trickWins && v.trickWins[2] || 0);
    const tB = (v.trickWins && v.trickWins[1] || 0) + (v.trickWins && v.trickWins[3] || 0);
    const mk = v.maker != null ? ` · team ${v.maker === 0 ? 'A' : 'B'} called` : '';
    return `${HUD.turnText(v.turn)} · tricks A ${tA}–${tB} B${mk}`;
  },
  renderActions(box, { state, priv, myTurn }) {
    if (!priv || !myTurn) return;
    const legal = priv.legal || [];
    if (priv.phase === 'bid1') {
      addBtn(box, `Order up ${SUIT_SYM[suitOf(priv.upcard)] || ''} ▲`, 'gold', () => C.emitAction({ type: 'orderUp' }), legal.some((a) => a.type === 'orderUp'));
      addBtn(box, 'Pass', 'ghost', () => C.emitAction({ type: 'pass' }), legal.some((a) => a.type === 'pass'));
      return;
    }
    if (priv.phase === 'bid2') {
      for (const a of legal) {
        if (a.type === 'callTrump') addBtn(box, `Call ${SUIT_SYM[a.suit]}`, redSuit(a.suit) ? 'gold' : 'act', () => C.emitAction(a), true);
      }
      if (legal.some((a) => a.type === 'pass')) addBtn(box, 'Pass', 'ghost', () => C.emitAction({ type: 'pass' }), true);
      return;
    }
    if (priv.phase === 'discard') {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = 'Tap a card to discard (you took the upcard)';
      box.appendChild(hint);
      return;
    }
    if (priv.phase === 'play') {
      // explain dead/grayed cards: when the legal set is narrower than the hand, you must follow
      const plays = (priv.legal || []).filter((a) => a.type === 'play');
      const constrained = plays.length > 0 && plays.length < (priv.hand || []).length;
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = constrained ? 'Tap a glowing card · must follow the led suit' : 'Tap a card to play';
      box.appendChild(hint);
    }
  },
  scoreFor(v, seat) {
    const team = teamOf(seat);
    const tw = (v.trickWins && v.trickWins[seat]) || 0;
    const maker = v.maker != null && team === v.maker ? ' · 👑 maker' : '';
    return { score: (v.teamPoints && v.teamPoints[team]) || 0, sub: `team ${team === 0 ? 'A' : 'B'} · ${tw} trick${tw === 1 ? '' : 's'}${maker}` };
  },
  scoreFootText: () => 'Partners sit across · first team to 10 points wins',
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>First team to 10</b></div>
      <ul>
        <li>You + the player across (🤝) are partners. 24-card deck, 9 to A.</li>
        <li><b>Round 1:</b> order up the turned suit as trump, or pass.</li>
        <li><b>Round 2:</b> if all pass, call a different suit. Dealer must call (stick the dealer).</li>
        <li><b>Bowers:</b> Jack of trump (right) is highest; the other same-color Jack (left) is 2nd and is trump.</li>
        <li>Makers take 3–4 tricks = 1 pt, all 5 = 2; euchred (makers &lt;3) gives the other team 2.</li>
      </ul>`;
  },
});
document.title = 'Euchre · tiles.madladslab';

function addBtn(box, text, cls, onclick, enabled) {
  const b = document.createElement('button');
  b.className = 'act ' + (cls || '');
  b.textContent = text;
  b.disabled = !enabled;
  b.onclick = () => { b.disabled = true; onclick(); };
  box.appendChild(b);
}
const SUIT_BY_INI = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
function suitOf(code) { return code ? SUIT_BY_INI[code.slice(-1)] : null; }
function redSuit(s) { return s === 'hearts' || s === 'diamonds'; }
function cardLabel(code) { if (!code) return ''; return code.slice(0, -1) + (SUIT_SYM[suitOf(code)] || ''); }

// ------------------------------------------------------------------ picking + drag
const HOLD_MS = 280, MOVE_CANCEL = 14;
let _g = null;

function cardAt(x, y) {
  if (!handMeshes.length) return null;
  const hits = T.raycast(x, y, handMeshes.map((h) => h.mesh));
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && obj.userData && obj.userData.kind !== 'hand' && obj.parent) obj = obj.parent;
  return (obj && obj.userData && obj.userData.code) ? obj.userData.code : null;
}
function slotAtScreenX(clientX) {
  const rect = T.renderer.domElement.getBoundingClientRect();
  let best = 0, bestDx = Infinity;
  for (const h of handMeshes) {
    const v = h.mesh.position.clone().project(T.camera);
    const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const dx = Math.abs(sx - clientX);
    if (dx < bestDx) { bestDx = dx; best = h.slot; }
  }
  return best;
}
function liftHeld(code, on) {
  const h = handMeshes.find((m) => m.code === code); if (!h) return;
  h.mesh.position.y += on ? 2.6 : 0;
}
function clearGesture() {
  if (_g && _g.holdTimer) clearTimeout(_g.holdTimer);
  if (_g && _g.armed) T.controls.enabled = true;
  _g = null;
}

T.renderer.domElement.addEventListener('pointerdown', (e) => {
  const code = cardAt(e.clientX, e.clientY);
  if (!code) { _g = null; return; }
  _g = { code, startX: e.clientX, startY: e.clientY, armed: false, holdTimer: null };
  _g.holdTimer = setTimeout(() => {
    if (!_g) return;
    _g.armed = true; T.controls.enabled = false; liftHeld(_g.code, true);
    if (T.Sound) T.Sound.tick && T.Sound.tick();
  }, HOLD_MS);
}, false);

T.renderer.domElement.addEventListener('pointermove', (e) => {
  if (!_g) return;
  const moved = Math.hypot(e.clientX - _g.startX, e.clientY - _g.startY);
  if (!_g.armed) { if (moved > MOVE_CANCEL) { clearTimeout(_g.holdTimer); _g.holdTimer = null; } return; }
  const from = handOrder.indexOf(_g.code);
  const to = slotAtScreenX(e.clientX);
  if (from !== -1 && to !== -1 && from !== to) {
    handOrder.splice(from, 1); handOrder.splice(to, 0, _g.code);
    renderHand(); liftHeld(_g.code, true);
  }
  e.stopPropagation();
}, false);

function endGesture(e) {
  if (!_g) return;
  const armed = _g.armed, code = _g.code, hadTimer = !!_g.holdTimer;
  clearGesture();
  if (armed) { if (e) e.stopPropagation(); renderHand(); return; }
  if (!hadTimer) return;

  const priv = C.priv; if (!priv || !C.myTurn()) return;
  if (priv.phase === 'discard') {
    const ok = (priv.legal || []).some((a) => a.type === 'discard' && a.card === code);
    if (ok) C.emitAction({ type: 'discard', card: code });
    return;
  }
  if (priv.phase === 'play') {
    const ok = (priv.legal || []).some((a) => a.type === 'play' && a.card === code);
    if (ok) C.emitPlayChecked({ type: 'play', card: code });
  }
}
T.renderer.domElement.addEventListener('pointerup', endGesture, false);
T.renderer.domElement.addEventListener('pointercancel', () => clearGesture(), false);
