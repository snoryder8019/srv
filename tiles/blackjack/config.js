/**
 * Blackjack configuration (box model).
 *   boxes      — 7 betting circles on the felt; a player claims one or more by betting.
 *   seats      — up to 7 players can be matched into the table.
 *   fillWithBots:false — empty seats stay open (you can play multiple boxes solo).
 */
export default {
  id: 'blackjack',
  scoring: { startChips: 200, betSize: 10, target: 500, maxRounds: 30 },
  rules: {
    blackjackPays: 1.5, dealerStandsSoft17: true,
    double: true, doubleAfterSplit: true, split: true, maxSplitHands: 4, resplitAces: false,
    decks: 6, penetration: 0.25, boxes: 7,
  },
  seating: { seats: 7, boxes: 7, partnerships: null, fillWithBots: false },
};
