/**
 * Space Hub Configuration
 * 4 corner anomalies that serve as starting locations based on String Domain
 */

export const SPACE_HUBS = {
  TIME_STRING: {
    id: 'time-nexus-hub',
    name: 'Temporal Nexus Station',
    stringDomain: 'Time String',
    assetType: 'anomaly',
    subType: 'space-station',
    description: 'Ancient station suspended in temporal flux. Home to Time String wielders who manipulate causality.',
    location: {
      x: 500,    // Top-left corner
      y: 500,
      type: 'galactic'
    },
    spawnRadius: 50, // Characters spawn within 50px radius
    primarySpecies: 'Silicates', // Most common, but any can start here
    color: '#667eea',
    icon: '⧗'
  },

  TECH_STRING: {
    id: 'tech-forge-hub',
    name: 'Quantum Forge Complex',
    stringDomain: 'Tech String',
    assetType: 'anomaly',
    subType: 'space-station',
    description: 'Massive technological construct. Tech String users harness quantum mechanics and advanced engineering.',
    location: {
      x: 4500,   // Top-right corner
      y: 500,
      type: 'galactic'
    },
    spawnRadius: 50,
    primarySpecies: 'Humans',
    color: '#10b981',
    icon: '⚙'
  },

  FAITH_STRING: {
    id: 'faith-sanctum-hub',
    name: 'Celestial Sanctum',
    stringDomain: 'Faith String',
    assetType: 'anomaly',
    subType: 'space-station',
    description: 'Sacred convergence point where Faith String believers commune with higher dimensions.',
    location: {
      x: 500,    // Bottom-left corner
      y: 4500,
      type: 'galactic'
    },
    spawnRadius: 50,
    primarySpecies: 'Lanterns',
    color: '#f59e0b',
    icon: '✦'
  },

  WAR_STRING: {
    id: 'war-bastion-hub',
    name: 'Crimson Bastion',
    stringDomain: 'War String',
    assetType: 'anomaly',
    subType: 'space-station',
    description: 'Fortified battle station. War String warriors train in combat mastery and tactical dominance.',
    location: {
      x: 4500,   // Bottom-right corner
      y: 4500,
      type: 'galactic'
    },
    spawnRadius: 50,
    primarySpecies: 'Devan',
    color: '#ef4444',
    icon: '⚔'
  }
};

/**
 * Get hub by string domain
 */
export function getHubByString(stringDomain) {
  const normalized = stringDomain?.toLowerCase().replace(/\s+/g, '_');

  switch (normalized) {
    case 'time_string':
      return SPACE_HUBS.TIME_STRING;
    case 'tech_string':
      return SPACE_HUBS.TECH_STRING;
    case 'faith_string':
      return SPACE_HUBS.FAITH_STRING;
    case 'war_string':
      return SPACE_HUBS.WAR_STRING;
    default:
      // Default to Time String if no match
      return SPACE_HUBS.TIME_STRING;
  }
}

/**
 * Get random spawn position within hub radius
 */
export function getSpawnPosition(hub) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * hub.spawnRadius;

  return {
    x: hub.location.x + Math.cos(angle) * distance,
    y: hub.location.y + Math.sin(angle) * distance,
    type: 'galactic'
  };
}

/**
 * Get all hubs as array
 */
export function getAllHubs() {
  return Object.values(SPACE_HUBS);
}

/**
 * Map species to their typical string (for suggestions, not mandatory)
 */
export const SPECIES_STRING_AFFINITY = {
  'Silicates': 'Time String',
  'Humans': 'Tech String',
  'Lanterns': 'Faith String',
  'Devan': 'War String'
};

export default {
  SPACE_HUBS,
  getHubByString,
  getSpawnPosition,
  getAllHubs,
  SPECIES_STRING_AFFINITY
};
