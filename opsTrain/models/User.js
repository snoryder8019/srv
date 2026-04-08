const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email:       { type: String, sparse: true },
  displayName: { type: String, default: '' },
  firstName:   { type: String, default: '' },
  lastName:    { type: String, default: '' },
  avatar:      { type: String, default: '' },
  googleId:    { type: String, sparse: true },
  password:    { type: String, default: '' },
  provider:    { type: String, default: 'local' },

  // Role hierarchy: superadmin > admin > manager > user
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'manager', 'user'],
    default: 'user'
  },

  // Brand association
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },

  // POS pin for shift-level login (4-6 digit)
  posPin: { type: String },

  // Shift tracking
  clockedIn:    { type: Boolean, default: false },
  lastClockIn:  { type: Date },
  lastClockOut: { type: Date }

}, { timestamps: true });

userSchema.index({ posPin: 1, brand: 1 });

module.exports = mongoose.model('User', userSchema);
