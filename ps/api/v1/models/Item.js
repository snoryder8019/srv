import { getDb } from '../../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

export class Item {
  /**
   * Create a new item
   */
  static async create(itemData) {
    const db = getDb();

    const item = {
      name: itemData.name,
      description: itemData.description || '',
      itemType: itemData.itemType, // "weapon", "module", "consumable", "resource", "trade_good"
      category: itemData.category,
      stackable: itemData.stackable !== undefined ? itemData.stackable : false,
      maxStack: itemData.maxStack || 1,
      volume: itemData.volume || 1,
      mass: itemData.mass || 1,
      rarity: itemData.rarity || 'common',
      attributes: itemData.attributes || {},
      metadata: {
        createdBy: itemData.createdBy || 'system',
        approvalStatus: 'approved', // Start approved for system items
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };

    const result = await db.collection('items').insertOne(item);
    return { ...item, _id: result.insertedId };
  }

  /**
   * Find item by ID
   */
  static async findById(itemId) {
    const db = getDb();
    return await db.collection('items').findOne({ _id: new ObjectId(itemId) });
  }

  /**
   * Find items by type
   */
  static async findByType(itemType) {
    const db = getDb();
    return await db.collection('items')
      .find({ itemType })
      .toArray();
  }

  /**
   * Find items by category
   */
  static async findByCategory(category) {
    const db = getDb();
    return await db.collection('items')
      .find({ category })
      .toArray();
  }

  /**
   * Search items
   */
  static async search(query) {
    const db = getDb();
    return await db.collection('items')
      .find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      })
      .toArray();
  }

  /**
   * Get all items
   */
  static async findAll() {
    const db = getDb();
    return await db.collection('items').find({}).toArray();
  }

  /**
   * Update item
   */
  static async update(itemId, updates) {
    const db = getDb();

    const result = await db.collection('items').updateOne(
      { _id: new ObjectId(itemId) },
      {
        $set: {
          ...updates,
          'metadata.updatedAt': new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Delete item
   */
  static async delete(itemId) {
    const db = getDb();
    const result = await db.collection('items').deleteOne({ _id: new ObjectId(itemId) });
    return result.deletedCount > 0;
  }
}
