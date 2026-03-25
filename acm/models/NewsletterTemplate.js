const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  description:  String,
  htmlContent:  { type: String, required: true },
  restaurant:   { type: String, enum: ['all', 'nook', 'heyday', 'graffiti'], default: 'all' },
  isDefault:    { type: Boolean, default: false },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('NewsletterTemplate', templateSchema);
