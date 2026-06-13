import mongoose from 'mongoose';

const motdSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
    trim: true
  },
  welcomeMessage: {
    type: String,
    default: 'Thank you and welcome to a new day in the Stringborn Universe!'
  },
  ctaText: {
    type: String,
    default: 'We need asset design testers! If you want to make an NPC and write an arc, or create a texture pack in the sprite world builder'
  },
  ctaLink: {
    type: String,
    default: '/menu'
  },
  ctaLinkText: {
    type: String,
    default: 'Visit the Menu'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
motdSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to get the current active MOTD
motdSchema.statics.getCurrentMOTD = async function() {
  const now = new Date();

  return this.findOne({
    isActive: true,
    startDate: { $lte: now },
    $or: [
      { endDate: null },
      { endDate: { $gte: now } }
    ]
  }).sort({ priority: -1, createdAt: -1 });
};

const MOTD = mongoose.model('MOTD', motdSchema);

export default MOTD;
