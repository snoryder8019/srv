const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  email: { type: String, sparse: true },
  avatar: String,
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    highScore: { type: Number, default: 0 },
    averagePerRound: { type: Number, default: 0 },
    totalDartsThrown: { type: Number, default: 0 },
    correctionsSubmitted: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
