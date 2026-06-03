/**
 * Euchre — 4-player partnership trick-taking (teams 0&2 vs 1&3), 24-card deck
 * (9..A). Turn-based, fits the runtime contract like hearts.
 *
 * Flow per hand: deal 5 each (pattern [3,2]) + an upcard. Two bid rounds:
 *   bid1 — from dealer's left, each may ORDER UP the upcard's suit as trump (the
 *          dealer then picks it up and discards one), or pass.
 *   bid2 — if all pass, the upcard is turned down; each may CALL a different suit
 *          as trump, or pass. "Stick the dealer": the dealer must call in round 2.
 * Then 5 tricks with trump + bowers (right bower = J of trump, left bower = J of
 * the same-color suit, which plays AS trump). Scoring: makers 3–4 tricks = 1,
 * all 5 (march) = 2; makers euchred (<3) = defenders 2. First team to 10 wins.
 *
 * (Going alone is intentionally omitted from this first version.)
 */
import { buildDeck, shuffle, deal, cardCode, sameColorSuit } from '../engine-cards/index.js';
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_BY_INITIAL = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };

function parseCode(code) {
  const init = code.slice(-1);
  return { suit: SUIT_BY_INITIAL[init], rank: code.slice(0, -1) };
}
function team(seat) { return seat % 2; }              // 0 -> {0,2}, 1 -> {1,3}
function partner(seat) { return (seat + 2) % 4; }

// Effective suit accounting for the left bower playing as trump.
function effSuit(card, trump) {
  if (card.rank === 'J' && card.suit === sameColorSuit(trump)) return trump;
  return card.suit;
}
// Strength of a card within a trick, given led + trump (bower-aware).
const TRUMP_ORDER = { '9': 1, '10': 2, 'Q': 3, 'K': 4, 'A': 5 };   // J handled as bower
const NAT_ORDER = { '9': 1, '10': 2, 'J': 3, 'Q': 4, 'K': 5, 'A': 6 };
function cardScore(card, led, trump) {
  const sc = sameColorSuit(trump);
  if (card.rank === 'J' && card.suit === trump) return 1000;        // right bower
  if (card.rank === 'J' && card.suit === sc) return 900;            // left bower
  if (card.suit === trump) return 800 + (TRUMP_ORDER[card.rank] || 0);
  if (card.suit === led) return 100 + (NAT_ORDER[card.rank] || 0);
  return NAT_ORDER[card.rank] || 0;                                 // off-suit: cannot win
}
function trickWinner(plays, trump) {
  const ledEff = effSuit(plays[0].card, trump);
  let best = plays[0], bestScore = cardScore(plays[0].card, ledEff, trump);
  for (let i = 1; i < plays.length; i++) {
    const s = cardScore(plays[i].card, ledEff, trump);
    if (s > bestScore) { best = plays[i]; bestScore = s; }
  }
  return best.seat;
}
// How many cards of "trump strength" a hand holds for a candidate trump suit.
function trumpStrength(hand, trump) {
  const sc = sameColorSuit(trump);
  let n = 0;
  for (const c of hand) {
    if (c.suit === trump) n += (c.rank === 'J' ? 2 : 1);
    else if (c.rank === 'J' && c.suit === sc) n += 2;              // left bower
  }
  return n;
}

const euchre = {
  id: 'euchre',
  name: 'Euchre',
  meta: cfg,
  catalog,
  defaults: { winScore: cfg.scoring.winScore, ranks: cfg.deck.ranks },

  _match(table) {
    if (!table._euchre) table._euchre = { teamPoints: [0, 0], handNo: 0 };
    return table._euchre;
  },

  startHand(table, rng) {
    const m = this._match(table);
    m.handNo += 1;
    const deck = shuffle(buildDeck({ ranks: table.config.ranks }), rng);
    const { hands, remaining } = deal(deck, { players: 4, pattern: [3, 2] });
    const dealer = table.dealer;
    table.hand = {
      phase: 'bid1',
      hands,
      upcard: remaining[0],
      kitty: remaining.slice(1),
      turnedDown: false,
      trump: null, maker: null,
      dealer,
      turn: (dealer + 1) % 4,
      passes: 0,
      leader: null, plays: [], trickWins: [0, 0, 0, 0], tricksPlayed: 0,
      match: m,
    };
    return table.hand;
  },

  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    return h.turn;
  },
  botSeatsToAct(table) {
    const s = this.currentTurn(table);
    return s == null ? [] : [s];
  },

  _beginPlay(table, h, events) {
    h.phase = 'play';
    h.leader = (h.dealer + 1) % 4;
    h.turn = h.leader;
    h.plays = [];
    events.push({ type: 'play:begin', leader: h.leader, trump: h.trump, maker: h.maker });
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h || seat !== h.turn) return [];

    if (h.phase === 'bid1') {
      return [{ type: 'orderUp' }, { type: 'pass' }];
    }
    if (h.phase === 'bid2') {
      const forbidden = h.upcard.suit;
      const calls = SUITS.filter((s) => s !== forbidden).map((s) => ({ type: 'callTrump', suit: s }));
      // stick-the-dealer: dealer cannot pass in round 2
      if (!(cfg.rules.stickTheDealer && seat === h.dealer)) calls.push({ type: 'pass' });
      return calls;
    }
    if (h.phase === 'discard') {
      return h.hands[h.dealer].map((c) => ({ type: 'discard', card: cardCode(c) }));
    }
    if (h.phase === 'play') {
      const hand = h.hands[seat];
      if (h.plays.length === 0) return hand.map((c) => ({ type: 'play', card: cardCode(c) }));
      const ledEff = effSuit(h.plays[0].card, h.trump);
      const following = hand.filter((c) => effSuit(c, h.trump) === ledEff);
      const pool = following.length ? following : hand;
      return pool.map((c) => ({ type: 'play', card: cardCode(c) }));
    }
    return [];
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (seat !== h.turn) return { ok: false, error: 'not your turn' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    if (h.phase === 'bid1') {
      if (action.type === 'orderUp') {
        h.trump = h.upcard.suit; h.maker = team(seat);
        h.hands[h.dealer].push(h.upcard);              // dealer picks up
        h.phase = 'discard'; h.turn = h.dealer;
        events.push({ type: 'orderedUp', seat, trump: h.trump, maker: h.maker });
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'pass') {
        h.passes += 1; h.turn = (h.turn + 1) % 4;
        events.push({ type: 'pass', seat, round: 1 });
        if (h.passes >= 4) {
          h.turnedDown = true; h.passes = 0; h.phase = 'bid2'; h.turn = (h.dealer + 1) % 4;
          events.push({ type: 'turnedDown', card: cardCode(h.upcard) });
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      return { ok: false, error: 'expected orderUp or pass' };
    }

    if (h.phase === 'bid2') {
      if (action.type === 'callTrump') {
        if (action.suit === h.upcard.suit) return { ok: false, error: 'cannot call the turned-down suit' };
        if (!SUITS.includes(action.suit)) return { ok: false, error: 'bad suit' };
        h.trump = action.suit; h.maker = team(seat);
        events.push({ type: 'calledTrump', seat, trump: h.trump, maker: h.maker });
        this._beginPlay(table, h, events);
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'pass') {
        if (cfg.rules.stickTheDealer && seat === h.dealer) return { ok: false, error: 'dealer must call' };
        h.passes += 1; h.turn = (h.turn + 1) % 4;
        events.push({ type: 'pass', seat, round: 2 });
        return { ok: true, events, handOver: false, gameOver: false };
      }
      return { ok: false, error: 'expected callTrump or pass' };
    }

    if (h.phase === 'discard') {
      if (action.type !== 'discard' || !action.card) return { ok: false, error: 'expected discard' };
      const hand = h.hands[h.dealer];
      const idx = hand.findIndex((c) => cardCode(c) === action.card);
      if (idx < 0) return { ok: false, error: 'card not in hand' };
      hand.splice(idx, 1);
      events.push({ type: 'discarded', seat: h.dealer });
      this._beginPlay(table, h, events);
      return { ok: true, events, handOver: false, gameOver: false };
    }

    if (h.phase === 'play') {
      if (action.type !== 'play' || !action.card) return { ok: false, error: 'expected play' };
      const legal = this.legalActions(table, seat).map((a) => a.card);
      if (!legal.includes(action.card)) return { ok: false, error: 'illegal play' };
      const hand = h.hands[seat];
      const [card] = hand.splice(hand.findIndex((c) => cardCode(c) === action.card), 1);
      h.plays.push({ seat, card });
      events.push({ type: 'play', seat, card: action.card });

      if (h.plays.length === 4) {
        const w = trickWinner(h.plays, h.trump);
        h.trickWins[w] += 1; h.tricksPlayed += 1;
        events.push({ type: 'trickWon', seat: w, cards: h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })) });
        h.plays = []; h.leader = w; h.turn = w;
        if (h.tricksPlayed === 5) return this._scoreHand(table, h, events);
      } else {
        h.turn = (h.turn + 1) % 4;
      }
      return { ok: true, events, handOver: false, gameOver: false };
    }

    return { ok: false, error: `cannot act in phase ${h.phase}` };
  },

  _scoreHand(table, h, events) {
    const m = h.match;
    const mk = h.maker;
    const makerTricks = h.trickWins[mk] + h.trickWins[partner(mk)];
    let pts, winnerTeam;
    if (makerTricks >= 3) { winnerTeam = mk; pts = makerTricks === 5 ? 2 : 1; }
    else { winnerTeam = 1 - mk; pts = 2; }            // euchred
    m.teamPoints[winnerTeam] += pts;
    // mirror team totals onto per-seat scores so the generic views read sensibly
    for (let s = 0; s < 4; s++) table.scores[s] = m.teamPoints[team(s)];

    events.push({ type: 'handScored', winnerTeam, points: pts, makerTricks, teamPoints: m.teamPoints.slice() });

    const gameOver = m.teamPoints.some((p) => p >= table.config.winScore);
    if (gameOver) {
      const wt = m.teamPoints[0] >= table.config.winScore ? 0 : 1;
      table._euchreResult = { teamPoints: m.teamPoints.slice(), winnerTeam: wt };
      events.push({ type: 'gameWon', winnerTeam: wt, teamPoints: m.teamPoints.slice() });
    }
    return { ok: true, events, handOver: !gameOver, gameOver };
  },

  gameResult(table) {
    const r = table._euchreResult || { teamPoints: this._match(table).teamPoints, winnerTeam: 0 };
    return { mode: 'team', winnerSeat: r.winnerTeam, totals: [0, 1, 2, 3].map((s) => r.teamPoints[team(s)]) };
  },
  standings(table) {
    const r = table._euchreResult || { teamPoints: this._match(table).teamPoints, winnerTeam: 0 };
    return table.seats.map((s) => ({
      seat: s.seat, team: team(s.seat), displayName: s.displayName, bot: s.bot,
      score: r.teamPoints[team(s.seat)], won: team(s.seat) === r.winnerTeam,
    }));
  },
  resetMatch(table) { table._euchre = { teamPoints: [0, 0], handNo: 0 }; table._euchreResult = null; },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase, dealer: h.dealer, turn: h.turn,
      upcard: h.turnedDown ? null : cardCode(h.upcard),
      turnedDown: h.turnedDown, trump: h.trump, maker: h.maker,
      trick: h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })),
      trickWins: h.trickWins.slice(), tricksPlayed: h.tricksPlayed,
      handCounts: h.hands.map((hh) => hh.length),
      teamPoints: h.match.teamPoints.slice(), winScore: table.config.winScore,
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, hand: [], legal: [] };
    return {
      seat, phase: h.phase, turn: h.turn, yourTurn: h.turn === seat,
      hand: (h.hands[seat] || []).map(cardCode),
      legal: this.legalActions(table, seat),
      trump: h.trump, upcard: h.turnedDown ? null : cardCode(h.upcard),
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;
    const hand = h.hands[seat];

    if (h.phase === 'bid1') {
      const str = trumpStrength(hand, h.upcard.suit) + (seat === h.dealer ? 1 : 0);
      return str >= 3 ? { type: 'orderUp' } : { type: 'pass' };
    }
    if (h.phase === 'bid2') {
      let best = null, bestStr = -1;
      for (const s of SUITS) {
        if (s === h.upcard.suit) continue;
        const str = trumpStrength(hand, s);
        if (str > bestStr) { bestStr = str; best = s; }
      }
      const forced = cfg.rules.stickTheDealer && seat === h.dealer;
      if (bestStr >= 3 || forced) return { type: 'callTrump', suit: best };
      return { type: 'pass' };
    }
    if (h.phase === 'discard') {
      // discard the weakest non-trump card (lowest natural rank, off-trump first)
      const dealerHand = h.hands[h.dealer];
      let worst = dealerHand[0], worstScore = Infinity;
      for (const c of dealerHand) {
        const isTrump = effSuit(c, h.trump) === h.trump;
        const sc = (isTrump ? 1000 : 0) + (NAT_ORDER[c.rank] || 0);
        if (sc < worstScore) { worstScore = sc; worst = c; }
      }
      return { type: 'discard', card: cardCode(worst) };
    }
    if (h.phase === 'play') {
      const legal = this.legalActions(table, seat).map((a) => parseCode(a.card));
      if (!legal.length) return null;
      if (h.plays.length === 0) {
        // lead highest trump if we have it, else highest off-card
        let pick = legal[0], pscore = -1;
        for (const c of legal) { const s = cardScore(c, c.suit, h.trump); if (s > pscore) { pscore = s; pick = c; } }
        return { type: 'play', card: cardCode(pick) };
      }
      const ledEff = effSuit(h.plays[0].card, h.trump);
      const curWinner = trickWinner(h.plays, h.trump);
      const partnerWinning = team(curWinner) === team(seat);
      // try to win cheaply; if partner already winning, dump lowest
      const scored = legal.map((c) => ({ c, s: cardScore(c, ledEff, h.trump) }));
      const curScore = cardScore(h.plays.find((p) => p.seat === curWinner).card, ledEff, h.trump);
      const winners = scored.filter((x) => x.s > curScore).sort((a, b) => a.s - b.s);
      if (!partnerWinning && winners.length) return { type: 'play', card: cardCode(winners[0].c) };
      const lowest = scored.sort((a, b) => a.s - b.s)[0];
      return { type: 'play', card: cardCode(lowest.c) };
    }
    return null;
  },
};

export default euchre;
export { trickWinner, effSuit, cardScore };
