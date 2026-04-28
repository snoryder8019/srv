const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId:    { type: String, unique: true, sparse: true },
  email:       { type: String, unique: true, sparse: true },
  displayName: String,
  firstName:   String,
  lastName:    String,
  avatar:      String,
  role:        { type: String, enum: ['superadmin', 'admin', 'player'], default: 'player' },
  provider:    { type: String, default: 'google' },
  stats: {
    gamesPlayed:    { type: Number, default: 0 },
    gamesWon:       { type: Number, default: 0 },
    highScore:      { type: Number, default: 0 },
    averagePerRound:{ type: Number, default: 0 }
  },
  // Notification preferences
  notifyOnTurn:  { type: Boolean, default: true },  // global turn alerts
  notifyOnChat:  { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
