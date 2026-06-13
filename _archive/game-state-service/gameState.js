/**
 * Game State Manager
 * Simulates and manages the universe state
 */

export class GameStateManager {
  constructor() {
    this.state = {
      galactic: {
        cycle: 1,
        year: 2847,
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
        unexplored: 1500,
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

    // Generate planetary zones
    this.planetaryZones = this.generatePlanetaryZones(500);
  }

  /**
   * Start the game state simulation
   */
  start() {
    console.log('🎮 Starting game state simulation...');

    // Generate initial events
    this.generateEvent();

    // Update state every 30 seconds
    this.updateInterval = setInterval(() => {
      this.updateState();
    }, 30000);

    // Generate new events every 2 minutes
    setInterval(() => {
      this.generateEvent();
    }, 120000);
  }

  /**
   * Update the game state
   */
  updateState() {
    // Slightly adjust faction power
    for (const faction in this.state.factions) {
      const change = (Math.random() - 0.5) * 3; // -1.5 to +1.5
      this.state.factions[faction].power = Math.max(0, Math.min(100,
        this.state.factions[faction].power + change
      ));
    }

    // Update galactic cycle
    this.state.galactic.cycle++;

    // Update resources
    this.state.resources.energy += Math.floor(Math.random() * 100000);
    this.state.resources.minerals += Math.floor(Math.random() * 150000);
    this.state.resources.technology += Math.floor(Math.random() * 50);
    this.state.resources.population += Math.floor(Math.random() * 1000000);

    // Update zones
    if (Math.random() > 0.7) {
      this.state.zones.discovered++;
      this.state.zones.unexplored--;
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
   * Generate planetary zones
   */
  generatePlanetaryZones(count) {
    const zones = [];
    const zoneTypes = ['discovery', 'combat', 'resource', 'trading', 'exploration'];
    const climates = ['temperate', 'arctic', 'desert', 'tropical', 'volcanic', 'toxic'];
    const factions = Object.keys(this.state.factions);

    for (let i = 0; i < count; i++) {
      zones.push({
        id: i + 1,
        name: `Zone-${String(i + 1).padStart(4, '0')}`,
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
          x: Math.floor(Math.random() * 1000),
          y: Math.floor(Math.random() * 1000)
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
}
