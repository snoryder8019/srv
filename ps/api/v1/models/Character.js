/**
 * Character Model
 * Handles character data including location tracking and navigation
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';
import { getHubByString, getSpawnPosition } from '../../../config/spaceHubs.js';

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
        vx: 0,
        vy: 0,
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
      'location.vx': locationData.vx ?? 0,
      'location.vy': locationData.vy ?? 0,
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
    const distance = Math.sqrt(dx * dx + dy * dy);
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
}

export default Character;
