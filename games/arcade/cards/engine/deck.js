/**
 * deck.js — build / shuffle / deal. Pure mechanics, no rules.
 */

import { SUITS, RANKS, makeCard } from './card.js';
import { rngFromSeed } from './rng.js';

/**
 * Build a deck from a rank subset (defaults to a full 52).
 * Euchre: buildDeck({ ranks: ['9','10','J','Q','K','A'] }) -> 24 cards.
 */
export function buildDeck({ ranks = RANKS, suits = SUITS } = {}) {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(makeCard(suit, rank));
    }
  }
  return deck;
}

// Fisher-Yates with a seedable rng. Returns a NEW array; input untouched.
export function shuffle(deck, seed) {
  const rng = typeof seed === 'function' ? seed : rngFromSeed(seed);
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal from the top of the deck. Two modes:
 *
 *  - round-robin (default): set `cardsPer`; each player gets one card per round
 *    until they hold `cardsPer`.
 *  - packet rounds: set `pattern` to an array of per-round packet sizes dealt to
 *    EVERY player in turn order. The classic euchre deal is pattern [3, 2]:
 *    round 1 deals 3 to each seat, round 2 deals 2 to each seat -> 5 per hand.
 *
 * Returns { hands: Card[][], remaining: Card[] }. `remaining` is the stock/kitty
 * the variant decides what to do with (euchre turns its top card face-up).
 *
 * Note: hands are indexed 0..players-1. The caller maps engine seat indices onto
 * real seats / dealer rotation (see Table.order); the deterministic shuffle makes
 * the exact card->seat mapping reproducible regardless of physical-deal flavor.
 */
export function deal(deck, { players, cardsPer, pattern = null } = {}) {
  const hands = Array.from({ length: players }, () => []);
  const stock = deck.slice();
  if (pattern) {
    for (const count of pattern) {
      for (let p = 0; p < players; p++) {
        for (let k = 0; k < count; k++) hands[p].push(stock.shift());
      }
    }
  } else {
    for (let c = 0; c < cardsPer; c++) {
      for (let p = 0; p < players; p++) hands[p].push(stock.shift());
    }
  }
  return { hands, remaining: stock };
}
