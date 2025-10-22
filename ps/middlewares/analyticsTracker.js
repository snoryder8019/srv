/**
 * Analytics Tracking Middleware
 * Automatically tracks user actions throughout the application
 */
import { UserAnalytics } from '../api/v1/models/UserAnalytics.js';

/**
 * Track page views
 */
export function trackPageView(req, res, next) {
  if (req.user) {
    // Don't await - fire and forget to not slow down requests
    UserAnalytics.trackAction(req.user._id, 'page_view', {
      page: req.path,
      method: req.method,
      userAgent: req.headers['user-agent'],
      sessionId: req.sessionID
    }).catch(err => {
      console.error('Error tracking page view:', err);
    });
  }
  next();
}

/**
 * Track API calls
 */
export function trackApiCall(req, res, next) {
  if (req.user) {
    UserAnalytics.trackAction(req.user._id, 'api_call', {
      endpoint: req.path,
      method: req.method,
      sessionId: req.sessionID
    }).catch(err => {
      console.error('Error tracking API call:', err);
    });
  }
  next();
}

/**
 * Track logins
 */
export function trackLogin(userId, metadata = {}) {
  return UserAnalytics.trackAction(userId, 'login', {
    ...metadata,
    timestamp: new Date()
  });
}

/**
 * Track logouts
 */
export function trackLogout(userId, metadata = {}) {
  return UserAnalytics.trackAction(userId, 'logout', {
    ...metadata,
    timestamp: new Date()
  });
}

/**
 * Wrap asset creation to track
 */
export async function trackAssetCreated(userId, assetId, assetType) {
  return UserAnalytics.trackAction(userId, 'asset_created', {
    assetId: assetId.toString(),
    assetType
  });
}

/**
 * Wrap asset submission to track
 */
export async function trackAssetSubmitted(userId, assetId, assetType) {
  return UserAnalytics.trackAction(userId, 'asset_submitted', {
    assetId: assetId.toString(),
    assetType
  });
}

/**
 * Track voting
 */
export async function trackVote(userId, assetId, voteType = 'add') {
  return UserAnalytics.trackAction(userId, 'vote_cast', {
    assetId: assetId.toString(),
    voteType
  });
}

/**
 * Track suggestions
 */
export async function trackSuggestion(userId, assetId, suggestionId) {
  return UserAnalytics.trackAction(userId, 'suggestion_made', {
    assetId: assetId.toString(),
    suggestionId: suggestionId.toString()
  });
}

/**
 * Track character creation
 */
export async function trackCharacterCreated(userId, characterId) {
  return UserAnalytics.trackAction(userId, 'character_created', {
    characterId: characterId.toString()
  });
}

/**
 * Track zone visits
 */
export async function trackZoneVisit(userId, zoneId, zoneName) {
  return UserAnalytics.trackAction(userId, 'zone_visited', {
    zoneId: zoneId.toString(),
    zoneName
  });
}

export default {
  trackPageView,
  trackApiCall,
  trackLogin,
  trackLogout,
  trackAssetCreated,
  trackAssetSubmitted,
  trackVote,
  trackSuggestion,
  trackCharacterCreated,
  trackZoneVisit
};
