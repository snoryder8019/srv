/**
 * Authentication Gates Middleware
 * Ensures users complete onboarding steps before accessing game features
 */

import { Character } from '../api/v1/models/Character.js';

/**
 * Require authentication
 */
export function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth');
  }
  next();
}

/**
 * Require welcome completion
 * User must have completed the welcome screen
 */
export function requireWelcome(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth');
  }

  if (!req.user.hasCompletedWelcome) {
    return res.redirect('/welcome');
  }

  next();
}

/**
 * Require intro completion
 * User must have completed both welcome and intro
 */
export function requireIntro(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth');
  }

  if (!req.user.hasCompletedWelcome) {
    return res.redirect('/welcome');
  }

  if (!req.user.hasCompletedIntro) {
    return res.redirect('/intro');
  }

  next();
}

/**
 * Require active character
 * User must have completed welcome, intro, and selected a character
 */
export async function requireCharacter(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth');
  }

  if (!req.user.hasCompletedWelcome) {
    return res.redirect('/welcome');
  }

  if (!req.user.hasCompletedIntro) {
    return res.redirect('/intro');
  }

  // Check if user has an active character
  if (!res.locals.character) {
    // Check if user has any characters at all
    try {
      const characters = await Character.findByUserId(req.user._id);

      if (characters.length === 0) {
        // No characters, redirect to create
        return res.redirect('/characters/create');
      } else {
        // Has characters but none active, redirect to selection
        return res.redirect('/auth');
      }
    } catch (error) {
      console.error('Error checking characters:', error);
      return res.redirect('/auth');
    }
  }

  next();
}

export default {
  requireAuth,
  requireWelcome,
  requireIntro,
  requireCharacter
};
