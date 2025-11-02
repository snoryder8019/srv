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
    this.tickRate = 1000; // 1000ms = 1 tick per second (base rate)
    this.simulationSpeed = 1.0; // Multiplier for simulation speed (default 1x)
    this.isRunning = false;
    this.gravityRadius = 200; // Units - bodies within this range exert gravity
    this.io = null; // Socket.IO instance for broadcasting

    // Galactic physics constants - heavily reduced for stable orbits
    this.GRAVITATIONAL_CONSTANT = 0.05; // Drastically reduced from 1.8 for weaker pull
    this.ANOMALY_CAPTURE_DISTANCE = 15000; // Increased to cover universe scale
    this.ANOMALY_MASS = 1000000;
    this.GALAXY_MASS = 100000;
    this.MAX_VELOCITY = 15; // Reduced - orbital speeds should be ~1-10 units/sec with lower G

    // Universe boundary constraints - keep galaxies within scene bounds
    this.UNIVERSE_BOUNDS = {
      min: { x: -5000, y: -5000, z: -5000 },
      max: { x: 5000, y: 5000, z: 5000 }
    };
    this.BOUNDARY_REPULSION_FORCE = 2000; // Strong force to push back
    this.BOUNDARY_SOFT_ZONE = 4000; // Start gentle pushback at this distance
    this.BOUNDARY_HARD_ZONE = 4800; // Strong pushback beyond this

    // Connection rules (in AU - Astronomical Units)
    this.CONNECTION_DISTANCE = 150; // Max distance for stable connection
    this.ORBIT_BUFFER = 150; // Minimum orbital radius buffer
    this.STABLE_CONNECTION_THRESHOLD = 3; // Days to be considered stable (scaled by sim speed)
    this.BREAKING_CONNECTION_THRESHOLD = 1; // Day before breaking (scaled)
    this.FORMING_CONNECTION_THRESHOLD = 0.5; // Half day before forming (scaled)
    this.ORBIT_LOCK_DURATION = 7; // Days in stable orbit before gravity well event (scaled)

    // Cache for galactic objects (refreshed periodically)
    this.galacticCache = {
      anomalies: [],
      galaxies: [],
      lastUpdate: 0,
      updateInterval: 30000 // Refresh every 30 seconds
    };

    // Connection tracking
    this.connections = new Map(); // connectionId -> connection state
    this.activeConnections = []; // Latest active connections array for visualization
    this.orbitLocks = new Map(); // galaxyId -> orbit lock state
    this.gravityWells = []; // Active gravity well events

    // Database write throttling
    this.dbWriteCounter = 0;
    this.dbWriteFrequency = 30; // Write to DB every 30 ticks (30 seconds at 1 tick/sec)

    // Tick counter for time tracking
    this.tickCounter = 0;
  }

  /**
   * Set Socket.IO instance for broadcasting
   */
  setIO(io) {
    this.io = io;
    console.log('✅ Physics Service connected to Socket.IO');
  }

  /**
   * Set simulation speed multiplier
   * @param {Number} speed - Speed multiplier (0.1 to 10.0)
   */
  setSimulationSpeed(speed) {
    speed = Math.max(0.1, Math.min(10.0, speed)); // Clamp between 0.1x and 10x
    this.simulationSpeed = speed;
    console.log(`⚡ Simulation speed set to ${speed.toFixed(1)}x`);

    // Broadcast speed change to all clients
    if (this.io) {
      this.io.emit('simulationSpeedChanged', { speed: this.simulationSpeed });
    }

    return this.simulationSpeed;
  }

  /**
   * Get current simulation speed
   */
  getSimulationSpeed() {
    return this.simulationSpeed;
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
      this.tickCounter++;

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
      const { updatedGalaxies, connections } = await this.updateGalacticPhysics();

      // Broadcast galaxy positions and connections if socket.io is available
      if (this.io) {
        if (updatedGalaxies.length > 0) {
          this.io.emit('galacticPhysicsUpdate', {
            galaxies: updatedGalaxies,
            connections: connections,
            simulationSpeed: this.simulationSpeed,
            timestamp: Date.now()
          });

          // Log sample position for debugging
          if (updatedGalaxies[0]) {
            const g = updatedGalaxies[0];
            console.log(`📡 Broadcast: ${g.id.substring(0,8)} pos:(${g.position.x.toFixed(0)},${g.position.y.toFixed(0)},${g.position.z.toFixed(0)}) | ${connections.length} connections`);
          }
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

      // Refresh both anomalies and galaxies periodically to pick up database changes
      if (now - this.galacticCache.lastUpdate > this.galacticCache.updateInterval) {
        this.galacticCache.anomalies = await Asset.getByTypes(['anomaly']);
        this.galacticCache.galaxies = await Asset.getByTypes(['galaxy']);
        this.galacticCache.lastUpdate = now;
        console.log(`🔄 Refreshed galactic cache (${this.galacticCache.galaxies.length} galaxies, ${this.galacticCache.anomalies.length} anomalies)`);
      }

      const anomalies = this.galacticCache.anomalies;
      const galaxies = this.galacticCache.galaxies;

      if (galaxies.length === 0) return [];

      // Apply simulation speed to delta time
      const baseTime = this.tickRate / 1000; // Convert to seconds
      const deltaTime = baseTime * this.simulationSpeed;
      const updatedGalaxies = [];
      const bulkOps = [];
      const activeConnections = [];

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

        // Apply boundary repulsion forces to keep galaxies within scene bounds
        const { forces: boundaryForces, boundaryViolation } = this.applyBoundaryForces(galaxy);
        totalForceX += boundaryForces.x;
        totalForceY += boundaryForces.y;
        totalForceZ += boundaryForces.z;

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

      // Process connections between anomalies and galaxies
      this.updateConnections(anomalies, galaxies, activeConnections);

      // Store active connections for API access
      this.activeConnections = activeConnections;

      // Process orbit locks and gravity wells
      this.updateOrbitLocksAndGravityWells(galaxies, anomalies, deltaTime);

      // Execute database updates only every N ticks to reduce DB load
      this.dbWriteCounter++;
      if (this.dbWriteCounter >= this.dbWriteFrequency && bulkOps.length > 0) {
        const db = (await import('../plugins/mongo/mongo.js')).getDb();
        const assetsCollection = db.collection('assets');
        await assetsCollection.bulkWrite(bulkOps, { ordered: false });
        this.dbWriteCounter = 0;
      }

      return { updatedGalaxies, connections: activeConnections };
    } catch (error) {
      console.error('Galactic physics error:', error.message);
      return { updatedGalaxies: [], connections: [] };
    }
  }

  /**
   * Update connections between anomalies and galaxies
   * Tracks connection stability based on distance and orbital dynamics
   */
  updateConnections(anomalies, galaxies, activeConnections) {
    // Rule: Anomalies always connect to closest orbiting galaxy (regardless of distance)
    // Plus up to 2 additional connections within CONNECTION_DISTANCE + ORBIT_BUFFER

    // Debug: Log once per update cycle
    if (anomalies.length > 0 && this.tickCounter % 10 === 0) {
      console.log(`🔗 Connection update: ${anomalies.length} anomalies, ${galaxies.length} galaxies`);
    }

    for (const anomaly of anomalies) {
      const anomalyPos = anomaly.coordinates;
      const connectedGalaxies = [];

      // Find galaxies orbiting this anomaly
      const orbitingGalaxies = galaxies.filter(g =>
        g.parentId && g.parentId.toString() === anomaly._id.toString()
      );

      // Debug logging
      if (this.tickCounter % 10 === 0) {
        console.log(`  Anomaly ${anomaly._id.toString().substring(0,8)}: ${orbitingGalaxies.length} orbiting galaxies`);
        if (orbitingGalaxies.length === 0 && galaxies.length > 0) {
          console.log(`    Sample galaxy parentId: ${galaxies[0].parentId ? galaxies[0].parentId.toString() : 'null'}`);
          console.log(`    Anomaly _id: ${anomaly._id.toString()}`);
        }
      }

      if (orbitingGalaxies.length === 0) continue;

      // Sort by distance to find closest
      orbitingGalaxies.sort((a, b) => {
        const distA = this.calculateDistance(anomalyPos, a.coordinates);
        const distB = this.calculateDistance(anomalyPos, b.coordinates);
        return distA - distB;
      });

      // Always connect to closest orbiting galaxy
      const closest = orbitingGalaxies[0];
      const closestDist = this.calculateDistance(anomalyPos, closest.coordinates);

      connectedGalaxies.push({
        galaxy: closest,
        distance: closestDist,
        isPrimary: true
      });

      // Add up to 2 more connections within range (after ORBIT_BUFFER)
      for (let i = 1; i < orbitingGalaxies.length && connectedGalaxies.length < 3; i++) {
        const galaxy = orbitingGalaxies[i];
        const dist = this.calculateDistance(anomalyPos, galaxy.coordinates);

        // Must be beyond orbit buffer and within connection distance
        if (dist > this.ORBIT_BUFFER && dist < this.CONNECTION_DISTANCE + this.ORBIT_BUFFER) {
          connectedGalaxies.push({
            galaxy: galaxy,
            distance: dist,
            isPrimary: false
          });
        }
      }

      // Process each connection
      for (const conn of connectedGalaxies) {
        const connectionId = `${anomaly._id}-${conn.galaxy._id}`;
        const existingConn = this.connections.get(connectionId);

        // Calculate velocity relative to anomaly
        const relativeVel = Math.sqrt(
          conn.galaxy.physics.vx ** 2 +
          conn.galaxy.physics.vy ** 2 +
          conn.galaxy.physics.vz ** 2
        );

        // Estimate time to break/form based on velocity and distance
        const daysToChange = this.estimateConnectionChange(conn.distance, relativeVel);

        // Determine connection state
        let state = 'stable'; // green
        let color = 0x00ff00;

        if (!existingConn) {
          // New connection forming
          if (daysToChange < this.FORMING_CONNECTION_THRESHOLD) {
            state = 'forming'; // blue dashed
            color = 0x0088ff;
          }

          this.connections.set(connectionId, {
            id: connectionId,
            fromId: anomaly._id.toString(),
            toId: conn.galaxy._id.toString(),
            createdAt: this.tickCounter,
            distance: conn.distance,
            state: state
          });
        } else {
          // Existing connection
          const connectionAge = (this.tickCounter - existingConn.createdAt) * this.tickRate / 1000 / 86400 * this.simulationSpeed;

          if (connectionAge < this.STABLE_CONNECTION_THRESHOLD) {
            state = 'forming'; // Still forming, blue dashed
            color = 0x0088ff;
          } else if (conn.distance > this.CONNECTION_DISTANCE + this.ORBIT_BUFFER) {
            // Connection breaking
            state = 'breaking'; // red-orange
            color = 0xff4400;
          } else {
            state = 'stable'; // green
            color = 0x00ff00;
          }

          existingConn.distance = conn.distance;
          existingConn.state = state;
        }

        // Add to active connections list for broadcast
        activeConnections.push({
          id: connectionId,
          from: anomaly._id.toString(),
          to: conn.galaxy._id.toString(),
          fromPos: { x: anomalyPos.x, y: anomalyPos.y, z: anomalyPos.z },
          toPos: {
            x: conn.galaxy.coordinates.x,
            y: conn.galaxy.coordinates.y,
            z: conn.galaxy.coordinates.z
          },
          distance: conn.distance,
          state: state,
          color: color,
          daysToChange: daysToChange,
          isPrimary: conn.isPrimary
        });
      }
    }

    // Clean up broken connections
    for (const [connId, conn] of this.connections.entries()) {
      const stillActive = activeConnections.some(ac => ac.id === connId);
      if (!stillActive) {
        this.connections.delete(connId);
      }
    }
  }

  /**
   * Calculate 3D distance between two points
   */
  calculateDistance(pos1, pos2) {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Estimate days until connection state changes
   */
  estimateConnectionChange(distance, velocity) {
    if (velocity === 0) return Infinity;

    // Rough estimate: distance / velocity = seconds to change
    // Convert to days and scale by simulation speed
    const secondsToChange = Math.abs(distance - this.CONNECTION_DISTANCE) / velocity;
    const daysToChange = secondsToChange / 86400 / this.simulationSpeed;

    return daysToChange;
  }

  /**
   * Track orbit locks and trigger random gravity well events
   */
  updateOrbitLocksAndGravityWells(galaxies, anomalies, deltaTime) {
    const daysPerTick = deltaTime / 86400; // Convert seconds to days

    for (const galaxy of galaxies) {
      if (!galaxy.parentId) continue;

      const parentAnomaly = anomalies.find(a => a._id.toString() === galaxy.parentId.toString());
      if (!parentAnomaly) continue;

      const galaxyId = galaxy._id.toString();
      const distance = this.calculateDistance(parentAnomaly.coordinates, galaxy.coordinates);

      // Check if galaxy is in stable orbit (within connection range)
      if (distance < this.CONNECTION_DISTANCE + this.ORBIT_BUFFER && distance > this.ORBIT_BUFFER) {
        // Track orbit lock
        let orbitLock = this.orbitLocks.get(galaxyId);

        if (!orbitLock) {
          orbitLock = {
            galaxyId: galaxyId,
            anomalyId: parentAnomaly._id.toString(),
            lockedAt: this.tickCounter,
            daysinLock: 0
          };
          this.orbitLocks.set(galaxyId, orbitLock);
        } else {
          orbitLock.daysInLock += daysPerTick;

          // After ORBIT_LOCK_DURATION days, trigger gravity well event
          if (orbitLock.daysInLock >= this.ORBIT_LOCK_DURATION && Math.random() < 0.1) { // 10% chance per tick
            this.triggerGravityWellEvent(galaxy, parentAnomaly);
            this.orbitLocks.delete(galaxyId); // Reset lock
          }
        }
      } else {
        // Galaxy left stable orbit, remove lock
        this.orbitLocks.delete(galaxyId);
      }
    }

    // Update active gravity wells
    this.gravityWells = this.gravityWells.filter(well => {
      well.age += daysPerTick;
      return well.age < well.duration; // Remove expired wells
    });
  }

  /**
   * Trigger a random gravity well trajectory event
   */
  triggerGravityWellEvent(galaxy, anomaly) {
    // Create random trajectory perpendicular to current orbit
    const toAnomaly = {
      x: anomaly.coordinates.x - galaxy.coordinates.x,
      y: anomaly.coordinates.y - galaxy.coordinates.y,
      z: anomaly.coordinates.z - galaxy.coordinates.z
    };

    // Generate random perpendicular vector
    const perpendicular = {
      x: -toAnomaly.y + (Math.random() - 0.5) * 100,
      y: toAnomaly.x + (Math.random() - 0.5) * 100,
      z: (Math.random() - 0.5) * 100
    };

    // Normalize and scale
    const mag = Math.sqrt(perpendicular.x ** 2 + perpendicular.y ** 2 + perpendicular.z ** 2);
    const wellForce = 50; // Strong pull

    const gravityWell = {
      id: `well-${Date.now()}`,
      targetGalaxyId: galaxy._id.toString(),
      force: {
        x: perpendicular.x / mag * wellForce,
        y: perpendicular.y / mag * wellForce,
        z: perpendicular.z / mag * wellForce
      },
      age: 0,
      duration: 30 // Days of influence
    };

    this.gravityWells.push(gravityWell);

    // Apply immediate velocity change
    galaxy.physics.vx += gravityWell.force.x * 0.1;
    galaxy.physics.vy += gravityWell.force.y * 0.1;
    galaxy.physics.vz += gravityWell.force.z * 0.1;

    console.log(`🌀 Gravity well event triggered for galaxy ${galaxy._id.toString().substring(0,8)}!`);
  }

  /**
   * Apply boundary repulsion forces to keep galaxies within universe bounds
   * Uses soft and hard zones for progressive containment
   */
  applyBoundaryForces(galaxy) {
    const forces = { x: 0, y: 0, z: 0 };
    let boundaryViolation = false;

    // Check each axis
    ['x', 'y', 'z'].forEach(axis => {
      const pos = galaxy.coordinates[axis];
      const min = this.UNIVERSE_BOUNDS.min[axis];
      const max = this.UNIVERSE_BOUNDS.max[axis];

      // Beyond max boundary
      if (pos > this.BOUNDARY_SOFT_ZONE) {
        boundaryViolation = true;

        if (pos > this.BOUNDARY_HARD_ZONE) {
          // Hard zone - strong repulsion
          const excess = pos - this.BOUNDARY_HARD_ZONE;
          forces[axis] -= this.BOUNDARY_REPULSION_FORCE * (excess / 200);
        } else {
          // Soft zone - gentle nudge
          const softExcess = pos - this.BOUNDARY_SOFT_ZONE;
          forces[axis] -= this.BOUNDARY_REPULSION_FORCE * 0.2 * (softExcess / 400);
        }

        // Beyond absolute max - clamp and reverse velocity
        if (pos > max) {
          galaxy.coordinates[axis] = max;
          galaxy.physics[`v${axis}`] = Math.min(0, galaxy.physics[`v${axis}`]); // Reverse if moving outward
          console.log(`🚧 ${galaxy.title} clamped at ${axis}=${max}`);
        }
      }
      // Below min boundary
      else if (pos < -this.BOUNDARY_SOFT_ZONE) {
        boundaryViolation = true;

        if (pos < -this.BOUNDARY_HARD_ZONE) {
          // Hard zone - strong repulsion
          const excess = -this.BOUNDARY_HARD_ZONE - pos;
          forces[axis] += this.BOUNDARY_REPULSION_FORCE * (excess / 200);
        } else {
          // Soft zone - gentle nudge
          const softExcess = -this.BOUNDARY_SOFT_ZONE - pos;
          forces[axis] += this.BOUNDARY_REPULSION_FORCE * 0.2 * (softExcess / 400);
        }

        // Beyond absolute min - clamp and reverse velocity
        if (pos < min) {
          galaxy.coordinates[axis] = min;
          galaxy.physics[`v${axis}`] = Math.max(0, galaxy.physics[`v${axis}`]); // Reverse if moving outward
          console.log(`🚧 ${galaxy.title} clamped at ${axis}=${min}`);
        }
      }
    });

    return { forces, boundaryViolation };
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      running: this.isRunning,
      tickRate: this.tickRate,
      simulationSpeed: this.simulationSpeed,
      gravityRadius: this.gravityRadius,
      hasIO: !!this.io,
      connections: this.connections.size,
      orbitLocks: this.orbitLocks.size,
      gravityWells: this.gravityWells.length,
      tickCounter: this.tickCounter
    };
  }

  /**
   * Get all current connections for visualization
   * @returns {Array} Array of connection objects with positions
   */
  getConnections() {
    return this.activeConnections || [];
  }
}

// Create singleton instance
const physicsService = new PhysicsService();

export { physicsService };
export default physicsService;
