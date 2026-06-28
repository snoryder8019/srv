const mongoose = require('mongoose');

const PetitionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  goal: { type: Number, default: 100 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  signatories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser' }],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_petitions' });

module.exports = mongoose.model('GrvPetition', PetitionSchema);
