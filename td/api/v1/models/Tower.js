/**
 * Tower asset - the heart of the community-built content.
 * Each tower has a GLTF model + stats + behavior config.
 */
import mongoose from 'mongoose';

const towerSchema = new mongoose.Schema({
  // Identity
  name: { type: String, required: true, trim: true, maxlength: 60 },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String, maxlength: 500 },
  category: {
    type: String,
    enum: ['kinetic', 'energy', 'support', 'special'],
    default: 'kinetic',
  },

  // Authorship
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String },

  // Asset references - gltfUrl is optional; client falls back to a primitive
  // so seed/system towers and bare drafts still render.
  gltfUrl: { type: String, default: '' },
  thumbnailUrl: { type: String },

  // Visual config
  scale: { type: Number, default: 1.0, min: 0.1, max: 5.0 },
  rotationOffset: { type: Number, default: 0 }, // radians

  // Combat stats
  stats: {
    damage: { type: Number, default: 10, min: 0 },
    range: { type: Number, default: 3, min: 1, max: 20 }, // in hex units
    fireRate: { type: Number, default: 1.0, min: 0.1, max: 10 }, // shots/sec
    cost: { type: Number, default: 50, min: 0 },
    projectileSpeed: { type: Number, default: 5 },
  },

  // Behavior flags - low-code surface for non-coders
  behavior: {
    targeting: {
      type: String,
      enum: ['nearest', 'first', 'last', 'strongest', 'weakest'],
      default: 'nearest',
    },
    canHitFlying: { type: Boolean, default: true },
    splashRadius: { type: Number, default: 0 }, // 0 = single target
  },

  // Lifecycle / moderation
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

towerSchema.index({ status: 1, 'votes.up': -1 });
towerSchema.index({ category: 1, status: 1 });

export default mongoose.model('Tower', towerSchema);
