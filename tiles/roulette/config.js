/**
 * Roulette configuration — European single-zero wheel (37 pockets). Flat betting
 * with bankrolls: each seat starts with `startChips`, bets `betSize`. The game
 * ends after `maxRounds` spins, when a player reaches `target`, or when one
 * solvent player remains. Straight numbers pay 35:1; outsides pay 1:1.
 */
export default {
  id: 'roulette',
  wheel: 'european',
  pockets: 37,
  scoring: { startChips: 100, betSize: 10, target: 200, maxRounds: 20 },
  rules: { layout: 'european' },
  seating: { seats: 6, partnerships: null, fillWithBots: true },
};
