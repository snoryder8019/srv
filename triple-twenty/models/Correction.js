const mongoose = require('mongoose');

const correctionSchema = new mongoose.Schema({
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
  frameId: String,
  ai: {
    darts: [{ segment: Number, ring: String, score: Number }],
    total: Number
  },
  corrected: {
    darts: [{ segment: Number, ring: String, score: Number }],
    total: Number
  },
  note: String
}, { timestamps: true });

module.exports = mongoose.model('Correction', correctionSchema);
