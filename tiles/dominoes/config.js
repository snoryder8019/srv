/**
 * Dominoes configuration — Block/Draw Dominoes (the classic), kept separate from logic.
 *
 * Standard double-six set (28 bones), 4 players, 7 tiles each. The holder of the
 * highest double opens; players match a bone to an open END of the line. If you
 * can't play you DRAW from the boneyard until you can, or PASS when it's empty
 * (this is the "draw" game; set drawGame:false for pure block). A hand ends when
 * a player goes out ("domino!") or the game is blocked (all pass). The winner of
 * the hand scores the SUM of every opponent's remaining pips. First to the target
 * (default 100) wins the game; individual scoring, HIGHEST total wins.
 *
 * Spinners: doubles can act as spinners, branching the line in up to four
 * directions. The host chooses the rule at table setup (config.spinnerRule):
 *   'first' (default) only the first double is a spinner
 *   'all'             every double is a spinner
 *   'none'            doubles are ordinary; single line, two ends (original game)
 */
export default {
  id: 'dominoes',

  set: { max: 6 },                 // double-six
  deal: { players: 4, tilesPer: 7 },

  rules: {
    drawGame: true,                // draw from boneyard when you can't play
    openWithHighestDouble: true,   // otherwise highest bone opens
    target: 100,                   // game ends when a player reaches this
    spinnerRule: 'first',          // 'first' | 'all' | 'none' — host picks at setup
  },

  seating: {
    seats: 4,
    partnerships: null,            // individual
    fillWithBots: true,
  },
};
