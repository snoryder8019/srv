/**
 * SpriteAtlas Model
 * Manages sprite atlases for planetary rendering
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../../../plugins/mongo/mongo.js';

const COLLECTION_NAME = 'spriteAtlases';

/**
 * Create indexes for spriteAtlases collection
 */
export async function createIndexes() {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  await collection.createIndexes([
    { key: { atlasKey: 1 }, name: 'atlasKey_1', unique: true },
    { key: { packType: 1 }, name: 'packType_1' },
    { key: { approvalStatus: 1 }, name: 'approvalStatus_1' },
    { key: { uploadedBy: 1 }, name: 'uploadedBy_1' },
    { key: { createdAt: 1 }, name: 'createdAt_1' },
    { key: { upvotes: 1 }, name: 'upvotes_1' },
  ]);

  console.log('✓ Sprite atlases indexes created');
}

/**
 * Create a new sprite atlas
 *
 * @param {Object} atlasData - Atlas data
 * @returns {Promise<Object>} - Inserted atlas
 */
export async function createAtlas(atlasData) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const now = new Date();

  const atlas = {
    ...atlasData,
    upvotes: 0,
    downvotes: 0,
    voters: [],
    approvalStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(atlas);

  return {
    ...atlas,
    _id: result.insertedId,
  };
}

/**
 * Get atlas by ID
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @returns {Promise<Object|null>} - Atlas document
 */
export async function getAtlasById(atlasId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.findOne({ _id: new ObjectId(atlasId) });
}

/**
 * Get atlas by key
 *
 * @param {string} atlasKey - Atlas key (e.g., "forest-terrain-001")
 * @returns {Promise<Object|null>} - Atlas document
 */
export async function getAtlasByKey(atlasKey) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.findOne({ atlasKey });
}

/**
 * Get all approved atlases
 *
 * @param {string} packType - Optional: filter by pack type
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Approved atlases
 */
export async function getApprovedAtlases(packType = null, limit = 100) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const query = { approvalStatus: 'approved' };
  if (packType) {
    query.packType = packType;
  }

  return collection
    .find(query)
    .limit(limit)
    .sort({ upvotes: -1, createdAt: -1 })
    .toArray();
}

/**
 * Get pending atlases for approval
 *
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Pending atlases
 */
export async function getPendingAtlases(limit = 50) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ approvalStatus: 'pending' })
    .limit(limit)
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Get atlases by uploader
 *
 * @param {ObjectId} uploaderId - Uploader ID
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - User's atlases
 */
export async function getUserAtlases(uploaderId, limit = 50) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ uploadedBy: new ObjectId(uploaderId) })
    .limit(limit)
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Update atlas manifest
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @param {Object} manifest - New manifest data
 * @returns {Promise<Object>} - Update result
 */
export async function updateAtlasManifest(atlasId, manifest) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.updateOne(
    { _id: new ObjectId(atlasId) },
    {
      $set: {
        tileManifest: manifest,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Vote on an atlas
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @param {ObjectId} userId - User ID
 * @param {string} voteType - 'upvote' or 'downvote'
 * @returns {Promise<Object>} - Updated atlas
 */
export async function voteAtlas(atlasId, userId, voteType) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const userIdObj = new ObjectId(userId);

  // Remove existing vote
  await collection.updateOne(
    { _id: new ObjectId(atlasId) },
    {
      $pull: { voters: { userId: userIdObj } },
    }
  );

  // Add new vote
  const voteUpdate = {
    $push: {
      voters: {
        userId: userIdObj,
        voteType,
        votedAt: new Date(),
      },
    },
  };

  if (voteType === 'upvote') {
    voteUpdate.$inc = { upvotes: 1 };
  } else if (voteType === 'downvote') {
    voteUpdate.$inc = { downvotes: 1 };
  }

  await collection.updateOne({ _id: new ObjectId(atlasId) }, voteUpdate);

  return getAtlasById(atlasId);
}

/**
 * Remove vote from an atlas
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @param {ObjectId} userId - User ID
 * @returns {Promise<Object>} - Updated atlas
 */
export async function removeVote(atlasId, userId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const userIdObj = new ObjectId(userId);

  // Get current vote
  const atlas = await getAtlasById(atlasId);
  const existingVote = atlas.voters.find(v => v.userId.toString() === userId.toString());

  if (existingVote) {
    // Decrement vote count
    const update = {
      $pull: { voters: { userId: userIdObj } },
    };

    if (existingVote.voteType === 'upvote') {
      update.$inc = { upvotes: -1 };
    } else if (existingVote.voteType === 'downvote') {
      update.$inc = { downvotes: -1 };
    }

    await collection.updateOne({ _id: new ObjectId(atlasId) }, update);
  }

  return getAtlasById(atlasId);
}

/**
 * Approve an atlas (admin only)
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @param {ObjectId} approvedBy - Admin user ID
 * @returns {Promise<Object>} - Update result
 */
export async function approveAtlas(atlasId, approvedBy) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.updateOne(
    { _id: new ObjectId(atlasId) },
    {
      $set: {
        approvalStatus: 'approved',
        approvedAt: new Date(),
        approvedBy: new ObjectId(approvedBy),
      },
    }
  );
}

/**
 * Reject an atlas (admin only)
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @param {ObjectId} rejectedBy - Admin user ID
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} - Update result
 */
export async function rejectAtlas(atlasId, rejectedBy, reason = '') {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.updateOne(
    { _id: new ObjectId(atlasId) },
    {
      $set: {
        approvalStatus: 'rejected',
        rejectedAt: new Date(),
        rejectedBy: new ObjectId(rejectedBy),
        rejectionReason: reason,
      },
    }
  );
}

/**
 * Delete an atlas
 *
 * @param {ObjectId} atlasId - Atlas ID
 * @returns {Promise<Object>} - Delete result
 */
export async function deleteAtlas(atlasId) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection.deleteOne({ _id: new ObjectId(atlasId) });
}

/**
 * Search atlases by name or tags
 *
 * @param {string} searchTerm - Search term
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Matching atlases
 */
export async function searchAtlases(searchTerm, limit = 50) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({
      approvalStatus: 'approved',
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { 'tileManifest.tags': { $regex: searchTerm, $options: 'i' } },
      ],
    })
    .limit(limit)
    .toArray();
}

/**
 * Get atlas statistics
 *
 * @returns {Promise<Object>} - Statistics
 */
export async function getAtlasStats() {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  const [total, approved, pending, rejected, byType] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ approvalStatus: 'approved' }),
    collection.countDocuments({ approvalStatus: 'pending' }),
    collection.countDocuments({ approvalStatus: 'rejected' }),
    collection.aggregate([
      { $group: { _id: '$packType', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  return {
    total,
    approved,
    pending,
    rejected,
    byType: byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
  };
}

/**
 * Get most popular atlases
 *
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Popular atlases
 */
export async function getPopularAtlases(limit = 10) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ approvalStatus: 'approved' })
    .sort({ upvotes: -1, downvotes: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Get recently added atlases
 *
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Recent atlases
 */
export async function getRecentAtlases(limit = 10) {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);

  return collection
    .find({ approvalStatus: 'approved' })
    .sort({ approvedAt: -1 })
    .limit(limit)
    .toArray();
}

export default {
  createIndexes,
  createAtlas,
  getAtlasById,
  getAtlasByKey,
  getApprovedAtlases,
  getPendingAtlases,
  getUserAtlases,
  updateAtlasManifest,
  voteAtlas,
  removeVote,
  approveAtlas,
  rejectAtlas,
  deleteAtlas,
  searchAtlases,
  getAtlasStats,
  getPopularAtlases,
  getRecentAtlases,
};
