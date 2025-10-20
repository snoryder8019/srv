import mongoose from "mongoose";

const qrCodeSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },

  // QR Code Data
  content: {
    type: String,
    required: true
  },
  contentType: {
    type: String,
    enum: ['url', 'text', 'email', 'phone', 'sms', 'wifi', 'vcard', 'location', 'event'],
    default: 'url'
  },

  // Short URL
  shortCode: {
    type: String,
    unique: true,
    sparse: true, // allows multiple null values
    index: true
  },
  shortUrl: {
    type: String
  },

  // Destination (for dynamic QR codes)
  destinationUrl: {
    type: String
  },
  isDynamic: {
    type: Boolean,
    default: false
  },

  // Customization
  customization: {
    foregroundColor: {
      type: String,
      default: '#000000'
    },
    backgroundColor: {
      type: String,
      default: '#FFFFFF'
    },
    logo: {
      type: String // URL or base64
    },
    size: {
      type: Number,
      default: 256,
      min: 128,
      max: 2048
    },
    margin: {
      type: Number,
      default: 1,
      min: 0,
      max: 10
    },
    errorCorrectionLevel: {
      type: String,
      enum: ['L', 'M', 'Q', 'H'],
      default: 'M'
    }
  },

  // Organization
  category: {
    type: String,
    enum: ['marketing', 'event', 'product', 'menu', 'contact', 'payment', 'social', 'other'],
    default: 'other'
  },
  tags: [{
    type: String,
    trim: true
  }],

  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'archived', 'expired'],
    default: 'active'
  },
  expiresAt: {
    type: Date
  },

  // Owner
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Analytics (cached counts)
  stats: {
    totalScans: {
      type: Number,
      default: 0
    },
    uniqueScans: {
      type: Number,
      default: 0
    },
    lastScannedAt: {
      type: Date
    }
  },

  // Metadata
  metadata: {
    type: Map,
    of: String
  }

}, {
  timestamps: true
});

// Indexes for performance
qrCodeSchema.index({ createdBy: 1, status: 1 });
qrCodeSchema.index({ shortCode: 1 });
qrCodeSchema.index({ category: 1 });
qrCodeSchema.index({ createdAt: -1 });
qrCodeSchema.index({ 'stats.totalScans': -1 });

// Virtual for full short URL
qrCodeSchema.virtual('fullShortUrl').get(function() {
  if (this.shortCode) {
    return `${process.env.BASE_URL || 'http://localhost:3000'}/q/${this.shortCode}`;
  }
  return null;
});

// Generate unique short code
qrCodeSchema.statics.generateShortCode = async function() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let exists = true;

  while (exists) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    exists = await this.findOne({ shortCode: code });
  }

  return code;
};

// Method to increment scan count
qrCodeSchema.methods.recordScan = async function(isUnique = false) {
  this.stats.totalScans += 1;
  if (isUnique) {
    this.stats.uniqueScans += 1;
  }
  this.stats.lastScannedAt = new Date();
  return this.save();
};

// Check if QR code is valid
qrCodeSchema.methods.isValid = function() {
  if (this.status !== 'active') return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
};

const QRCode = mongoose.model('QRCode', qrCodeSchema);

export default QRCode;
