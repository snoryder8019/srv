/**
 * Profile Routes
 * User profile and analytics
 */
import express from 'express';
import { isAuthenticated } from '../utilities/helpers.js';
import { UserAnalytics } from '../api/v1/models/UserAnalytics.js';

const router = express.Router();

/**
 * GET /profile
 * User profile page
 */
router.get('/', isAuthenticated, (req, res) => {
  res.render('profile', {
    title: 'My Profile',
    user: req.user
  });
});

/**
 * GET /api/v1/profile/analytics
 * Get current user's analytics
 */
router.get('/api/v1/profile/analytics', isAuthenticated, async (req, res) => {
  try {
    const analytics = await UserAnalytics.getUserAnalytics(req.user._id);

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
