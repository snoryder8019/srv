const mongoose = require('mongoose');

const qrScanSchema = new mongoose.Schema({
  qrCode:   { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode', required: true },
  brand:    { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  posPin:   { type: String },

  // Scan context
  type:     { type: String },  // mirrors QRCode.type at scan time
  note:     { type: String, default: '' },

  // Device info
  ip:        { type: String },
  userAgent: { type: String },
  device:    { type: String },
  os:        { type: String },
  browser:   { type: String },

  // Webhook data (for webhook-type QRs)
  webhookCategory: { type: String },
  webhookMeta:     { type: mongoose.Schema.Types.Mixed }

}, { timestamps: true });

qrScanSchema.index({ qrCode: 1, createdAt: -1 });
qrScanSchema.index({ brand: 1, createdAt: -1 });

module.exports = mongoose.model('QRScan', qrScanSchema);
