/**
 * game3d.js — interactive 3D client for the engine-backed table/casino variants
 * (euchre, mahjong, craps, roulette). One generic shell: it wires the SHARED
 * pieces — table core (table3d), socket client (tableclient3d), HUD (hud3d) — and
 * selects a small per-game ADAPTER that knows how to turn that game's
 * legal-action list + view into tappable controls, a status line, an action-bar
 * readout, a scoreboard line, and rules copy.
 *
 * Game id comes from the path (/lobby/<game>). All move legality stays server-
 * authoritative: controls are built from priv.legal and sent via emitAction, and
 * the server validates again. Dominoes/hearts keep their bespoke clients; this is
 * for the four engine ports that don't need card-dragging physics yet.
 */
import { createTable3D } from './table3d.js';
import { createTableClient } from './tableclient3d.js';
import { createHUD } from './hud3d.js';

const seg = location.pathname.split('/').filter(Boolean);
const GAME = (seg[seg.length - 1] || 'euchre').toLowerCase();

// pretty helpers -------------------------------------------------------------
const SUIT_SYM = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_CLR = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };
const SUIT_INI = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
function cardLabel(code) {                       // "10S" -> "10♠"
  if (!code) return '';
  const suit = SUIT_INI[code.slice(-1)] || '';
  return code.slice(0, -1) + (SUIT_SYM[suit] || '');
}
function cardClass(code) { return SUIT_CLR[SUIT_INI[code.slice(-1)]] === 'red' ? 'gold' : 'ghost'; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// per-game adapters ----------------------------------------------------------
const ADAPTERS = {
  euchre: {
    title: 'EUCHRE', scoreLabel: 'First team to 10', lowerWins: false,
    info: `<p><b>Euchre</b> — partners sit across (you + the player opposite). 24-card deck, 9 to A.</p>
      <ul><li><b>Bid round 1:</b> order up the turned card's suit as trump, or pass.</li>
      <li><b>Bid round 2:</b> if all pass, call a different suit. The dealer must call (stick the dealer).</li>
      <li><b>Bowers:</b> the Jack of trump (right) is highest; the other Jack of the same color (left) is 2nd and counts as trump.</li>
      <li>Win 3–4 tricks = 1 point, all 5 = 2. Get euchred (makers &lt;3) and the other team takes 2.</li></ul>`,
    status(v, me) {
      if (v.phase === 'bid1') return v.turn === me ? `<b>Order up?</b> ${cardLabel(v.upcard)} is up` : `Bidding · ${cardLabel(v.upcard)} up`;
      if (v.phase === 'bid2') return v.turn === me ? `<b>Call trump</b> (not ${cardLabel(v.upcard)?.slice(-1)})` : 'Calling trump…';
      if (v.phase === 'discard') return v.turn === me ? '<b>Discard a card</b>' : 'Dealer discarding…';
      if (v.phase === 'play') {
        const t = v.trump ? `${SUIT_SYM[v.trump]} trump` : '';
        return (v.turn === me ? '<b>YOUR TURN</b> · ' : `Seat ${v.turn} · `) + t;
      }
      return '…';
    },
    actionbar(v) {
      const chips = [];
      if (v.trump) chips.push(`<span class="chip">trump <b>${SUIT_SYM[v.trump]}</b></span>`);
      if (v.trick && v.trick.length) chips.push(`<span class="chip">trick: ${v.trick.map((p) => cardLabel(p.card)).join(' ')}</span>`);
      if (v.trickWins) chips.push(`<span class="chip">tricks ${v.trickWins.reduce((a, b) => a + b, 0)}/5</span>`);
      return chips.join('');
    },
    controls(box, { priv, myTurn, send }) {
      if (!myTurn || !priv.legal || !priv.legal.length) return;
      for (const a of priv.legal) {
        if (a.type === 'orderUp') addBtn(box, 'Order up ▲', 'gold', () => send(a));
        else if (a.type === 'pass') addBtn(box, 'Pass', 'ghost', () => send(a));
        else if (a.type === 'callTrump') addBtn(box, `Call ${SUIT_SYM[a.suit]}`, cardClass('x' + a.suit[0].toUpperCase()), () => send(a));
        else if (a.type === 'discard') addBtn(box, `✕ ${cardLabel(a.card)}`, cardClass(a.card), () => send(a));
        else if (a.type === 'play') addBtn(box, cardLabel(a.card), cardClass(a.card), () => send(a));
      }
    },
    score(v, seat) {
      const team = seat % 2;
      return { score: (v.teamPoints && v.teamPoints[team]) || 0, sub: `team ${team === 0 ? 'A' : 'B'}` };
    },
  },

  mahjong: {
    title: 'MAHJONG', scoreLabel: 'First to win a hand', lowerWins: false,
    info: `<p><b>Mahjong</b> — draw and discard to build a complete hand: four melds + a pair.</p>
      <ul><li>A meld is a <b>pung</b> (three identical) or a <b>chow</b> (three in a row, same suit).</li>
      <li>On your turn: <b>draw</b> a tile, then <b>discard</b> one — or declare <b>Mahjong</b> if complete.</li>
      <li>This table is a self-draw race (no claiming others' discards yet).</li></ul>`,
    status(v, me) {
      if (v.turn === me) return '<b>YOUR TURN</b> · draw, then discard';
      return `Seat ${v.turn} · wall ${v.wall}`;
    },
    actionbar(v) {
      const chips = [`<span class="chip">wall <b>${v.wall}</b></span>`];
      if (v.lastDiscards && v.lastDiscards.length) chips.push(`<span class="chip">discards: ${v.lastDiscards.slice(-6).map(tileLabel).join(' ')}</span>`);
      return chips.join('');
    },
    controls(box, { priv, myTurn, send }) {
      if (!myTurn || !priv.legal || !priv.legal.length) return;
      const win = priv.legal.find((a) => a.type === 'win');
      if (win) addBtn(box, '🀄 Mahjong!', 'gold', () => send(win));
      const draw = priv.legal.find((a) => a.type === 'draw');
      if (draw) { addBtn(box, 'Draw tile', 'act', () => send(draw)); return; }
      // discard phase: show the hand as tappable tiles
      for (const a of priv.legal) if (a.type === 'discard') addBtn(box, tileLabel(a.tile), 'tile', () => send(a));
    },
    score(v, seat) { return { score: (v.points && v.points[seat]) || 0, sub: `${(v.handCounts && v.handCounts[seat]) || 0} tiles` }; },
  },

  craps: {
    title: 'CRAPS', scoreLabel: 'Most chips wins', lowerWins: false,
    info: `<p><b>Craps</b> — bet the line, then the shooter rolls.</p>
      <ul><li><b>Pass</b> wins on a come-out 7/11, loses on 2/3/12. Otherwise that number is the <b>point</b>.</li>
      <li>Once a point is set, <b>pass</b> wins if the point repeats before a 7.</li>
      <li><b>Don't pass</b> is the opposite. Build the biggest bankroll before the rounds run out.</li></ul>`,
    status(v, me) {
      if (v.phase === 'bets') return (this._betterIsMe(v, me)) ? '<b>Place your bet</b>' : 'Betting…';
      if (v.phase === 'roll') return v.shooter === me ? '<b>Your roll</b> 🎲' : `Seat ${v.shooter} shooting…`;
      return '…';
    },
    _betterIsMe(v, me) { return v.turn === me; },
    actionbar(v) {
      const chips = [];
      chips.push(`<span class="chip">${v.comeout ? 'come-out' : 'point <b>' + v.point + '</b>'}</span>`);
      if (v.lastRoll) chips.push(`<span class="chip big">🎲 ${v.lastRoll[0]}+${v.lastRoll[1]} = ${v.lastRoll[0] + v.lastRoll[1]}</span>`);
      chips.push(`<span class="chip">round ${v.round}/${v.maxRounds}</span>`);
      return chips.join('');
    },
    controls(box, { priv, myTurn, send }) {
      if (!priv.legal || !priv.legal.length) return;
      const isRoll = priv.legal.some((a) => a.type === 'roll');
      if (isRoll) { addBtn(box, 'Roll 🎲', 'gold', () => send({ type: 'roll' })); return; }
      for (const a of priv.legal) {
        if (a.type !== 'bet') continue;
        const label = a.side === 'pass' ? `Pass line (${a.amount})` : `Don't pass (${a.amount})`;
        addBtn(box, label, a.side === 'pass' ? 'act' : 'ghost', () => send(a));
      }
    },
    score(v, seat) { return { score: (v.bankrolls && v.bankrolls[seat]) || 0, sub: 'chips' }; },
  },

  roulette: {
    title: 'ROULETTE', scoreLabel: 'Most chips wins', lowerWins: false,
    info: `<p><b>Roulette</b> — place a bet, the wheel spins, bets settle.</p>
      <ul><li><b>Red/Black, Even/Odd, Low (1–18)/High (19–36)</b> pay even money.</li>
      <li>A <b>straight number</b> (0–36) pays 35:1.</li>
      <li>European single-zero wheel. Build the biggest bankroll before the spins run out.</li></ul>`,
    status(v, me) {
      if (v.phase === 'bets') return v.turn === me ? '<b>Place your bet</b>' : 'Betting…';
      return 'Spinning…';
    },
    actionbar(v) {
      const chips = [];
      if (v.lastPocket != null) chips.push(`<span class="chip big ${v.lastColor}">● ${v.lastPocket}</span>`);
      chips.push(`<span class="chip">round ${v.round}/${v.maxRounds}</span>`);
      return chips.join('');
    },
    controls(box, { priv, myTurn, send }) {
      if (!myTurn || !priv.legal || !priv.legal.length) return;
      const amt = (priv.legal[0] && priv.legal[0].amount) || 10;
      for (const a of priv.legal) {
        if (a.type !== 'bet') continue;
        const cls = a.side === 'red' ? 'red' : a.side === 'black' ? 'black' : 'ghost';
        addBtn(box, cap(a.side), cls, () => send(a));
      }
      // a couple of straight-number quick bets (lucky 7, and 0) — full board can come later
      addBtn(box, `7 (35:1)`, 'gold', () => send({ type: 'bet', side: 'number', n: 7, amount: amt }));
      addBtn(box, `0 (35:1)`, 'gold', () => send({ type: 'bet', side: 'number', n: 0, amount: amt }));
    },
    score(v, seat) { return { score: (v.bankrolls && v.bankrolls[seat]) || 0, sub: 'chips' }; },
  },
};

function tileLabel(code) { return code || ''; }
function addBtn(box, text, cls, onclick) {
  const b = document.createElement('button');
  b.className = 'act ' + (cls || '');
  b.textContent = text;
  b.onclick = () => { b.disabled = true; onclick(); };
  box.appendChild(b);
}

// boot -----------------------------------------------------------------------
const A = ADAPTERS[GAME] || ADAPTERS.euchre;

const T = createTable3D({ tableRadius: 34, bgScene: GAME });

const C = createTableClient({
  onState() { paint(); },
  onPriv() { paint(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus(`<b style="color:#ff6f52">${msg}</b>`); },
});

const HUD = createHUD({
  client: C, Sound: T.Sound, title: A.title,
  scoreLabel: A.scoreLabel, lowerWins: A.lowerWins,
  onResetCam: () => T.resetCamera(),
  statusLine: (v) => A.status.call(A, v, C.mySeat),
  infoHTML: () => A.info,
  scoreFor: (v, seat) => A.score(v, seat),
  renderActions: (box, { state, priv, myTurn }) => {
    if (!priv) return;
    A.controls(box, { state, view: state.view || {}, priv, myTurn, send: (action) => { C.emitAction(action); } });
  },
});
if (document.getElementById('infoTitle')) document.getElementById('infoTitle').textContent = 'How to play · ' + cap(GAME);
document.title = cap(GAME) + ' · tiles.madladslab';

// seats + action-bar readout
let seatsBuilt = 0;
function paint() {
  const st = C.state; if (!st) return;
  const v = st.view || {};
  const seats = st.seats || [];
  if (seats.length !== seatsBuilt) { T.buildSeats(seats.length, C.mySeat || 0); seatsBuilt = seats.length; }
  seats.forEach((s) => {
    const sc = A.score(v, s.seat);
    T.updateSeat(s.seat, {
      name: s.displayName || ('Seat ' + s.seat),
      sub: (s.bot ? 'bot · ' : '') + (sc.sub || ''),
      score: sc.score,
      turn: v.turn === s.seat && st.phase === 'playing',
      you: s.seat === C.mySeat,
    });
  });
  const bar = document.getElementById('actionbar');
  if (bar) bar.innerHTML = (st.phase === 'playing' && A.actionbar) ? A.actionbar(v) : '';
  HUD.render();
}

function onEvent(ev) {
  if (!ev || !ev.type) return;
  // light sounds + vote passthrough; the per-game readout comes from state
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
  if (T.Sound) {
    if (ev.type === 'play' || ev.type === 'drew' || ev.type === 'discarded' || ev.type === 'bet') T.Sound.play && T.Sound.play();
    if (ev.type === 'roll' || ev.type === 'spin') T.Sound.play && T.Sound.play();
    if (ev.type === 'trickWon' || ev.type === 'mahjong' || ev.type === 'settle' || ev.type === 'handScored') T.Sound.play && T.Sound.play();
  }
}

// mute persistence parity with hearts
try { if (localStorage.getItem('cards_muted') === '1' && T.Sound) T.Sound.setMuted(true); } catch (e) {}
