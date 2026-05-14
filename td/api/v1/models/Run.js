/**
 * Run - a single playthrough instance.
 * Tracks live game state for multiplayer/replay/leaderboards.
 */
import mongoose from 'mongoose';

const placementSchema = new mongoose.Schema({
  towerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tower' },
  q: Number,
  r: Number,
  level: { type: Number, default: 1 },
}, { _id: false });

const runSchema = new mongoose.Schema({
  mapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Map', required: true },
  playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  playerName: String,

  status: {
    type: String,
    enum: ['active', 'won', 'lost', 'abandoned'],
    default: 'active',
  },

  // Live state
  currentWave: { type: Number, default: 0 },
  baseHealth: { type: Number, default: 100 },
  currency: { type: Number, default: 200 },
  score: { type: Number, default: 0 },

  placements: [placementSchema],

  // Timing
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  durationMs: Number,
}, { timestamps: true });

runSchema.index({ mapId: 1, score: -1 });
runSchema.index({ playerId: 1, createdAt: -1 });

export default mongoose.model('Run', runSchema);
