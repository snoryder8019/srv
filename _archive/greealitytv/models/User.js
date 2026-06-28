const mongoose = require('mongoose');

const ROLES = ['viewer', 'contributor', 'delegate', 'editor', 'moderator', 'admin'];

const UserSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  email: { type: String },
  avatar: { type: String },
  bio: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  roles: [{ type: String, enum: ROLES, default: 'viewer' }],
  permissions: {
    canPost:       { type: Boolean, default: false },
    canUploadVideo:{ type: Boolean, default: false },
    canBroadcast:  { type: Boolean, default: false },
    canModerate:   { type: Boolean, default: false },
    canManageEvents:{ type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_users' });

UserSchema.methods.hasRole = function(role) {
  return this.roles.includes(role) || this.isAdmin;
};

UserSchema.methods.can = function(perm) {
  if (this.isAdmin) return true;
  return !!this.permissions[perm];
};

UserSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('GrvUser', UserSchema);
