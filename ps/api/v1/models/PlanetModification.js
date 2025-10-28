/**
 * PlanetModification Model
 * Tracks player modifications to procedurally generated terrain
 * Only stores changes, not full chunk data
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../../../plugins/mongo/mongo.js';

const COLLECTION_NAME = 'planetModifications';

/**
 * Create indexes for planetModifications collection
 */
export async function createIndexes() {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  await collection.createIndexes([
    { key: { planetId: 1 }, name: 'planetId_1' },
    { key: { planetId: 1, chunkX: 1, chunkY: 1 }, name: 'planet_chunk_1', unique: true },
    { key: { 'modifications.playerId': 1 }, name: 'playerId_1' },
    { key: { updatedAt: 1 }, name: 'updatedAt_1' },
  ]);

  console.log('✓ Planet modifications indexes created');
}

/**
 * Get modifications for a specific chunk
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkY - Chunk Y coordinate
 * @returns {Promise<Object|null>} - Modification document
 */
export async function getChunkModifications(planetId, chunkX, chunkY) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.findOne({
    planetId: new ObjectId(planetId),
    chunkX,
    chunkY,
  });
}

/**
 * Get all modifications for a planet (paginated)
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} skip - Number of docs to skip
 * @param {number} limit - Max docs to return
 * @returns {Promise<Array>} - Modification documents
 */
export async function getPlanetModifications(planetId, skip = 0, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ planetId: new ObjectId(planetId) })
    .skip(skip)
    .limit(limit)
    .toArray();
}

/**
 * Add a modification to a tile
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkY - Chunk Y coordinate
 * @param {Object} modification - Modification data
 * @returns {Promise<Object>} - Update result
 */
export async function addModification(planetId, chunkX, chunkY, modification) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const now = new Date();

  // Upsert: create document if doesn't exist, otherwise push to modifications array
  const result = await collection.updateOne(
    {
      planetId: new ObjectId(planetId),
      chunkX,
      chunkY,
    },
    {
      $setOnInsert: {
        planetId: new ObjectId(planetId),
        chunkX,
        chunkY,
        createdAt: now,
      },
      $push: {
        modifications: {
          ...modification,
          timestamp: now,
        },
      },
      $set: {
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  return result;
}

/**
 * Modify terrain at a specific tile
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} worldX - World X coordinate
 * @param {number} worldY - World Y coordinate
 * @param {ObjectId} playerId - Player who made the modification
 * @param {Object} changes - Changes to terrain
 * @returns {Promise<Object>} - Update result
 */
export async function modifyTerrain(planetId, worldX, worldY, playerId, changes) {
  const chunkSize = 64;
  const chunkX = Math.floor(worldX / chunkSize);
  const chunkY = Math.floor(worldY / chunkSize);
  const tileX = worldX % chunkSize;
  const tileY = worldY % chunkSize;

  const modification = {
    tileX,
    tileY,
    worldX,
    worldY,
    type: 'terrain_modified',
    playerId: new ObjectId(playerId),
    ...changes,
  };

  return addModification(planetId, chunkX, chunkY, modification);
}

/**
 * Mark a resource as harvested
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} worldX - World X coordinate
 * @param {number} worldY - World Y coordinate
 * @param {ObjectId} playerId - Player who harvested
 * @param {string} resourceType - Type of resource harvested
 * @returns {Promise<Object>} - Update result
 */
export async function harvestResource(planetId, worldX, worldY, playerId, resourceType) {
  const chunkSize = 64;
  const chunkX = Math.floor(worldX / chunkSize);
  const chunkY = Math.floor(worldY / chunkSize);
  const tileX = worldX % chunkSize;
  const tileY = worldY % chunkSize;

  const modification = {
    tileX,
    tileY,
    worldX,
    worldY,
    type: 'resource_harvested',
    playerId: new ObjectId(playerId),
    resourceType,
  };

  return addModification(planetId, chunkX, chunkY, modification);
}

/**
 * Change a single tile's properties
 *
 * @param {ObjectId} planetId - Planet ID
 * @param {number} worldX - World X coordinate
 * @param {number} worldY - World Y coordinate
 * @param {ObjectId} playerId - Player who made the change
 * @param {Object} tileChanges - New tile properties
 * @returns {Promise<Object>} - Update result
 */
export async function changeTile(planetId, worldX, worldY, playerId, tileChanges) {
  const chunkSize = 64;
  const chunkX = Math.floor(worldX / chunkSize);
  const chunkY = Math.floor(worldY / chunkSize);
  const tileX = worldX % chunkSize;
  const tileY = worldY % chunkSize;

  const modification = {
    tileX,
    tileY,
    worldX,
    worldY,
    type: 'tile_changed',
    playerId: new ObjectId(playerId),
    changes: tileChanges,
  };

  return addModification(planetId, chunkX, chunkY, modification);
}

/**
 * Get all modifications by a specific player
 *
 * @param {ObjectId} playerId - Player ID
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Modification documents
 */
export async function getPlayerModifications(playerId, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ 'modifications.playerId': new ObjectId(playerId) })
    .limit(limit)
    .toArray();
}

/**
 * Count total modifications on a planet
 *
 * @param {ObjectId} planetId - Planet ID
 * @returns {Promise<number>} - Count
 */
export async function countPlanetModifications(planetId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.aggregate([
    { $match: { planetId: new ObjectId(planetId) } },
    { $project: { modCount: { $size: '$modifications' } } },
    { $group: { _id: null, total: { $sum: '$modCount' } } },
  ]).toArray();

  return result[0]?.total || 0;
}

/**
 * Delete old modifications (cleanup)
 *
 * @param {Date} olderThan - Delete modifications older than this date
 * @returns {Promise<Object>} - Delete result
 */
export async function deleteOldModifications(olderThan) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.deleteMany({
    updatedAt: { $lt: olderThan },
  });
}

export default {
  createIndexes,
  getChunkModifications,
  getPlanetModifications,
  addModification,
  modifyTerrain,
  harvestResource,
  changeTile,
  getPlayerModifications,
  countPlanetModifications,
  deleteOldModifications,
};
