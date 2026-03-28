const mongoose = require('mongoose');

const shiftNoteSchema = new mongoose.Schema({
  brand:     { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  author:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title:     { type: String, default: '' },
  body:      { type: String, required: true },

  // Categorize: uniform, specials, announcements, safety, custom
  category: {
    type: String,
    enum: ['uniform', 'specials', 'announcement', 'safety', 'custom'],
    default: 'announcement'
  },

  shiftDate: { type: String }, // YYYY-MM-DD
  shiftTime: { type: String, enum: ['open', 'mid', 'close', 'all'], default: 'all' },

  // Users who acknowledged this note
  acknowledgedBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at:   { type: Date, default: Date.now }
  }],

  pinned: { type: Boolean, default: false },
  active: { type: Boolean, default: true }

}, { timestamps: true });

shiftNoteSchema.index({ brand: 1, shiftDate: 1 });

module.exports = mongoose.model('ShiftNote', shiftNoteSchema);
