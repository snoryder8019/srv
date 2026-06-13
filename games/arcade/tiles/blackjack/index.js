/**
 * Blackjack (box model) — casino 21 with 7 betting boxes on the felt.
 *
 * BOXES, not seats, are the unit of play. During the bets phase a player CLAIMS a
 * box by betting on it (tap a circle); a player may claim MULTIPLE boxes — that's
 * multi-hand play. Empty (unclaimed) boxes sit out. Bots claim one open box each.
 * Boxes reset to open at the start of every hand, so an entrant can take any open
 * (or previously bot-held) box for the next deal.
 *
 * Flow per hand:
 *   bets   — claim + stack wagers (+ optional 21+3 / pairs side bets) per box.
 *   play   — boxes play left\u2192right; the box OWNER hits / stands / doubles / splits.
 *            A box can split into multiple hands; each plays out before the next box.
 *   dealer — hole revealed; dealer draws to 17 (stands on all 17); peeks for a natural.
 *   settle — per box per hand: blackjack 3:2, win 1:1, push, bust loses.
 *
 * Bankrolls are per SEAT (player) and RESERVED, not deducted, until settle. A seat's
 * reservation is summed across every box it owns.
 */
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const TENS = new Set(['10', 'J', 'Q', 'K']);
const R = Object.assign({
  blackjackPays: 1.5, dealerStandsSoft17: true, double: true, doubleAfterSplit: true,
  split: true, maxSplitHands: 4, resplitAces: false, decks: 6, penetration: 0.25,
}, cfg.rules || {});
const BJ_PAYS = R.blackjackPays;
const DECKS = R.decks;
const NBOX = (cfg.seating && cfg.seating.boxes) || R.boxes || 7;

function rankOf(code) { return code.slice(0, -1); }
function suitOf(code) { return code.slice(-1); }
function cardVal(rank) { if (rank === 'A') return 11; if (TENS.has(rank)) return 10; return parseInt(rank, 10); }
function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const v = cardVal(rankOf(c)); total += v; if (rankOf(c) === 'A') aces++; }
  let a = aces;
  while (total > 21 && a > 0) { total -= 10; a--; }
  return { total, soft: a > 0 && total <= 21 };
}
function isBlackjack(cards) { return cards.length === 2 && handValue(cards).total === 21; }
function sameRank(cards) { return cards.length === 2 && rankOf(cards[0]) === rankOf(cards[1]); }
function mkHand(cards, bet, fromSplit, fromAces) {
  return { cards: cards.slice(), bet, done: false, doubled: false, fromSplit: !!fromSplit, fromAces: !!fromAces };
}
function mkBox() { return { owner: null, bet: 0, side: { '21+3': 0, pairs: 0 }, hands: [], active: 0 }; }
function buildShoe(decks, rng) {
  const d = [];
  for (let k = 0; k < decks; k++) for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}

// ── side bets ───────────────────────────────────────────────────────────────
const RED = new Set(['H', 'D']);
const STRAIGHT_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function sideTotal(s) { return s ? ((s['21+3'] || 0) + (s.pairs || 0)) : 0; }
function eval213(three) {
  const ranks = three.map(rankOf), suits = three.map(suitOf);
  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const uniq = new Set(ranks).size === 3;
  const vals = ranks.map((r) => STRAIGHT_ORDER.indexOf(r) + 2);
  const seq = (vs) => { const x = [...vs].sort((a, b) => a - b); return x[0] + 1 === x[1] && x[1] + 1 === x[2]; };
  const straight = uniq && (seq(vals) || seq(vals.map((v) => (v === 14 ? 1 : v))));
  if (trips && flush) return { cat: 'suited trips', mult: 100 };
  if (straight && flush) return { cat: 'straight flush', mult: 40 };
  if (trips) return { cat: 'three of a kind', mult: 30 };
  if (straight) return { cat: 'straight', mult: 10 };
  if (flush) return { cat: 'flush', mult: 5 };
  return null;
}
function evalPairs(a, b) {
  if (rankOf(a) !== rankOf(b)) return null;
  if (suitOf(a) === suitOf(b)) return { cat: 'perfect pair', mult: 25 };
  if (RED.has(suitOf(a)) === RED.has(suitOf(b))) return { cat: 'colored pair', mult: 12 };
  return { cat: 'mixed pair', mult: 6 };
}

function boxReserved(b) { return (b.hands.length ? b.hands.reduce((a, x) => a + x.bet, 0) : b.bet) + sideTotal(b.side); }

const blackjack = {
  id: 'blackjack',
  name: 'Blackjack',
  meta: cfg,
  catalog,
  defaults: { startChips: cfg.scoring.startChips, betSize: cfg.scoring.betSize },
  continuous: true,
  boxes: NBOX,

  _match(table) {
    if (!table._bj) {
      table._bj = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0, shoe: null, dealerPool: 0 };
      table.scores = table._bj.bankrolls.slice();
    }
    return table._bj;
  },
  _occupied(table, s) { const x = table.seats[s]; return !!(x && (x.platformId || x.bot)); },
  _reservedFor(h, seat) { let r = ((h.toke && h.toke[seat]) || 0) + ((h.tip && h.tip[seat]) || 0); for (const b of h.boxes) if (b.owner === seat) r += boxReserved(b); return r; },
  // bots hold their bets until every connected, solvent human has locked in —
  // so persona chips fill in AFTER you've readied up, not racing onto the felt.
  _humansReady(table) {
    const h = table.hand; if (!h) return true;
    for (let s = 0; s < table.seatCount; s++) {
      const seat = table.seats[s];
      if (seat && seat.platformId && !seat.bot && seat.connected && h.match.bankrolls[s] > 0 && !h.locked[s]) return false;
    }
    return true;
  },

  startHand(table, rng) {
    const m = this._match(table);
    m.handNo += 1;
    table.hand = {
      phase: 'bets',
      boxes: Array.from({ length: NBOX }, mkBox),
      locked: new Array(table.seatCount).fill(false),
      dealer: [], hideHole: true, shoe: [], turn: null,
      toke: new Array(table.seatCount).fill(0), tip: new Array(table.seatCount).fill(0),
      _rng: rng, match: m,
    };
    return table.hand;
  },

  currentTurn(table) {
    const h = table.hand;
    if (!h || h.phase !== 'play' || h.turn == null) return null;
    const b = h.boxes[h.turn];
    return b ? b.owner : null;
  },

  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (this._occupied(table, s) && h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'play') { const seat = this.currentTurn(table); return (seat != null && table.seats[seat] && table.seats[seat].bot) ? [seat] : []; }
    if (!this._humansReady(table)) return [];   // bets phase: wait for humans to ready up
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },

  // pick a default box for a bare {type:'bet'} (no box index): a box this seat
  // already owns, else the lowest open box.
  _defaultBox(h, seat) {
    let owned = -1, open = -1;
    for (let i = 0; i < h.boxes.length; i++) {
      if (h.boxes[i].owner === seat && owned < 0) owned = i;
      if (h.boxes[i].owner == null && open < 0) open = i;
    }
    return owned >= 0 ? owned : open;
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h) return [];
    if (h.phase === 'bets') {
      const acts = [];
      if (this._occupied(table, seat) && h.match.bankrolls[seat] > 0 && !h.locked[seat]) {
        const free = h.match.bankrolls[seat] - this._reservedFor(h, seat);
        const amount = Math.min(free, table.config.betSize);
        if (amount > 0) {
          acts.push({ type: 'bet', amount });
          acts.push({ type: 'bet', side: '21+3', amount });
          acts.push({ type: 'bet', side: 'pairs', amount });
          acts.push({ type: 'bet', side: 'dealer', amount });
          acts.push({ type: 'bet', side: 'tip', amount });
        }
        acts.push({ type: 'done' });
      }
      return acts;
    }
    if (h.phase === 'play' && h.turn != null) {
      const box = h.boxes[h.turn];
      if (!box || box.owner !== seat) return [];
      const ah = box.hands[box.active];
      if (!ah || ah.done) return [];
      const acts = [{ type: 'hit' }, { type: 'stand' }];
      const free = h.match.bankrolls[seat] - this._reservedFor(h, seat);
      const two = ah.cards.length === 2;
      if (R.double && two && !ah.fromAces && free >= ah.bet && (R.doubleAfterSplit || box.hands.length === 1)) acts.push({ type: 'double' });
      if (R.split && two && sameRank(ah.cards) && box.hands.length < R.maxSplitHands && free >= ah.bet) {
        const isAces = rankOf(ah.cards[0]) === 'A';
        if (!(isAces && ah.fromAces && !R.resplitAces)) acts.push({ type: 'split' });
      }
      return acts;
    }
    return [];
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    if (h.phase === 'bets') {
      if (h.match.bankrolls[seat] <= 0) return { ok: false, error: 'no chips' };
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'bet') {
        if (action.side === 'dealer' || action.side === 'tip') {
          const free = h.match.bankrolls[seat] - this._reservedFor(h, seat);
          const amount = Math.max(0, Math.min(free, action.amount || table.config.betSize));
          if (amount <= 0) return { ok: false, error: 'insufficient' };
          if (action.side === 'dealer') h.toke[seat] += amount; else h.tip[seat] += amount;
          events.push({ type: 'bet', seat, side: action.side, amount, total: action.side === 'dealer' ? h.toke[seat] : h.tip[seat] });
          return { ok: true, events, handOver: false, gameOver: false };
        }
        let bi = (typeof action.box === 'number') ? action.box : this._defaultBox(h, seat);
        if (bi == null || bi < 0 || bi >= h.boxes.length) return { ok: false, error: 'no open box' };
        const box = h.boxes[bi];
        if (box.owner != null && box.owner !== seat) return { ok: false, error: 'box taken' };
        const free = h.match.bankrolls[seat] - this._reservedFor(h, seat);
        const amount = Math.max(0, Math.min(free, action.amount || table.config.betSize));
        if (amount <= 0) return { ok: false, error: 'insufficient' };
        box.owner = seat;
        const side = action.side;
        if (side === '21+3' || side === 'pairs') {
          box.side[side] = (box.side[side] || 0) + amount;
          events.push({ type: 'bet', seat, box: bi, side, amount, total: box.side[side] });
        } else {
          box.bet += amount;
          events.push({ type: 'bet', seat, box: bi, amount, total: box.bet });
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'clear') {
        // release a box you own (before the deal)
        const bi = action.box;
        if (typeof bi === 'number' && h.boxes[bi] && h.boxes[bi].owner === seat) {
          h.boxes[bi] = mkBox();
          events.push({ type: 'clear', seat, box: bi });
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'done') {
        h.locked[seat] = true;
        events.push({ type: 'locked', seat });
        return this._dealIfReady(table, h, events);
      }
      return { ok: false, error: 'expected bet/clear/done' };
    }

    if (h.phase === 'play') {
      if (h.turn == null) return { ok: false, error: 'not in play' };
      const box = h.boxes[h.turn];
      if (!box || box.owner !== seat) return { ok: false, error: 'not your turn' };
      const ai = box.active;
      const ah = box.hands[ai];
      if (!ah || ah.done) return { ok: false, error: 'not your hand' };
      const free = h.match.bankrolls[seat] - this._reservedFor(h, seat);

      if (action.type === 'stand') {
        ah.done = true;
        events.push({ type: 'stand', seat, box: h.turn, hand: ai, total: handValue(ah.cards).total });
        return this._advanceTurn(table, h, events);
      }
      if (action.type === 'hit') {
        ah.cards.push(h.shoe.pop());
        const v = handValue(ah.cards);
        events.push({ type: 'hit', seat, box: h.turn, hand: ai, card: ah.cards[ah.cards.length - 1], total: v.total });
        if (v.total >= 21) { ah.done = true; if (v.total > 21) events.push({ type: 'bust', seat, box: h.turn, hand: ai, total: v.total }); return this._advanceTurn(table, h, events); }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'double') {
        if (ah.cards.length !== 2) return { ok: false, error: 'double only on first two' };
        if (ah.fromAces) return { ok: false, error: 'cannot double split aces' };
        if (!(R.doubleAfterSplit || box.hands.length === 1)) return { ok: false, error: 'double after split not allowed' };
        if (free < ah.bet) return { ok: false, error: 'insufficient to double' };
        ah.bet += ah.bet;
        ah.cards.push(h.shoe.pop());
        ah.doubled = true; ah.done = true;
        const v = handValue(ah.cards);
        events.push({ type: 'double', seat, box: h.turn, hand: ai, card: ah.cards[ah.cards.length - 1], total: v.total, bet: ah.bet });
        if (v.total > 21) events.push({ type: 'bust', seat, box: h.turn, hand: ai, total: v.total });
        return this._advanceTurn(table, h, events);
      }
      if (action.type === 'split') {
        if (!R.split) return { ok: false, error: 'split not allowed' };
        if (ah.cards.length !== 2 || !sameRank(ah.cards)) return { ok: false, error: 'split needs a pair' };
        if (box.hands.length >= R.maxSplitHands) return { ok: false, error: 'max splits reached' };
        if (free < ah.bet) return { ok: false, error: 'insufficient to split' };
        const isAces = rankOf(ah.cards[0]) === 'A';
        const c2 = ah.cards.pop();
        const nh = mkHand([c2], ah.bet, true, isAces);
        ah.fromSplit = true; ah.fromAces = isAces;
        ah.cards.push(h.shoe.pop());
        nh.cards.push(h.shoe.pop());
        box.hands.splice(ai + 1, 0, nh);
        if (isAces) { ah.done = true; nh.done = true; }
        else { if (handValue(ah.cards).total === 21) ah.done = true; if (handValue(nh.cards).total === 21) nh.done = true; }
        events.push({ type: 'split', seat, box: h.turn, hand: ai, cards: [ah.cards.slice(), nh.cards.slice()], bet: ah.bet, aces: isAces });
        if (ah.done) return this._advanceTurn(table, h, events);
        return { ok: true, events, handOver: false, gameOver: false };
      }
      return { ok: false, error: 'expected hit/stand/double/split' };
    }
    return { ok: false, error: `cannot act in phase ${h.phase}` };
  },

  _dealIfReady(table, h, events) {
    for (let s = 0; s < table.seatCount; s++) if (this._occupied(table, s) && h.match.bankrolls[s] > 0 && !h.locked[s]) return { ok: true, events, handOver: false, gameOver: false };
    const anyBet = h.boxes.some((b) => b.owner != null && (b.bet > 0 || sideTotal(b.side) > 0));
    if (!anyBet) return { ok: true, events, handOver: true, gameOver: false };
    return this._deal(table, h, events);
  },

  _ensureShoe(table, h, events) {
    const m = h.match;
    const total = DECKS * 52;
    if (!m.shoe || m.shoe.length < Math.floor(total * R.penetration)) {
      m.shoe = buildShoe(DECKS, h._rng);
      events.push({ type: 'shuffle', decks: DECKS, cards: m.shoe.length });
    }
    h.shoe = m.shoe;
  },

  _playingBoxes(h) {
    const out = [];
    for (let i = 0; i < h.boxes.length; i++) { const b = h.boxes[i]; if (b.owner != null && (b.bet > 0 || sideTotal(b.side) > 0)) out.push(i); }
    return out;
  },

  _deal(table, h, events) {
    this._ensureShoe(table, h, events);
    const playing = this._playingBoxes(h);
    const c1 = {}, c2 = {};
    for (const i of playing) c1[i] = h.shoe.pop();
    h.dealer.push(h.shoe.pop());                       // upcard
    for (const i of playing) c2[i] = h.shoe.pop();
    h.dealer.push(h.shoe.pop());                       // hole
    h.hideHole = true; h.phase = 'play';
    for (const i of playing) { const b = h.boxes[i]; b.hands = [mkHand([c1[i], c2[i]], b.bet)]; b.active = 0; }
    events.push({ type: 'deal', dealerUp: h.dealer[0], boxes: h.boxes.map((b) => (b.hands.length ? b.hands[0].cards.slice() : null)) });
    // side bets resolve off the first three cards (two player + up-card)
    const m = h.match, beforeSide = m.bankrolls.slice(), sideBreak = [];
    for (const i of playing) { for (const r of this._resolveSide(h, i)) sideBreak.push({ box: i, seat: h.boxes[i].owner, ...r }); }
    if (sideBreak.length) {
      table.scores = m.bankrolls.slice();
      events.push({ type: 'sidebets', breakdown: sideBreak, deltas: m.bankrolls.map((v, i) => v - beforeSide[i]), bankrolls: m.bankrolls.slice() });
    }
    // naturals + side-only boxes auto-stand
    for (const i of playing) { const b = h.boxes[i]; const hand = b.hands[0]; if (b.bet <= 0 || isBlackjack(hand.cards)) hand.done = true; }
    // dealer peek: a dealer natural ends the hand before anyone acts
    if (isBlackjack(h.dealer)) return this._toDealer(table, h, events);
    h.turn = null;
    for (let i = 0; i < h.boxes.length; i++) { const b = h.boxes[i]; const idx = b.hands.findIndex((x) => !x.done); if (idx >= 0) { h.turn = i; b.active = idx; break; } }
    if (h.turn == null) return this._toDealer(table, h, events);
    return { ok: true, events, handOver: false, gameOver: false };
  },

  _resolveSide(h, i) {
    const out = [], box = h.boxes[i], sb = box.side || {}, cards = box.hands[0].cards, up = h.dealer[0], owner = box.owner;
    if (sb['21+3'] > 0) {
      const r = eval213([cards[0], cards[1], up]); const amt = sb['21+3']; const delta = r ? amt * r.mult : -amt;
      h.match.bankrolls[owner] += delta; out.push({ kind: '21+3', amount: amt, cat: r ? r.cat : 'no win', delta });
    }
    if (sb.pairs > 0) {
      const r = evalPairs(cards[0], cards[1]); const amt = sb.pairs; const delta = r ? amt * r.mult : -amt;
      h.match.bankrolls[owner] += delta; out.push({ kind: 'pairs', amount: amt, cat: r ? r.cat : 'no win', delta });
    }
    box.side = { '21+3': 0, pairs: 0 };
    return out;
  },

  _advanceTurn(table, h, events) {
    const box = h.boxes[h.turn];
    for (let i = box.active + 1; i < box.hands.length; i++) {
      if (!box.hands[i].done) { box.active = i; events.push({ type: 'handFocus', box: h.turn, hand: i }); return { ok: true, events, handOver: false, gameOver: false }; }
    }
    for (let i = h.turn + 1; i < h.boxes.length; i++) {
      const nb = h.boxes[i]; const idx = nb.hands.findIndex((x) => !x.done);
      if (idx >= 0) { h.turn = i; nb.active = idx; events.push({ type: 'boxFocus', box: i, seat: nb.owner }); return { ok: true, events, handOver: false, gameOver: false }; }
    }
    return this._toDealer(table, h, events);
  },

  _toDealer(table, h, events) {
    const m = h.match, before = m.bankrolls.slice();
    h.hideHole = false; h.phase = 'dealer';
    events.push({ type: 'dealerReveal', hole: h.dealer[1], total: handValue(h.dealer).total });
    const anyLive = (() => {
      for (const b of h.boxes) for (const hand of b.hands) if (hand.bet > 0 && handValue(hand.cards).total <= 21) return true;
      return false;
    })();
    if (anyLive) {
      while (handValue(h.dealer).total < 17) { const c = h.shoe.pop(); h.dealer.push(c); events.push({ type: 'dealerCard', card: c, total: handValue(h.dealer).total }); }
    }
    const dv = handValue(h.dealer), dealerBust = dv.total > 21, dealerBJ = isBlackjack(h.dealer);
    const breakdown = [];
    for (let i = 0; i < h.boxes.length; i++) {
      const box = h.boxes[i];
      for (let hi = 0; hi < box.hands.length; hi++) {
        const hand = box.hands[hi]; if (hand.bet <= 0) continue;
        const pv = handValue(hand.cards), pBust = pv.total > 21;
        const pBJ = hand.cards.length === 2 && pv.total === 21 && !hand.fromSplit;
        const bet = hand.bet; let result, delta;
        if (pBust) { result = 'lose'; delta = -bet; }
        else if (pBJ && !dealerBJ) { result = 'blackjack'; delta = Math.round(bet * BJ_PAYS); }
        else if (pBJ && dealerBJ) { result = 'push'; delta = 0; }
        else if (dealerBJ) { result = 'lose'; delta = -bet; }
        else if (dealerBust) { result = 'win'; delta = bet; }
        else if (pv.total > dv.total) { result = 'win'; delta = bet; }
        else if (pv.total < dv.total) { result = 'lose'; delta = -bet; }
        else { result = 'push'; delta = 0; }
        if (box.owner != null) m.bankrolls[box.owner] += delta;
        breakdown.push({ box: i, seat: box.owner, hand: hi, result, delta, total: pv.total, bet, doubled: hand.doubled, split: hand.fromSplit });
      }
    }
    // dealer tips + tokes — funded by the player, collected by the dealer pool. A
    // toke "rides with" the seat's main play: it pays the dealer (2x) when the seat
    // finished the round up on its box bets; a flat tip is an outright gift.
    const seatDelta = new Array(table.seatCount).fill(0);
    for (const r of breakdown) if (r.seat != null && typeof r.delta === 'number') seatDelta[r.seat] += r.delta;
    let handTip = 0, handToke = 0;
    for (let s = 0; s < table.seatCount; s++) {
      const tip = (h.tip && h.tip[s]) || 0, toke = (h.toke && h.toke[s]) || 0;
      if (tip > 0) { m.bankrolls[s] -= tip; handTip += tip; breakdown.push({ seat: s, spot: 'tip', amount: tip, delta: -tip, note: 'tip' }); }
      if (toke > 0) { const won = seatDelta[s] > 0; m.bankrolls[s] -= toke; if (won) handToke += toke * 2; breakdown.push({ seat: s, spot: 'dealer', amount: toke, delta: -toke, note: won ? 'toke win' : 'toke' }); }
    }
    m.dealerPool = (m.dealerPool || 0) + handTip + handToke;
    table.scores = m.bankrolls.slice();
    const deltas = m.bankrolls.map((v, i) => v - before[i]);
    events.push({ type: 'settle', dealerTotal: dv.total, dealerBust, dealerBJ, dealerCards: h.dealer.slice(), breakdown, deltas, bankrolls: m.bankrolls.slice(), dealerTip: handTip, dealerWin: handToke, dealerPool: m.dealerPool });
    return { ok: true, events, handOver: true, gameOver: false };
  },

  gameResult(table) {
    const m = this._match(table);
    let w = 0; for (let s = 1; s < table.seatCount; s++) if (m.bankrolls[s] > m.bankrolls[w]) w = s;
    return { mode: 'individual', winnerSeat: w, totals: m.bankrolls.slice() };
  },
  resetMatch(table) {
    table._bj = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0, shoe: null, dealerPool: 0 };
    table.scores = table._bj.bankrolls.slice();
  },

  _boxView(b) {
    const primary = b.hands[b.active] || b.hands[0] || null;
    const cards = primary ? primary.cards : [];
    const v = cards.length ? handValue(cards) : { total: 0, soft: false };
    return {
      owner: b.owner,
      bet: b.hands.length ? b.hands.reduce((a, x) => a + x.bet, 0) : b.bet,
      side: { '21+3': (b.side && b.side['21+3']) || 0, pairs: (b.side && b.side.pairs) || 0 },
      hands: b.hands.map((x) => { const hv = handValue(x.cards); return { cards: x.cards.slice(), total: hv.total, soft: hv.soft, bet: x.bet, done: x.done, busted: hv.total > 21, blackjack: (x.cards.length === 2 && hv.total === 21 && !x.fromSplit), doubled: x.doubled, fromSplit: x.fromSplit }; }),
      active: b.active, handCount: b.hands.length,
      cards: cards.slice(), total: v.total, soft: v.soft,
      busted: cards.length ? v.total > 21 : false,
      blackjack: primary ? (primary.cards.length === 2 && handValue(primary.cards).total === 21 && !primary.fromSplit) : false,
      done: b.hands.length ? b.hands.every((x) => x.done) : false,
    };
  },
  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby', boxes: NBOX };
    const dealerCards = h.hideHole && h.dealer.length ? [h.dealer[0], null] : h.dealer.slice();
    return {
      phase: h.phase, turn: h.phase === 'play' ? h.turn : null, turnSeat: this.currentTurn(table),
      dealer: { cards: dealerCards, total: h.hideHole ? null : handValue(h.dealer).total, hideHole: h.hideHole },
      boxes: h.boxes.map((b) => this._boxView(b)),
      boxCount: NBOX,
      locked: h.locked.slice(),
      bankrolls: h.match.bankrolls.slice(), round: h.match.handNo, continuous: true, dealerPool: h.match.dealerPool || 0,
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, legal: [], boxes: [] };
    const boxes = h.boxes.map((b) => { const bv = this._boxView(b); bv.mine = (b.owner === seat); return bv; });
    const myBoxes = []; for (let i = 0; i < h.boxes.length; i++) if (h.boxes[i].owner === seat) myBoxes.push(i);
    const activeBox = (h.phase === 'play' && h.turn != null && h.boxes[h.turn] && h.boxes[h.turn].owner === seat) ? h.turn : null;
    const ah = activeBox != null ? h.boxes[activeBox].hands[h.boxes[activeBox].active] : null;
    const av = ah ? handValue(ah.cards) : { total: 0, soft: false };
    return {
      seat, phase: h.phase, turn: h.phase === 'play' ? h.turn : null, turnSeat: this.currentTurn(table),
      yourTurn: (h.phase === 'bets' && this._occupied(table, seat) && !h.locked[seat] && h.match.bankrolls[seat] > 0) || activeBox != null,
      locked: h.locked[seat], bankroll: h.match.bankrolls[seat],
      boxes, myBoxes, activeBox,
      activeHand: ah ? (h.boxes[activeBox].active) : null,
      myTotal: av.total, soft: av.soft,
      reserved: this._reservedFor(h, seat),
      myToke: (h.toke && h.toke[seat]) || 0, myTip: (h.tip && h.tip[seat]) || 0,
      legal: this.legalActions(table, seat),
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'bets') {
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      if (!this._humansReady(table)) return null;   // hold until humans have locked in
      const ownsAny = h.boxes.some((b) => b.owner === seat);
      if (!ownsAny) {
        const open = h.boxes.findIndex((b) => b.owner == null);
        if (open >= 0) { const amount = Math.min(h.match.bankrolls[seat], table.config.betSize); if (amount > 0) return { type: 'bet', box: open, amount }; }
      }
      return { type: 'done' };
    }
    if (h.phase === 'play') {
      const seatTurn = this.currentTurn(table);
      if (seatTurn !== seat || h.turn == null) return null;
      const box = h.boxes[h.turn]; const ah = box.hands[box.active]; if (!ah) return null;
      const v = handValue(ah.cards);
      if (v.total < 17 || (v.soft && v.total === 17)) return { type: 'hit' };
      return { type: 'stand' };
    }
    return null;
  },
};

export default blackjack;
