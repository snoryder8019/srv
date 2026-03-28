const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  location:    { type: String, default: '' },
  address:     { type: String, default: '' },
  phone:       { type: String, default: '' },
  logo:        { type: String, default: '' },
  color:       { type: String, default: '#2563eb' },
  description: { type: String, default: '' },

  // Owner (admin or brandAdmin who created it)
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Settings
  settings: {
    requirePinForTasks:  { type: Boolean, default: true },
    shiftNoteRequired:   { type: Boolean, default: false },
    specialsEnabled:     { type: Boolean, default: true },
    webhooksEnabled:     { type: Boolean, default: true },
    // Timezone (IANA, e.g. America/New_York, America/Chicago, America/Los_Angeles)
    timezone:   { type: String, default: 'America/New_York' },
    // Shift hour boundaries (local time, 24h)
    shiftOpen:  { type: Number, default: 6 },   // open starts at 6am
    shiftMid:   { type: Number, default: 14 },   // mid starts at 2pm
    shiftClose: { type: Number, default: 18 },   // close starts at 6pm
    shiftEnd:   { type: Number, default: 2 }      // day rolls over at 2am
  },

  active: { type: Boolean, default: true }

}, { timestamps: true });

module.exports = mongoose.model('Brand', brandSchema);
