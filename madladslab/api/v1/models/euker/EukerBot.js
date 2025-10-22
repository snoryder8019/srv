import mongoose from "mongoose";

// Virtual bot user schema - these aren't real users but act like them
const eukerBotSchema = new mongoose.Schema(
  {
    displayName: {
      type: String,
      required: true,
      get: function(v) {
        // Always append robot emoji to bot names
        return v && !v.includes('🤖') ? `${v} 🤖` : v;
      }
    },
    email: {
      type: String,
      default: function() {
        return `bot-${this._id}@euker.bot`;
      }
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    },
    isBot: {
      type: Boolean,
      default: true
    },
    gamesPlayed: {
      type: Number,
      default: 0
    },
    wins: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
  }
);

// Method to make it look like a user
eukerBotSchema.methods.toUserFormat = function() {
  return {
    _id: this._id,
    displayName: `${this.displayName} 🤖`,
    email: `bot-${this._id}@euker.local`,
    isBot: true
  };
};

const EukerBot = mongoose.model("EukerBot", eukerBotSchema);

export default EukerBot;
