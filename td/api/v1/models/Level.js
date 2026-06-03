/**
 * Level - a playable configuration built ON TOP of a Map (board).
 * A Map is the reusable board geometry; a Level adds the waves, difficulty
 * modifiers, and lifecycle. One board can back many levels.
 *
 * At run start the engine receives a composed object: { ...board, waves } so
 * GameInstance itself needs no knowledge of Levels.
 */
import mongoose from 'mongoose';

// _id:false keeps the waves JSON clean (it is hand-edited in the admin panel).
const enemyGroupSchema = new mongoose.Schema({
  type: { type: String, default: 'basic' },
  count: { type: Number, default: 10 },
  delayMs: { type: Number, default: 1000 },
}, { _id: false });

const waveSchema = new mongoose.Schema({
  enemies: [enemyGroupSchema],
  intermissionMs: { type: Number, default: 5000 },
}, { _id: false });

const levelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String, maxlength: 500 },

  // The board this level is played on.
  mapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Map', required: true },

  // Wave script (same shape the engine already reads off a map).
  waves: [waveSchema],

  // Difficulty modifiers applied at run start (null currency/health = engine default).
  modifiers: {
    startingCurrency: { type: Number, default: null },
    baseHealth: { type: Number, default: null },
    enemyHpMult: { type: Number, default: 1 },
    enemySpeedMult: { type: Number, default: 1 },
    rewardMult: { type: Number, default: 1 },
  },

  status: { type: String, enum: ['draft', 'approved', 'featured'], default: 'draft' },
  order: { type: Number, default: 0 },

  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String },
}, { timestamps: true });

levelSchema.index({ status: 1, order: 1 });

export default mongoose.model('Level', levelSchema);
