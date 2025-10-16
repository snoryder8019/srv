import express from "express";
import {
  getNearbyLocations,
  getAllLocations,
  getLocationById,
  createLocation,
  checkInToLocation,
  getUserProfile,
  getUserCheckIns,
  getLeaderboard,
  getAvailableRewards,
  redeemReward,
  getLocationStats
} from "../../api/v1/ep/lbb.js";

const router = express.Router();

// Middleware: require authenticated user
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// Middleware: require admin/manager
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAustins) {
    return res.status(403).json({ error: "Forbidden. Admin access required." });
  }
  next();
}

// ============ VIEW ROUTES ============

// Main LBB page - displays map and nearby locations
router.get("/", async (req, res) => {
  try {
    const user = req.user || null;
    let profile = null;
    let recentCheckIns = [];

    if (user) {
      profile = await getUserProfile(user._id);
      recentCheckIns = await getUserCheckIns(user._id, 5);
    }

    res.render("lbb/index", {
      user,
      profile,
      recentCheckIns,
      title: "Life Behind Bars"
    });
  } catch (error) {
    console.error("Error loading LBB page:", error);
    res.status(500).send("Error loading page");
  }
});

// Profile page
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user._id);
    const checkIns = await getUserCheckIns(req.user._id, 20);

    res.render("lbb/profile", {
      user: req.user,
      profile,
      checkIns,
      title: "My Profile - LBB"
    });
  } catch (error) {
    console.error("Error loading profile:", error);
    res.status(500).send("Error loading profile");
  }
});

// Leaderboard page
router.get("/leaderboard", async (req, res) => {
  try {
    const leaderboard = await getLeaderboard(50, 'points');

    res.render("lbb/leaderboard", {
      user: req.user || null,
      leaderboard,
      title: "Leaderboard - LBB"
    });
  } catch (error) {
    console.error("Error loading leaderboard:", error);
    res.status(500).send("Error loading leaderboard");
  }
});

// Rewards page
router.get("/rewards", requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user._id);
    const availableRewards = await getAvailableRewards(req.user._id);

    res.render("lbb/rewards", {
      user: req.user,
      profile,
      availableRewards,
      title: "Rewards - LBB"
    });
  } catch (error) {
    console.error("Error loading rewards:", error);
    res.status(500).send("Error loading rewards");
  }
});

// ============ API ROUTES ============

// Get nearby locations (for map)
router.get("/api/locations/nearby", async (req, res) => {
  try {
    const { longitude, latitude, maxDistance } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ error: "Longitude and latitude required" });
    }

    const locations = await getNearbyLocations(
      parseFloat(longitude),
      parseFloat(latitude),
      maxDistance ? parseInt(maxDistance) : 5000
    );

    res.json(locations);
  } catch (error) {
    console.error("Error fetching nearby locations:", error);
    res.status(500).json({ error: "Error fetching locations" });
  }
});

// Get all locations
router.get("/api/locations", async (req, res) => {
  try {
    const locations = await getAllLocations();
    res.json(locations);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: "Error fetching locations" });
  }
});

// Get specific location
router.get("/api/locations/:id", async (req, res) => {
  try {
    const location = await getLocationById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }
    res.json(location);
  } catch (error) {
    console.error("Error fetching location:", error);
    res.status(500).json({ error: "Error fetching location" });
  }
});

// Create location (admin only)
router.post("/api/locations", requireAuth, requireAdmin, async (req, res) => {
  try {
    const location = await createLocation({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(location);
  } catch (error) {
    console.error("Error creating location:", error);
    res.status(500).json({ error: "Error creating location" });
  }
});

// Check in to location
router.post("/api/checkin", requireAuth, async (req, res) => {
  try {
    const { locationId, longitude, latitude } = req.body;

    if (!locationId || !longitude || !latitude) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const checkIn = await checkInToLocation(
      req.user._id,
      locationId,
      parseFloat(longitude),
      parseFloat(latitude)
    );

    res.json({
      success: true,
      checkIn,
      message: `Check-in successful! You earned ${checkIn.points + checkIn.bonusPoints} points!`
    });
  } catch (error) {
    console.error("Error checking in:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get user profile
router.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user._id);
    res.json(profile);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Error fetching profile" });
  }
});

// Get user check-in history
router.get("/api/checkins", requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const checkIns = await getUserCheckIns(req.user._id, limit);
    res.json(checkIns);
  } catch (error) {
    console.error("Error fetching check-ins:", error);
    res.status(500).json({ error: "Error fetching check-ins" });
  }
});

// Get leaderboard
router.get("/api/leaderboard", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const type = req.query.type || 'points';
    const leaderboard = await getLeaderboard(limit, type);
    res.json(leaderboard);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Error fetching leaderboard" });
  }
});

// Get available rewards
router.get("/api/rewards", requireAuth, async (req, res) => {
  try {
    const locationId = req.query.locationId || null;
    const rewards = await getAvailableRewards(req.user._id, locationId);
    res.json(rewards);
  } catch (error) {
    console.error("Error fetching rewards:", error);
    res.status(500).json({ error: "Error fetching rewards" });
  }
});

// Redeem reward
router.post("/api/rewards/:id/redeem", requireAuth, async (req, res) => {
  try {
    const result = await redeemReward(req.user._id, req.params.id);
    res.json({
      success: true,
      message: "Reward redeemed successfully!",
      ...result
    });
  } catch (error) {
    console.error("Error redeeming reward:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get location stats (admin)
router.get("/api/locations/:id/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await getLocationStats(req.params.id);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching location stats:", error);
    res.status(500).json({ error: "Error fetching stats" });
  }
});

export default router;
