/**
 * Euchre configuration — the rule/scoring/seating knobs for this variant,
 * kept separate from the logic so a table can be created with overrides and so
 * matchmaking can read the seating shape. The variant's `defaults` are derived
 * from this; a table's params (from the matchmaking ticket) override them.
 *
 * Standard North-American euchre: 24-card deck (9..A), 5 cards per hand dealt
 * 3-2, partners across the table, order-up / call bidding with stick-the-dealer,
 * going alone on, first team to 10.
 */
export default {
  id: 'euchre',

  // deck + deal
  deck: { ranks: ['9', '10', 'J', 'Q', 'K', 'A'] }, // 24 cards
  deal: { players: 4, pattern: [3, 2] },            // 5 each, 4 to the kitty

  // scoring (points awarded per hand)
  scoring: {
    winningScore: 10,
    point: 1,       // makers take 3-4 tricks
    march: 2,       // makers take all 5
    loneMarch: 4,   // lone maker takes all 5
    euchre: 2,      // makers fail (defenders take 3+)
  },

  // rule toggles
  rules: {
    goAlone: true,
    stickDealer: true, // dealer must call in round 2 (no throw-in)
  },

  // seating — how matchmaking seats players at a euchre table
  seating: {
    seats: 4,
    partnerships: [[0, 2], [1, 3]], // across-the-table partners
    fillWithBots: true,
  },
};
