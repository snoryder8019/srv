const mongoose = require('mongoose');

const SCHOOLS = [
  'Greeley Central',
  'Greeley West',
  'Northridge',
  'Jefferson'
];

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

const DelegateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  // Which school(s) this delegate covers
  schools: [{ type: String, enum: SCHOOLS }],
  // Contact / identity
  fullName:  { type: String, required: true },
  phone:     { type: String },
  relation:  { type: String, enum: ['parent', 'guardian', 'teacher', 'coach', 'community', 'other'], default: 'parent' },
  // Agreement with GreeAlityTV
  agreementSigned: { type: Boolean, default: false },
  agreementDate:   { type: Date },
  // District partnership agreement (example reference)
  districtAgreementRef: { type: String, default: '' },
  // Status
  status: { type: String, enum: STATUSES, default: 'pending' },
  // Admin notes
  adminNotes: { type: String, default: '' },
  // Equipment issued
  equipment: [{
    item: String,
    serialNumber: String,
    issuedDate: Date,
    returnedDate: Date
  }],
  // Stats
  gamesRecorded:  { type: Number, default: 0 },
  totalViewership: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_delegates' });

DelegateSchema.statics.SCHOOLS = SCHOOLS;
DelegateSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('GrvDelegate', DelegateSchema);
