const mongoose = require('mongoose');

const siteContentSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true,
    unique: true
    // Sections: 'hero', 'mobile-repair', 'roof-repair', 'about', 'contact', 'footer'
  },
  heading: String,
  subheading: String,
  body: String,        // rich text / HTML
  image: String,       // path to uploaded image
  buttonText: String,
  buttonLink: String,
  extras: mongoose.Schema.Types.Mixed, // flexible key-value for section-specific data
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SiteContent', siteContentSchema, 'mm.siteContent');
