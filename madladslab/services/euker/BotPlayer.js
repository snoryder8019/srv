// services/euker/BotPlayer.js
// AI Bot logic for Euker card game

const SUITS = ['H', 'D', 'C', 'S'];
const sameColor = { H: 'D', D: 'H', C: 'S', S: 'C' };

class EukerBot {
  constructor(name, difficulty = 'medium') {
    this.name = name;
    this.difficulty = difficulty; // 'easy', 'medium', 'hard'
  }

  // Evaluate hand strength for a given trump suit
  evaluateHand(hand, trumpSuit) {
    let score = 0;
    const leftBower = sameColor[trumpSuit];

    for (const card of hand) {
      const rank = card.slice(0, -1);
      const suit = card.slice(-1);

      // Right bower (J of trump)
      if (rank === 'J' && suit === trumpSuit) score += 10;
      // Left bower (J of same color)
      else if (rank === 'J' && suit === leftBower) score += 9;
      // Other trump cards
      else if (suit === trumpSuit) {
        const values = { 'A': 6, 'K': 5, 'Q': 4, '10': 3, '9': 2 };
        score += values[rank] || 0;
      }
      // Aces in other suits
      else if (rank === 'A') score += 2;
    }

    return score;
  }

  // Bidding Round 1 - decide whether to order up the upcard
  decideBidRound1(hand, upcard, position, dealerPosition) {
    const trumpSuit = upcard.slice(-1);
    const handStrength = this.evaluateHand(hand, trumpSuit);
    const isDealer = position === dealerPosition;

    // Difficulty affects decision threshold
    const thresholds = {
      easy: { order: 8, dealerOrder: 5 },
      medium: { order: 12, dealerOrder: 8 },
      hard: { order: 15, dealerOrder: 10 }
    };

    const threshold = thresholds[this.difficulty];

    // Dealer has advantage (gets to pick up the card)
    if (isDealer) {
      return handStrength >= threshold.dealerOrder;
    }

    return handStrength >= threshold.order;
  }

  // Bidding Round 2 - choose a suit (or pass)
  decideBidRound2(hand, excludeSuit, position, dealerPosition) {
    const isDealer = position === dealerPosition;
    let bestSuit = null;
    let bestScore = 0;

    // Evaluate each possible trump suit
    for (const suit of SUITS) {
      if (suit === excludeSuit) continue;

      const score = this.evaluateHand(hand, suit);
      if (score > bestScore) {
        bestScore = score;
        bestSuit = suit;
      }
    }

    // Difficulty affects threshold for calling
    const thresholds = {
      easy: { call: 6, dealerCall: 3 },
      medium: { call: 10, dealerCall: 6 },
      hard: { call: 13, dealerCall: 8 }
    };

    const threshold = thresholds[this.difficulty];
    const minScore = isDealer ? threshold.dealerCall : threshold.call;

    // Dealer must call if they're last
    if (isDealer && bestScore >= minScore) {
      return bestSuit;
    }

    return bestScore >= threshold.call ? bestSuit : null;
  }

  // Determine if a card is trump
  isTrump(card, trumpSuit) {
    const rank = card.slice(0, -1);
    const suit = card.slice(-1);
    const leftBower = sameColor[trumpSuit];

    return suit === trumpSuit || (rank === 'J' && suit === leftBower);
  }

  // Get the effective suit of a card (accounting for left bower)
  getEffectiveSuit(card, trumpSuit) {
    const rank = card.slice(0, -1);
    const suit = card.slice(-1);
    const leftBower = sameColor[trumpSuit];

    if (rank === 'J' && suit === leftBower) return trumpSuit;
    return suit;
  }

  // Calculate card value for trick-taking
  cardValue(card, leadSuit, trumpSuit) {
    const rank = card.slice(0, -1);
    const suit = card.slice(-1);
    const leftBower = sameColor[trumpSuit];

    // Right bower
    if (rank === 'J' && suit === trumpSuit) return 100;
    // Left bower
    if (rank === 'J' && suit === leftBower) return 99;

    const isTrump = this.isTrump(card, trumpSuit);
    const effectiveSuit = this.getEffectiveSuit(card, trumpSuit);
    const isLead = effectiveSuit === leadSuit;

    const base = { 'A': 6, 'K': 5, 'Q': 4, '10': 3, '9': 2, 'J': 1 }[rank] || 0;

    if (isTrump) return 50 + base;
    if (isLead) return 20 + base;
    return base;
  }

  // Choose which card to play
  chooseCard(hand, currentTrick, trumpSuit) {
    if (hand.length === 0) return null;

    // If leading (first to play)
    if (currentTrick.length === 0) {
      return this.chooseLeadCard(hand, trumpSuit);
    }

    // Following suit
    const leadCard = currentTrick[0].card;
    const leadSuit = this.getEffectiveSuit(leadCard, trumpSuit);

    // Get cards that follow suit
    const followCards = hand.filter(c =>
      this.getEffectiveSuit(c, trumpSuit) === leadSuit
    );

    if (followCards.length > 0) {
      return this.chooseBestFollowCard(followCards, currentTrick, leadSuit, trumpSuit);
    }

    // Can't follow suit - play strategically
    return this.chooseDiscardCard(hand, currentTrick, leadSuit, trumpSuit);
  }

  // Choose card when leading
  chooseLeadCard(hand, trumpSuit) {
    // Strategy: Lead with highest trump or highest card
    if (this.difficulty === 'hard') {
      // Hard bots lead trump to draw out opponent's trump
      const trumpCards = hand.filter(c => this.isTrump(c, trumpSuit));
      if (trumpCards.length > 0) {
        return trumpCards.reduce((best, card) =>
          this.cardValue(card, trumpSuit, trumpSuit) > this.cardValue(best, trumpSuit, trumpSuit)
            ? card : best
        );
      }
    }

    // Lead with highest card
    return hand.reduce((best, card) =>
      this.cardValue(card, card.slice(-1), trumpSuit) >
      this.cardValue(best, best.slice(-1), trumpSuit)
        ? card : best
    );
  }

  // Choose best card when following suit
  chooseBestFollowCard(followCards, currentTrick, leadSuit, trumpSuit) {
    // Find current winning card
    let winningCard = currentTrick[0].card;
    let winningValue = this.cardValue(winningCard, leadSuit, trumpSuit);

    for (let i = 1; i < currentTrick.length; i++) {
      const card = currentTrick[i].card;
      const value = this.cardValue(card, leadSuit, trumpSuit);
      if (value > winningValue) {
        winningCard = card;
        winningValue = value;
      }
    }

    // Try to win the trick
    const winningCards = followCards.filter(c =>
      this.cardValue(c, leadSuit, trumpSuit) > winningValue
    );

    if (winningCards.length > 0) {
      // Play lowest card that wins
      return winningCards.reduce((best, card) =>
        this.cardValue(card, leadSuit, trumpSuit) < this.cardValue(best, leadSuit, trumpSuit)
          ? card : best
      );
    }

    // Can't win - play lowest card
    return followCards.reduce((best, card) =>
      this.cardValue(card, leadSuit, trumpSuit) < this.cardValue(best, leadSuit, trumpSuit)
        ? card : best
    );
  }

  // Choose card when can't follow suit
  chooseDiscardCard(hand, currentTrick, leadSuit, trumpSuit) {
    // Check if partner is winning
    const partnerIndex = (currentTrick.length + 2) % 4;
    let partnerWinning = false;

    if (currentTrick.length >= 2) {
      let winningIdx = 0;
      let winningValue = this.cardValue(currentTrick[0].card, leadSuit, trumpSuit);

      for (let i = 1; i < currentTrick.length; i++) {
        const value = this.cardValue(currentTrick[i].card, leadSuit, trumpSuit);
        if (value > winningValue) {
          winningIdx = i;
          winningValue = value;
        }
      }

      // Simple partner detection (opposite player)
      partnerWinning = (winningIdx % 2) === 0 && currentTrick.length === 3;
    }

    // If partner is winning and we're last, discard lowest
    if (partnerWinning && currentTrick.length === 3) {
      return hand.reduce((best, card) =>
        this.cardValue(card, card.slice(-1), trumpSuit) <
        this.cardValue(best, best.slice(-1), trumpSuit)
          ? card : best
      );
    }

    // Try to win with trump
    const trumpCards = hand.filter(c => this.isTrump(c, trumpSuit));
    if (trumpCards.length > 0 && this.difficulty !== 'easy') {
      // Find current winning value
      let winningValue = 0;
      for (const play of currentTrick) {
        const value = this.cardValue(play.card, leadSuit, trumpSuit);
        if (value > winningValue) winningValue = value;
      }

      // Play lowest trump that wins
      const winningTrumps = trumpCards.filter(c =>
        this.cardValue(c, leadSuit, trumpSuit) > winningValue
      );

      if (winningTrumps.length > 0) {
        return winningTrumps.reduce((best, card) =>
          this.cardValue(card, leadSuit, trumpSuit) < this.cardValue(best, leadSuit, trumpSuit)
            ? card : best
        );
      }
    }

    // Discard lowest card
    return hand.reduce((best, card) =>
      this.cardValue(card, card.slice(-1), trumpSuit) <
      this.cardValue(best, best.slice(-1), trumpSuit)
        ? card : best
    );
  }
}

// Predefined bot personalities
const BOT_NAMES = [
  { name: 'RoboCard', difficulty: 'medium' },
  { name: 'TrumpMaster', difficulty: 'hard' },
  { name: 'CardBot3000', difficulty: 'medium' },
  { name: 'EasyBot', difficulty: 'easy' },
  { name: 'AlphaEuker', difficulty: 'hard' },
  { name: 'BetaPlayer', difficulty: 'medium' },
  { name: 'GammaBot', difficulty: 'easy' },
  { name: 'DeltaCard', difficulty: 'hard' }
];

export { EukerBot, BOT_NAMES };
