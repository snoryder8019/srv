const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  brand:       { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  category:    { type: String, default: 'sidework' },

  // Task type: sidework, prep, cleaning, inspection, custom
  type: {
    type: String,
    enum: ['sidework', 'prep', 'cleaning', 'inspection', 'custom'],
    default: 'sidework'
  },

  // Scheduling
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'per-shift', 'once'],
    default: 'daily'
  },
  daysOfWeek: [{ type: Number }], // 0=Sun - 6=Sat
  shiftTime:  { type: String, enum: ['open', 'mid', 'close', 'any'], default: 'any' },

  // QR association — if this task is tied to a scannable QR
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode' },

  // Completion tracking
  imageMode: {
    type: String,
    enum: ['none', 'allowed', 'required'],
    default: 'none'
  },
  requiresNote:   { type: Boolean, default: false },

  sortOrder: { type: Number, default: 0 },
  active:    { type: Boolean, default: true }

}, { timestamps: true });

taskSchema.index({ brand: 1, active: 1 });

module.exports = mongoose.model('Task', taskSchema);
