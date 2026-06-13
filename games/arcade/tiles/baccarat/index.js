/**
 * Baccarat (punto banco) — shared-outcome casino card game on a continuous table.
 *
 * Everyone at the table bets the SAME dealt hand. Each seat may stack any of:
 *   PLAYER  1:1      · BANKER  0.95:1 (5% commission) · TIE  8:1 (P/B push on a tie)
 *   P PAIR / B PAIR  11:1  (first two cards of that side are a pair)
 *   DEALER  — a toke bet placed FOR the dealer on Banker (funds the dealer pool)
 *   TIP     — a flat gift straight to the dealer pool
 *
 * Flow per hand: bets → deal Player/Banker two cards each → third-card rules
 * (fixed table, no decisions) → settle every bet. Cards draw from a persistent
 * multi-deck shoe that reshuffles past the cut card (emits a `shuffle` event).
 * Bankrolls are RESERVED, not deducted, until settle.
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
const R = Object.assign({ bankerCommission: 0.05, tiePays: 8, pairPays: 11, decks: 6, penetration: 0.2 }, cfg.rules || {});
const DECKS = R.decks;
const SPOTS = ['player', 'banker', 'tie', 'ppair', 'bpair', 'dealer', 'tip'];
const RETURNS = new Set(['player', 'banker', 'tie', 'ppair', 'bpair']);   // spots that can pay the bettor

function rankOf(c) { return c.slice(0, -1); }
function cardVal(c) { const r = rankOf(c); if (r === 'A') return 1; if (TENS.has(r)) return 0; return parseInt(r, 10); }
function total(cards) { return cards.reduce((a, c) => a + cardVal(c), 0) % 10; }
function isPair(cards) { return cards.length >= 2 && rankOf(cards[0]) === rankOf(cards[1]); }
function buildShoe(decks, rng) {
  const d = [];
  for (let k = 0; k < decks; k++) for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}
function mkBets() { return { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0, dealer: 0, tip: 0 }; }

const baccarat = {
  id: 'baccarat',
  name: 'Baccarat',
  meta: cfg,
  catalog,
  defaults: { startChips: cfg.scoring.startChips, betSize: cfg.scoring.betSize },
  continuous: true,

  _match(table) {
    if (!table._bac) {
      table._bac = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0, shoe: null, dealerPool: 0, recent: [] };
      table.scores = table._bac.bankrolls.slice();
    }
    return table._bac;
  },
  _occupied(table, s) { const x = table.seats[s]; return !!(x && (x.platformId || x.bot)); },
  _staked(h, seat) { const b = h.bets[seat]; return SPOTS.reduce((a, k) => a + (b[k] || 0), 0); },
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
      bets: Array.from({ length: table.seatCount }, mkBets),
      locked: new Array(table.seatCount).fill(false),
      player: [], banker: [], outcome: null, pt: 0, bt: 0,
      shoe: [], _rng: rng, match: m,
    };
    return table.hand;
  },

  currentTurn() { return null; },   // no per-seat turns — the hand auto-deals

  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (this._occupied(table, s) && h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  botSeatsToAct(table) {
    const h = table.hand; if (!h || h.phase !== 'bets') return [];
    if (!this._humansReady(table)) return [];   // bots fill in after humans ready up
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets') return [];
    if (!this._occupied(table, seat) || h.match.bankrolls[seat] <= 0 || h.locked[seat]) return [];
    const acts = [];
    const free = h.match.bankrolls[seat] - this._staked(h, seat);
    const amount = Math.min(free, table.config.betSize);
    if (amount > 0) for (const spot of SPOTS) acts.push({ type: 'bet', spot, amount });
    acts.push({ type: 'done' });
    return acts;
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    if (h.phase !== 'bets') return { ok: false, error: `cannot act in phase ${h.phase}` };
    if (h.match.bankrolls[seat] <= 0) return { ok: false, error: 'no chips' };
    if (h.locked[seat]) return { ok: false, error: 'already locked in' };
    const events = [];

    if (action.type === 'bet') {
      const spot = action.spot;
      if (!SPOTS.includes(spot)) return { ok: false, error: 'bad bet spot' };
      const free = h.match.bankrolls[seat] - this._staked(h, seat);
      const amount = Math.max(0, Math.min(free, action.amount || table.config.betSize));
      if (amount <= 0) return { ok: false, error: 'insufficient' };
      h.bets[seat][spot] += amount;
      events.push({ type: 'bet', seat, spot, amount, total: h.bets[seat][spot] });
      return { ok: true, events, handOver: false, gameOver: false };
    }
    if (action.type === 'clear') {
      h.bets[seat] = mkBets();
      events.push({ type: 'clear', seat });
      return { ok: true, events, handOver: false, gameOver: false };
    }
    if (action.type === 'done') {
      h.locked[seat] = true;
      events.push({ type: 'locked', seat });
      return this._dealIfReady(table, h, events);
    }
    return { ok: false, error: 'expected bet/clear/done' };
  },

  _dealIfReady(table, h, events) {
    for (let s = 0; s < table.seatCount; s++) if (this._occupied(table, s) && h.match.bankrolls[s] > 0 && !h.locked[s]) return { ok: true, events, handOver: false, gameOver: false };
    const anyBet = h.bets.some((b) => SPOTS.some((k) => b[k] > 0));
    if (!anyBet) return { ok: true, events, handOver: true, gameOver: false };
    return this._deal(table, h, events);
  },

  _ensureShoe(table, h, events) {
    const m = h.match, totalCards = DECKS * 52;
    if (!m.shoe || m.shoe.length < Math.floor(totalCards * R.penetration)) {
      m.shoe = buildShoe(DECKS, h._rng);
      events.push({ type: 'shuffle', decks: DECKS, cards: m.shoe.length });
    }
    h.shoe = m.shoe;
  },

  // fixed third-card rules (punto banco)
  _resolveDraws(h) {
    h.player = [h.shoe.pop(), h.shoe.pop()];
    h.banker = [h.shoe.pop(), h.shoe.pop()];
    // order dealt P,B,P,B — pop order above gives P,P,B,B which is value-equivalent
    let pt = total(h.player), bt = total(h.banker);
    const natural = pt >= 8 || bt >= 8;
    let playerThird = null;
    if (!natural) {
      if (pt <= 5) { playerThird = h.shoe.pop(); h.player.push(playerThird); }
      const bDraw = (() => {
        if (playerThird === null) return bt <= 5;     // player stood on 6/7
        const t = cardVal(playerThird);
        if (bt <= 2) return true;
        if (bt === 3) return t !== 8;
        if (bt === 4) return t >= 2 && t <= 7;
        if (bt === 5) return t >= 4 && t <= 7;
        if (bt === 6) return t === 6 || t === 7;
        return false;                                 // 7 stands
      })();
      if (bDraw) h.banker.push(h.shoe.pop());
    }
    h.pt = total(h.player); h.bt = total(h.banker);
    h.outcome = h.pt > h.bt ? 'player' : (h.bt > h.pt ? 'banker' : 'tie');
    return { natural, playerThird };
  },

  _deal(table, h, events) {
    this._ensureShoe(table, h, events);
    const info = this._resolveDraws(h);
    events.push({ type: 'deal', player: h.player.slice(0, 2), banker: h.banker.slice(0, 2), natural: info.natural });
    if (h.player.length > 2) events.push({ type: 'playerThird', card: h.player[2] });
    if (h.banker.length > 2) events.push({ type: 'bankerThird', card: h.banker[2] });

    const m = h.match, before = m.bankrolls.slice();
    const pPair = isPair(h.player), bPair = isPair(h.banker);
    const comm = R.bankerCommission;
    const breakdown = [];
    let handTip = 0, handDealerWin = 0;
    for (let s = 0; s < table.seatCount; s++) {
      const b = h.bets[s]; if (SPOTS.every((k) => !b[k])) continue;
      let delta = 0;
      const add = (spot, d, note) => { delta += d; breakdown.push({ seat: s, spot, amount: b[spot], delta: d, note }); };
      if (b.player) add('player', h.outcome === 'player' ? b.player : (h.outcome === 'tie' ? 0 : -b.player), h.outcome);
      if (b.banker) add('banker', h.outcome === 'banker' ? Math.floor(b.banker * (1 - comm)) : (h.outcome === 'tie' ? 0 : -b.banker), h.outcome);
      if (b.tie) add('tie', h.outcome === 'tie' ? b.tie * R.tiePays : -b.tie, h.outcome);
      if (b.ppair) add('ppair', pPair ? b.ppair * R.pairPays : -b.ppair, pPair ? 'pair' : 'no');
      if (b.bpair) add('bpair', bPair ? b.bpair * R.pairPays : -b.bpair, bPair ? 'pair' : 'no');
      // dealer toke bet on Banker: player always funds it (gift); the dealer pool
      // collects stake+winnings on a Banker win; a tie returns it to the player.
      if (b.dealer) {
        if (h.outcome === 'tie') { /* push: returns to player, net 0 */ }
        else { delta -= b.dealer; if (h.outcome === 'banker') handDealerWin += b.dealer + Math.floor(b.dealer * (1 - comm)); }
        breakdown.push({ seat: s, spot: 'dealer', amount: b.dealer, delta: h.outcome === 'tie' ? 0 : -b.dealer, note: 'toke' });
      }
      if (b.tip) { delta -= b.tip; handTip += b.tip; breakdown.push({ seat: s, spot: 'tip', amount: b.tip, delta: -b.tip, note: 'tip' }); }
      m.bankrolls[s] += delta;
    }
    m.dealerPool += handTip + handDealerWin;
    table.scores = m.bankrolls.slice();
    const deltas = m.bankrolls.map((v, i) => v - before[i]);
    const recap = (h.outcome === 'tie' ? `Tie at ${h.pt}` : (h.outcome === 'player' ? `Player ${h.pt} beat Banker ${h.bt}` : `Banker ${h.bt} beat Player ${h.pt}`)) + ((pPair || bPair) ? ` (${pPair ? 'P' : ''}${pPair && bPair ? '&' : ''}${bPair ? 'B' : ''} pair)` : '');
    m.recent.push(recap); if (m.recent.length > 8) m.recent.shift();
    events.push({
      type: 'settle', outcome: h.outcome, playerTotal: h.pt, bankerTotal: h.bt,
      playerCards: h.player.slice(), bankerCards: h.banker.slice(), pPair, bPair,
      breakdown, deltas, bankrolls: m.bankrolls.slice(),
      dealerTip: handTip, dealerWin: handDealerWin, dealerPool: m.dealerPool, recap,
    });
    return { ok: true, events, handOver: true, gameOver: false };
  },

  gameResult(table) {
    const m = this._match(table);
    let w = 0; for (let s = 1; s < table.seatCount; s++) if (m.bankrolls[s] > m.bankrolls[w]) w = s;
    return { mode: 'individual', winnerSeat: w, totals: m.bankrolls.slice() };
  },
  resetMatch(table) {
    table._bac = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0, shoe: null, dealerPool: 0, recent: [] };
    table.scores = table._bac.bankrolls.slice();
  },

  _pool(h) {
    const p = { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0, dealer: 0, tip: 0 };
    for (const b of h.bets) for (const k of SPOTS) p[k] += (b[k] || 0);
    return p;
  },
  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    const reveal = h.phase !== 'bets';
    return {
      phase: h.phase, round: h.match.handNo, continuous: true,
      player: { cards: reveal ? h.player.slice() : [], total: reveal ? h.pt : null },
      banker: { cards: reveal ? h.banker.slice() : [], total: reveal ? h.bt : null },
      outcome: h.outcome, pool: this._pool(h), locked: h.locked.slice(),
      bankrolls: h.match.bankrolls.slice(), dealerPool: h.match.dealerPool,
      recent: h.match.recent.slice(-5),
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, legal: [], bets: mkBets() };
    return {
      seat, phase: h.phase, turn: null,
      yourTurn: h.phase === 'bets' && !h.locked[seat] && this._occupied(table, seat) && h.match.bankrolls[seat] > 0,
      locked: h.locked[seat], bankroll: h.match.bankrolls[seat],
      bets: h.bets[seat], reserved: this._staked(h, seat),
      outcome: h.outcome, legal: this.legalActions(table, seat),
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets') return null;
    if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
    if (!this._humansReady(table)) return null;
    const staked = this._staked(h, seat);
    if (staked <= 0) {
      const amount = Math.min(h.match.bankrolls[seat], table.config.betSize);
      // simple flavor: mostly Banker/Player, occasional tie or a dealer tip
      const r = (h._rng ? h._rng() : Math.random());
      const spot = r < 0.45 ? 'banker' : (r < 0.85 ? 'player' : (r < 0.93 ? 'tie' : 'dealer'));
      if (amount > 0) return { type: 'bet', spot, amount };
    }
    return { type: 'done' };
  },
};

export default baccarat;
