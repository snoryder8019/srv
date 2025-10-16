import mongoose from "mongoose";

const checkInSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LBBLocation',
    required: true
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
  points: {
    type: Number,
    default: 10
  },
  bonusPoints: {
    type: Number,
    default: 0
  },
  isFirstVisit: {
    type: Boolean,
    default: false
  },
  note: String,
  sharedLocation: {
    type: Boolean,
    default: false
  },
  verificationMethod: {
    type: String,
    enum: ['gps', 'qr', 'manual'],
    default: 'gps'
  },
  status: {
    type: String,
    enum: ['verified', 'pending', 'rejected'],
    default: 'verified'
  }
}, {
  timestamps: true
});

// Indexes for queries
checkInSchema.index({ userId: 1, createdAt: -1 });
checkInSchema.index({ locationId: 1, createdAt: -1 });
checkInSchema.index({ userId: 1, locationId: 1 });

const CheckIn = mongoose.model('LBBCheckIn', checkInSchema);

export default CheckIn;
