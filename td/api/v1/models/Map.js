/**
 * Map - a hex board layout with path, spawn, and base hexes.
 * Stored as axial coordinates so size doesn't bloat the doc.
 */
import mongoose from 'mongoose';

const hexCoordSchema = new mongoose.Schema({
  q: { type: Number, required: true },
  r: { type: Number, required: true },
}, { _id: false });

const mapSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String, maxlength: 500 },

  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String },

  // Board geometry
  radius: { type: Number, default: 6, min: 3, max: 20 },

  // Hex roles - everything else is buildable terrain
  spawnHexes: [hexCoordSchema],   // enemies enter here
  baseHexes: [hexCoordSchema],    // enemies must reach (and damage) these
  pathHexes: [hexCoordSchema],    // pre-set walking path (towers cannot occupy)
  blockedHexes: [hexCoordSchema], // visual obstacles, no build, no walk

  // Difficulty / waves
  waves: [{
    enemies: [{
      type: { type: String, default: 'basic' },
      count: { type: Number, default: 10 },
      delayMs: { type: Number, default: 1000 },
    }],
    intermissionMs: { type: Number, default: 5000 },
  }],

  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected', 'featured'],
    default: 'draft',
  },
  votes: {
    up: { type: Number, default: 0 },
    down: { type: Number, default: 0 },
  },
}, { timestamps: true });

mapSchema.index({ status: 1, 'votes.up': -1 });

export default mongoose.model('Map', mapSchema);
