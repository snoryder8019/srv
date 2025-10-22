import mongoose from "mongoose";

const eukerTableSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: function() {
        return `Table ${Math.floor(Math.random() * 1000)}`;
      }
    },
    status: {
      type: String,
      enum: ['waiting', 'playing', 'finished'],
      default: 'waiting'
    },
    maxPlayers: {
      type: Number,
      default: 4,
      min: 2,
      max: 4
    },
    // Players in seats (North, East, South, West)
    seats: {
      North: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        isReady: { type: Boolean, default: false }
      },
      East: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        isReady: { type: Boolean, default: false }
      },
      South: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        isReady: { type: Boolean, default: false }
      },
      West: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        isReady: { type: Boolean, default: false }
      }
    },
    // Game state
    gameState: {
      dealerIdx: { type: Number, default: 0 },
      turnIdx: { type: Number, default: 0 },
      phase: { type: String, enum: ['idle', 'bidding1', 'bidding2', 'play'], default: 'idle' },
      deck: [String],
      upcard: String,
      trump: String,
      hands: {
        North: [String],
        East: [String],
        South: [String],
        West: [String]
      },
      table: [{
        player: String,
        card: String
      }],
      score: {
        teamNS: { type: Number, default: 0 },
        teamEW: { type: Number, default: 0 }
      },
      gamesWon: {
        teamNS: { type: Number, default: 0 },
        teamEW: { type: Number, default: 0 }
      },
      trickCount: {
        teamNS: { type: Number, default: 0 },
        teamEW: { type: Number, default: 0 }
      },
      maker: String, // who called trump
      goingAlone: Boolean
    },
    // Chat/activity log
    log: [{
      timestamp: { type: Date, default: Date.now },
      message: String,
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    private: {
      type: Boolean,
      default: false
    },
    password: String
  },
  {
    timestamps: true
  }
);

// Helper methods
eukerTableSchema.methods.getPlayerPosition = function(userId) {
  for (const [position, seat] of Object.entries(this.seats)) {
    if (seat.user && seat.user.toString() === userId.toString()) {
      return position;
    }
  }
  return null;
};

eukerTableSchema.methods.getPlayers = function() {
  return ['North', 'East', 'South', 'West']
    .map(pos => this.seats[pos].user)
    .filter(u => u);
};

eukerTableSchema.methods.isFull = function() {
  return this.getPlayers().length >= this.maxPlayers;
};

eukerTableSchema.methods.isEmpty = function() {
  return this.getPlayers().length === 0;
};

eukerTableSchema.methods.canStart = function() {
  const players = this.getPlayers();
  return players.length === 4 && ['North', 'East', 'South', 'West']
    .every(pos => this.seats[pos].isReady);
};

eukerTableSchema.methods.addLog = function(message, userId = null) {
  this.log.push({ message, user: userId });
  if (this.log.length > 100) {
    this.log = this.log.slice(-100); // Keep last 100 entries
  }
};

const EukerTable = mongoose.model("EukerTable", eukerTableSchema);

export default EukerTable;
