/**
 * trial — a minimal but real trick-taking variant used to exercise the table
 * runtime + socket protocol before euchre exists. No trump, no bidding: deal 5
 * from a 24-card deck, follow suit, high card of the led suit wins the trick, the
 * winner leads next. A hand scores the higher-trick team its trick count; first
 * team to `target` points wins. It uses the real engine (deal/trick/comparator),
 * so verifying it verifies the whole pipe.
 */
import {
  buildDeck, shuffle, deal, naturalComparator, cardCode,
} from '../../engine/index.js';

function findByCode(hand, code) {
  return hand.findIndex((c) => cardCode(c) === code);
}

const trial = {
  id: 'trial',
  name: 'Trick Trial',
  defaults: { ranks: ['9', '10', 'J', 'Q', 'K', 'A'], target: 10 },

  startHand(table, rng) {
    const deck = shuffle(buildDeck({ ranks: table.config.ranks }), rng);
    const { hands } = deal(deck, { players: 4, pattern: [3, 2] });
    const leader = table.next(table.dealer);
    table.hand = {
      hands,
      leader,
      turn: leader,
      plays: [],
      trickWins: [0, 0, 0, 0],
    };
    return table.hand;
  },

  currentTurn(table) {
    return table.hand ? table.hand.turn : null;
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h || h.turn !== seat) return [];
    const hand = h.hands[seat] || [];
    if (h.plays.length === 0) return hand.map((card) => ({ type: 'play', card }));
    const led = h.plays[0].card.suit;
    const canFollow = hand.some((c) => c.suit === led);
    const playable = canFollow ? hand.filter((c) => c.suit === led) : hand;
    return playable.map((card) => ({ type: 'play', card }));
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand in progress' };
    if (h.turn !== seat) return { ok: false, error: 'not your turn' };
    if (!action || action.type !== 'play' || !action.card) {
      return { ok: false, error: 'expected a play action' };
    }
    const code = typeof action.card === 'string' ? action.card : cardCode(action.card);
    const legalCodes = this.legalActions(table, seat).map((a) => cardCode(a.card));
    if (!legalCodes.includes(code)) return { ok: false, error: 'illegal play — must follow suit' };

    const hand = h.hands[seat];
    const [card] = hand.splice(findByCode(hand, code), 1);
    h.plays.push({ seat, card });
    const events = [{ type: 'play', seat, card: cardCode(card) }];

    if (h.plays.length === 4) {
      const winner = naturalComparator(h.plays, { trump: null });
      h.trickWins[winner] += 1;
      events.push({
        type: 'trickWon',
        seat: winner,
        cards: h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })),
      });
      h.plays = [];
      h.leader = winner;
      h.turn = winner;

      if (h.hands.every((hh) => hh.length === 0)) {
        const teamTricks = [h.trickWins[0] + h.trickWins[2], h.trickWins[1] + h.trickWins[3]];
        const team = teamTricks[0] > teamTricks[1] ? 0 : 1;
        const points = Math.max(teamTricks[0], teamTricks[1]);
        table.scores[team] += points;
        events.push({ type: 'handWon', team, points, teamTricks });
        const gameOver = table.scores.some((s) => s >= table.config.target);
        return { ok: true, events, handOver: true, gameOver };
      }
    } else {
      h.turn = table.next(h.turn);
    }
    return { ok: true, events, handOver: false, gameOver: false };
  },

  publicView(table) {
    const h = table.hand;
    return {
      dealer: table.dealer,
      turn: h ? h.turn : null,
      trick: h ? h.plays.map((p) => ({ seat: p.seat, card: cardCode(p.card) })) : [],
      trickWins: h ? h.trickWins.slice() : [0, 0, 0, 0],
      handCounts: h ? h.hands.map((hh) => hh.length) : [0, 0, 0, 0],
    };
  },

  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, hand: [], legal: [] };
    return {
      seat,
      hand: (h.hands[seat] || []).map(cardCode),
      legal: this.legalActions(table, seat).map((a) => cardCode(a.card)),
    };
  },

  botAction(table, seat) {
    const legal = this.legalActions(table, seat);
    if (!legal.length) return null;
    return { type: 'play', card: cardCode(legal[0].card) };
  },
};

export default trial;
