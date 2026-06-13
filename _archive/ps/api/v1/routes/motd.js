import express from 'express';
import MOTD from '../models/MOTD.js';

const router = express.Router();

/**
 * GET /api/v1/motd/current
 * Fetch the current active MOTD
 */
router.get('/current', async (req, res) => {
  try {
    const motd = await MOTD.getCurrentMOTD();

    if (!motd) {
      return res.json({
        success: true,
        motd: null,
        message: 'No active MOTD found'
      });
    }

    res.json({
      success: true,
      motd: {
        _id: motd._id,
        message: motd.message,
        welcomeMessage: motd.welcomeMessage,
        ctaText: motd.ctaText,
        ctaLink: motd.ctaLink,
        ctaLinkText: motd.ctaLinkText,
        createdAt: motd.createdAt,
        updatedAt: motd.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching MOTD:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch MOTD'
    });
  }
});

/**
 * GET /api/v1/motd/list
 * Fetch all MOTDs (admin only)
 */
router.get('/list', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session?.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const motds = await MOTD.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      motds
    });
  } catch (error) {
    console.error('Error fetching MOTDs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch MOTDs'
    });
  }
});

/**
 * POST /api/v1/motd/create
 * Create a new MOTD (admin only)
 */
router.post('/create', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session?.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const {
      message,
      welcomeMessage,
      ctaText,
      ctaLink,
      ctaLinkText,
      isActive,
      priority,
      startDate,
      endDate
    } = req.body;

    const motd = new MOTD({
      message,
      welcomeMessage,
      ctaText,
      ctaLink,
      ctaLinkText,
      isActive,
      priority,
      startDate,
      endDate,
      createdBy: req.session.user._id
    });

    await motd.save();

    res.json({
      success: true,
      motd,
      message: 'MOTD created successfully'
    });
  } catch (error) {
    console.error('Error creating MOTD:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create MOTD'
    });
  }
});

/**
 * PUT /api/v1/motd/:id
 * Update an existing MOTD (admin only)
 */
router.put('/:id', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session?.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    const motd = await MOTD.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true }
    );

    if (!motd) {
      return res.status(404).json({
        success: false,
        error: 'MOTD not found'
      });
    }

    res.json({
      success: true,
      motd,
      message: 'MOTD updated successfully'
    });
  } catch (error) {
    console.error('Error updating MOTD:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update MOTD'
    });
  }
});

/**
 * DELETE /api/v1/motd/:id
 * Delete a MOTD (admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.session?.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;

    const motd = await MOTD.findByIdAndDelete(id);

    if (!motd) {
      return res.status(404).json({
        success: false,
        error: 'MOTD not found'
      });
    }

    res.json({
      success: true,
      message: 'MOTD deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting MOTD:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete MOTD'
    });
  }
});

export default router;
