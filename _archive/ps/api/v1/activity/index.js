/**
 * Activity Token API Endpoints
 * Handles token creation, renewal, and validation
 */

import express from 'express';
import {
  createActivityToken,
  validateActivityToken,
  renewActivityToken,
  invalidateActivityToken,
  invalidateCharacterTokens,
  getActiveCharacterToken
} from '../../../utilities/activityTokens.js';
import { Character } from '../models/Character.js';

const router = express.Router();

/**
 * POST /api/v1/activity/token/create
 * Create a new activity token for a character
 */
router.post('/token/create', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { characterId } = req.body;

    if (!characterId) {
      return res.status(400).json({
        success: false,
        error: 'characterId is required'
      });
    }

    // Verify character belongs to user
    const character = await Character.findById(characterId);

    if (!character) {
      return res.status(404).json({
        success: false,
        error: 'Character not found'
      });
    }

    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this character'
      });
    }

    // Create token
    const result = await createActivityToken(req.user._id, characterId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Set token cookie
    res.cookie('activityToken', result.token, {
      maxAge: 20 * 60 * 1000, // 20 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Also update activeCharacterId cookie
    res.cookie('activeCharacterId', characterId, {
      maxAge: 20 * 60 * 1000, // Match activity token duration
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({
      success: true,
      message: 'Activity token created',
      expiresAt: result.expiresAt,
      characterId: result.characterId,
      character: {
        _id: character._id,
        name: character.name,
        level: character.level
      }
    });
  } catch (error) {
    console.error('Error creating activity token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create activity token'
    });
  }
});

/**
 * POST /api/v1/activity/token/validate
 * Validate current activity token
 */
router.post('/token/validate', async (req, res) => {
  try {
    const token = req.cookies.activityToken;

    if (!token) {
      return res.json({
        valid: false,
        reason: 'no_token'
      });
    }

    const validation = await validateActivityToken(token);

    res.json(validation);
  } catch (error) {
    console.error('Error validating activity token:', error);
    res.status(500).json({
      valid: false,
      error: 'Validation failed'
    });
  }
});

/**
 * POST /api/v1/activity/token/renew
 * Renew (extend) current activity token
 */
router.post('/token/renew', async (req, res) => {
  try {
    const token = req.cookies.activityToken;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'No activity token found'
      });
    }

    const result = await renewActivityToken(token);

    if (!result.success) {
      // Token might be expired or invalid - clear cookies
      res.clearCookie('activityToken');
      res.clearCookie('activeCharacterId');

      return res.status(400).json(result);
    }

    // Update cookie expiration
    res.cookie('activityToken', token, {
      maxAge: 20 * 60 * 1000, // 20 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Also renew activeCharacterId cookie
    const activeCharacterId = req.cookies.activeCharacterId;
    if (activeCharacterId) {
      res.cookie('activeCharacterId', activeCharacterId, {
        maxAge: 20 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
    }

    res.json({
      success: true,
      message: 'Activity token renewed',
      expiresAt: result.expiresAt,
      renewalCount: result.renewalCount
    });
  } catch (error) {
    console.error('Error renewing activity token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to renew activity token'
    });
  }
});

/**
 * POST /api/v1/activity/token/invalidate
 * Invalidate current activity token (logout)
 */
router.post('/token/invalidate', async (req, res) => {
  try {
    const token = req.cookies.activityToken;

    if (token) {
      await invalidateActivityToken(token, 'user_logout');
    }

    // Clear cookies
    res.clearCookie('activityToken');
    res.clearCookie('activeCharacterId');

    res.json({
      success: true,
      message: 'Activity token invalidated'
    });
  } catch (error) {
    console.error('Error invalidating activity token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate activity token'
    });
  }
});

/**
 * GET /api/v1/activity/token/status
 * Get current token status (for UI updates)
 */
router.get('/token/status', async (req, res) => {
  try {
    const token = req.cookies.activityToken;

    if (!token) {
      return res.json({
        hasToken: false,
        active: false
      });
    }

    const validation = await validateActivityToken(token);

    if (!validation.valid) {
      return res.json({
        hasToken: true,
        active: false,
        reason: validation.reason
      });
    }

    // Get character info
    let character = null;
    if (validation.characterId) {
      character = await Character.findById(validation.characterId);
    }

    res.json({
      hasToken: true,
      active: true,
      expiresAt: validation.expiresAt,
      timeRemaining: validation.timeRemaining,
      shouldWarn: validation.shouldWarn,
      characterId: validation.characterId,
      character: character ? {
        _id: character._id,
        name: character.name,
        level: character.level
      } : null
    });
  } catch (error) {
    console.error('Error getting token status:', error);
    res.status(500).json({
      hasToken: false,
      active: false,
      error: 'Failed to get token status'
    });
  }
});

/**
 * POST /api/v1/activity/character/switch
 * Switch to a different character (invalidates old token, creates new one)
 */
router.post('/character/switch', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { characterId } = req.body;

    if (!characterId) {
      return res.status(400).json({
        success: false,
        error: 'characterId is required'
      });
    }

    // Verify new character belongs to user
    const character = await Character.findById(characterId);

    if (!character) {
      return res.status(404).json({
        success: false,
        error: 'Character not found'
      });
    }

    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this character'
      });
    }

    // Invalidate old token if exists
    const oldToken = req.cookies.activityToken;
    if (oldToken) {
      await invalidateActivityToken(oldToken, 'character_switch');
    }

    // Create new token
    const result = await createActivityToken(req.user._id, characterId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Set new token cookie
    res.cookie('activityToken', result.token, {
      maxAge: 20 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Update activeCharacterId cookie
    res.cookie('activeCharacterId', characterId, {
      maxAge: 20 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({
      success: true,
      message: 'Character switched',
      expiresAt: result.expiresAt,
      character: {
        _id: character._id,
        name: character.name,
        level: character.level
      }
    });
  } catch (error) {
    console.error('Error switching character:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to switch character'
    });
  }
});

export default router;
