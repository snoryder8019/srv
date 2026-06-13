/**
 * trick.js — one trick of a trick-taking game.
 *
 * The engine owns the MECHANICS of a trick (who played what, in what order) but
 * NOT the meaning of "highest". Trump and euchre's bowers are variant logic, so
 * the winner is resolved through a comparator the variant supplies. This is the
 * seam that keeps the engine game-agnostic.
 *
 * comparator(plays, ctx) -> winning seat
 *   plays : [{ seat, card }] in play order (plays[0] led)
 *   ctx   : whatever the variant needs (e.g. { trump })
 *
 * A default natural comparator is provided for plain trump games; euchre passes
 * its own bower-aware comparator from /srv/euchre.
 */

import { rankValue } from './card.js';

export class Trick {
  constructor(leaderSeat) {
    this.leaderSeat = leaderSeat;
    this.plays = []; // [{ seat, card }]
  }

  get ledSuit() {
    return this.plays.length ? this.plays[0].card.suit : null;
  }

  get isEmpty() {
    return this.plays.length === 0;
  }

  play(seat, card) {
    this.plays.push({ seat, card });
    return this;
  }

  size() {
    return this.plays.length;
  }

  // Resolve the winning seat using the supplied comparator.
  winner(comparator, ctx = {}) {
    if (!this.plays.length) return null;
    return comparator(this.plays, ctx);
  }
}

/**
 * Natural comparator for simple trump games (NOT euchre — no bowers).
 * Trump beats led suit; within a suit, higher natural rank wins; off-suit,
 * off-led cards cannot win.
 */
export function naturalComparator(plays, { trump = null } = {}) {
  const led = plays[0].card.suit;
  let best = plays[0];
  let bestScore = scoreCard(best.card, led, trump);
  for (let i = 1; i < plays.length; i++) {
    const s = scoreCard(plays[i].card, led, trump);
    if (s > bestScore) {
      bestScore = s;
      best = plays[i];
    }
  }
  return best.seat;
}

function scoreCard(card, led, trump) {
  const r = rankValue(card.rank); // 0..12
  if (trump && card.suit === trump) return 200 + r;
  if (card.suit === led) return 100 + r;
  return r; // cannot win a trick it didn't follow/trump
}
