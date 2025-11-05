/**
 * Storehouse Model
 * Galaxy-level inventory storage for ship resupply
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

export class Storehouse {
  /**
   * Create a new storehouse for a galaxy
   */
  static async create(storehouseData) {
    const db = getDb();

    const storehouse = {
      galaxyId: new ObjectId(storehouseData.galaxyId),

      inventory: {
        fuel: storehouseData.inventory?.fuel || 50000,
        food: storehouseData.inventory?.food || 20000,
        oxygen: storehouseData.inventory?.oxygen || 100000,
        medkits: storehouseData.inventory?.medkits || 5000,

        // Expandable for future items
        custom: storehouseData.inventory?.custom || []
      },

      access: {
        public: storehouseData.access?.public !== undefined ? storehouseData.access.public : true,
        allowedUsers: storehouseData.access?.allowedUsers || []
      },

      lastUpdated: new Date(),
      createdAt: new Date()
    };

    const result = await db.collection(collections.storehouses).insertOne(storehouse);
    return { ...storehouse, _id: result.insertedId };
  }

  /**
   * Find storehouse by galaxy ID
   */
  static async findByGalaxyId(galaxyId) {
    const db = getDb();
    return await db.collection(collections.storehouses).findOne({
      galaxyId: new ObjectId(galaxyId)
    });
  }

  /**
   * Find storehouse by ID
   */
  static async findById(storehouseId) {
    const db = getDb();
    return await db.collection(collections.storehouses).findOne({
      _id: new ObjectId(storehouseId)
    });
  }

  /**
   * Update storehouse inventory
   */
  static async updateInventory(galaxyId, inventoryUpdates) {
    const db = getDb();

    const updateData = {
      lastUpdated: new Date()
    };

    // Build update object for specific inventory items
    Object.keys(inventoryUpdates).forEach(key => {
      updateData[`inventory.${key}`] = inventoryUpdates[key];
    });

    const result = await db.collection(collections.storehouses).updateOne(
      { galaxyId: new ObjectId(galaxyId) },
      { $set: updateData }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Transfer items from storehouse to character ship
   */
  static async transferToShip(galaxyId, item, amount) {
    const db = getDb();

    const storehouse = await this.findByGalaxyId(galaxyId);
    if (!storehouse) {
      return { success: false, error: 'Storehouse not found' };
    }

    // Check if enough in storehouse
    if (storehouse.inventory[item] < amount) {
      return {
        success: false,
        error: `Insufficient ${item} in storehouse`,
        available: storehouse.inventory[item]
      };
    }

    // Reduce storehouse inventory
    const newAmount = storehouse.inventory[item] - amount;
    await this.updateInventory(galaxyId, { [item]: newAmount });

    return {
      success: true,
      item: item,
      amount: amount,
      remaining: newAmount
    };
  }

  /**
   * Transfer items from character ship to storehouse
   */
  static async transferFromShip(galaxyId, item, amount) {
    const db = getDb();

    const storehouse = await this.findByGalaxyId(galaxyId);
    if (!storehouse) {
      return { success: false, error: 'Storehouse not found' };
    }

    // Add to storehouse inventory
    const newAmount = storehouse.inventory[item] + amount;
    await this.updateInventory(galaxyId, { [item]: newAmount });

    return {
      success: true,
      item: item,
      amount: amount,
      newTotal: newAmount
    };
  }

  /**
   * Get all storehouses
   */
  static async findAll() {
    const db = getDb();
    return await db.collection(collections.storehouses).find({}).toArray();
  }

  /**
   * Delete storehouse
   */
  static async delete(galaxyId) {
    const db = getDb();
    const result = await db.collection(collections.storehouses).deleteOne({
      galaxyId: new ObjectId(galaxyId)
    });

    return result.deletedCount > 0;
  }
}

export default Storehouse;
