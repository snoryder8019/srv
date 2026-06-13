/**
 * Enhanced Game State Manager
 * Simulates and manages the universe state with admin-configurable parameters
 */

import { GameConfig } from './config.js';

export class GameStateManager {
  constructor() {
    this.config = new GameConfig();

    this.state = {
      galactic: {
        cycle: 1,
        year: this.config.settings.game.startYear,
        currentSeason: 'Expansion',
        dominantFaction: 'Silicate Consortium',
        threatLevel: 'Moderate',
        economicState: 'Prosperous',
        totalPopulation: 0,
        activeConflicts: 0
      },
      factions: {
        'Silicate Consortium': { power: 85, territory: 42, influence: 78 },
        'Lantern Collective': { power: 72, territory: 35, influence: 81 },
        'Devan Empire': { power: 68, territory: 28, influence: 65 },
        'Human Federation': { power: 55, territory: 25, influence: 70 },
        'Independent Systems': { power: 40, territory: 30, influence: 55 }
      },
      events: [],
      zones: {
        controlled: 160,
        discovered: 245,
        unexplored: this.config.settings.mapSize.totalZones - 405,
        contested: 15
      },
      resources: {
        energy: 89000000,
        minerals: 125000000,
        technology: 67000,
        population: 45000000000
      },
      activeThreats: [],
      recentBattles: []
    };

    this.listeners = [];
    this.eventListeners = [];
    this.updateInterval = null;
    this.eventInterval = null;

    // Generate planetary zones based on config
    const settings = this.config.settings;
    const initialZones = settings.simulation.initialZones;
    this.planetaryZones = this.generatePlanetaryZones(initialZones);
  }

  /**
   * Start the game state simulation
   */
  start() {
    console.log('🎮 Starting game state simulation...');
    console.log(`📏 Map Size: ${this.config.settings.mapSize.width}x${this.config.settings.mapSize.height}`);
    console.log(`⏱️  Update Interval: ${this.config.settings.timing.updateInterval}ms`);

    // Generate initial events
    this.generateEvent();

    // Clear any existing intervals
    this.stop();

    // Update state based on configured timing
    this.updateInterval = setInterval(() => {
      this.updateState();
    }, this.config.settings.timing.updateInterval);

    // Generate new events based on configured timing
    this.eventInterval = setInterval(() => {
      this.generateEvent();
    }, this.config.settings.timing.eventInterval);
  }

  /**
   * Stop the simulation
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.eventInterval) {
      clearInterval(this.eventInterval);
      this.eventInterval = null;
    }
  }

  /**
   * Restart with new configuration
   */
  restart() {
    console.log('🔄 Restarting simulation with new configuration...');
    this.stop();
    this.start();
  }

  /**
   * Update configuration and restart
   */
  updateConfig(newConfig) {
    if (newConfig.timing) {
      this.config.setTiming(newConfig.timing.velocityUnit, newConfig.timing.cycleSpeed);
    }
    if (newConfig.mapSize) {
      this.config.setMapSize(newConfig.mapSize.width, newConfig.mapSize.height);
      // Update unexplored zones count
      this.state.zones.unexplored = this.config.settings.mapSize.totalZones -
        (this.state.zones.controlled + this.state.zones.discovered + this.state.zones.contested);
    }
    if (newConfig.simulation) {
      this.config.updateSimulation(newConfig.simulation);
    }

    this.restart();
    return this.config.getSettings();
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return this.config.getSettings();
  }

  /**
   * Update the game state
   */
  updateState() {
    const growthRate = this.config.settings.simulation.resourceGrowthRate;

    // Slightly adjust faction power
    for (const faction in this.state.factions) {
      const change = (Math.random() - 0.5) * 3; // -1.5 to +1.5
      this.state.factions[faction].power = Math.max(0, Math.min(100,
        this.state.factions[faction].power + change
      ));
    }

    // Update galactic cycle
    this.state.galactic.cycle++;

    // Update resources with growth rate
    this.state.resources.energy += Math.floor(Math.random() * 100000 * growthRate);
    this.state.resources.minerals += Math.floor(Math.random() * 150000 * growthRate);
    this.state.resources.technology += Math.floor(Math.random() * 50 * growthRate);
    this.state.resources.population += Math.floor(Math.random() * 1000000 * growthRate);

    // Update zones based on discovery rate
    if (Math.random() > (1 - this.config.settings.simulation.discoveryRate)) {
      if (this.state.zones.unexplored > 0) {
        this.state.zones.discovered++;
        this.state.zones.unexplored--;
      }
    }

    // Calculate totals
    this.state.galactic.totalPopulation = this.state.resources.population;
    this.state.galactic.activeConflicts = this.state.zones.contested;

    // Determine dominant faction
    let maxPower = 0;
    let dominant = '';
    for (const faction in this.state.factions) {
      if (this.state.factions[faction].power > maxPower) {
        maxPower = this.state.factions[faction].power;
        dominant = faction;
      }
    }
    this.state.galactic.dominantFaction = dominant;

    // Notify listeners
    this.notifyListeners({
      galactic: this.state.galactic,
      factions: this.state.factions,
      resources: this.state.resources
    });
  }

  /**
   * Generate random events
   */
  generateEvent() {
    const eventTypes = [
      {
        type: 'discovery',
        templates: [
          'New zone discovered in {sector} sector',
          'Ancient artifact found on planet {planet}',
          'Unknown signal detected from {location}',
          'New species encountered in {zone}'
        ]
      },
      {
        type: 'conflict',
        templates: [
          '{faction1} declares war on {faction2}',
          'Border skirmish in {zone}',
          'Trade embargo imposed by {faction}',
          'Alliance formed between {faction1} and {faction2}'
        ]
      },
      {
        type: 'economic',
        templates: [
          'Energy crisis in {sector} sector',
          'Mineral boom on {planet}',
          'Technology breakthrough: {tech}',
          'Market crash affects {faction}'
        ]
      },
      {
        type: 'environmental',
        templates: [
          'Solar flare threatens {zone}',
          'Asteroid collision imminent for {planet}',
          'Wormhole opens near {sector}',
          'Cosmic storm sweeps through {region}'
        ]
      }
    ];

    const sectors = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
    const planets = ['Nexus Prime', 'Crystallis', 'Forge World', 'Haven', 'Terminus'];
    const zones = ['Outer Rim', 'Core Worlds', 'Frontier', 'Dead Zone'];
    const factions = Object.keys(this.state.factions);
    const techs = ['FTL Drive 2.0', 'Quantum Computing', 'Nanomedicine', 'Plasma Weapons'];

    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    let template = eventType.templates[Math.floor(Math.random() * eventType.templates.length)];

    // Replace placeholders
    template = template
      .replace('{sector}', sectors[Math.floor(Math.random() * sectors.length)])
      .replace('{planet}', planets[Math.floor(Math.random() * planets.length)])
      .replace('{location}', zones[Math.floor(Math.random() * zones.length)])
      .replace('{zone}', zones[Math.floor(Math.random() * zones.length)])
      .replace('{region}', zones[Math.floor(Math.random() * zones.length)])
      .replace('{faction}', factions[Math.floor(Math.random() * factions.length)])
      .replace('{faction1}', factions[Math.floor(Math.random() * factions.length)])
      .replace('{faction2}', factions[Math.floor(Math.random() * factions.length)])
      .replace('{tech}', techs[Math.floor(Math.random() * techs.length)]);

    const event = {
      id: Date.now(),
      type: eventType.type,
      message: template,
      timestamp: new Date().toISOString(),
      severity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)]
    };

    // Add to events (keep last 20)
    this.state.events.unshift(event);
    if (this.state.events.length > 20) {
      this.state.events = this.state.events.slice(0, 20);
    }

    // Notify event listeners
    this.notifyEventListeners(event);
  }

  /**
   * Get current complete state
   */
  getCurrentState() {
    return this.state;
  }

  /**
   * Get galactic state only
   */
  getGalacticState() {
    return this.state.galactic;
  }

  /**
   * Get active events
   */
  getActiveEvents() {
    return this.state.events;
  }

  /**
   * Get faction standings
   */
  getFactionStandings() {
    return this.state.factions;
  }

  /**
   * Generate planetary zones based on map configuration
   */
  generatePlanetaryZones(count) {
    const zones = [];
    const zoneTypes = ['discovery', 'combat', 'resource', 'trading', 'exploration'];
    const climates = ['temperate', 'arctic', 'desert', 'tropical', 'volcanic', 'toxic'];
    const factions = Object.keys(this.state.factions);
    const mapWidth = this.config.settings.mapSize.width;
    const mapHeight = this.config.settings.mapSize.height;

    for (let i = 0; i < count; i++) {
      zones.push({
        id: i + 1,
        name: `Zone-${String(i + 1).padStart(6, '0')}`,
        type: zoneTypes[Math.floor(Math.random() * zoneTypes.length)],
        climate: climates[Math.floor(Math.random() * climates.length)],
        level: Math.floor(Math.random() * 50) + 1,
        controller: Math.random() > 0.3 ? factions[Math.floor(Math.random() * factions.length)] : 'Unclaimed',
        population: Math.floor(Math.random() * 10000000),
        resources: {
          energy: Math.floor(Math.random() * 100000),
          minerals: Math.floor(Math.random() * 150000),
          technology: Math.floor(Math.random() * 1000)
        },
        dangerLevel: Math.floor(Math.random() * 10) + 1,
        discovered: Math.random() > 0.2,
        coordinates: {
          x: Math.floor(Math.random() * mapWidth),
          y: Math.floor(Math.random() * mapHeight)
        }
      });
    }

    return zones;
  }

  /**
   * Get planetary data in chunks
   */
  getPlanetaryData(chunk = 0, chunkSize = 50) {
    const start = chunk * chunkSize;
    const end = start + chunkSize;
    const zones = this.planetaryZones.slice(start, end);

    return {
      total: this.planetaryZones.length,
      chunk: chunk,
      chunkSize: chunkSize,
      zones: zones,
      hasMore: end < this.planetaryZones.length
    };
  }

  /**
   * Add state update listener
   */
  addListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Remove state update listener
   */
  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  /**
   * Add event listener
   */
  addEventListener(callback) {
    this.eventListeners.push(callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(callback) {
    this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
  }

  /**
   * Notify all listeners of state change
   */
  notifyListeners(updateData) {
    this.listeners.forEach(callback => {
      try {
        callback(updateData);
      } catch (error) {
        console.error('Error notifying listener:', error);
      }
    });
  }

  /**
   * Notify event listeners
   */
  notifyEventListeners(event) {
    this.eventListeners.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error notifying event listener:', error);
      }
    });
  }

  /**
   * Spatial Asset Management
   */

  // Initialize spatial assets storage
  initSpatialAssets() {
    if (!this.spatialAssets) {
      this.spatialAssets = new Map();
    }
  }

  /**
   * Get all spatial assets with positions
   */
  getSpatialAssets() {
    this.initSpatialAssets();
    return Array.from(this.spatialAssets.values());
  }

  /**
   * Update spatial assets from map client
   */
  updateSpatialAssets(assets) {
    this.initSpatialAssets();

    assets.forEach(asset => {
      if (asset._id) {
        this.spatialAssets.set(asset._id, {
          _id: asset._id,
          title: asset.title,
          assetType: asset.assetType,
          x: asset.x,
          y: asset.y,
          vx: asset.vx || 0,
          vy: asset.vy || 0,
          radius: asset.radius || 10,
          isStationary: asset.isStationary || false,
          lastUpdated: Date.now()
        });
      }
    });

    // Notify listeners of spatial update
    this.notifyListeners({
      type: 'spatial_update',
      assetCount: this.spatialAssets.size
    });
  }

  /**
   * Clear all spatial assets (for reset)
   */
  clearSpatialAssets() {
    this.initSpatialAssets();
    this.spatialAssets.clear();

    // Notify listeners
    this.notifyListeners({
      type: 'spatial_cleared',
      message: 'All spatial assets cleared'
    });

    return { success: true, message: 'Spatial assets cleared' };
  }

  /**
   * Calculate travel connections between nearby assets
   * Assets within maxDistance can have travel routes
   */
  calculateTravelConnections(maxDistance = 300) {
    this.initSpatialAssets();
    const assets = Array.from(this.spatialAssets.values());
    const connections = [];
    const connectionSet = new Set(); // Track unique connections

    // Future connection range (for blue "planned" routes)
    const futureDistance = maxDistance * 1.5;

    for (let i = 0; i < assets.length; i++) {
      for (let j = i + 1; j < assets.length; j++) {
        const assetA = assets[i];
        const assetB = assets[j];

        // Calculate distance
        const dx = assetB.x - assetA.x;
        const dy = assetB.y - assetA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If within future range, create connection with status
        if (distance <= futureDistance) {
          // Create unique connection ID (sorted to avoid duplicates)
          const connId = [assetA._id, assetB._id].sort().join('-');

          if (!connectionSet.has(connId)) {
            connectionSet.add(connId);

            // Calculate connection status
            let status = 'stable'; // green
            let stability = 1.0;

            if (distance <= maxDistance * 0.7) {
              // Close range: stable (green)
              status = 'stable';
              stability = 1.0 - (distance / (maxDistance * 0.7)) * 0.2; // 0.8-1.0
            } else if (distance <= maxDistance) {
              // Medium range: warning (yellow-orange-red)
              status = 'warning';
              const warningRatio = (distance - maxDistance * 0.7) / (maxDistance * 0.3);
              stability = 0.8 - (warningRatio * 0.6); // 0.8-0.2
            } else {
              // Future range: planned (blue)
              status = 'future';
              stability = (futureDistance - distance) / (futureDistance - maxDistance); // 1.0-0.0
            }

            connections.push({
              from: assetA._id,
              to: assetB._id,
              fromTitle: assetA.title,
              toTitle: assetB.title,
              fromType: assetA.assetType,
              toType: assetB.assetType,
              distance: Math.round(distance),
              fromX: assetA.x,
              fromY: assetA.y,
              toX: assetB.x,
              toY: assetB.y,
              travelTime: Math.ceil(distance / 10),
              status: status,
              stability: stability,
              maxDistance: maxDistance
            });
          }
        }
      }
    }

    return connections;
  }

  /**
   * Get grid cell for position (for grid-based detection)
   */
  getGridCell(x, y, gridSize = 100) {
    return {
      cellX: Math.floor(x / gridSize),
      cellY: Math.floor(y / gridSize)
    };
  }

  /**
   * Get assets in grid cell (optimized spatial queries)
   */
  getAssetsInGridCell(cellX, cellY, gridSize = 100) {
    this.initSpatialAssets();
    const assets = [];

    for (const asset of this.spatialAssets.values()) {
      const cell = this.getGridCell(asset.x, asset.y, gridSize);
      if (cell.cellX === cellX && cell.cellY === cellY) {
        assets.push(asset);
      }
    }

    return assets;
  }

  /**
   * Get nearby assets within radius (using grid optimization)
   */
  getNearbyAssets(x, y, radius, gridSize = 100) {
    this.initSpatialAssets();
    const centerCell = this.getGridCell(x, y, gridSize);
    const cellRadius = Math.ceil(radius / gridSize);
    const nearby = [];

    // Check cells in range
    for (let cx = centerCell.cellX - cellRadius; cx <= centerCell.cellX + cellRadius; cx++) {
      for (let cy = centerCell.cellY - cellRadius; cy <= centerCell.cellY + cellRadius; cy++) {
        const cellAssets = this.getAssetsInGridCell(cx, cy, gridSize);

        cellAssets.forEach(asset => {
          const dx = asset.x - x;
          const dy = asset.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= radius) {
            nearby.push({ ...asset, distance: dist });
          }
        });
      }
    }

    return nearby;
  }

  // ===== CHARACTER TRACKING =====

  /**
   * Initialize character tracking storage
   */
  initCharacters() {
    if (!this.characters) {
      this.characters = new Map();
    }
  }

  /**
   * Get all tracked characters
   */
  getCharacters() {
    this.initCharacters();
    return Array.from(this.characters.values());
  }

  /**
   * Get character by ID
   */
  getCharacter(characterId) {
    this.initCharacters();
    return this.characters.get(characterId);
  }

  /**
   * Update character location and state
   */
  updateCharacter(characterId, characterData) {
    this.initCharacters();

    this.characters.set(characterId, {
      _id: characterId,
      userId: characterData.userId,
      name: characterData.name,
      species: characterData.species || null,
      level: characterData.level || 1,
      location: {
        type: characterData.location?.type || 'galactic',
        x: characterData.location?.x || 0,
        y: characterData.location?.y || 0,
        vx: characterData.location?.vx || 0,
        vy: characterData.location?.vy || 0,
        zone: characterData.location?.zone || null,
        assetId: characterData.location?.assetId || null
      },
      navigation: {
        destination: characterData.navigation?.destination || null,
        travelSpeed: characterData.navigation?.travelSpeed || 5,
        isInTransit: characterData.navigation?.isInTransit || false,
        eta: characterData.navigation?.eta || null
      },
      lastUpdated: Date.now()
    });
  }

  /**
   * Update multiple characters at once
   */
  updateCharacters(charactersArray) {
    this.initCharacters();

    charactersArray.forEach(char => {
      this.updateCharacter(char._id, char);
    });
  }

  /**
   * Remove character from tracking
   */
  removeCharacter(characterId) {
    this.initCharacters();
    return this.characters.delete(characterId);
  }

  /**
   * Get characters near a location
   */
  getNearbyCharacters(x, y, radius = 100) {
    this.initCharacters();
    const characters = Array.from(this.characters.values());
    const nearby = [];

    characters.forEach(char => {
      if (char.location.type !== 'galactic') return;

      const dx = char.location.x - x;
      const dy = char.location.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        nearby.push({
          ...char,
          distance
        });
      }
    });

    return nearby.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Get characters in a grid cell
   */
  getCharactersInGridCell(cellX, cellY, gridSize = 100) {
    this.initCharacters();
    const characters = [];

    for (const char of this.characters.values()) {
      if (char.location.type !== 'galactic') continue;

      const charCell = this.getGridCell(char.location.x, char.location.y, gridSize);
      if (charCell.cellX === cellX && charCell.cellY === cellY) {
        characters.push(char);
      }
    }

    return characters;
  }

  /**
   * Update character movement (for navigation simulation)
   */
  updateCharacterMovement(characterId) {
    this.initCharacters();
    const char = this.characters.get(characterId);

    if (!char || !char.navigation.isInTransit || !char.navigation.destination) {
      return false;
    }

    const dest = char.navigation.destination;
    const dx = dest.x - char.location.x;
    const dy = dest.y - char.location.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Arrived at destination
    if (distance < char.navigation.travelSpeed) {
      char.location.x = dest.x;
      char.location.y = dest.y;
      char.location.vx = 0;
      char.location.vy = 0;
      char.navigation.isInTransit = false;
      char.navigation.destination = null;
      char.navigation.eta = null;
      char.lastUpdated = Date.now();
      return true;
    }

    // Move toward destination
    const angle = Math.atan2(dy, dx);
    char.location.vx = Math.cos(angle) * char.navigation.travelSpeed;
    char.location.vy = Math.sin(angle) * char.navigation.travelSpeed;
    char.location.x += char.location.vx;
    char.location.y += char.location.vy;
    char.lastUpdated = Date.now();

    return false;
  }

  /**
   * Update all characters in transit
   */
  updateAllCharactersMovement() {
    this.initCharacters();
    let arrivedCount = 0;

    for (const [charId, char] of this.characters.entries()) {
      if (char.navigation.isInTransit) {
        const arrived = this.updateCharacterMovement(charId);
        if (arrived) arrivedCount++;
      }
    }

    return arrivedCount;
  }
}
