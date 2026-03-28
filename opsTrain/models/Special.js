const mongoose = require('mongoose');

const specialSchema = new mongoose.Schema({
  brand:       { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: String, default: '' },
  imageUrl:    { type: String, default: '' },

  // When this special is active
  dayOfWeek:   [{ type: Number }], // 0-6, empty = everyday
  startDate:   { type: Date },
  endDate:     { type: Date },
  shiftTime:   { type: String, enum: ['open', 'mid', 'close', 'all'], default: 'all' },

  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
  active: { type: Boolean, default: true }

}, { timestamps: true });

specialSchema.index({ brand: 1, active: 1 });

module.exports = mongoose.model('Special', specialSchema);
