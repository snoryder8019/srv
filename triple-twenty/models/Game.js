const mongoose = require('mongoose');

const dartSchema = new mongoose.Schema({
  segment: { type: Number, required: true },
  ring: { type: String, enum: ['single', 'double', 'triple', 'outer_bull', 'inner_bull', 'miss'], required: true },
  score: { type: Number, required: true }
}, { _id: false });

const roundSchema = new mongoose.Schema({
  playerIndex: { type: Number, required: true },
  darts: [dartSchema],
  total: { type: Number, default: 0 },
  confidence: String,
  frameId: String,
  corrected: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const playerStateSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // linked account
  player:    { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
  name:      String,
  token:     String,
  connected: { type: Boolean, default: false },
  // 501
  remaining: { type: Number, default: 501 },
  // Cricket
  marks: {
    20: { type: Number, default: 0 },
    19: { type: Number, default: 0 },
    18: { type: Number, default: 0 },
    17: { type: Number, default: 0 },
    16: { type: Number, default: 0 },
    15: { type: Number, default: 0 },
    bull: { type: Number, default: 0 }
  },
  cricketPoints: { type: Number, default: 0 }
}, { _id: false });

const gameSchema = new mongoose.Schema({
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // who created it
  mode:   { type: String, enum: ['501', 'cricket'], required: true },
  status: { type: String, enum: ['waiting', 'active', 'idle', 'finished', 'archived'], default: 'waiting' },
  lastActivityAt: { type: Date, default: Date.now },
  pausedFromStatus: { type: String, enum: ['waiting', 'active', null], default: null },  // what to restore on resume
  players: [playerStateSchema],
  currentPlayerIndex: { type: Number, default: 0 },
  rounds:  [roundSchema],
  winner:  { type: Number, default: null },
  camera: {
    ip:       String,
    username: String,
    password: String,
    path:     { type: String, default: '/cgi-bin/snapshot.cgi' }
  },
  inviteCode: { type: String, unique: true, sparse: true },
  name:       String   // optional friendly name set by host
}, { timestamps: true });

// Index for fast user game lookups
gameSchema.index({ hostUserId: 1, status: 1 });
gameSchema.index({ 'players.userId': 1, status: 1 });

module.exports = mongoose.model('Game', gameSchema);
