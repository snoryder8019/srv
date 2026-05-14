const mongoose = require('mongoose');

const correctionSchema = new mongoose.Schema({
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
  frameId: String,

  // Frame storage — without this, corrections are unusable for training.
  frameSha256: String,
  frameUrl:    String,
  frameBytes:  Number,
  cameraModel: String,

  ai: {
    darts: [{ segment: Number, ring: String, score: Number }],
    total: Number
  },
  corrected: {
    darts: [{ segment: Number, ring: String, score: Number }],
    total: Number
  },
  note: String,

  source: {
    type: String,
    enum: ['learning-mode', 'post-round', 'manual', 'background', 'unknown'],
    default: 'unknown'
  },
  validated: { type: Boolean, default: false }
}, { timestamps: true });

correctionSchema.index({ frameSha256: 1 });
correctionSchema.index({ validated: 1, createdAt: -1 });

module.exports = mongoose.model('Correction', correctionSchema);
