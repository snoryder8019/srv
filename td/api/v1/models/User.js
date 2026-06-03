/**
 * User account - identity is provided by the games.madladslab.com platform
 * (platformId), with legacy/standalone Google OAuth (googleId) as a fallback.
 * This doc is the LOCAL per-game profile (progression, stats); the platform
 * owns canonical identity + cross-game analytics. See games WEBGAMES_PROTOCOL.md.
 * Roles allow basic privilege escalation: user < creator < moderator < admin.
 */
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  // Platform identity (games.madladslab.com - canonical)
  platformId: { type: String, unique: true, sparse: true, index: true },
  platformEmail: { type: String, lowercase: true, trim: true },
  isPlatformAdmin: { type: Boolean, default: false },
  permissions: { type: Object, default: {} },

  // Legacy / standalone OAuth identity (optional; sparse unique)
  googleId: { type: String, unique: true, sparse: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  emailVerified: { type: Boolean, default: false },

  // Display
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  avatarUrl: String,

  // Authorization
  roles: {
    type: [String],
    enum: ['user', 'creator', 'moderator', 'admin'],
    default: ['user'],
  },

  // Economy inventory — components build defenses, ammo arms deployments.
  // Global chips are NOT stored here; always read live from the platform wallet.
  inventory: {
    components: { type: Number, default: 0 },
    ammo: { type: Number, default: 0 },
    builtTowers: [{ towerId: { type: String, required: true }, count: { type: Number, default: 1 } }],
  },

  // Deckbuilder progression
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  cardCollection: [{ slug: { type: String, required: true }, count: { type: Number, default: 1 } }],

  // Engagement
  lastLoginAt: { type: Date },
  loginCount: { type: Number, default: 0 },

  // Soft moderation
  status: {
    type: String,
    enum: ['active', 'suspended', 'banned'],
    default: 'active',
  },

  // Lifetime play stats (updated at the end of every run)
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    gamesLost: { type: Number, default: 0 },
    gamesAbandoned: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    highestWave: { type: Number, default: 0 },
    towersBuilt: { type: Number, default: 0 },
    lastPlayedAt: { type: Date },
  },
}, { timestamps: true });

userSchema.methods.hasRole = function (role) {
  return this.roles.includes(role) || this.roles.includes('admin');
};

export default mongoose.model('User', userSchema);
