const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
  brand:    { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  label:    { type: String, required: true },
  code:     { type: String, required: true, unique: true },

  // What this QR does
  type: {
    type: String,
    enum: [
      'task-checkin',     // scan to check in for a task / sidework
      'shift-login',      // scan to start shift (enter PIN)
      'webhook',          // scan triggers a webhook event (fridge check, trash out, appliance move)
      'task-list',        // scan to view full task list for location
      'prep-log',         // scan to log a prep recipe completed
      'custom'
    ],
    default: 'task-checkin'
  },

  // Linked references
  task:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },

  // For webhook type
  webhookCategory: { type: String, default: '' },  // e.g. "fridge-left", "fridge-center", "appliance-rollout", "trash"
  webhookMeta:     { type: mongoose.Schema.Types.Mixed, default: {} },

  // Location within the venue
  area:     { type: String, default: '' },  // "kitchen", "bar", "patio", "walk-in"
  position: { type: String, default: '' },  // "left", "center", "right", "back"

  // Generated QR data URL (base64)
  dataUrl:  { type: String, default: '' },

  active:   { type: Boolean, default: true }

}, { timestamps: true });

qrCodeSchema.index({ brand: 1 });

module.exports = mongoose.model('QRCode', qrCodeSchema);
