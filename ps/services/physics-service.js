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
    this.tickRate = 1000; // 1000ms = 1 tick per second (reduced for performance)
    this.isRunning = false;
    this.gravityRadius = 200; // Units - bodies within this range exert gravity
    this.io = null; // Socket.IO instance for broadcasting

    // Galactic physics constants - heavily reduced for stable orbits
    this.GRAVITATIONAL_CONSTANT = 0.05; // Drastically reduced from 1.8 for weaker pull
    this.ANOMALY_CAPTURE_DISTANCE = 15000; // Increased to cover universe scale
    this.ANOMALY_MASS = 1000000;
    this.GALAXY_MASS = 100000;
    this.MAX_VELOCITY = 15; // Reduced - orbital speeds should be ~1-10 units/sec with lower G

    // Cache for galactic objects (refreshed periodically)
    this.galacticCache = {
      anomalies: [],
      galaxies: [],
      lastUpdate: 0,
      updateInterval: 30000 // Refresh every 30 seconds
    };

    // Database write throttling
    this.dbWriteCounter = 0;
    this.dbWriteFrequency = 30; // Write to DB every 30 ticks (30 seconds at 1 tick/sec)
  }

  /**
   * Set Socket.IO instance for broadcasting
   */
  setIO(io) {
    this.io = io;
    console.log('✅ Physics Service connected to Socket.IO');
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
   * Physics tick - update all characters and galactic objects
   */
  async tick() {
    try {
      // Get all characters with galactic positions
      const characters = await Character.getGalacticCharacters();

      // Get celestial bodies for gravity calculations
      const celestialBodies = await this.getCelestialBodies();

      // Update physics for each character
      if (characters.length > 0) {
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
      }

      // Update galactic physics (galaxies orbiting anomalies)
      const updatedGalaxies = await this.updateGalacticPhysics();

      // Broadcast galaxy positions if socket.io is available
      if (updatedGalaxies.length > 0 && this.io) {
        this.io.emit('galacticPhysicsUpdate', {
          galaxies: updatedGalaxies,
          timestamp: Date.now()
        });

        // Log sample position for debugging
        if (updatedGalaxies[0]) {
          const g = updatedGalaxies[0];
          console.log(`📡 Broadcast: ${g.id.substring(0,8)} pos:(${g.position.x.toFixed(0)},${g.position.y.toFixed(0)},${g.position.z.toFixed(0)})`);
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
   * Update galactic physics - galaxies orbit anomalies
   */
  async updateGalacticPhysics() {
    try {
      const now = Date.now();

      // Load initial data on first run
      if (this.galacticCache.galaxies.length === 0) {
        this.galacticCache.anomalies = await Asset.getByTypes(['anomaly']);
        this.galacticCache.galaxies = await Asset.getByTypes(['galaxy']);
        this.galacticCache.lastUpdate = now;
        console.log(`🌌 Loaded ${this.galacticCache.galaxies.length} galaxies and ${this.galacticCache.anomalies.length} anomalies into physics cache`);
      }

      // Only refresh anomalies periodically (they don't move)
      // Keep galaxies in memory - they're updated by physics calculations
      if (now - this.galacticCache.lastUpdate > this.galacticCache.updateInterval) {
        this.galacticCache.anomalies = await Asset.getByTypes(['anomaly']);
        this.galacticCache.lastUpdate = now;
        console.log(`🔄 Refreshed anomaly positions (galaxies stay in cache)`);
      }

      const anomalies = this.galacticCache.anomalies;
      const galaxies = this.galacticCache.galaxies;

      if (galaxies.length === 0) return [];

      const deltaTime = this.tickRate / 1000; // Convert to seconds
      const updatedGalaxies = [];
      const bulkOps = [];

      // Update each galaxy
      for (const galaxy of galaxies) {
        // Initialize physics if not present
        if (!galaxy.physics) {
          galaxy.physics = { vx: 0, vy: 0, vz: 0 };
        }

        let totalForceX = 0;
        let totalForceY = 0;
        let totalForceZ = 0;

        // Calculate gravitational force ONLY from parent anomaly
        // This prevents galaxies from being pulled toward multiple anomalies and converging
        if (galaxy.parentId) {
          const parentAnomaly = anomalies.find(a => a._id.toString() === galaxy.parentId.toString());

          if (parentAnomaly) {
            const dx = parentAnomaly.coordinates.x - galaxy.coordinates.x;
            const dy = parentAnomaly.coordinates.y - galaxy.coordinates.y;
            const dz = parentAnomaly.coordinates.z - galaxy.coordinates.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            const dist = Math.sqrt(distSq);

            // Gravitational force: F = G * m1 * m2 / r^2
            const force = (this.GRAVITATIONAL_CONSTANT * this.ANOMALY_MASS * this.GALAXY_MASS) / (distSq + 1);

            // Direction unit vector
            totalForceX = (dx / dist) * force;
            totalForceY = (dy / dist) * force;
            totalForceZ = (dz / dist) * force;
          }
        } else {
          // Fallback: if no parent assigned, use nearest anomaly
          for (const anomaly of anomalies) {
            const dx = anomaly.coordinates.x - galaxy.coordinates.x;
            const dy = anomaly.coordinates.y - galaxy.coordinates.y;
            const dz = anomaly.coordinates.z - galaxy.coordinates.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            const dist = Math.sqrt(distSq);

            // Only apply force if within capture distance
            if (dist < this.ANOMALY_CAPTURE_DISTANCE) {
              // Gravitational force: F = G * m1 * m2 / r^2
              const force = (this.GRAVITATIONAL_CONSTANT * this.ANOMALY_MASS * this.GALAXY_MASS) / (distSq + 1);

              // Direction unit vector
              const forceX = (dx / dist) * force;
              const forceY = (dy / dist) * force;
              const forceZ = (dz / dist) * force;

              totalForceX += forceX;
              totalForceY += forceY;
              totalForceZ += forceZ;
            }
          }
        }

        // Apply forces to velocity (F = ma, assuming m = GALAXY_MASS)
        const accelX = totalForceX / this.GALAXY_MASS;
        const accelY = totalForceY / this.GALAXY_MASS;
        const accelZ = totalForceZ / this.GALAXY_MASS;

        galaxy.physics.vx += accelX * deltaTime;
        galaxy.physics.vy += accelY * deltaTime;
        galaxy.physics.vz += accelZ * deltaTime;

        // Clamp velocity to max speed
        const speed = Math.sqrt(
          galaxy.physics.vx**2 +
          galaxy.physics.vy**2 +
          galaxy.physics.vz**2
        );
        if (speed > this.MAX_VELOCITY) {
          const scale = this.MAX_VELOCITY / speed;
          galaxy.physics.vx *= scale;
          galaxy.physics.vy *= scale;
          galaxy.physics.vz *= scale;
        }

        // Update position based on velocity
        galaxy.coordinates.x += galaxy.physics.vx * deltaTime;
        galaxy.coordinates.y += galaxy.physics.vy * deltaTime;
        galaxy.coordinates.z += galaxy.physics.vz * deltaTime;

        // Prepare bulk update operation
        bulkOps.push({
          updateOne: {
            filter: { _id: galaxy._id },
            update: {
              $set: {
                coordinates: galaxy.coordinates,
                physics: galaxy.physics,
                updatedAt: new Date()
              }
            }
          }
        });

        // Add to broadcast list
        updatedGalaxies.push({
          id: galaxy._id.toString(),
          position: {
            x: galaxy.coordinates.x,
            y: galaxy.coordinates.y,
            z: galaxy.coordinates.z
          },
          velocity: {
            vx: galaxy.physics.vx,
            vy: galaxy.physics.vy,
            vz: galaxy.physics.vz
          }
        });
      }

      // Execute database updates only every N ticks to reduce DB load
      this.dbWriteCounter++;
      if (this.dbWriteCounter >= this.dbWriteFrequency && bulkOps.length > 0) {
        const db = (await import('../plugins/mongo/mongo.js')).getDb();
        const assetsCollection = db.collection('assets');
        await assetsCollection.bulkWrite(bulkOps, { ordered: false });
        this.dbWriteCounter = 0;
      }

      return updatedGalaxies;
    } catch (error) {
      console.error('Galactic physics error:', error.message);
      return [];
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      running: this.isRunning,
      tickRate: this.tickRate,
      gravityRadius: this.gravityRadius,
      hasIO: !!this.io
    };
  }
}

// Create singleton instance
const physicsService = new PhysicsService();

export { physicsService };
export default physicsService;
