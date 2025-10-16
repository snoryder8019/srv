import mongoose from "mongoose";

const rewardSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  type: {
    type: String,
    enum: ['discount', 'free_item', 'special_access', 'points_multiplier', 'badge', 'other'],
    default: 'points_multiplier'
  },
  pointsCost: {
    type: Number,
    required: true,
    min: 0
  },
  value: String, // e.g., "20% off", "Free drink", "2x points"
  imageUrl: String,
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LBBLocation'
  },
  isGlobal: {
    type: Boolean,
    default: false
  },
  expiresAt: Date,
  maxRedemptions: Number,
  currentRedemptions: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  requirements: {
    minCheckIns: Number,
    minPoints: Number,
    specificLocations: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LBBLocation'
    }]
  }
}, {
  timestamps: true
});

rewardSchema.index({ locationId: 1, isActive: 1 });
rewardSchema.index({ isGlobal: 1, isActive: 1 });

const Reward = mongoose.model('LBBReward', rewardSchema);

export default Reward;
