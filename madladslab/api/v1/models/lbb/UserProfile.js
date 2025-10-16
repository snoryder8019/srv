import mongoose from "mongoose";

const userProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  displayName: String,
  totalPoints: {
    type: Number,
    default: 0
  },
  totalCheckIns: {
    type: Number,
    default: 0
  },
  level: {
    type: Number,
    default: 1
  },
  badges: [{
    name: String,
    description: String,
    imageUrl: String,
    earnedAt: {
      type: Date,
      default: Date.now
    }
  }],
  favoriteLocations: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LBBLocation'
  }],
  redeemedRewards: [{
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LBBReward'
    },
    redeemedAt: {
      type: Date,
      default: Date.now
    },
    code: String,
    used: {
      type: Boolean,
      default: false
    }
  }],
  preferences: {
    shareLocation: {
      type: Boolean,
      default: true
    },
    notifications: {
      type: Boolean,
      default: true
    },
    publicProfile: {
      type: Boolean,
      default: false
    }
  },
  stats: {
    uniqueLocations: {
      type: Number,
      default: 0
    },
    currentStreak: {
      type: Number,
      default: 0
    },
    longestStreak: {
      type: Number,
      default: 0
    },
    lastCheckIn: Date
  }
}, {
  timestamps: true
});

userProfileSchema.index({ userId: 1 });
userProfileSchema.index({ totalPoints: -1 });
userProfileSchema.index({ totalCheckIns: -1 });

const UserProfile = mongoose.model('LBBUserProfile', userProfileSchema);

export default UserProfile;
