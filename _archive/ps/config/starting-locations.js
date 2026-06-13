/**
 * Starting Locations Configuration
 * Defines teleportation points for testers and new characters
 */

export const STARTING_LOCATIONS = {
  // Central starting zone
  'Starting Zone (Center)': {
    x: 2500,
    y: 2500,
    description: 'The central starting zone where all new characters begin',
    type: 'galactic',
    icon: '🏁'
  },

  // Four faction territories
  'Human Federation Territory': {
    x: 1000,
    y: 1000,
    description: 'Northwest sector - Human Federation controlled space',
    type: 'galactic',
    faction: 'Human Federation',
    icon: '🌍'
  },

  'Silicate Consortium Hub': {
    x: 4000,
    y: 1000,
    description: 'Northeast sector - Silicate Consortium research stations',
    type: 'galactic',
    faction: 'Silicate Consortium',
    icon: '🔷'
  },

  'Devan Empire Stronghold': {
    x: 1000,
    y: 4000,
    description: 'Southwest sector - Devan Empire military zone',
    type: 'galactic',
    faction: 'Devan Empire',
    icon: '⚔️'
  },

  'Lantern Collective Nexus': {
    x: 4000,
    y: 4000,
    description: 'Southeast sector - Lantern Collective trade routes',
    type: 'galactic',
    faction: 'Lantern Collective',
    icon: '🏮'
  },

  // Major landmarks
  'Temporal Nexus Station': {
    x: 500,
    y: 500,
    description: 'Ancient station at the edge of known space',
    type: 'galactic',
    icon: '🌀'
  },

  'Quantum Forge Complex': {
    x: 4500,
    y: 500,
    description: 'Massive industrial complex in the northern void',
    type: 'galactic',
    icon: '⚙️'
  },

  'Celestial Sanctum': {
    x: 500,
    y: 4500,
    description: 'Sacred temple station in the southern reaches',
    type: 'galactic',
    icon: '⛪'
  },

  'Crimson Bastion': {
    x: 4500,
    y: 4500,
    description: 'Fortress station at the galactic edge',
    type: 'galactic',
    icon: '🏰'
  },

  // Galaxy centers
  'Andromeda Spiral': {
    x: 3785,
    y: 2326,
    description: 'Center of the Andromeda Spiral galaxy',
    type: 'galactic',
    icon: '🌌'
  },

  'Elysium Cluster': {
    x: 2676,
    y: 1439,
    description: 'Peaceful Elysium Cluster region',
    type: 'galactic',
    icon: '✨'
  },

  'Crimson Nebula': {
    x: 4748,
    y: 2950,
    description: 'Dangerous Crimson Nebula territory',
    type: 'galactic',
    icon: '☄️'
  },

  'Stellar Crown': {
    x: 4326,
    y: 3888,
    description: 'Majestic Stellar Crown formation',
    type: 'galactic',
    icon: '👑'
  },

  // Testing locations
  'Northwest Corner': {
    x: 200,
    y: 200,
    description: 'Map corner for testing',
    type: 'galactic',
    icon: '📍'
  },

  'Northeast Corner': {
    x: 4800,
    y: 200,
    description: 'Map corner for testing',
    type: 'galactic',
    icon: '📍'
  },

  'Southwest Corner': {
    x: 200,
    y: 4800,
    description: 'Map corner for testing',
    type: 'galactic',
    icon: '📍'
  },

  'Southeast Corner': {
    x: 4800,
    y: 4800,
    description: 'Map corner for testing',
    type: 'galactic',
    icon: '📍'
  }
};

// Get location by name
export function getLocation(name) {
  return STARTING_LOCATIONS[name] || null;
}

// Get all location names
export function getLocationNames() {
  return Object.keys(STARTING_LOCATIONS);
}

// Get locations by faction
export function getLocationsByFaction(faction) {
  return Object.entries(STARTING_LOCATIONS)
    .filter(([_, loc]) => loc.faction === faction)
    .map(([name, loc]) => ({ name, ...loc }));
}

// Get locations by type
export function getLocationsByType(type) {
  return Object.entries(STARTING_LOCATIONS)
    .filter(([_, loc]) => loc.type === type)
    .map(([name, loc]) => ({ name, ...loc }));
}

export default STARTING_LOCATIONS;
