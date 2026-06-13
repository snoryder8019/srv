/**
 * Baccarat (punto banco) configuration.
 *   Player 1:1 · Banker 0.95:1 (5% commission) · Tie 8:1 (P/B push on a tie)
 *   side: Player Pair / Banker Pair 11:1
 *   dealer: a toke bet on Banker placed FOR the dealer, plus flat tips
 */
export default {
  id: 'baccarat',
  scoring: { startChips: 200, betSize: 10, target: 500, maxRounds: 30 },
  rules: { bankerCommission: 0.05, tiePays: 8, pairPays: 11, decks: 6, penetration: 0.2 },
  seating: { seats: 7, fillWithBots: false },
};
