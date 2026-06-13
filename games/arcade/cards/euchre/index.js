/**
 * Euchre — standard North-American euchre, seated inside the cards platform
 * (/srv/cards is the scaffolding; this folder is the variant + its config).
 *
 * Implements the cards-platform variant contract (../lib/variants/contract.js).
 * The engine (../engine) owns deal/shuffle/trick mechanics; euchre owns the
 * rules the engine leaves open: a 24-card deck, bower-aware trump order,
 * follow-suit legality, the two bidding rounds (order-up / call) with
 * stick-the-dealer, going alone, and 1/2/4-point scoring to 10.
 *
 * Configuration lives in ./config.js; catalog/seating metadata in ./meta.json.
 * Wire format: cards cross as compact codes ("9H","10S","JD","AC").
 *
 * Hand state (table.hand):
 *   phase   'bidding1' | 'bidding2' | 'discard' | 'playing'
 *   hands   Card[][]  seat -> cards
 *   kitty   Card[]    buried cards
 *   upCard  Card|null turn-up (round 1)
 *   turnedDownSuit, trump, maker, makerTeam, alone, loneSeat, sitOut
 *   bidder  seat acting during bidding
 *   leader, turn, plays[], trickWins[4], tricksPlayed
 */
import {
  buildDeck, shuffle, deal, cardCode, rankValue, sameColorSuit, SUITS,
} from '../engine/index.js';
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Catalog/seating metadata matchmaking reads to seat players (see ./meta.json).
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const SUIT_BY_INITIAL = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
const SUIT_SYMBOL = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

function parseCode(code) {
  const init = code.slice(-1);
  const rank = code.slice(0, -1);
  return { suit: SUIT_BY_INITIAL[init], rank };
}

// The suit a card plays AS, given trump: the left bower (J of the same color as
// trump) counts as a trump, not as its printed suit. Everything else is itself.
function effSuit(card, trump) {
  if (!trump) return card.suit;
  if (card.rank === 'J' && card.suit === sameColorSuit(trump)) return trump;
  return card.suit;
}

const isRightBower = (card, trump) => card.rank === 'J' && card.suit === trump;
const isLeftBower = (card, trump) => card.rank === 'J' && card.suit === sameColorSuit(trump);

// Score a card within a trick. Higher wins. Trump tier > led tier > nothing.
// Bowers sit at the top of the trump tier (right above left).
function euchreScore(card, led, trump) {
  if (effSuit(card, trump) === trump) {
    if (isRightBower(card, trump)) return 300;
    if (isLeftBower(card, trump)) return 290;
    return 200 + rankValue(card.rank); // A=212,K=211,Q=210,10=208,9=207
  }
  if (effSuit(card, trump) === led) return 100 + rankValue(card.rank);
  return rankValue(card.rank); // off-suit: cannot win
}

// Variant trick comparator (the engine's seam). plays=[{seat,card}], plays[0] led.
function euchreComparator(plays, { trump }) {
  const led = effSuit(plays[0].card, trump);
  let best = plays[0];
  let bestScore = euchreScore(best.card, led, trump);
  for (let i = 1; i < plays.length; i++) {
    const s = euchreScore(plays[i].card, led, trump);
    if (s > bestScore) { bestScore = s; best = plays[i]; }
  }
  return best.seat;
}

const partnerOf = (seat) => (seat + 2) % 4;

// Bot heuristic: how strong is this hand if `trump` were trump?
function trumpStrength(hand, trump) {
  let s = 0;
  for (const c of hand) {
    if (isRightBower(c, trump)) s += 2;
    else if (isLeftBower(c, trump)) s += 1.5;
    else if (effSuit(c, trump) === trump) s += 1;
    else if (c.rank === 'A') s += 0.5; // off-suit ace
  }
  return s;
}

const euchre = {
  id: 'euchre',
  name: 'Euchre',
  meta: cfg,
  catalog,
  defaults: {
    ranks: cfg.deck.ranks,
    winningScore: cfg.scoring.winningScore,
    goAlone: cfg.rules.goAlone,
    stickDealer: cfg.rules.stickDealer,
  },

  startHand(table, rng) {
    const deck = shuffle(buildDeck({ ranks: table.config.ranks }), rng);
    const { hands, remaining } = deal(deck, {
      players: cfg.deal.players, pattern: cfg.deal.pattern,
    });
    const eldest = table.next(table.dealer); // left of dealer leads bidding + play
    table.hand = {
      phase: 'bidding1',
      hands,
      kitty: remaining.slice(1),
      upCard: remaining[0],
      turnedDownSuit: null,
      trump: null, maker: null, makerTeam: null,
      alone: false, loneSeat: null, sitOut: null,
      bidder: eldest, passes: 0,
      leader: eldest, turn: eldest, plays: [], trickWins: [0, 0, 0, 0], tricksPlayed: 0,
    };
    return table.hand;
  },

  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'bidding1' || h.phase === 'bidding2') return h.bidder;
    if (h.phase === 'discard') return table.dealer;
    if (h.phase === 'playing') return h.turn;
    return null;
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h) return [];
    if (h.phase === 'bidding1') {
      if (seat !== h.bidder) return [];
      const acts = [{ type: 'orderUp' }];
      if (table.config.goAlone) acts.push({ type: 'orderUp', alone: true });
      acts.push({ type: 'pass' });
      return acts;
    }
    if (h.phase === 'bidding2') {
      if (seat !== h.bidder) return [];
      const acts = [];
      for (const s of SUITS) {
        if (s === h.turnedDownSuit) continue;
        acts.push({ type: 'call', suit: s });
        if (table.config.goAlone) acts.push({ type: 'call', suit: s, alone: true });
      }
      const mustCall = table.config.stickDealer && seat === table.dealer;
      if (!mustCall) acts.push({ type: 'pass' });
      return acts;
    }
    if (h.phase === 'discard') {
      if (seat !== table.dealer) return [];
      return h.hands[seat].map((c) => ({ type: 'discard', card: cardCode(c) }));
    }
    if (h.phase === 'playing') {
      if (seat !== h.turn) return [];
      const hand = h.hands[seat];
      if (h.plays.length === 0) return hand.map((c) => ({ type: 'play', card: cardCode(c) }));
      const led = effSuit(h.plays[0].card, h.trump);
      const canFollow = hand.some((c) => effSuit(c, h.trump) === led);
      const playable = canFollow ? hand.filter((c) => effSuit(c, h.trump) === led) : hand;
      return playable.map((c) => ({ type: 'play', card: cardCode(c) }));
    }
    return [];
  },

  _nextActive(table, seat) {
    let n = table.next(seat);
    if (table.hand.sitOut === n) n = table.next(n);
    return n;
  },

  _beginPlay(table, h, events) {
    h.phase = 'playing';
    let lead = table.next(table.dealer);
    if (h.sitOut === lead) lead = table.next(lead);
    h.leader = lead; h.turn = lead; h.plays = [];
    events.push({ type: 'play:begin', trump: h.trump, maker: h.maker, alone: h.alone, leader: lead });
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand in progress' };
    if (!action || !action.type) return { ok: false, error: 'no action' };

    // ---- bidding round 1: order up the turn-up suit, or pass ----
    if (h.phase === 'bidding1') {
      if (seat !== h.bidder) return { ok: false, error: 'not your turn to bid' };
      if (action.type === 'pass') {
        h.passes += 1;
        const events = [{ type: 'bid', seat, bid: 'pass' }];
        if (h.passes >= 4) {
          h.turnedDownSuit = h.upCard.suit;
          h.upCard = null;
          h.phase = 'bidding2';
          h.bidder = table.next(table.dealer);
          h.passes = 0;
          events.push({ type: 'turnedDown', suit: h.turnedDownSuit });
        } else {
          h.bidder = table.next(h.bidder);
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'orderUp') {
        h.trump = h.upCard.suit; h.maker = seat; h.makerTeam = seat % 2;
        if (action.alone && table.config.goAlone) {
          h.alone = true; h.loneSeat = seat; h.sitOut = partnerOf(seat);
        }
        const events = [{ type: 'bid', seat, bid: 'orderUp', trump: h.trump, alone: !!action.alone }];
        if (h.alone && h.sitOut === table.dealer) {
          h.upCard = null; // dealer sits out — no functional pickup
          this._beginPlay(table, h, events);
        } else {
          h.hands[table.dealer].push(h.upCard);
          events.push({ type: 'pickUp', seat: table.dealer, card: cardCode(h.upCard) });
          h.upCard = null;
          h.phase = 'discard';
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      return { ok: false, error: 'illegal bid' };
    }

    // ---- dealer discards after picking up ----
    if (h.phase === 'discard') {
      if (seat !== table.dealer) return { ok: false, error: 'only the dealer discards' };
      if (action.type !== 'discard' || !action.card) return { ok: false, error: 'must discard a card' };
      const idx = h.hands[seat].findIndex((c) => cardCode(c) === action.card);
      if (idx < 0) return { ok: false, error: 'card not in hand' };
      const [d] = h.hands[seat].splice(idx, 1);
      h.kitty.push(d);
      const events = [{ type: 'discard', seat }];
      this._beginPlay(table, h, events);
      return { ok: true, events, handOver: false, gameOver: false };
    }

    // ---- bidding round 2: call a suit (not the turned-down one), or pass ----
    if (h.phase === 'bidding2') {
      if (seat !== h.bidder) return { ok: false, error: 'not your turn to bid' };
      if (action.type === 'pass') {
        if (table.config.stickDealer && seat === table.dealer) {
          return { ok: false, error: 'dealer must call (stick the dealer)' };
        }
        h.passes += 1;
        const events = [{ type: 'bid', seat, bid: 'pass' }];
        if (h.passes >= 4) {
          events.push({ type: 'misdeal' });
          return { ok: true, events, handOver: true, gameOver: false };
        }
        h.bidder = table.next(h.bidder);
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'call') {
        if (!action.suit || action.suit === h.turnedDownSuit) {
          return { ok: false, error: 'cannot call the turned-down suit' };
        }
        h.trump = action.suit; h.maker = seat; h.makerTeam = seat % 2;
        if (action.alone && table.config.goAlone) {
          h.alone = true; h.loneSeat = seat; h.sitOut = partnerOf(seat);
        }
        const events = [{ type: 'bid', seat, bid: 'call', trump: h.trump, alone: !!action.alone }];
        this._beginPlay(table, h, events);
        return { ok: true, events, handOver: false, gameOver: false };
      }
      return { ok: false, error: 'illegal bid' };
    }

    // ---- trick play ----
    if (h.phase === 'playing') {
      if (seat !== h.turn) return { ok: false, error: 'not your turn' };
      if (action.type !== 'play' || !action.card) return { ok: false, error: 'expected a play action' };
      const code = action.card;
      const legal = this.legalActions(table, seat).map((a) => a.card);
      if (!legal.includes(code)) return { ok: false, error: 'illegal play — must follow suit' };

      const hand = h.hands[seat];
      const [card] = hand.splice(hand.findIndex((c) => cardCode(c) === code), 1);
      h.plays.push({ seat, card });
      const events = [{ type: 'play', seat, card: code }];
      const seatsThisTrick = h.alone ? 3 : 4;

      if (h.plays.length === seatsThisTrick) {
        const winner = euchreComparator(h.plays, { trump: h.trump });
        h.trickWins[winner] += 1;
        h.tricksPlayed += 1;
        events.push({
          type: 'trickWon', seat: winner,
          cards: h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })),
        });
        h.plays = [];
        h.leader = winner; h.turn = winner; // winner leads next

        if (h.tricksPlayed === 5) {
          const makerTricks = h.trickWins[h.maker] + h.trickWins[partnerOf(h.maker)];
          let points; let team;
          if (makerTricks >= 3) {
            team = h.makerTeam;
            if (makerTricks === 5) points = h.alone ? cfg.scoring.loneMarch : cfg.scoring.march;
            else points = cfg.scoring.point;
          } else {
            team = 1 - h.makerTeam; // euchred
            points = cfg.scoring.euchre;
          }
          table.scores[team] += points;
          events.push({
            type: 'handWon', team, points, makerTeam: h.makerTeam,
            makerTricks, alone: h.alone, trump: h.trump, euchred: makerTricks < 3,
          });
          const gameOver = table.scores.some((s) => s >= table.config.winningScore);
          return { ok: true, events, handOver: true, gameOver };
        }
      } else {
        h.turn = this._nextActive(table, h.turn);
      }
      return { ok: true, events, handOver: false, gameOver: false };
    }

    return { ok: false, error: `cannot act in phase ${h.phase}` };
  },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase,
      dealer: table.dealer,
      turn: this.currentTurn(table),
      trump: h.trump,
      trumpSymbol: h.trump ? SUIT_SYMBOL[h.trump] : null,
      upCard: h.upCard ? cardCode(h.upCard) : null,
      maker: h.maker, makerTeam: h.makerTeam,
      alone: h.alone, loneSeat: h.loneSeat,
      trick: h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })),
      trickWins: h.trickWins.slice(),
      tricksPlayed: h.tricksPlayed,
      handCounts: h.hands.map((hh) => hh.length),
      scores: table.scores.slice(),
    };
  },

  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, hand: [], legal: [] };
    return {
      seat,
      hand: (h.hands[seat] || []).map(cardCode),
      phase: h.phase,
      legal: this.legalActions(table, seat),
      upCard: h.upCard ? cardCode(h.upCard) : null,
      trump: h.trump,
      isMaker: h.maker === seat,
      sittingOut: h.sitOut === seat,
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;

    if (h.phase === 'bidding1') {
      const s = h.upCard.suit;
      let str = trumpStrength(h.hands[seat], s);
      if (seat === table.dealer) str += 1; // dealer will gain the up-card
      return str >= 3 ? { type: 'orderUp' } : { type: 'pass' };
    }

    if (h.phase === 'bidding2') {
      let best = null; let bestStr = -1;
      for (const s of SUITS) {
        if (s === h.turnedDownSuit) continue;
        const st = trumpStrength(h.hands[seat], s);
        if (st > bestStr) { bestStr = st; best = s; }
      }
      const mustCall = table.config.stickDealer && seat === table.dealer;
      if (bestStr >= 3 || mustCall) return { type: 'call', suit: best };
      return { type: 'pass' };
    }

    if (h.phase === 'discard') {
      const hand = h.hands[seat];
      const nonTrump = hand.filter((c) => effSuit(c, h.trump) !== h.trump);
      const pool = nonTrump.length ? nonTrump : hand;
      let worst = pool[0];
      for (const c of pool) if (rankValue(c.rank) < rankValue(worst.rank)) worst = c;
      return { type: 'discard', card: cardCode(worst) };
    }

    if (h.phase === 'playing') {
      const legal = this.legalActions(table, seat);
      if (!legal.length) return null;
      const cards = legal.map((a) => parseCode(a.card));

      if (h.plays.length === 0) {
        let bestC = cards[0];
        let bestV = euchreScore(cards[0], effSuit(cards[0], h.trump), h.trump);
        for (const c of cards) {
          const v = euchreScore(c, effSuit(c, h.trump), h.trump);
          if (v > bestV) { bestV = v; bestC = c; }
        }
        return { type: 'play', card: cardCode(bestC) };
      }

      const led = effSuit(h.plays[0].card, h.trump);
      const curWinner = euchreComparator(h.plays, { trump: h.trump });
      const partnerWinning = curWinner === partnerOf(seat);
      const bestPlay = h.plays.reduce((a, b) =>
        (euchreScore(b.card, led, h.trump) > euchreScore(a.card, led, h.trump) ? b : a));
      const threshold = euchreScore(bestPlay.card, led, h.trump);
      const winners = cards.filter((c) => euchreScore(c, led, h.trump) > threshold);

      if (!partnerWinning && winners.length) {
        let cw = winners[0];
        for (const c of winners) {
          if (euchreScore(c, led, h.trump) < euchreScore(cw, led, h.trump)) cw = c;
        }
        return { type: 'play', card: cardCode(cw) };
      }
      let lo = cards[0];
      for (const c of cards) {
        if (euchreScore(c, led, h.trump) < euchreScore(lo, led, h.trump)) lo = c;
      }
      return { type: 'play', card: cardCode(lo) };
    }

    return null;
  },
};

export default euchre;
export { euchreComparator, euchreScore, effSuit, isRightBower, isLeftBower, parseCode };
