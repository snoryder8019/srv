import mongoose from "mongoose";

const eukerPlayerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    stats: {
      gamesPlayed: { type: Number, default: 0 },
      gamesWon: { type: Number, default: 0 },
      handsPlayed: { type: Number, default: 0 },
      tricksWon: { type: Number, default: 0 },
      trumpCalls: { type: Number, default: 0 },
      successfulTrumpCalls: { type: Number, default: 0 },
      aloneAttempts: { type: Number, default: 0 },
      aloneSuccesses: { type: Number, default: 0 }
    },
    currentTable: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EukerTable'
    },
    preferences: {
      autoReady: { type: Boolean, default: false },
      soundEnabled: { type: Boolean, default: true },
      showHints: { type: Boolean, default: true }
    },
    lastActive: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Update last active on save
eukerPlayerSchema.pre('save', function(next) {
  this.lastActive = Date.now();
  next();
});

// Methods
eukerPlayerSchema.methods.getWinRate = function() {
  if (this.stats.gamesPlayed === 0) return 0;
  return (this.stats.gamesWon / this.stats.gamesPlayed * 100).toFixed(1);
};

eukerPlayerSchema.methods.getTrumpSuccessRate = function() {
  if (this.stats.trumpCalls === 0) return 0;
  return (this.stats.successfulTrumpCalls / this.stats.trumpCalls * 100).toFixed(1);
};

const EukerPlayer = mongoose.model("EukerPlayer", eukerPlayerSchema);

export default EukerPlayer;
