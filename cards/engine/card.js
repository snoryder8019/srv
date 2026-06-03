/**
 * card.js — the card model shared by every variant.
 *
 * A card is { suit, rank }. Suits and rank-order are canonical here; a variant
 * chooses WHICH ranks it deals (euchre uses 9..A) but never redefines what a
 * card is. Trump/bower semantics are NOT here — that is variant logic that sits
 * atop the engine via the comparator seam (see trick.js).
 */

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

export const SUIT_COLOR = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black',
};

const SUIT_INITIAL = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' };

// Canonical low->high natural order. A variant deals a subset of these.
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function color(suit) {
  return SUIT_COLOR[suit];
}

// The other suit of the same color — used by variants for "left bower" logic.
export function sameColorSuit(suit) {
  if (suit === 'hearts') return 'diamonds';
  if (suit === 'diamonds') return 'hearts';
  if (suit === 'clubs') return 'spades';
  if (suit === 'spades') return 'clubs';
  return null;
}

// Natural rank index (0 = lowest of the canonical set). Variants that reorder
// (e.g. bowers above ace) compute their own value in their comparator.
export function rankValue(rank) {
  return RANKS.indexOf(rank);
}

export function makeCard(suit, rank) {
  return { suit, rank };
}

// Compact, human-readable code: "9H", "10S", "JD", "AC".
export function cardCode(card) {
  return `${card.rank}${SUIT_INITIAL[card.suit]}`;
}

export function sameCard(a, b) {
  return a && b && a.suit === b.suit && a.rank === b.rank;
}
