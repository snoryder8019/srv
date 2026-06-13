/**
 * Craps configuration — flat pass / don't-pass betting with bankrolls. Each seat
 * starts with `startChips`; bets are `betSize`. The game ends after `maxRounds`
 * sequences, when a player reaches `target`, or when one solvent player remains.
 */
export default {
  id: 'craps',
  dice: 2,
  scoring: { startChips: 100, betSize: 10, target: 200, maxRounds: 20 },
  rules: { passLine: true, dontPass: true },
  seating: { seats: 4, partnerships: null, fillWithBots: true },
};
