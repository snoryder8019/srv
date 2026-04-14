const mongoose = require('mongoose');

const siteThemeSchema = new mongoose.Schema({
  activeTheme: {
    type: String,
    default: 'default',
    enum: ['default', 'camping-highway']
  },
  customColors: {
    primary: String,
    primaryDark: String,
    primaryLight: String,
    accent: String,
    bg: String,
    bgCard: String,
    text: String,
    textLight: String
  },
  heroStyle: {
    type: String,
    default: 'gradient',
    enum: ['gradient', 'image', 'video']
  },
  heroOverlayOpacity: { type: Number, default: 0.6, min: 0, max: 1 },
  fontFamily: {
    type: String,
    default: 'system'
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

// Singleton pattern — only one theme doc
siteThemeSchema.statics.getActive = async function () {
  let theme = await this.findOne();
  if (!theme) {
    theme = await this.create({});
  }
  return theme;
};

module.exports = mongoose.model('SiteTheme', siteThemeSchema, 'mm.siteTheme');
