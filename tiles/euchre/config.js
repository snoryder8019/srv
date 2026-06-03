/**
 * Euchre configuration — 24-card deck (9..A), 5 cards each dealt [3,2] + an
 * upcard, partnerships (0&2 vs 1&3), trump with right/left bowers, "stick the
 * dealer" in round 2, first team to winScore points wins. Going alone: not yet.
 */
export default {
  id: 'euchre',
  deck: { ranks: ['9', '10', 'J', 'Q', 'K', 'A'] },
  deal: { players: 4, pattern: [3, 2] },
  scoring: { winScore: 10, march: 2, point: 1, euchre: 2 },
  rules: { trump: true, bowers: true, stickTheDealer: true, goAlone: false },
  seating: { seats: 4, partnerships: [[0, 2], [1, 3]], fillWithBots: true },
};
