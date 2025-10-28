/**
 * Character Model
 * Handles character data including location tracking and navigation
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';
import { getHubByString, getSpawnPosition } from '../../../config/spaceHubs.js';
import { Physics3D, Vector3D } from '../physics/physics3d.js';

export class Character {
  /**
   * Create a new character
   */
  static async create(characterData) {
    const db = getDb();

    // Get home hub based on string domain
    const homeHub = getHubByString(characterData.stringDomain);
    const spawnLocation = getSpawnPosition(homeHub);

    const character = {
      userId: characterData.userId,
      name: characterData.name,
      species: characterData.species || null,
      stringDomain: characterData.stringDomain || 'Time String', // Default to Time String
      homeStar: characterData.homeStar || null,
      homePlanet: characterData.homePlanet || null,
      traits: characterData.traits || [],
      primaryClass: characterData.primaryClass || null,
      level: 1,

      // Home hub tracking
      homeHub: {
        id: homeHub.id,
        name: homeHub.name,
        stringDomain: homeHub.stringDomain,
        location: homeHub.location
      },

      // Stats
      stats: {
        strength: characterData.stats?.strength || 0,
        intelligence: characterData.stats?.intelligence || 0,
        agility: characterData.stats?.agility || 0,
        faith: characterData.stats?.faith || 0,
        tech: characterData.stats?.tech || 0
      },

      // Trait buffs
      traitBuffs: {
        passive: [],
        triggered: []
      },

      // Inventory
      backpack: {
        items: []
      },

      equipped: {
        head: null,
        chest: null,
        legs: null,
        feet: null,
        hands: null,
        weapon: null,
        offhand: null,
        trinket1: null,
        trinket2: null
      },

      enchantments: [],

      // Ship Status
      activeInShip: true, // Whether character is actively piloting ship

      // Ship Inventory
      ship: {
        name: 'Basic Hauler',
        class: 'frigate',
        hull: {
          maxHP: 1000,
          currentHP: 1000,
          armor: 50
        },
        capacitor: {
          max: 500,
          current: 500,
          rechargeRate: 10
        },
        fittings: {
          highSlots: [null, null, null], // Weapons, mining lasers
          midSlots: [null, null, null, null], // Shield, prop mods, tackle
          lowSlots: [null, null, null, null], // Armor, damage mods, power
          rigSlots: [null, null] // Permanent modifications
        },
        cargoHold: {
          capacity: 1000, // m³
          items: []
        },
        stats: {
          maxSpeed: 100,
          agility: 50,
          scanResolution: 100,
          targetingRange: 5000,
          maxTargets: 3
        }
      },

      // Talent Tree
      talents: {
        availablePoints: 0,
        spent: {},
        unlocked: []
      },

      // Galactic location tracking - spawn at home hub
      location: {
        type: 'galactic',
        x: spawnLocation.x,
        y: spawnLocation.y,
        z: spawnLocation.z || 0, // 3D coordinate for galactic map
        vx: 0,
        vy: 0,
        vz: 0, // Z-axis velocity
        zone: homeHub.name,
        assetId: null,
        lastUpdated: new Date()
      },

      // Navigation
      navigation: {
        destination: null,
        travelSpeed: 5,
        isInTransit: false,
        eta: null
      },

      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection(collections.characters).insertOne(character);
    return { ...character, _id: result.insertedId };
  }

  /**
   * Find character by ID
   */
  static async findById(characterId) {
    const db = getDb();
    return await db.collection(collections.characters).findOne({
      _id: new ObjectId(characterId)
    });
  }

  /**
   * Find all characters for a user
   */
  static async findByUserId(userId) {
    const db = getDb();
    return await db.collection(collections.characters)
      .find({ userId: userId.toString() })
      .toArray();
  }

  /**
   * Update character location
   */
  static async updateLocation(characterId, locationData) {
    const db = getDb();
    const updateData = {
      'location.x': locationData.x,
      'location.y': locationData.y,
      'location.z': locationData.z ?? 0, // 3D coordinate
      'location.vx': locationData.vx ?? 0,
      'location.vy': locationData.vy ?? 0,
      'location.vz': locationData.vz ?? 0, // Z-axis velocity
      'location.lastUpdated': new Date(),
      updatedAt: new Date()
    };

    if (locationData.type) updateData['location.type'] = locationData.type;
    if (locationData.zone !== undefined) updateData['location.zone'] = locationData.zone;
    if (locationData.assetId !== undefined) updateData['location.assetId'] = locationData.assetId;

    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      { $set: updateData }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Set navigation destination
   */
  static async setDestination(characterId, destination) {
    const db = getDb();
    const character = await this.findById(characterId);
    if (!character) return false;

    const dx = destination.x - character.location.x;
    const dy = destination.y - character.location.y;
    const dz = (destination.z || 0) - (character.location.z || 0); // 3D distance
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz); // 3D distance formula
    const eta = distance / character.navigation.travelSpeed;

    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $set: {
          'navigation.destination': destination,
          'navigation.isInTransit': true,
          'navigation.eta': new Date(Date.now() + eta * 1000),
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Cancel navigation
   */
  static async cancelNavigation(characterId) {
    const db = getDb();
    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $set: {
          'navigation.destination': null,
          'navigation.isInTransit': false,
          'navigation.eta': null,
          'location.vx': 0,
          'location.vy': 0,
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Dock character at an asset (location-based positioning)
   */
  static async dockAtAsset(characterId, assetId) {
    const db = getDb();
    const { Asset } = await import('./Asset.js');

    // Get the asset to dock at
    const asset = await Asset.findById(assetId);
    if (!asset) return { success: false, error: 'Asset not found' };

    // Get asset position (from initialPosition or hubData)
    let assetX, assetY;
    if (asset.hubData && asset.hubData.location) {
      assetX = asset.hubData.location.x;
      assetY = asset.hubData.location.y;
    } else if (asset.initialPosition) {
      assetX = asset.initialPosition.x;
      assetY = asset.initialPosition.y;
    } else {
      return { success: false, error: 'Asset has no position data' };
    }

    // Update character location to asset position and dock
    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $set: {
          'location.x': assetX,
          'location.y': assetY,
          'location.vx': 0,
          'location.vy': 0,
          'location.assetId': assetId,
          'location.lastUpdated': new Date(),
          'navigation.destination': null,
          'navigation.isInTransit': false,
          'navigation.eta': null,
          updatedAt: new Date()
        }
      }
    );

    return {
      success: result.modifiedCount > 0,
      asset: {
        _id: asset._id,
        title: asset.title,
        assetType: asset.assetType,
        x: assetX,
        y: assetY
      }
    };
  }

  /**
   * Undock from current asset (enter open space)
   */
  static async undock(characterId) {
    const db = getDb();
    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $set: {
          'location.assetId': null,
          'location.lastUpdated': new Date(),
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Navigate to an asset (travel to and dock)
   */
  static async navigateToAsset(characterId, assetId) {
    const db = getDb();
    const { Asset } = await import('./Asset.js');

    const character = await this.findById(characterId);
    const asset = await Asset.findById(assetId);

    if (!character || !asset) return { success: false, error: 'Character or asset not found' };

    // Get asset position
    let assetX, assetY;
    if (asset.hubData && asset.hubData.location) {
      assetX = asset.hubData.location.x;
      assetY = asset.hubData.location.y;
    } else if (asset.initialPosition) {
      assetX = asset.initialPosition.x;
      assetY = asset.initialPosition.y;
    } else {
      return { success: false, error: 'Asset has no position data' };
    }

    // Calculate travel time
    const dx = assetX - character.location.x;
    const dy = assetY - character.location.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const eta = distance / character.navigation.travelSpeed;

    // Set navigation with asset as destination
    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $set: {
          'navigation.destination': {
            x: assetX,
            y: assetY,
            assetId: assetId,
            assetName: asset.title
          },
          'navigation.isInTransit': true,
          'navigation.eta': new Date(Date.now() + eta * 1000),
          updatedAt: new Date()
        }
      }
    );

    return {
      success: result.modifiedCount > 0,
      eta: eta,
      distance: distance,
      destination: {
        assetId: assetId,
        assetName: asset.title,
        x: assetX,
        y: assetY
      }
    };
  }

  /**
   * Get all characters at a specific asset
   */
  static async getCharactersAtAsset(assetId) {
    const db = getDb();
    return await db.collection(collections.characters)
      .find({ 'location.assetId': assetId })
      .toArray();
  }

  /**
   * Get all characters in galactic view (for map display)
   */
  static async getGalacticCharacters() {
    const db = getDb();
    return await db.collection(collections.characters)
      .find({ 'location.type': 'galactic' })
      .project({
        _id: 1,
        userId: 1,
        name: 1,
        species: 1,
        level: 1,
        location: 1,
        navigation: 1
      })
      .toArray();
  }

  /**
   * Get characters near a location (for proximity detection)
   */
  static async getNearbyCharacters(x, y, radius = 100) {
    const db = getDb();
    const characters = await db.collection(collections.characters)
      .find({ 'location.type': 'galactic' })
      .toArray();

    return characters.filter(char => {
      const dx = char.location.x - x;
      const dy = char.location.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= radius;
    });
  }

  /**
   * Update character (general)
   */
  static async update(characterId, updateData) {
    const db = getDb();
    const cleanData = { ...updateData };
    delete cleanData._id;
    cleanData.updatedAt = new Date();

    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      { $set: cleanData }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Delete character
   */
  static async delete(characterId, userId) {
    const db = getDb();
    const result = await db.collection(collections.characters).deleteOne({
      _id: new ObjectId(characterId),
      userId: userId.toString()
    });

    return result.deletedCount > 0;
  }

  /**
   * ========================================
   * 3D PHYSICS METHODS
   * ========================================
   */

  /**
   * Apply thrust to character in a direction (3D)
   * Updates velocity based on ship thrust capabilities
   *
   * @param {String} characterId - Character ID
   * @param {Object} direction - Direction vector {x, y, z} (will be normalized)
   * @param {Number} power - Thrust power 0-1 (default 1.0)
   * @returns {Object} - Updated velocity
   */
  static async applyThrust(characterId, direction, power = 1.0) {
    const character = await this.findById(characterId);
    if (!character) return null;

    const physics = new Physics3D();

    // Create ship object with current state
    const ship = {
      position: {
        x: character.location.x,
        y: character.location.y,
        z: character.location.z || 0
      },
      velocity: {
        x: character.location.vx || 0,
        y: character.location.vy || 0,
        z: character.location.vz || 0
      },
      mass: character.ship?.stats?.mass || 100,
      stats: {
        maxThrust: character.ship?.stats?.maxThrust || 10
      }
    };

    // Calculate thrust force
    const directionVector = new Vector3D(direction.x, direction.y, direction.z);
    const thrustForce = physics.calculateThrust(ship, directionVector, power);

    // Apply force to update velocity
    const newVelocity = physics.updateVelocity(ship, [thrustForce]);

    // Update character in database
    await this.updateLocation(characterId, {
      x: character.location.x,
      y: character.location.y,
      z: character.location.z || 0,
      vx: newVelocity.x,
      vy: newVelocity.y,
      vz: newVelocity.z
    });

    return {
      vx: newVelocity.x,
      vy: newVelocity.y,
      vz: newVelocity.z
    };
  }

  /**
   * Apply gravity from nearby celestial bodies
   * Calculates gravitational pull from planets/stars
   *
   * @param {String} characterId - Character ID
   * @param {Array<Object>} celestialBodies - Array of bodies with {position: {x,y,z}, mass}
   * @returns {Object} - Updated position and velocity
   */
  static async applyGravity(characterId, celestialBodies = []) {
    const character = await this.findById(characterId);
    if (!character) return null;

    const physics = new Physics3D();

    // Create ship object
    const ship = {
      position: {
        x: character.location.x,
        y: character.location.y,
        z: character.location.z || 0
      },
      velocity: {
        x: character.location.vx || 0,
        y: character.location.vy || 0,
        z: character.location.vz || 0
      },
      mass: character.ship?.stats?.mass || 100
    };

    // Calculate gravitational forces from all celestial bodies
    const forces = [];
    celestialBodies.forEach(body => {
      const gravityForce = physics.calculateGravity(ship, body);
      forces.push(gravityForce);
    });

    // Update position and velocity
    const updated = physics.update(ship, forces);

    // Save to database
    await this.updateLocation(characterId, {
      x: updated.position.x,
      y: updated.position.y,
      z: updated.position.z,
      vx: updated.velocity.x,
      vy: updated.velocity.y,
      vz: updated.velocity.z
    });

    return updated;
  }

  /**
   * Update physics for character (called by state manager tick)
   * Applies all forces and updates position/velocity
   *
   * @param {String} characterId - Character ID
   * @param {Array<Object>} nearbyBodies - Nearby celestial bodies for gravity
   * @returns {Object} - Updated state
   */
  static async updatePhysics(characterId, nearbyBodies = []) {
    const character = await this.findById(characterId);
    if (!character) return null;

    const physics = new Physics3D();

    // Create ship object
    const ship = {
      position: {
        x: character.location.x,
        y: character.location.y,
        z: character.location.z || 0
      },
      velocity: {
        x: character.location.vx || 0,
        y: character.location.vy || 0,
        vz: character.location.vz || 0
      },
      mass: character.ship?.stats?.mass || 100
    };

    // Collect all forces
    const forces = [];

    // Add gravity from nearby bodies
    nearbyBodies.forEach(body => {
      const gravityForce = physics.calculateGravity(ship, body);
      forces.push(gravityForce);
    });

    // If character is thrusting (has active navigation), add thrust force
    if (character.navigation.isInTransit && character.navigation.destination) {
      const dest = character.navigation.destination;
      const direction = new Vector3D(
        dest.x - character.location.x,
        dest.y - character.location.y,
        (dest.z || 0) - (character.location.z || 0)
      );

      const thrustForce = physics.calculateThrust(ship, direction, 1.0);
      forces.push(thrustForce);
    }

    // Update physics
    const updated = physics.update(ship, forces);

    // Save to database
    await this.updateLocation(characterId, {
      x: updated.position.x,
      y: updated.position.y,
      z: updated.position.z,
      vx: updated.velocity.x,
      vy: updated.velocity.y,
      vz: updated.velocity.z
    });

    return updated;
  }

  /**
   * Set character in orbit around a celestial body
   *
   * @param {String} characterId - Character ID
   * @param {Object} centralBody - Body to orbit {position: {x,y,z}, mass}
   * @param {Number} radius - Orbit radius
   * @param {Number} inclination - Orbit inclination (radians, default 0)
   * @returns {Object} - New orbital position and velocity
   */
  static async setOrbit(characterId, centralBody, radius, inclination = 0) {
    const character = await this.findById(characterId);
    if (!character) return null;

    const physics = new Physics3D();

    const orbitingBody = {
      position: {
        x: character.location.x,
        y: character.location.y,
        z: character.location.z || 0
      }
    };

    const orbit = physics.setCircularOrbit(orbitingBody, centralBody, radius, inclination);

    // Update character location
    await this.updateLocation(characterId, {
      x: orbit.position.x,
      y: orbit.position.y,
      z: orbit.position.z,
      vx: orbit.velocity.x,
      vy: orbit.velocity.y,
      vz: orbit.velocity.z
    });

    return orbit;
  }

  /**
   * Stop all movement (kill velocity)
   *
   * @param {String} characterId - Character ID
   * @returns {Boolean} - Success
   */
  static async stopMovement(characterId) {
    return await this.updateLocation(characterId, {
      vx: 0,
      vy: 0,
      vz: 0
    });
  }
}

export default Character;
