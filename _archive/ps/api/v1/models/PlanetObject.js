/**
 * PlanetObject Model
 * Handles player-placed objects on planets
 * Spaceships, buildings, defenses, NPCs, etc.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../../../plugins/mongo/mongo.js';

const COLLECTION_NAME = 'planetObjects';

/**
 * Create indexes for planetObjects collection
 */
export async function createIndexes() {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  await collection.createIndexes([
    { key: { planetId: 1 }, name: 'planetId_1' },
    { key: { planetId: 1, 'position.chunkX': 1, 'position.chunkY': 1 }, name: 'planet_chunk_1' },
    { key: { ownerId: 1 }, name: 'ownerId_1' },
    { key: { objectType: 1 }, name: 'objectType_1' },
    { key: { 'position.worldX': 1, 'position.worldY': 1 }, name: 'world_position_1' },
    { key: { placedAt: 1 }, name: 'placedAt_1' },
  ]);

  console.log('✓ Planet objects indexes created');
}

/**
 * Place an object on a planet
 *
 * @param {Object} objectData - Object data
 * @returns {Promise<Object>} - Inserted object
 */
export async function placeObject(objectData) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const now = new Date();

  // Calculate chunk coordinates from world position
  const chunkSize = 64;
  const chunkX = Math.floor(objectData.position.worldX / chunkSize);
  const chunkY = Math.floor(objectData.position.worldY / chunkSize);

  const object = {
    ...objectData,
    position: {
      ...objectData.position,
      chunkX,
      chunkY,
      layer: objectData.position.layer || 1,
    },
    placedAt: now,
    lastInteraction: now,
    modifiedAt: now,
  };

  const result = await collection.insertOne(object);

  return {
    ...object,
    _id: result.insertedId,
  };
}

/**
 * Get objects in a specific chunk
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkY - Chunk Y coordinate
 * @returns {Promise<Array>} - Objects in chunk
 */
export async function getObjectsInChunk(planetId, chunkX, chunkY) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({
      planetId: new ObjectId(planetId),
      'position.chunkX': chunkX,
      'position.chunkY': chunkY,
    })
    .toArray();
}

/**
 * Get objects in a rectangular area
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} minX - Min world X
 * @param {number} maxX - Max world X
 * @param {number} minY - Min world Y
 * @param {number} maxY - Max world Y
 * @returns {Promise<Array>} - Objects in area
 */
export async function getObjectsInArea(planetId, minX, maxX, minY, maxY) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({
      planetId: new ObjectId(planetId),
      'position.worldX': { $gte: minX, $lte: maxX },
      'position.worldY': { $gte: minY, $lte: maxY },
    })
    .toArray();
}

/**
 * Get object by ID
 *
 * @param {ObjectId} objectId - Object ID
 * @returns {Promise<Object|null>} - Object document
 */
export async function getObjectById(objectId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.findOne({ _id: new ObjectId(objectId) });
}

/**
 * Update object state
 *
 * @param {ObjectId} objectId - Object ID
 * @param {Object} stateUpdate - State updates
 * @returns {Promise<Object>} - Update result
 */
export async function updateObjectState(objectId, stateUpdate) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.updateOne(
    { _id: new ObjectId(objectId) },
    {
      $set: {
        state: stateUpdate,
        lastInteraction: new Date(),
        modifiedAt: new Date(),
      },
    }
  );
}

/**
 * Update object sprite data (for animations)
 *
 * @param {ObjectId} objectId - Object ID
 * @param {Object} spriteUpdate - Sprite data updates
 * @returns {Promise<Object>} - Update result
 */
export async function updateObjectSprite(objectId, spriteUpdate) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.updateOne(
    { _id: new ObjectId(objectId) },
    {
      $set: {
        spriteData: spriteUpdate,
        modifiedAt: new Date(),
      },
    }
  );
}

/**
 * Remove an object
 *
 * @param {ObjectId} objectId - Object ID
 * @param {ObjectId} playerId - Player removing (must be owner or admin)
 * @returns {Promise<Object>} - Delete result
 */
export async function removeObject(objectId, playerId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  // Verify ownership
  const object = await getObjectById(objectId);
  if (!object) {
    throw new Error('Object not found');
  }

  if (object.ownerId.toString() !== playerId.toString()) {
    throw new Error('Not authorized to remove this object');
  }

  return collection.deleteOne({ _id: new ObjectId(objectId) });
}

/**
 * Get all objects owned by a player
 *
 * @param {ObjectId} ownerId - Owner ID
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Objects
 */
export async function getPlayerObjects(ownerId, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ ownerId: new ObjectId(ownerId) })
    .limit(limit)
    .sort({ placedAt: -1 })
    .toArray();
}

/**
 * Get all objects on a planet
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} skip - Pagination skip
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Objects
 */
export async function getPlanetObjects(planetId, skip = 0, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ planetId: new ObjectId(planetId) })
    .skip(skip)
    .limit(limit)
    .toArray();
}

/**
 * Count objects on a planet
 *
 * @param {ObjectId} planetId - Planet ID
 * @returns {Promise<number>} - Count
 */
export async function countPlanetObjects(planetId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.countDocuments({ planetId: new ObjectId(planetId) });
}

/**
 * Check if position is occupied
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} worldX - World X coordinate
 * @param {number} worldY - World Y coordinate
 * @param {number} radius - Check radius (for multi-tile objects)
 * @returns {Promise<boolean>} - True if occupied
 */
export async function isPositionOccupied(planetId, worldX, worldY, radius = 0) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const count = await collection.countDocuments({
    planetId: new ObjectId(planetId),
    'position.worldX': { $gte: worldX - radius, $lte: worldX + radius },
    'position.worldY': { $gte: worldY - radius, $lte: worldY + radius },
  });

  return count > 0;
}

/**
 * Interact with an object
 *
 * @param {ObjectId} objectId - Object ID
 * @param {ObjectId} playerId - Player interacting
 * @param {string} interactionType - Type of interaction
 * @param {Object} data - Interaction data
 * @returns {Promise<Object>} - Updated object
 */
export async function interactWithObject(objectId, playerId, interactionType, data = {}) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const now = new Date();

  // Update last interaction time
  await collection.updateOne(
    { _id: new ObjectId(objectId) },
    {
      $set: {
        lastInteraction: now,
        modifiedAt: now,
      },
    }
  );

  // Get updated object
  const object = await getObjectById(objectId);

  // Handle interaction based on type
  // (This can be expanded with specific logic for different object types)

  return {
    success: true,
    object,
    interaction: {
      type: interactionType,
      playerId,
      timestamp: now,
      data,
    },
  };
}

/**
 * Get objects by type
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {string} objectType - Object type
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Objects
 */
export async function getObjectsByType(planetId, objectType, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({
      planetId: new ObjectId(planetId),
      objectType,
    })
    .limit(limit)
    .toArray();
}

/**
 * Delete old inactive objects (cleanup)
 *
 * @param {Date} olderThan - Delete objects not interacted with since this date
 * @returns {Promise<Object>} - Delete result
 */
export async function deleteInactiveObjects(olderThan) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.deleteMany({
    lastInteraction: { $lt: olderThan },
    objectType: { $nin: ['spaceship', 'base'] }, // Never auto-delete important objects
  });
}

export default {
  createIndexes,
  placeObject,
  getObjectsInChunk,
  getObjectsInArea,
  getObjectById,
  updateObjectState,
  updateObjectSprite,
  removeObject,
  getPlayerObjects,
  getPlanetObjects,
  countPlanetObjects,
  isPositionOccupied,
  interactWithObject,
  getObjectsByType,
  deleteInactiveObjects,
};
