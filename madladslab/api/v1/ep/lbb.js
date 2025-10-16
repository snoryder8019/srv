import Location from "../models/lbb/Location.js";
import CheckIn from "../models/lbb/CheckIn.js";
import Reward from "../models/lbb/Reward.js";
import UserProfile from "../models/lbb/UserProfile.js";

// Helper: Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Get nearby locations
export async function getNearbyLocations(longitude, latitude, maxDistance = 5000) {
  return await Location.find({
    coordinates: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    isActive: true
  }).limit(50);
}

// Get all locations
export async function getAllLocations() {
  return await Location.find({ isActive: true }).sort({ name: 1 });
}

// Get location by ID
export async function getLocationById(locationId) {
  return await Location.findById(locationId).populate('rewards');
}

// Create location
export async function createLocation(data) {
  const location = new Location(data);
  return await location.save();
}

// Check in to a location
export async function checkInToLocation(userId, locationId, userLongitude, userLatitude) {
  const location = await Location.findById(locationId);
  if (!location) {
    throw new Error("Location not found");
  }

  // Verify user is within check-in radius
  const distance = calculateDistance(
    userLatitude,
    userLongitude,
    location.coordinates.coordinates[1],
    location.coordinates.coordinates[0]
  );

  if (distance > location.checkInRadius) {
    throw new Error(`You must be within ${location.checkInRadius}m to check in`);
  }

  // Check if user already checked in today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existingCheckIn = await CheckIn.findOne({
    userId,
    locationId,
    createdAt: { $gte: today }
  });

  if (existingCheckIn) {
    throw new Error("You've already checked in here today");
  }

  // Check if this is first visit
  const previousVisits = await CheckIn.countDocuments({ userId, locationId });
  const isFirstVisit = previousVisits === 0;

  // Calculate points
  let points = 10;
  let bonusPoints = 0;

  if (isFirstVisit) {
    bonusPoints += 20; // First visit bonus
  }

  // Create check-in
  const checkIn = new CheckIn({
    userId,
    locationId,
    coordinates: {
      type: 'Point',
      coordinates: [userLongitude, userLatitude]
    },
    points,
    bonusPoints,
    isFirstVisit,
    sharedLocation: true,
    verificationMethod: 'gps',
    status: 'verified'
  });

  await checkIn.save();

  // Update location stats
  await Location.findByIdAndUpdate(locationId, {
    $inc: { totalCheckIns: 1 }
  });

  // Update user profile
  await updateUserProfile(userId, points + bonusPoints, locationId);

  return checkIn;
}

// Update user profile
async function updateUserProfile(userId, pointsToAdd, locationId) {
  let profile = await UserProfile.findOne({ userId });

  if (!profile) {
    profile = new UserProfile({
      userId,
      totalPoints: 0,
      totalCheckIns: 0
    });
  }

  profile.totalPoints += pointsToAdd;
  profile.totalCheckIns += 1;

  // Update level (every 100 points = 1 level)
  profile.level = Math.floor(profile.totalPoints / 100) + 1;

  // Update stats
  const uniqueLocations = await CheckIn.distinct('locationId', { userId });
  profile.stats.uniqueLocations = uniqueLocations.length;
  profile.stats.lastCheckIn = new Date();

  // Calculate streak
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const checkedInYesterday = await CheckIn.findOne({
    userId,
    createdAt: {
      $gte: yesterday,
      $lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000)
    }
  });

  if (checkedInYesterday) {
    profile.stats.currentStreak += 1;
  } else {
    profile.stats.currentStreak = 1;
  }

  if (profile.stats.currentStreak > profile.stats.longestStreak) {
    profile.stats.longestStreak = profile.stats.currentStreak;
  }

  await profile.save();
  return profile;
}

// Get user profile
export async function getUserProfile(userId) {
  let profile = await UserProfile.findOne({ userId });

  if (!profile) {
    profile = new UserProfile({ userId });
    await profile.save();
  }

  return profile;
}

// Get user check-in history
export async function getUserCheckIns(userId, limit = 20) {
  return await CheckIn.find({ userId })
    .populate('locationId')
    .sort({ createdAt: -1 })
    .limit(limit);
}

// Get leaderboard
export async function getLeaderboard(limit = 10, type = 'points') {
  const sortField = type === 'points' ? 'totalPoints' : 'totalCheckIns';
  return await UserProfile.find()
    .populate('userId', 'name email')
    .sort({ [sortField]: -1 })
    .limit(limit);
}

// Get available rewards for user
export async function getAvailableRewards(userId, locationId = null) {
  const profile = await getUserProfile(userId);

  let query = { isActive: true };

  if (locationId) {
    query.$or = [
      { locationId },
      { isGlobal: true }
    ];
  } else {
    query.isGlobal = true;
  }

  const rewards = await Reward.find(query);

  // Filter rewards based on user's eligibility
  return rewards.filter(reward => {
    if (reward.requirements) {
      if (reward.requirements.minPoints && profile.totalPoints < reward.requirements.minPoints) {
        return false;
      }
      if (reward.requirements.minCheckIns && profile.totalCheckIns < reward.requirements.minCheckIns) {
        return false;
      }
    }
    if (reward.maxRedemptions && reward.currentRedemptions >= reward.maxRedemptions) {
      return false;
    }
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return false;
    }
    return true;
  });
}

// Redeem reward
export async function redeemReward(userId, rewardId) {
  const reward = await Reward.findById(rewardId);
  if (!reward || !reward.isActive) {
    throw new Error("Reward not available");
  }

  const profile = await getUserProfile(userId);

  if (profile.totalPoints < reward.pointsCost) {
    throw new Error("Not enough points");
  }

  // Check eligibility
  if (reward.requirements) {
    if (reward.requirements.minPoints && profile.totalPoints < reward.requirements.minPoints) {
      throw new Error("Does not meet minimum points requirement");
    }
    if (reward.requirements.minCheckIns && profile.totalCheckIns < reward.requirements.minCheckIns) {
      throw new Error("Does not meet minimum check-ins requirement");
    }
  }

  // Generate redemption code
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();

  // Update profile
  profile.totalPoints -= reward.pointsCost;
  profile.redeemedRewards.push({
    rewardId,
    code,
    used: false
  });
  await profile.save();

  // Update reward redemption count
  await Reward.findByIdAndUpdate(rewardId, {
    $inc: { currentRedemptions: 1 }
  });

  return { reward, code, profile };
}

// Get location stats
export async function getLocationStats(locationId) {
  const location = await Location.findById(locationId);
  const totalCheckIns = await CheckIn.countDocuments({ locationId });
  const uniqueUsers = await CheckIn.distinct('userId', { locationId });

  return {
    location,
    totalCheckIns,
    uniqueUsers: uniqueUsers.length
  };
}
