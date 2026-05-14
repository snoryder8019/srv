/**
 * User account - keyed by Google OAuth profile ID.
 * Roles allow basic privilege escalation: user < creator < moderator < admin.
 */
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  // OAuth identity
  googleId: { type: String, required: true, unique: true, index: true },
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

  // Engagement
  lastLoginAt: { type: Date },
  loginCount: { type: Number, default: 0 },

  // Soft moderation
  status: {
    type: String,
    enum: ['active', 'suspended', 'banned'],
    default: 'active',
  },
}, { timestamps: true });

userSchema.methods.hasRole = function (role) {
  return this.roles.includes(role) || this.roles.includes('admin');
};

export default mongoose.model('User', userSchema);
