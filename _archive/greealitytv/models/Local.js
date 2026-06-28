const mongoose = require('mongoose');

const NEIGHBORHOODS = [
  'Downtown',
  'University District',
  'Westlake',
  'Island Grove',
  'East Greeley',
  'North Greeley',
  'South Greeley',
  'Bittersweet',
  'Country Club',
  'Poudre River',
  'Alta Vista',
  'West Side',
  'Sunrise',
  'Prairie West'
];

const localSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  category:     { type: String, enum: ['food', 'business', 'service', 'food-truck'], required: true },
  neighborhood: { type: String, enum: NEIGHBORHOODS, required: true },
  address:      { type: String, trim: true },
  description:  { type: String, required: true, trim: true },
  website:      { type: String, trim: true },
  phone:        { type: String, trim: true },
  hours:        { type: String, trim: true },
  image:        { type: String },
  submittedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt:    { type: Date, default: Date.now }
});

localSchema.statics.NEIGHBORHOODS = NEIGHBORHOODS;

module.exports = mongoose.model('GrvLocal', localSchema, 'grv_local');
