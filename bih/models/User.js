const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  displayName: { type: String },
  googleId: { type: String },
  avatar: { type: String },
  epicId: { type: String },
  twitchId: { type: String },
  theShowUsername: { type: String },
  theShowPlatform: { type: String, enum: ['PS5', 'PS4', 'Xbox', 'Switch', 'PC', ''], default: '' },
  isAdmin: { type: Boolean, default: false },
  isBIH: { type: Boolean, default: false },
  permissions: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
