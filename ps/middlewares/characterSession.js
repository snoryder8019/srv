/**
 * Character Session Middleware
 * Loads active character from cookie/session and attaches to res.locals
 */

import { Character } from '../api/v1/models/Character.js';

/**
 * Middleware to load active character from session
 */
export async function loadActiveCharacter(req, res, next) {
  try {
    // Initialize character as null
    res.locals.character = null;
    
    // Check if user is logged in
    if (!req.user) {
      return next();
    }
    
    // Check for active character in cookie
    const activeCharacterId = req.cookies.activeCharacterId;
    
    if (activeCharacterId) {
      // Load character from database
      const character = await Character.findById(activeCharacterId);
      
      // Verify character belongs to logged-in user
      if (character && character.userId.toString() === req.user._id.toString()) {
        res.locals.character = character;
      } else {
        // Invalid character ID in cookie, clear it
        res.clearCookie('activeCharacterId');
      }
    }
    
    next();
  } catch (error) {
    console.error('Error loading active character:', error);
    next();
  }
}

/**
 * Set active character in cookie
 */
export async function setActiveCharacter(req, res, characterId) {
  try {
    // Validate character belongs to user
    const character = await Character.findById(characterId);
    
    if (!character || character.userId.toString() !== req.user._id.toString()) {
      throw new Error('Character not found or unauthorized');
    }
    
    // Set cookie with 30-day expiration
    res.cookie('activeCharacterId', characterId, {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.locals.character = character;
    
    return character;
  } catch (error) {
    console.error('Error setting active character:', error);
    throw error;
  }
}

/**
 * Clear active character
 */
export function clearActiveCharacter(req, res) {
  res.clearCookie('activeCharacterId');
  res.locals.character = null;
}

export default {
  loadActiveCharacter,
  setActiveCharacter,
  clearActiveCharacter
};
