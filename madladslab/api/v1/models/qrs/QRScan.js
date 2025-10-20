import mongoose from "mongoose";

const qrScanSchema = new mongoose.Schema({
  // QR Code Reference
  qrCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QRCode',
    required: true,
    index: true
  },

  // Scan Details
  scannedAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // User/Session Info
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sessionId: {
    type: String,
    index: true
  },
  fingerprint: {
    type: String // Browser fingerprint for unique tracking
  },

  // Location Data
  location: {
    ip: String,
    country: String,
    region: String,
    city: String,
    latitude: Number,
    longitude: Number,
    timezone: String
  },

  // Device & Browser Info
  device: {
    type: {
      type: String,
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
      default: 'unknown'
    },
    os: String,
    osVersion: String,
    browser: String,
    browserVersion: String,
    userAgent: String
  },

  // Referrer
  referrer: {
    type: String
  },

  // UTM Parameters
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },

  // Custom metadata
  metadata: {
    type: Map,
    of: String
  }

}, {
  timestamps: false // We use scannedAt instead
});

// Indexes for analytics queries
qrScanSchema.index({ qrCode: 1, scannedAt: -1 });
qrScanSchema.index({ sessionId: 1, qrCode: 1 });
qrScanSchema.index({ 'location.country': 1 });
qrScanSchema.index({ 'device.type': 1 });

// Static method to get scan statistics
qrScanSchema.statics.getStatsByQRCode = async function(qrCodeId, dateFrom, dateTo) {
  const match = {
    qrCode: mongoose.Types.ObjectId(qrCodeId)
  };

  if (dateFrom || dateTo) {
    match.scannedAt = {};
    if (dateFrom) match.scannedAt.$gte = new Date(dateFrom);
    if (dateTo) match.scannedAt.$lte = new Date(dateTo);
  }

  const [total, unique, byCountry, byDevice, byHour] = await Promise.all([
    // Total scans
    this.countDocuments(match),

    // Unique scans (by fingerprint)
    this.distinct('fingerprint', match).then(arr => arr.length),

    // By country
    this.aggregate([
      { $match: match },
      { $group: { _id: '$location.country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),

    // By device type
    this.aggregate([
      { $match: match },
      { $group: { _id: '$device.type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),

    // By hour of day
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $hour: '$scannedAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  return {
    total,
    unique,
    byCountry,
    byDevice,
    byHour
  };
};

// Method to check if this is a unique scan for this session
qrScanSchema.statics.isUniqueScan = async function(qrCodeId, sessionId) {
  const existing = await this.findOne({
    qrCode: qrCodeId,
    sessionId: sessionId
  });
  return !existing;
};

const QRScan = mongoose.model('QRScan', qrScanSchema);

export default QRScan;
