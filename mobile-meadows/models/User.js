const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  displayName: String,
  firstName: String,
  lastName: String,
  email: { type: String, required: true },
  avatar: String,
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  phone: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'mm.users');
