/**
 * Game State Configuration
 * Admin-configurable parameters for the game simulation
 */

export class GameConfig {
  constructor() {
    this.settings = {
      // Map dimensions
      mapSize: {
        width: 1000,
        height: 1000,
        totalZones: 1000000 // width * height
      },

      // Timing configuration
      timing: {
        updateInterval: 30000, // 30 seconds default
        eventInterval: 120000, // 2 minutes default
        velocityUnit: 'seconds', // 'seconds', 'minutes', 'hours', 'days'
        cycleSpeed: 1 // Multiplier for simulation speed
      },

      // Simulation parameters
      simulation: {
        factionCount: 5,
        initialZones: 500,
        resourceGrowthRate: 1.0,
        conflictProbability: 0.3,
        discoveryRate: 0.7
      },

      // Game parameters
      game: {
        startYear: 2847,
        seasonsEnabled: true,
        economicFluctuation: true,
        randomEvents: true
      }
    };
  }

  /**
   * Update timing configuration
   */
  setTiming(velocityUnit, cycleSpeed) {
    this.settings.timing.velocityUnit = velocityUnit;
    this.settings.timing.cycleSpeed = cycleSpeed || 1;

    // Convert velocity unit to milliseconds
    const baseInterval = this.convertToMilliseconds(velocityUnit);
    this.settings.timing.updateInterval = baseInterval * cycleSpeed;
    this.settings.timing.eventInterval = baseInterval * cycleSpeed * 4; // Events are 4x slower

    return this.settings.timing;
  }

  /**
   * Convert timing unit to milliseconds
   */
  convertToMilliseconds(unit) {
    switch(unit) {
      case 'seconds':
        return 1000;
      case 'minutes':
        return 60000;
      case 'hours':
        return 3600000;
      case 'days':
        return 86400000;
      default:
        return 1000;
    }
  }

  /**
   * Update map size
   */
  setMapSize(width, height) {
    this.settings.mapSize.width = width;
    this.settings.mapSize.height = height;
    this.settings.mapSize.totalZones = width * height;

    return this.settings.mapSize;
  }

  /**
   * Update simulation parameters
   */
  updateSimulation(params) {
    this.settings.simulation = {
      ...this.settings.simulation,
      ...params
    };

    return this.settings.simulation;
  }

  /**
   * Get all settings
   */
  getSettings() {
    return this.settings;
  }

  /**
   * Update any setting
   */
  updateSetting(category, key, value) {
    if (this.settings[category]) {
      this.settings[category][key] = value;
      return true;
    }
    return false;
  }
}
