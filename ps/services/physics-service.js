/**
 * Physics Service
 * Handles physics updates for all characters in 3D space
 * Runs on a scheduled interval to update positions and velocities
 */
import { Character } from '../api/v1/models/Character.js';
import { Asset } from '../api/v1/models/Asset.js';

class PhysicsService {
  constructor() {
    this.updateInterval = null;
    this.tickRate = 100; // 100ms = 10 ticks per second
    this.isRunning = false;
    this.gravityRadius = 200; // Units - bodies within this range exert gravity
  }

  /**
   * Start the physics update loop
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Physics service already running');
      return;
    }

    console.log('🚀 Starting Physics Service...');
    console.log('   Tick rate: ' + this.tickRate + 'ms (' + (1000 / this.tickRate) + ' ticks/sec)');
    console.log('   Gravity radius: ' + this.gravityRadius + ' units');

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.tick(), this.tickRate);
  }

  /**
   * Stop the physics update loop
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      this.isRunning = false;
      console.log('🛑 Physics Service stopped');
    }
  }

  /**
   * Physics tick - update all characters
   */
  async tick() {
    try {
      // Get all characters with galactic positions
      const characters = await Character.getGalacticCharacters();
      
      if (characters.length === 0) return;

      // Get celestial bodies for gravity calculations
      const celestialBodies = await this.getCelestialBodies();

      // Update physics for each character
      for (const character of characters) {
        try {
          // Find nearby celestial bodies within gravity radius
          const nearbyBodies = this.findNearbyBodies(character.location, celestialBodies);

          // Update character physics
          await Character.updatePhysics(character._id.toString(), nearbyBodies);

          // Check if character reached destination
          if (character.navigation.isInTransit && character.navigation.destination) {
            await this.checkDestinationReached(character);
          }
        } catch (error) {
          console.error('Error updating physics for character ' + character._id + ':', error.message);
        }
      }
    } catch (error) {
      console.error('Physics tick error:', error.message);
    }
  }

  /**
   * Get all celestial bodies (stars, planets) for gravity calculations
   */
  async getCelestialBodies() {
    try {
      const bodies = await Asset.getByTypes(['star', 'planet', 'orbital']);
      
      return bodies.map(body => {
        return {
          _id: body._id,
          title: body.title,
          position: {
            x: body.coordinates ? body.coordinates.x : 0,
            y: body.coordinates ? body.coordinates.y : 0,
            z: body.coordinates ? body.coordinates.z : 0
          },
          mass: body.stats && body.stats.mass ? body.stats.mass : this.getDefaultMass(body.assetType)
        };
      });
    } catch (error) {
      console.error('Error fetching celestial bodies:', error.message);
      return [];
    }
  }

  /**
   * Get default mass for asset type
   */
  getDefaultMass(assetType) {
    const massDefaults = {
      star: 10000,
      planet: 1000,
      orbital: 100,
      station: 50
    };
    return massDefaults[assetType] ? massDefaults[assetType] : 100;
  }

  /**
   * Find celestial bodies near a character position
   */
  findNearbyBodies(characterPosition, celestialBodies) {
    const charX = characterPosition.x;
    const charY = characterPosition.y;
    const charZ = characterPosition.z || 0;

    return celestialBodies.filter(body => {
      const dx = body.position.x - charX;
      const dy = body.position.y - charY;
      const dz = body.position.z - charZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      return distance <= this.gravityRadius;
    });
  }

  /**
   * Check if character has reached their destination
   */
  async checkDestinationReached(character) {
    const dest = character.navigation.destination;
    const loc = character.location;

    const dx = dest.x - loc.x;
    const dy = dest.y - loc.y;
    const dz = (dest.z || 0) - (loc.z || 0);
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // If within 5 units of destination, stop
    if (distance < 5) {
      await Character.cancelNavigation(character._id.toString());
      console.log('✅ Character ' + character.name + ' reached destination at (' + dest.x.toFixed(1) + ', ' + dest.y.toFixed(1) + ', ' + dest.z.toFixed(1) + ')');

      // Auto-dock if destination was an asset
      if (dest.assetId) {
        await Character.dockAtAsset(character._id.toString(), dest.assetId);
        console.log('   🛸 Auto-docked at ' + dest.assetName);
      }
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      running: this.isRunning,
      tickRate: this.tickRate,
      gravityRadius: this.gravityRadius
    };
  }
}

// Create singleton instance
const physicsService = new PhysicsService();

export { physicsService };
export default physicsService;
