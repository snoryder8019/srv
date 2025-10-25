/**
 * Asset Model
 * Handles community-submitted assets with approval workflow and voting
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

export class Asset {
  /**
   * Create a new asset
   */
  static async create(assetData) {
    const db = getDb();
    const asset = {
      userId: new ObjectId(assetData.userId),
      title: assetData.title,
      description: assetData.description,
      assetType: assetData.assetType,
      subType: assetData.subType || null,
      status: 'submitted', // Auto-submit for community voting

      // Images
      images: {
        pixelArt: assetData.images?.pixelArt || null,
        fullscreen: assetData.images?.fullscreen || null,
        indexCard: assetData.images?.indexCard || null
      },
      pixelData: assetData.pixelData || null,
      animationFrames: assetData.animationFrames || [],

      // Lore & Story
      lore: assetData.lore || null,
      backstory: assetData.backstory || null,
      flavor: assetData.flavor || null,

      // Stats & Attributes (type-specific)
      stats: assetData.stats || {},
      requirements: assetData.requirements || {},
      effects: assetData.effects || [],
      buffs: assetData.buffs || [],
      debuffs: assetData.debuffs || [],

      // Item-specific
      rarity: assetData.rarity || null,
      stackable: assetData.stackable || false,
      maxStack: assetData.maxStack || 1,
      tradeable: assetData.tradeable || true,

      // Environment-specific (for environment type)
      environmentType: assetData.environmentType || null, // planet, station, asteroid, etc.
      climate: assetData.climate || null,
      atmosphere: assetData.atmosphere || null,
      gravity: assetData.gravity || null,
      resources: assetData.resources || [],

      // Object-specific (for pixel-built objects)
      objectType: assetData.objectType || null, // furniture, decoration, tool, etc.
      isInteractive: assetData.isInteractive || false,
      interactionType: assetData.interactionType || null,

      // HIERARCHY: Support for multi-level universe navigation
      parentGalaxy: assetData.parentGalaxy ? new ObjectId(assetData.parentGalaxy) : null,
      parentStar: assetData.parentStar ? new ObjectId(assetData.parentStar) : null,

      // Position in parent container (for spatial placement)
      coordinates: {
        x: assetData.coordinates?.x || 0,
        y: assetData.coordinates?.y || 0,
        z: assetData.coordinates?.z || 0
      },

      // Orbital mechanics (for planets/moons orbiting stars)
      orbital: assetData.orbital ? {
        radius: assetData.orbital.radius || 0,
        speed: assetData.orbital.speed || 0,
        angle: assetData.orbital.angle || 0,
        clockwise: assetData.orbital.clockwise !== false
      } : null,

      // Galaxy-specific properties
      galaxyType: assetData.galaxyType || null, // spiral, elliptical, irregular, etc.
      starCount: assetData.starCount || 0,

      // Star-specific properties
      starType: assetData.starType || null, // red dwarf, yellow star, blue giant, etc.
      luminosity: assetData.luminosity || 1,
      temperature: assetData.temperature || null,

      // Metadata
      tags: assetData.tags || [],
      category: assetData.category || null,

      // Community features
      votes: 0,
      voters: [],
      suggestions: [],
      collaborators: [],

      // Admin
      adminNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      approvedAt: null,
      approvedBy: null
    };

    const result = await db.collection(collections.assets).insertOne(asset);
    return { ...asset, _id: result.insertedId };
  }

  /**
   * Find asset by ID
   */
  static async findById(assetId) {
    const db = getDb();
    return await db.collection(collections.assets).findOne({
      _id: new ObjectId(assetId)
    });
  }

  /**
   * Find all assets by user
   */
  static async findByUserId(userId) {
    const db = getDb();
    return await db.collection(collections.assets)
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Find assets by status
   */
  static async findByStatus(status) {
    const db = getDb();
    return await db.collection(collections.assets)
      .find({ status })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Find approved assets for voting
   */
  static async findApproved(limit = 50) {
    const db = getDb();
    const pipeline = [
      { $match: { status: 'approved' } },
      {
        $lookup: {
          from: collections.users,
          localField: 'userId',
          foreignField: '_id',
          as: 'createdBy'
        }
      },
      {
        $unwind: {
          path: '$createdBy',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $addFields: {
          creatorUsername: '$createdBy.username',
          voteCount: {
            $cond: {
              if: { $isArray: '$votes' },
              then: { $size: '$votes' },
              else: { $ifNull: ['$votes', 0] }
            }
          }
        }
      },
      {
        $unset: ['createdBy']
      },
      { $sort: { voteCount: -1, approvedAt: -1 } },
      { $limit: limit }
    ];

    return await db.collection(collections.assets).aggregate(pipeline).toArray();
  }

  /**
   * Find assets submitted for community voting
   */
  static async findCommunity(limit = 100) {
    const db = getDb();
    const pipeline = [
      { $match: { status: 'submitted' } },
      {
        $lookup: {
          from: collections.users,
          localField: 'userId',
          foreignField: '_id',
          as: 'createdBy'
        }
      },
      {
        $unwind: {
          path: '$createdBy',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $addFields: {
          creatorUsername: '$createdBy.username',
          voteCount: {
            $cond: {
              if: { $isArray: '$votes' },
              then: { $size: '$votes' },
              else: { $ifNull: ['$votes', 0] }
            }
          }
        }
      },
      {
        $unset: ['createdBy']
      },
      { $sort: { voteCount: -1, submittedAt: -1, createdAt: -1 } },
      { $limit: limit }
    ];

    return await db.collection(collections.assets).aggregate(pipeline).toArray();
  }

  /**
   * Update asset
   */
  static async update(assetId, updateData) {
    const db = getDb();
    const update = {
      ...updateData,
      updatedAt: new Date()
    };

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      { $set: update }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Submit asset for approval
   */
  static async submitForApproval(assetId, userId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.userId.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }

    if (asset.status !== 'draft') {
      throw new Error('Asset already submitted');
    }

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $set: {
          status: 'pending',
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Approve asset (admin only)
   */
  static async approve(assetId, adminId, adminNotes = null) {
    const db = getDb();
    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: new ObjectId(adminId),
          adminNotes: adminNotes,
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Reject asset (admin only)
   */
  static async reject(assetId, adminId, adminNotes) {
    const db = getDb();
    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $set: {
          status: 'rejected',
          adminNotes: adminNotes,
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Add vote to asset
   */
  static async addVote(assetId, userId, voteType = 1) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    // All assets can be voted on (submitted or approved)
    if (!['submitted', 'approved'].includes(asset.status)) {
      throw new Error('Asset not available for voting');
    }

    // Check if user already voted
    const existingVote = asset.voters.find(v => v.userId?.toString() === userId.toString());
    if (existingVote) {
      throw new Error('Already voted');
    }

    // voteType: 1 for upvote, -1 for downvote
    const voteValue = voteType === -1 ? -1 : 1;

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $inc: {
          votes: voteValue,
          ...(voteValue === 1 ? { upvotes: 1 } : { downvotes: 1 })
        },
        $push: {
          voters: {
            userId: new ObjectId(userId),
            voteType: voteValue,
            votedAt: new Date()
          }
        },
        $set: { updatedAt: new Date() }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Remove vote from asset
   */
  static async removeVote(assetId, userId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    // Check if user has voted
    if (!asset.voters.some(voterId => voterId.toString() === userId.toString())) {
      throw new Error('Vote not found');
    }

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $inc: { votes: -1 },
        $pull: { voters: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Add suggestion to asset
   */
  static async addSuggestion(assetId, userId, username, suggestionData) {
    const db = getDb();
    const suggestion = {
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      username: username,
      text: suggestionData.text || '',
      fieldChanges: suggestionData.fieldChanges || {},
      images: suggestionData.images || {},
      createdAt: new Date(),
      upvotes: 0,
      upvoters: [],
      status: 'pending'
    };

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $push: { suggestions: suggestion },
        $set: { updatedAt: new Date() }
      }
    );

    return result.modifiedCount > 0 ? suggestion : null;
  }

  /**
   * Upvote a suggestion
   */
  static async upvoteSuggestion(assetId, suggestionId, userId) {
    const db = getDb();
    const result = await db.collection(collections.assets).updateOne(
      {
        _id: new ObjectId(assetId),
        'suggestions._id': new ObjectId(suggestionId)
      },
      {
        $inc: { 'suggestions.$.upvotes': 1 },
        $addToSet: { 'suggestions.$.upvoters': new ObjectId(userId) }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Approve suggestion and apply changes
   */
  static async approveSuggestion(assetId, suggestionId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    const suggestion = asset.suggestions.find(s => s._id.toString() === suggestionId);

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    const updateData = {
      updatedAt: new Date()
    };

    // Apply field changes
    if (suggestion.fieldChanges) {
      Object.assign(updateData, suggestion.fieldChanges);
    }

    // Apply image changes
    if (suggestion.images) {
      if (suggestion.images.pixelArt) {
        updateData['images.pixelArt'] = suggestion.images.pixelArt;
      }
      if (suggestion.images.fullscreen) {
        updateData['images.fullscreen'] = suggestion.images.fullscreen;
      }
      if (suggestion.images.indexCard) {
        updateData['images.indexCard'] = suggestion.images.indexCard;
      }
    }

    // Update suggestion status to approved
    await db.collection(collections.assets).updateOne(
      {
        _id: new ObjectId(assetId),
        'suggestions._id': new ObjectId(suggestionId)
      },
      {
        $set: {
          'suggestions.$.status': 'approved',
          'suggestions.$.approvedAt': new Date()
        }
      }
    );

    // Apply the changes to the asset
    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      { $set: updateData }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Reject suggestion
   */
  static async rejectSuggestion(assetId, suggestionId, reason) {
    const db = getDb();
    const result = await db.collection(collections.assets).updateOne(
      {
        _id: new ObjectId(assetId),
        'suggestions._id': new ObjectId(suggestionId)
      },
      {
        $set: {
          'suggestions.$.status': 'rejected',
          'suggestions.$.rejectedAt': new Date(),
          'suggestions.$.rejectionReason': reason || 'No reason provided'
        }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Add collaborator to asset
   */
  static async addCollaborator(assetId, userId, collaboratorId, collaboratorName) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.userId.toString() !== userId.toString()) {
      throw new Error('Only the creator can add collaborators');
    }

    const collaborator = {
      userId: new ObjectId(collaboratorId),
      username: collaboratorName,
      addedAt: new Date(),
      contribution: ''
    };

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $push: { collaborators: collaborator },
        $set: { updatedAt: new Date() }
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Delete asset
   */
  static async delete(assetId, userId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.userId.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }

    const result = await db.collection(collections.assets).deleteOne(
      { _id: new ObjectId(assetId) }
    );

    return result.deletedCount > 0;
  }

  /**
   * Get asset statistics
   */
  static async getStats() {
    const db = getDb();
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ];

    const results = await db.collection(collections.assets).aggregate(pipeline).toArray();

    return results.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});
  }

  // ============ HIERARCHY METHODS ============

  /**
   * Get all galaxies (approved assets of type 'galaxy')
   */
  static async getGalaxies(options = {}) {
    const db = getDb();
    const query = {
      assetType: 'galaxy',
      status: 'approved',
      ...options.additionalFilters
    };

    return await db.collection(collections.assets)
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Get all stars in a specific galaxy
   */
  static async getStarsInGalaxy(galaxyId) {
    const db = getDb();
    return await db.collection(collections.assets)
      .find({
        assetType: 'star',
        status: 'approved',
        parentGalaxy: new ObjectId(galaxyId)
      })
      .sort({ 'coordinates.x': 1 })
      .toArray();
  }

  /**
   * Get all planetary bodies in a star system
   */
  static async getBodiesInStarSystem(starId) {
    const db = getDb();
    return await db.collection(collections.assets)
      .find({
        assetType: { $in: ['planet', 'orbital', 'anomaly'] },
        status: 'approved',
        parentStar: new ObjectId(starId)
      })
      .sort({ 'orbital.radius': 1 }) // Sort by orbital distance
      .toArray();
  }

  /**
   * Get full hierarchy path for an asset (galaxy -> star -> planet)
   */
  static async getHierarchyPath(assetId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    const path = {
      current: asset,
      star: null,
      galaxy: null
    };

    // Get parent star if exists
    if (asset.parentStar) {
      path.star = await db.collection(collections.assets).findOne({
        _id: asset.parentStar
      });
    }

    // Get parent galaxy if exists
    if (asset.parentGalaxy) {
      path.galaxy = await db.collection(collections.assets).findOne({
        _id: asset.parentGalaxy
      });
    } else if (path.star && path.star.parentGalaxy) {
      // If asset is directly under star, get galaxy from star
      path.galaxy = await db.collection(collections.assets).findOne({
        _id: path.star.parentGalaxy
      });
    }

    return path;
  }

  /**
   * Get children count for a celestial body
   */
  static async getChildrenCount(parentId, parentType) {
    const db = getDb();
    const query = { status: 'approved' };

    if (parentType === 'galaxy') {
      query.parentGalaxy = new ObjectId(parentId);
      query.assetType = 'star';
    } else if (parentType === 'star') {
      query.parentStar = new ObjectId(parentId);
      query.assetType = { $in: ['planet', 'orbital', 'anomaly'] };
    }

    return await db.collection(collections.assets).countDocuments(query);
  }
}

export default Asset;
