import mongoose from 'mongoose';

/**
 * Asset Model - Tracks files uploaded to Linode Object Storage
 * Organized by app buckets: madladslab/, acm/, sna/, twww/, ps/, etc.
 */
const assetSchema = new mongoose.Schema({
  // File information
  filename: {
    type: String,
    required: true,
    index: true
  },
  originalName: {
    type: String,
    required: true
  },

  // Bucket organization (matches /srv directory structure)
  bucket: {
    type: String,
    required: true,
    enum: ['madladslab', 'acm', 'sna', 'twww', 'ps', 'graffiti-tv', 'nocometalworkz', 'sfg', 'madThree', 'w2MongoClient', 'servers'],
    index: true
  },
  subdirectory: {
    type: String,
    default: '',
    index: true
  },

  // Full path in bucket: bucket/subdirectory/filename
  bucketPath: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // URLs
  publicUrl: {
    type: String,
    required: true
  },

  // File metadata
  fileType: {
    type: String,
    enum: ['image', 'video', 'object', 'document', 'other'],
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  dimensions: {
    width: Number,
    height: Number
  },

  // User-editable metadata
  title: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  tags: [{
    type: String,
    trim: true
  }],

  // Optional MongoDB linking
  linkedTo: {
    model: String,        // e.g., 'Recipe', 'Brand', 'Training'
    id: mongoose.Schema.Types.ObjectId,
    field: String         // e.g., 'image', 'logo'
  },

  // Access control
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },

  // Tracking
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for fast queries
assetSchema.index({ bucket: 1, subdirectory: 1, uploadedAt: -1 });
assetSchema.index({ fileType: 1, uploadedAt: -1 });
assetSchema.index({ tags: 1 });

// Virtual for full directory path
assetSchema.virtual('fullPath').get(function() {
  return this.subdirectory
    ? `${this.bucket}/${this.subdirectory}`
    : this.bucket;
});

// Update updatedAt on save
assetSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Asset', assetSchema);
