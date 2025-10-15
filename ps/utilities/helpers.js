/**
 * Utility helper functions for Stringborn Universe
 */

// Check if user is authenticated
export const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

// Format date for display
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Calculate character level based on experience
export const calculateLevel = (experience) => {
  return Math.floor(Math.sqrt(experience / 100)) + 1;
};

// Get species-specific starting stats
export const getSpeciesStats = (species) => {
  const statsMap = {
    'Silicates': {
      strength: 5,
      intelligence: 10,
      agility: 6,
      faith: 8,
      tech: 7
    },
    'Lanterns': {
      strength: 4,
      intelligence: 9,
      agility: 8,
      faith: 5,
      tech: 10
    },
    'Devan': {
      strength: 7,
      intelligence: 8,
      agility: 5,
      faith: 10,
      tech: 6
    },
    'Humans': {
      strength: 10,
      intelligence: 6,
      agility: 7,
      faith: 5,
      tech: 8
    }
  };

  return statsMap[species] || {
    strength: 5,
    intelligence: 5,
    agility: 5,
    faith: 5,
    tech: 5
  };
};

// Calculate grid handoff direction
export const calculateGridDirection = (currentGrid, targetGrid) => {
  const dx = targetGrid.x - currentGrid.x;
  const dy = targetGrid.y - currentGrid.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'east' : 'west';
  } else {
    return dy > 0 ? 'north' : 'south';
  }
};

// Validate character data
export const validateCharacterData = (data) => {
  const requiredFields = ['name', 'species', 'stringDomain', 'primaryClass'];
  const validSpecies = ['Silicates', 'Lanterns', 'Devan', 'Humans'];
  const validDomains = ['Time String', 'Tech String', 'Faith String', 'War String'];

  for (const field of requiredFields) {
    if (!data[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (!validSpecies.includes(data.species)) {
    return { valid: false, error: 'Invalid species' };
  }

  if (!validDomains.includes(data.stringDomain)) {
    return { valid: false, error: 'Invalid string domain' };
  }

  return { valid: true };
};

// Generate random loot
export const generateLoot = (level, rarity = 'common') => {
  const rarityMultiplier = {
    'common': 1,
    'uncommon': 2,
    'rare': 3,
    'epic': 5,
    'legendary': 10
  };

  return {
    gold: Math.floor(Math.random() * 100 * level * rarityMultiplier[rarity]),
    items: [],
    experience: Math.floor(Math.random() * 50 * level)
  };
};

export default {
  isAuthenticated,
  formatDate,
  calculateLevel,
  getSpeciesStats,
  calculateGridDirection,
  validateCharacterData,
  generateLoot
};
