/**
 * Activity Token System
 * Manages character activity sessions with token-based authentication
 * Prevents duplicate sessions and state mismanagement
 */

import crypto from 'crypto';
import { getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

const TOKEN_DURATION_MS = 20 * 60 * 1000; // 20 minutes
const WARNING_THRESHOLD_MS = 18 * 60 * 1000; // 18 minutes - show "keep playing" popup
const TOKEN_LENGTH = 32;

/**
 * Generate a cryptographically secure random token
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Create a new activity token for a character
 * Invalidates any existing tokens for this character to prevent duplicates
 */
export async function createActivityToken(userId, characterId) {
  const db = getDb();
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_DURATION_MS);

  try {
    // First, invalidate all existing tokens for this character
    await db.collection('activityTokens').updateMany(
      { characterId: characterId.toString() },
      {
        $set: {
          active: false,
          invalidatedAt: now,
          invalidationReason: 'new_session'
        }
      }
    );

    // Create new token
    const activityToken = {
      token,
      userId: userId.toString(),
      characterId: characterId.toString(),
      createdAt: now,
      expiresAt,
      lastRenewedAt: now,
      active: true,
      renewalCount: 0,
      userAgent: null, // Can be set from request headers
      ipAddress: null  // Can be set from request
    };

    await db.collection('activityTokens').insertOne(activityToken);

    console.log(`✅ Created activity token for character ${characterId} (expires: ${expiresAt.toISOString()})`);

    return {
      success: true,
      token,
      expiresAt,
      characterId: characterId.toString()
    };
  } catch (error) {
    console.error('Error creating activity token:', error);
    return {
      success: false,
      error: 'Failed to create activity token'
    };
  }
}

/**
 * Validate an activity token
 * Returns character data if valid, null if invalid/expired
 */
export async function validateActivityToken(token) {
  const db = getDb();
  const now = new Date();

  try {
    const activityToken = await db.collection('activityTokens').findOne({
      token,
      active: true
    });

    if (!activityToken) {
      return {
        valid: false,
        reason: 'token_not_found'
      };
    }

    // Check if expired
    if (now > activityToken.expiresAt) {
      // Mark as inactive
      await db.collection('activityTokens').updateOne(
        { _id: activityToken._id },
        {
          $set: {
            active: false,
            invalidatedAt: now,
            invalidationReason: 'expired'
          }
        }
      );

      return {
        valid: false,
        reason: 'token_expired',
        expiredAt: activityToken.expiresAt
      };
    }

    // Token is valid
    return {
      valid: true,
      userId: activityToken.userId,
      characterId: activityToken.characterId,
      expiresAt: activityToken.expiresAt,
      timeRemaining: activityToken.expiresAt.getTime() - now.getTime(),
      shouldWarn: (activityToken.expiresAt.getTime() - now.getTime()) < (TOKEN_DURATION_MS - WARNING_THRESHOLD_MS)
    };
  } catch (error) {
    console.error('Error validating activity token:', error);
    return {
      valid: false,
      reason: 'validation_error',
      error: error.message
    };
  }
}

/**
 * Renew an activity token (extend expiration by another 20 minutes)
 * Called when user clicks "Keep Playing"
 */
export async function renewActivityToken(token) {
  const db = getDb();
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + TOKEN_DURATION_MS);

  try {
    const activityToken = await db.collection('activityTokens').findOne({
      token,
      active: true
    });

    if (!activityToken) {
      return {
        success: false,
        reason: 'token_not_found'
      };
    }

    // Update token with new expiration
    const result = await db.collection('activityTokens').updateOne(
      { _id: activityToken._id },
      {
        $set: {
          expiresAt: newExpiresAt,
          lastRenewedAt: now
        },
        $inc: {
          renewalCount: 1
        }
      }
    );

    if (result.modifiedCount === 0) {
      return {
        success: false,
        reason: 'update_failed'
      };
    }

    console.log(`🔄 Renewed activity token for character ${activityToken.characterId} (renewal #${activityToken.renewalCount + 1})`);

    return {
      success: true,
      expiresAt: newExpiresAt,
      renewalCount: activityToken.renewalCount + 1,
      characterId: activityToken.characterId
    };
  } catch (error) {
    console.error('Error renewing activity token:', error);
    return {
      success: false,
      reason: 'renewal_error',
      error: error.message
    };
  }
}

/**
 * Invalidate an activity token (user logs out or switches character)
 */
export async function invalidateActivityToken(token, reason = 'manual') {
  const db = getDb();
  const now = new Date();

  try {
    const result = await db.collection('activityTokens').updateOne(
      { token },
      {
        $set: {
          active: false,
          invalidatedAt: now,
          invalidationReason: reason
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`❌ Invalidated activity token (reason: ${reason})`);
      return { success: true };
    }

    return { success: false, reason: 'token_not_found' };
  } catch (error) {
    console.error('Error invalidating activity token:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Invalidate all tokens for a specific character
 * Used when user selects a different character
 */
export async function invalidateCharacterTokens(characterId, reason = 'character_switch') {
  const db = getDb();
  const now = new Date();

  try {
    const result = await db.collection('activityTokens').updateMany(
      {
        characterId: characterId.toString(),
        active: true
      },
      {
        $set: {
          active: false,
          invalidatedAt: now,
          invalidationReason: reason
        }
      }
    );

    console.log(`❌ Invalidated ${result.modifiedCount} token(s) for character ${characterId}`);

    return {
      success: true,
      invalidatedCount: result.modifiedCount
    };
  } catch (error) {
    console.error('Error invalidating character tokens:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get active token for a character
 */
export async function getActiveCharacterToken(characterId) {
  const db = getDb();
  const now = new Date();

  try {
    const token = await db.collection('activityTokens').findOne({
      characterId: characterId.toString(),
      active: true,
      expiresAt: { $gt: now }
    });

    return token;
  } catch (error) {
    console.error('Error getting active character token:', error);
    return null;
  }
}

/**
 * Clean up expired tokens (run periodically via cron)
 */
export async function cleanupExpiredTokens() {
  const db = getDb();
  const now = new Date();

  try {
    // Mark expired tokens as inactive
    const result = await db.collection('activityTokens').updateMany(
      {
        active: true,
        expiresAt: { $lt: now }
      },
      {
        $set: {
          active: false,
          invalidatedAt: now,
          invalidationReason: 'expired'
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`🧹 Cleaned up ${result.modifiedCount} expired activity token(s)`);
    }

    // Delete tokens older than 7 days
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const deleteResult = await db.collection('activityTokens').deleteMany({
      createdAt: { $lt: sevenDaysAgo }
    });

    if (deleteResult.deletedCount > 0) {
      console.log(`🧹 Deleted ${deleteResult.deletedCount} old activity token(s)`);
    }

    return {
      success: true,
      expiredCount: result.modifiedCount,
      deletedCount: deleteResult.deletedCount
    };
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create database indexes for activity tokens (run on startup)
 */
export async function createActivityTokenIndexes() {
  const db = getDb();

  try {
    await db.collection('activityTokens').createIndex({ token: 1 }, { unique: true });
    await db.collection('activityTokens').createIndex({ characterId: 1, active: 1 });
    await db.collection('activityTokens').createIndex({ userId: 1 });
    await db.collection('activityTokens').createIndex({ expiresAt: 1 });
    await db.collection('activityTokens').createIndex({ createdAt: 1 });

    console.log('✅ Activity token indexes created');
  } catch (error) {
    console.error('Error creating activity token indexes:', error);
  }
}

export default {
  createActivityToken,
  validateActivityToken,
  renewActivityToken,
  invalidateActivityToken,
  invalidateCharacterTokens,
  getActiveCharacterToken,
  cleanupExpiredTokens,
  createActivityTokenIndexes,
  TOKEN_DURATION_MS,
  WARNING_THRESHOLD_MS
};
