/**
 * Activity Token Middleware
 * Validates activity tokens and redirects to character selection if invalid
 */

import { validateActivityToken, invalidateActivityToken } from '../utilities/activityTokens.js';

/**
 * Middleware to require a valid activity token
 * Use this on routes that require an active character session
 */
export async function requireActivityToken(req, res, next) {
  try {
    // Get token from cookie
    const token = req.cookies.activityToken;

    if (!token) {
      console.log('⚠️ No activity token found - redirecting to character selection');
      return redirectToCharacterSelection(req, res, 'no_token');
    }

    // Validate token
    const validation = await validateActivityToken(token);

    if (!validation.valid) {
      console.log(`⚠️ Invalid activity token (${validation.reason}) - redirecting to character selection`);

      // Clear invalid token cookie
      res.clearCookie('activityToken');
      res.clearCookie('activeCharacterId');

      return redirectToCharacterSelection(req, res, validation.reason);
    }

    // Token is valid - attach info to request
    req.activityToken = {
      token,
      userId: validation.userId,
      characterId: validation.characterId,
      expiresAt: validation.expiresAt,
      timeRemaining: validation.timeRemaining,
      shouldWarn: validation.shouldWarn
    };

    // Verify character ID matches active character cookie
    const activeCharacterId = req.cookies.activeCharacterId;
    if (activeCharacterId && activeCharacterId !== validation.characterId) {
      console.log('⚠️ Character ID mismatch - invalidating tokens');
      await invalidateActivityToken(token, 'character_mismatch');
      res.clearCookie('activityToken');
      res.clearCookie('activeCharacterId');
      return redirectToCharacterSelection(req, res, 'character_mismatch');
    }

    next();
  } catch (error) {
    console.error('Error in activity token middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Activity token validation failed'
    });
  }
}

/**
 * Optional activity token middleware
 * Validates token if present, but doesn't redirect if missing
 * Useful for pages that show different content based on active session
 */
export async function optionalActivityToken(req, res, next) {
  try {
    const token = req.cookies.activityToken;

    if (!token) {
      req.activityToken = null;
      return next();
    }

    const validation = await validateActivityToken(token);

    if (!validation.valid) {
      // Clear invalid token but don't redirect
      res.clearCookie('activityToken');
      req.activityToken = null;
      return next();
    }

    req.activityToken = {
      token,
      userId: validation.userId,
      characterId: validation.characterId,
      expiresAt: validation.expiresAt,
      timeRemaining: validation.timeRemaining,
      shouldWarn: validation.shouldWarn
    };

    next();
  } catch (error) {
    console.error('Error in optional activity token middleware:', error);
    req.activityToken = null;
    next();
  }
}

/**
 * Redirect to character selection with reason
 */
function redirectToCharacterSelection(req, res, reason) {
  // For API requests, return JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      success: false,
      error: 'session_expired',
      reason,
      message: 'Your session has expired. Please select a character to continue.',
      redirectTo: '/characters'
    });
  }

  // For page requests, redirect with query param
  const redirectUrl = `/characters?reason=${reason}&expired=true`;
  return res.redirect(redirectUrl);
}

/**
 * Middleware to attach activity token info to response locals
 * Use after requireActivityToken to make token info available in views
 */
export function attachActivityTokenToLocals(req, res, next) {
  if (req.activityToken) {
    res.locals.activityToken = req.activityToken;
  }
  next();
}

export default {
  requireActivityToken,
  optionalActivityToken,
  attachActivityTokenToLocals
};
