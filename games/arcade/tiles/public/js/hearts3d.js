/**
 * hearts3d.js — Hearts on the shared 3D table.
 *
 * Thin game layer: it imports the shared core (table3d), the socket client
 * (tableclient3d), the HUD chrome (hud3d), and card meshes (card3d), and supplies
 * ONLY what's hearts-specific:
 *   • the fanned 3D hand (mine), face-up, selectable
 *   • the center trick area (each played card laid toward its player's seat)
 *   • the passing phase (multi-select passCount cards, then submit one pass)
 *   • the action controls + info copy + scoreboard read
 *
 * Data shape (hearts variant):
 *   priv.hand: card codes ["QS","2C",…]   priv.legal: [{type:'play',card}|{type:'passCard',card}]
 *   priv.phase: 'passing'|'playing'  priv.needToPass  priv.passCount  priv.yourTurn
 *   view.trick: [{seat,card}]  view.handCounts[]  view.totals[]  view.passed[] view.heartsBroken
 *   Lowest score wins.
 */
import { createTable3D } from './table3d.js?v=1780587392337';
import { createTableClient } from './tableclient3d.js';
import { createHUD } from './hud3d.js';
import { buildCard, CARD_W, CARD_H, CARD_T, applyLegalHighlight, setFollowViolation } from './card3d.js';

// ------------------------------------------------------------------ card maths
// Card codes are "<rank><suit>", rank ∈ A K Q J T 9..2, suit ∈ S H D C.
const RANK_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
const QS = 'QS';                                   // the Queen of Spades — 13 points
const SUIT_OF = (code) => code ? code.slice(-1) : '';
const RANK_OF = (code) => code ? RANK_ORDER[code.slice(0, -1)] || 0 : 0;
const SUIT_GLYPH = { S:'♠', H:'♥', D:'♦', C:'♣', spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣' };
const SUIT_NAME = { S:'spades', H:'hearts', D:'diamonds', C:'clubs' };
// Penalty value of a single card: each heart = 1, Q♠ = 13, everything else 0.
function cardPenalty(code) { if (!code) return 0; if (code === QS) return 13; return SUIT_OF(code) === 'H' ? 1 : 0; }
// Sum of penalty points sitting in a trick array of {seat,card}.
function trickPenalty(trick) { return (trick || []).reduce((a, p) => a + cardPenalty(p.card), 0); }
// Which played entry is currently winning a trick? Highest card of the LED suit.
function trickLeaderIndex(trick) {
  if (!trick || !trick.length) return -1;
  const led = SUIT_OF(trick[0].card);
  let best = 0, bestRank = -1;
  trick.forEach((p, i) => { if (SUIT_OF(p.card) === led && RANK_OF(p.card) > bestRank) { bestRank = RANK_OF(p.card); best = i; } });
  return best;
}
// Passing direction → a viewer-friendly label with a directional arrow.
function passDirLabel(dir) {
  switch (dir) {
    case 'left': return '← left (next player)';
    case 'right': return 'right (previous player) →';
    case 'across': return '↔ across';
    case 'hold': return '⟳ hold (no pass)';
    default: return dir || '';
  }
}
// Cards risky to PASS or hold: the Q♠ and the high hearts/high spades that drag it in.
function isHighRiskCard(code) {
  if (code === QS) return true;
  const s = SUIT_OF(code), r = RANK_OF(code);
  if (s === 'H' && r >= 11) return true;            // J♥ Q♥ K♥ A♥
  if (s === 'S' && r >= 13) return true;            // K♠ A♠ — outrank the Queen, can capture it
  return false;
}

const T = createTable3D({
  tableRadius: 34, feltColor: 0x14633f,
  bgScene: 'hearts',
  // start outside the south ring, lower, looking across the table AT the player's hand
  cameraStart: { x: 5.1, y: 46.5, z: 135.3 }, // baked from on-device SAVE ANGLE
  cameraTarget: { x: 8.8, y: 22, z: 81.7 },
});
T.setCamera({ maxDistance: 320 });  // allow the far-south framing without clamping
const THREE = T.THREE;

// ------------------------------------------------------------------ tabletop
// Two groups: the local player's fanned hand (in front of camera-south seat) and
// the center trick. Other players' cards are abstracted to their seat plates.
const HAND = new THREE.Group(); T.scene.add(HAND);
const TRICK = new THREE.Group(); T.scene.add(TRICK);
const OPP = new THREE.Group(); T.scene.add(OPP);   // face-down fans at opponents' seats

let selPass = new Set();   // codes selected during the passing phase
const handMeshes = [];     // { mesh, code, slot } for raycast picking + drag
// Client-side preferred arrangement of MY hand. The server owns membership (which
// cards I hold) + legality; this array owns only the cosmetic left->right order.
// Reconciled on every seat:hand so it survives updates, new cards (after a pass),
// and removals (after I play). Dragging mutates ONLY this — never the socket.
let handOrder = [];
function reconcileHandOrder(serverHand) {
  const have = new Set(serverHand);
  handOrder = handOrder.filter((c) => have.has(c));        // drop cards no longer held
  for (const c of serverHand) if (!handOrder.includes(c)) handOrder.push(c); // append new
}

// Float a small glyph badge just above a card mesh (Q♠ skull, ⚠ risk, ✓ selected).
// The sprite is parented to the card so it tracks the fan/drag automatically.
const _tagTex = {};
function tagTexture(glyph, hex) {
  const key = glyph + hex;
  if (_tagTex[key]) return _tagTex[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const x = cv.getContext('2d');
  x.beginPath(); x.arc(48, 48, 40, 0, Math.PI * 2);
  x.fillStyle = 'rgba(8,12,9,.92)'; x.fill();
  x.lineWidth = 6; x.strokeStyle = '#' + hex.toString(16).padStart(6, '0'); x.stroke();
  x.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  x.font = '54px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(glyph, 48, 52);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
  _tagTex[key] = t; return t;
}
function tagCard(mesh, glyph, hex) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(glyph, hex), depthTest: false, depthWrite: false, transparent: true }));
  sp.scale.set(3.2, 3.2, 1);
  sp.position.set(0, 0.4, CARD_H * 0.5 + 0.6);   // float just past the card's top edge (local +Z)
  sp.renderOrder = 4000;
  mesh.add(sp);
}

// --- my hand: a shallow fan arcing up toward the camera at the south seat ---
function renderHand() {
  for (const m of HAND.children.slice()) HAND.remove(m);
  handMeshes.length = 0;
  const priv = C.priv; if (!priv || !priv.hand) return;
  reconcileHandOrder(priv.hand);
  const hand = handOrder.slice();           // render in MY arrangement
  const n = hand.length; if (!n) return;

  const playable = new Set((priv.legal || []).filter((a) => a.type === 'play').map((a) => a.card));
  const passable = priv.phase === 'passing' && priv.needToPass;
  // Are we constrained to follow a led suit? (legal plays all share one suit while we
  // also hold cards of OTHER suits → those other cards are follow-suit violations.)
  const legalSuits = new Set([...playable].map(SUIT_OF));
  const mustFollowSuit = priv.phase === 'playing' && priv.yourTurn && legalSuits.size === 1
    ? [...legalSuits][0] : null;

  // The hand sits just inside the south rail on a BIG arc. Stacking is strictly
  // LEFT-OVER-RIGHT: the leftmost card is on top (highest, frontmost), and each
  // card to the right tucks UNDER its left neighbour (lower + slightly behind).
  const stepX = CARD_W * 0.5;                       // half-card spacing (cards overlap ~50%)
  const span = stepX * (n - 1);                     // resulting fan width
  const z0 = T.TABLE_R - 9.0;                       // distance out toward south rail
  const HAND_Y = 4.5;                                // base height above the felt
  const fanDeg = Math.min(48, n * 4.2);             // fan rotation across the hand
  const arcDepth = 5.0;                              // how far the ends curve back
  const archY = 4.5;                                 // higher arch: middle lifts this much
  const mid = (n - 1) / 2;

  hand.forEach((code, i) => {
    const mesh = buildCard(code);
    const rel = i - mid;
    const frac = mid === 0 ? 0 : rel / mid;          // -1..1
    const x = rel * stepX;
    // Curved fan: ends sweep back in Z (the visible arch). Y descends STRICTLY
    // left->right so the leftmost card is physically highest and sits on top.
    const arc = (1 - frac * frac) * arcDepth;        // Z bow (middle nearest camera) = the arch
    const yaw = -frac * (fanDeg * Math.PI / 180);    // fan rotation about Y
    const stackY = i * 0.22;                          // RIGHT card highest; each left card lower
    const stackZ = (i / Math.max(1, n - 1)) * 0.9;   // right cards pushed slightly back
    const sel = (passable && selPass.has(code));
    const canPick = passable ? true : playable.has(code);
    mesh.position.set(x, HAND_Y + stackY + (sel ? 2.0 : 0), z0 - arc + stackZ);
    // face is +Y; stand it up toward the south camera, fan yaw across the hand.
    mesh.rotation.set(Math.PI / 2 - 0.95, yaw, 0);
    // Enforce left-over-right overlap independent of depth: leftmost draws last (on top)
    // and we DISABLE depth testing on hand cards so Y differences can't reorder them.
    mesh.userData = { code, canPick, kind: 'hand', slot: i, x };
    mesh.traverse((o) => { if (o.isMesh) { o.renderOrder = 1000 + i; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); } } });
    // Legality glow: playable cards get a green emissive glow, dead cards dim to 0.55.
    // During passing every card is selectable, so don't dim — just keep them full.
    if (priv.phase === 'playing' && playable.size) {
      applyLegalHighlight(mesh, playable.has(code), '#2fbf71');
      // a card I hold of the wrong suit while forced to follow → flag it red so the
      // reason it's un-tappable is unmistakable.
      if (mustFollowSuit && !playable.has(code)) setFollowViolation(mesh, true);
    } else if (!canPick && passable) {
      // belt-and-braces (passing keeps all canPick=true, so this rarely fires)
      mesh.traverse((o) => { if (o.material) { o.material = o.material.clone ? o.material.clone() : o.material; o.material.opacity = 0.55; o.material.transparent = true; } });
    }
    // Selected-to-pass cards pop up (handled via position above) AND glow gold.
    if (sel) tagCard(mesh, '✓', 0xe3c567);
    // Danger marker: during passing, flag the cards that are dangerous to give away.
    if (passable && isHighRiskCard(code) && !sel) tagCard(mesh, code === QS ? '☠' : '⚠', 0xc0392b);
    HAND.add(mesh);
    handMeshes.push({ mesh, code, slot: i, x });
  });
}

// --- center trick: each played card laid toward the player's seat direction ---
let _prevTrick = '';
function renderTrick() {
  const v = (C.state && C.state.view) || {};
  const trick = v.trick || [];
  const key = trick.map((p) => p.seat + p.card).join(',');
  const grew = trick.length > (_prevTrick ? _prevTrick.split(',').filter(Boolean).length : 0);
  _prevTrick = key;
  for (const m of TRICK.children.slice()) TRICK.remove(m);
  updateTrickInfo(v, trick);                        // refresh the "winning / pts in play" hint
  if (!trick.length) return;
  const n = (C.state.seats || []).length || 4;
  const TRICK_Y = 1.0;                              // rest height above the felt (no clipping)
  const leadIdx = trickLeaderIndex(trick);          // which card is currently winning
  const seats = C.state.seats || [];
  // Danger sound the first time a Q♠ appears in this trick.
  if (grew && trick.some((p) => p.card === QS) && _qsTrickKey !== key) {
    _qsTrickKey = key;
    if (T.Sound) (T.Sound.alert || T.Sound.trick || function(){})();
  }
  trick.forEach((p, idx) => {
    const mesh = buildCard(p.card);
    const ang = T.seatAngleOf(seatRel(p.seat, n)); // world azimuth of that seat
    // place the card a short way from center toward that seat, lying flat & face up
    const r = 3.0;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    // each successive play stacks slightly higher so cards overlap, not z-fight
    const restY = TRICK_Y + idx * 0.08;
    const ry = -ang + Math.PI / 2;
    mesh.position.set(x, restY, z);
    mesh.rotation.set(Math.PI / 2, ry, 0);         // flat on the table, face up
    const seatLabel = (seats[p.seat] && seats[p.seat].displayName) || ('Seat ' + p.seat);
    mesh.userData = { kind: 'trick', code: p.card, seatAngle: ang, seatLabel };
    // draw order + no depth test so trick cards never sink into / fight the felt
    mesh.traverse((o) => { if (o.isMesh) { o.renderOrder = 500 + idx; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); } } });
    TRICK.add(mesh);
    // Q♠ in the center gets a permanent skull badge — it's the 13-point bomb.
    if (p.card === QS) tagCard(mesh, '☠', 0xe3c567);
    // The card currently winning the trick gets a gold glow ring so "who's taking it"
    // (and the points riding on it) reads at a glance.
    if (idx === leadIdx && trick.length > 1) {
      applyLegalHighlight(mesh, true, '#e3c567');
      tagCard(mesh, '▲', 0xe3c567);
    }
    // the newest card flies in (frisbee) from its player's seat to its rest spot
    if (grew && idx === trick.length - 1) {
      const from = T.seatPosition(p.seat) || { x, z: z };
      mesh.position.set(from.x * 0.9, restY + 8, (from.z || z) * 0.9);
      T.flyTo(mesh, { x, y: restY, z, rx: Math.PI / 2, ry, rz: 0 }, { dur: 460, arc: 7, spin: Math.PI });
    }
  });
}
let _qsTrickKey = '';
// 2D overlay: "Winning: Name · N pts at stake" while a trick is open.
function updateTrickInfo(v, trick) {
  const el = document.getElementById('trickInfo'); if (!el) return;
  if (!trick || trick.length < 1 || (v.phase && v.phase !== 'playing')) { el.classList.remove('show'); return; }
  const seats = C.state.seats || [];
  const li = trickLeaderIndex(trick);
  const winner = li >= 0 ? ((seats[trick[li].seat] && seats[trick[li].seat].displayName) || ('Seat ' + trick[li].seat)) : '—';
  const pts = trickPenalty(trick);
  const mine = li >= 0 && trick[li].seat === C.mySeat;
  el.innerHTML = `<span class="w">Winning</span> ${mine ? '<b>YOU</b>' : winner}` +
                 (pts > 0 ? ` · <span class="p">${pts} pt${pts === 1 ? '' : 's'} at stake</span>` : ' · clean trick');
  el.classList.add('show');
}
// --- opponents' hands: a face-down fan at each non-local seat, facing inward ---
function renderOpponents() {
  for (const m of OPP.children.slice()) OPP.remove(m);
  const s = C.state; if (!s) return;
  const v = s.view || {};
  const counts = v.handCounts || [];
  const n = (s.seats || []).length || 4;
  for (let seat = 0; seat < n; seat++) {
    if (seat === C.mySeat) continue;            // my own hand is the 3D fan
    const cnt = counts[seat] || 0; if (!cnt) continue;
    const pos = T.seatPosition(seat); if (!pos) continue;
    const ang = T.seatAngleOf(seat);            // world azimuth of that seat (outward)
    // inward direction (toward center) = ang + PI; cards fan along the tangent.
    const inward = ang + Math.PI;
    const tx = Math.cos(ang), tz = Math.sin(ang);           // radial (outward) unit
    const px = -Math.sin(ang), pz = Math.cos(ang);          // tangent unit (fan spread)
    const show = Math.min(cnt, 13);
    const stepT = 0.62;                                      // tangential spacing
    const mid = (show - 1) / 2;
    for (let i = 0; i < show; i++) {
      const mesh = buildCard(null);                          // face-down (back up)
      const rel = i - mid;
      // sit just inside the seat plate, fanned along the tangent, tilted upright-ish
      const r = T.TABLE_R - 7.0;
      const cx = Math.cos(ang) * r + px * rel * stepT;
      const cz = Math.sin(ang) * r + pz * rel * stepT;
      const fan = -rel * 0.05;
      mesh.position.set(cx, 6.0 + (1 - Math.abs(mid ? rel / mid : 0)) * 0.5, cz);
      // stand the back toward the table center: face (+Y) points inward + up
      mesh.rotation.set(Math.PI / 2 - 0.95, inward + Math.PI + fan, 0);
      mesh.userData = { kind: 'opp', seat };
      OPP.add(mesh);
    }
  }
}

// seat index relative to me (so my plays land in front of me, south)
function seatRel(seat, n) { return seat; } // core already orients seats; trick uses absolute seat azimuth

// ------------------------------------------------------------------ client + HUD
const C = createTableClient({
  onState(s) { onState(s); },
  onPriv(p) { if (!T.isDealing()) renderHand(); HUD.render(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

let lastSeatCount = 0, prevTurn = null, prevHandNo = null;
function renderTable() {
  if (T.isDealing()) return;          // hold real cards until the deal flourish finishes
  renderTrick();
  renderHand();
  renderOpponents();
}

function onState(s) {
  const v = s.view || {};
  const n = (s.seats || []).length;
  if (n && n !== lastSeatCount) { T.buildSeats(n, C.mySeat); lastSeatCount = n; }
  updateSeats(s, v);

  // New hand? play the shuffle + deal flourish, THEN reveal the real cards.
  const newHand = s.handNo && s.handNo !== prevHandNo && s.phase !== 'lobby';
  if (newHand && !T.isDealing()) {
    // clear any leftover cards, run the flourish, render real hands on completion
    for (const m of HAND.children.slice()) HAND.remove(m);
    for (const m of OPP.children.slice()) OPP.remove(m);
    for (const m of TRICK.children.slice()) TRICK.remove(m);
    T.dealAnimation({
      buildCard,
      seats: (s.seats || []).map((x) => x.seat),
      perSeat: 13,
      onDone: () => { renderTable(); HUD.render(); },
    });
  } else {
    renderTable();
  }

  if (T.Sound && v.turn === C.mySeat && prevTurn !== C.mySeat && s.phase === 'playing') T.Sound.yourTurn();
  prevTurn = v.turn; prevHandNo = s.handNo;
  HUD.render();
  HUD.renderVote(s.vote);
  if (s.phase === 'lobby') { HUD.hideOver(); selPass.clear(); }
}

function updateSeats(s, v) {
  const hp = v.handPoints || [];
  // A seat is "on the moon" if it has taken EVERY penalty point dealt so far this
  // hand (and at least the Q♠-worth) — i.e. nobody else has any. Flag it so the
  // table can warn "someone may shoot".
  const totalTaken = hp.reduce((a, b) => (a || 0) + (b || 0), 0);
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const cnt = (v.handCounts && v.handCounts[i] != null) ? v.handCounts[i] : '';
    const total = (v.totals && v.totals[i] != null) ? v.totals[i] : 0;
    const taken = hp[i] || 0;
    const turn = v.turn === i && s.phase === 'playing';
    const onMoon = s.phase === 'playing' && taken >= 13 && taken === totalTaken;
    let name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '');
    if (onMoon) name = '🌙 ' + name;                 // shoot-the-moon watch
    let sub, handInfo;
    if (s.phase === 'lobby') sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    else if (s.phase === 'passing') sub = (v.passed && v.passed[i]) ? 'passed ✓' : 'passing…';
    else { sub = `${total} pts total`; handInfo = `${cnt} cards · ${taken} this hand`; }
    T.updateSeat(i, { name, sub, handInfo, turn, isTurn: turn, you: i === C.mySeat });
  }
}

function onEvent(ev) {
  if (ev.type === 'play' && T.Sound) T.Sound.play();
  if (ev.type === 'trickWon') {
    const seats = C.state && C.state.seats || [];
    const nm = (seats[ev.seat] && seats[ev.seat].displayName) || (ev.seat === C.mySeat ? 'You' : 'Seat ' + ev.seat);
    const pts = ev.points || 0;
    const note = pts > 0 ? `${nm} took the trick (+${pts})` : `${nm} took the trick`;
    if (HUD.showTrickWinner) HUD.showTrickWinner(ev.seat, note);
    if (T.highlightTrickWinner) T.highlightTrickWinner(ev.seat); else if (T.Sound) T.Sound.trick();
  }
  if (ev.type === 'turn:timeout' && T.Sound) T.Sound.alert();
  if ((ev.type === 'vote:open' || ev.type === 'vote:update')) HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

// ------------------------------------------------------------------ actions/info
const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'HEARTS',
  lowerWins: true, scoreLabel: 'Lowest score wins',
  onResetCam: () => T.resetCamera(),
  statusLine(v, c) {
    if (c.priv && c.priv.phase === 'passing') {
      const dir = passDirLabel(c.priv.passDir);
      return c.priv.needToPass
        ? `<b style="color:var(--gold)">PASS ${c.priv.passCount}</b> ${dir} · tap ${c.priv.passCount} cards (avoid ☠ Q♠ & high ♥)`
        : 'waiting for others to pass…';
    }
    const turnTxt = (HUD.turnText ? HUD.turnText(v.turn) : (v.turn === c.mySeat ? '<b>YOUR TURN</b>' : `seat ${v.turn}`));
    document.body.classList.toggle('hb', !!v.heartsBroken);   // drives the #status pulse
    const hb = v.heartsBroken ? ' · <span style="color:#ff8a8a;font-weight:800">♥ HEARTS BROKEN</span>' : ' · ♥ not yet broken';
    return `${turnTxt}${hb} · trick ${(v.trick || []).length}/4`;
  },
  // Persistent badge strip (top-left): the led suit you must follow, plus a forced-
  // follow nudge. Driven off priv (authoritative) for the follow constraint.
  leadSuitBadge(v) {
    const led = v.trick && v.trick[0] && v.trick[0].card;
    if (!led) return null;
    const s = SUIT_OF(led);
    return { text: 'Led', suit: s, color: (s === 'H' || s === 'D') ? '#ff8a8a' : '#e9ecef' };
  },
  followSuitHint(v, priv) {
    if (!priv || priv.phase !== 'playing' || !priv.yourTurn) return null;
    const plays = (priv.legal || []).filter((a) => a.type === 'play').map((a) => a.card);
    if (!plays.length) return null;
    const suits = new Set(plays.map(SUIT_OF));
    // If every legal play is one suit AND I hold cards of other suits, I'm forced to follow.
    const handSuits = new Set((priv.hand || []).map(SUIT_OF));
    if (suits.size === 1 && handSuits.size > 1) {
      const s = [...suits][0];
      return { text: 'Must follow', suit: s, color: (s === 'H' || s === 'D') ? '#ff8a8a' : '#e9ecef' };
    }
    // Leading and hearts not broken → can't lead a heart.
    if (!(v.trick || []).length && !v.heartsBroken && handSuits.size > 1 && !suits.has('H')) {
      return { text: "Can't lead ♥ yet", color: '#9fb0a6' };
    }
    return null;
  },
  renderActions(box, { state, priv, myTurn }) {
    if (!priv) return;
    if (priv.phase === 'passing' && priv.needToPass) {
      const need = priv.passCount || 3;
      const b = document.createElement('button');
      b.className = 'act gold'; b.disabled = selPass.size !== need;
      b.textContent = selPass.size === need ? `Pass ${need} ${passDirLabel(priv.passDir)} ▶` : `Select ${need} (${selPass.size}/${need})`;
      b.onclick = () => { C.emitAction({ type: 'pass', cards: [...selPass] }); selPass.clear(); HUD.render(); renderHand(); };
      box.appendChild(b);
      return;
    }
    if (priv.phase === 'playing' && myTurn) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = 'Tap a card to play';
      box.appendChild(hint);
    }
  },
  scoreFor(v, seat) {
    return { score: (v.totals && v.totals[seat] != null) ? v.totals[seat] : 0,
             sub: (v.handCounts && v.handCounts[seat] != null) ? v.handCounts[seat] + ' cards' : '' };
  },
  scoreFootText: (v) => `Lowest score wins · game ends at ${v.losingScore || 100}`,
  infoHTML(v) {
    return `
      <div class="k"><span>Goal</span><b>Lowest score wins</b></div>
      <div class="k"><span>Game ends at</span><b>${v.losingScore || 100} pts</b></div>
      <div class="k"><span>This hand passes</span><b>${v.passDir ? passDirLabel(v.passDir) : '—'}</b></div>
      <p style="background:#1a0e0e;border:1px solid #c0392b;border-radius:8px;padding:8px 10px;margin:10px 0">
        <b style="color:#ff8a8a">☠ The Queen of Spades = 13 points</b> — a quarter of the whole pot in
        one card. Don't take it, and think hard before passing it to someone who can punish you.
      </p>
      <ul>
        <li><b>Pass first.</b> Direction cycles each hand: ← left, → right, ↔ across, then ⟳ hold (no pass).</li>
        <li><b>Follow suit.</b> Must play the led suit if you hold it; highest card of the led suit takes the trick.</li>
        <li><b>♥ are locked</b> until "broken": you can't <i>lead</i> a heart until a heart (or the Q♠) has been played on an earlier trick.</li>
        <li>Each <b>♥</b> = 1 point, the <b>Q♠</b> = 13 — you want to take as few as possible.</li>
        <li>The center hint shows <b>who's winning</b> the open trick and how many <b>points are at stake</b>.</li>
        <li>🌙 <b>Shoot the moon</b>: take ALL 26 penalty points and instead of 26 you get 0 — everyone else +26. The ultimate comeback (watch for the 🌙 flag on a seat).</li>
        <li>Lowest total when someone hits ${v.losingScore || 100} wins the game.</li>
      </ul>`;
  },
});

// ------------------------------------------------------------------ picking + drag
// Gesture model: TAP a card to play/select. HOLD a card (~280ms) to pick it up
// into DRAG state, then slide left/right to reorder MY hand. Reordering is cosmetic
// only (mutates handOrder, never the socket); the server stays authoritative.
const HOLD_MS = 280;          // press-and-hold duration to arm a drag
const MOVE_CANCEL = 14;       // px of movement before the hold fires -> treat as tap, cancel hold
let _g = null;                // { code, startX, startY, holdTimer, armed }

function cardAt(clientX, clientY) {
  if (!handMeshes.length) return null;
  const hits = T.raycast(clientX, clientY, handMeshes.map((h) => h.mesh));
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && obj.userData && obj.userData.kind !== 'hand' && obj.parent) obj = obj.parent;
  return (obj && obj.userData && obj.userData.code) ? obj.userData.code : null;
}

// Which hand slot does a screen-X correspond to? Project each card's world X to
// screen and pick the nearest — robust to the fan curve + camera angle.
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

// lift the held card visually so it's clear it's "picked up"
function liftHeld(code, on) {
  const h = handMeshes.find((m) => m.code === code); if (!h) return;
  h.mesh.position.y += on ? 2.6 : 0;   // pop up while held (renderHand resets next paint)
}

function clearGesture() {
  if (_g && _g.holdTimer) clearTimeout(_g.holdTimer);
  if (_g && _g.armed) T.controls.enabled = true;
  _g = null;
}

T.renderer.domElement.addEventListener('pointerdown', (e) => {
  const code = cardAt(e.clientX, e.clientY);
  if (!code) { _g = null; return; }     // not on a card -> let OrbitControls/HUD have it
  _g = { code, startX: e.clientX, startY: e.clientY, armed: false, holdTimer: null };
  _g.holdTimer = setTimeout(() => {
    if (!_g) return;
    _g.armed = true;                    // HOLD satisfied -> enter drag state
    T.controls.enabled = false;         // lock the camera while dragging a card
    liftHeld(_g.code, true);
    if (T.Sound) T.Sound.tick();        // tactile feedback that the card is picked up
  }, HOLD_MS);
}, false);

T.renderer.domElement.addEventListener('pointermove', (e) => {
  if (!_g) return;
  const dx = e.clientX - _g.startX, dy = e.clientY - _g.startY;
  const moved = Math.hypot(dx, dy);
  if (!_g.armed) {
    // moved too much before the hold fired -> it's a swipe/tap, cancel the hold so
    // the camera can pan/orbit and the tap still registers on release.
    if (moved > MOVE_CANCEL) { clearTimeout(_g.holdTimer); _g.holdTimer = null; }
    return;
  }
  // armed: reorder live as the finger slides
  const from = handOrder.indexOf(_g.code);
  const to = slotAtScreenX(e.clientX);
  if (from !== -1 && to !== -1 && from !== to) {
    handOrder.splice(from, 1);
    handOrder.splice(to, 0, _g.code);
    renderHand();
    liftHeld(_g.code, true);            // keep the dragged card lifted after re-render
  }
  e.stopPropagation();
}, false);

function endGesture(e) {
  if (!_g) return;
  const armed = _g.armed;
  const code = _g.code;
  const hadTimer = !!_g.holdTimer;
  clearGesture();
  if (armed) { if (e) e.stopPropagation(); renderHand(); return; }  // finished a reorder
  if (!hadTimer) return;   // hold was cancelled by a big swipe -> not a tap

  // --- TAP: play / pass-select (priv-gated) ---
  const priv = C.priv; if (!priv) return;
  if (priv.phase === 'passing' && priv.needToPass) {
    const need = priv.passCount || 3;
    if (selPass.has(code)) selPass.delete(code);
    else if (selPass.size < need) selPass.add(code);
    renderHand(); HUD.render();
    return;
  }
  if (priv.phase === 'playing' && C.myTurn()) {
    const ok = (priv.legal || []).some((a) => a.type === 'play' && a.card === code);
    if (ok) C.emitPlayChecked({ type: 'play', card: code });
  }
}
T.renderer.domElement.addEventListener('pointerup', endGesture, false);
T.renderer.domElement.addEventListener('pointercancel', () => clearGesture(), false);
