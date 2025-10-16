import mongoose from "mongoose";

const locationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['bar', 'lounge', 'club', 'pub', 'other'],
    default: 'bar'
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: 'USA' }
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  description: String,
  imageUrl: String,
  hours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  rewards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LBBReward'
  }],
  checkInRadius: {
    type: Number,
    default: 50 // meters
  },
  isActive: {
    type: Boolean,
    default: true
  },
  totalCheckIns: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Create geospatial index for location-based queries
locationSchema.index({ coordinates: '2dsphere' });
locationSchema.index({ name: 'text', description: 'text' });

const Location = mongoose.model('LBBLocation', locationSchema);

export default Location;
