const mongoose = require('mongoose');

const addOnFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },          // stable key e.g. "skylight", "vent-cover"
  label: { type: String, required: true },        // display label e.g. "Skylight Seal"
  cost: { type: Number, required: true, min: 0 }, // flat $ add-on per unit selected
  type: { type: String, enum: ['checkbox', 'count'], default: 'checkbox' }, // checkbox = yes/no, count = qty
  enabled: { type: Boolean, default: true }
}, { _id: false });

const roofCalculatorSchema = new mongoose.Schema({
  costPerFoot: { type: Number, required: true, default: 12 },   // $ per linear foot of RV length
  costPerAC:   { type: Number, required: true, default: 75 },   // $ per AC unit on roof
  addOns:      { type: [addOnFieldSchema], default: [] },
  noteText:    { type: String, default: 'Estimate only — final price confirmed on inspection.' },
  enabled:     { type: Boolean, default: true },
  updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt:   { type: Date, default: Date.now }
});

// Singleton
roofCalculatorSchema.statics.getConfig = async function () {
  let cfg = await this.findOne();
  if (!cfg) cfg = await this.create({});
  return cfg;
};

module.exports = mongoose.model('RoofCalculator', roofCalculatorSchema, 'mm.roofCalculator');
