/**
 * Hearts configuration — rule/scoring/seating knobs, kept separate from logic.
 *
 * Standard 4-player Hearts: full 52-card deck, 13 cards each, no partnerships
 * (free-for-all). Avoid penalty cards: each heart = 1, the Queen of Spades = 13.
 * "Shooting the moon" (taking ALL penalty cards) gives the shooter 0 and every
 * opponent 26. A passing phase precedes each hand, rotating left/right/across/
 * hold. The game ends when someone reaches the cap; LOWEST score wins.
 */
export default {
  id: 'hearts',

  // deck + deal
  deck: { ranks: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] }, // full 52
  deal: { players: 4, cardsPer: 13 },

  // scoring
  scoring: {
    losingScore: 100,   // game ends when any player reaches this; lowest total wins
    heart: 1,
    queenSpades: 13,
    moon: 26,           // shooting the moon: shooter 0, everyone else +26
  },

  // rule toggles
  rules: {
    passCount: 3,                                    // cards passed each round (when not a hold)
    passCycle: ['left', 'right', 'across', 'hold'],  // rotates by hand number
    queenBreaksHearts: true,                         // Q♠ also "breaks hearts" for leading
    noFirstTrickPenalty: true,                       // cannot play hearts/Q♠ on trick 1
    twoOfClubsLeads: true,                           // holder of 2♣ leads the first trick
  },

  // seating — free-for-all, no partnerships
  seating: {
    seats: 4,
    partnerships: null, // individual scoring
    fillWithBots: true,
  },
};
