const mongoose = require('mongoose');

const crewSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  displayName: { type: String, required: true },
  posPin:      { type: String, default: '' },
  role:        { type: String, default: '' },   // server, cook, bartender, host, busser, dishwasher, expo, manager
  station:     { type: String, default: '' },   // bar, kitchen, floor, patio, drive-thru
  clockIn:     { type: Date },
  clockOut:    { type: Date },
  present:     { type: Boolean, default: false },
  note:        { type: String, default: '' }
}, { _id: true });

const shiftSchema = new mongoose.Schema({
  brand:     { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  date:      { type: String, required: true }, // YYYY-MM-DD
  shiftTime: { type: String, enum: ['open', 'mid', 'close'], required: true },
  status:    { type: String, enum: ['draft', 'active', 'closed'], default: 'draft' },
  crew:      [crewSchema],
  notes:     { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  activatedAt: { type: Date },
  closedAt:    { type: Date }
}, { timestamps: true });

shiftSchema.index({ brand: 1, date: 1, shiftTime: 1 }, { unique: true });
shiftSchema.index({ brand: 1, status: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
