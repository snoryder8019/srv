/**
 * Asset Model
 * Handles community-submitted assets with approval workflow and voting
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

export class Asset {
  /**
   * Get default map level for asset type
   * Controls which zoom level the asset appears on
   */
  static getDefaultMapLevel(assetType) {
    const defaults = {
      // Galactic Level - Deep space objects
      'galaxy': 'galactic',
      'anomaly': 'galactic',
      'anomoly': 'galactic', // Support legacy spelling
      'localGroup': 'galactic',
      'nebula': 'galactic',

      // Galaxy Level - Objects within a galaxy
      'star': 'galaxy',
      'station': 'galaxy',
      'starship': 'galaxy',

      // System Level - Objects within a star system
      'planet': 'system',
      'orbital': 'system',
      'asteroid': 'system',

      // Orbital Level - Close proximity objects
      'zone': 'orbital',
      'sprite': null // Sprites don't render on 3D maps
    };
    return defaults[assetType] || 'system'; // Default to system level
  }

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

      // HIERARCHY: Full hierarchical asset system (ENHANCED)
      hierarchy: {
        parent: assetData.hierarchy?.parent ? new ObjectId(assetData.hierarchy.parent) : null,
        parentType: assetData.hierarchy?.parentType || null,
        children: assetData.hierarchy?.children?.map(id => new ObjectId(id)) || [],
        depth: assetData.hierarchy?.depth || 0,
        path: assetData.hierarchy?.path?.map(id => new ObjectId(id)) || []
      },

      // LEGACY: Support for old hierarchy fields (backward compatibility)
      parentGalaxy: assetData.parentGalaxy ? new ObjectId(assetData.parentGalaxy) : null,
      parentStar: assetData.parentStar ? new ObjectId(assetData.parentStar) : null,

      // Position in parent container (for spatial placement)
      coordinates: {
        x: assetData.coordinates?.x || 0,
        y: assetData.coordinates?.y || 0,
        z: assetData.coordinates?.z || 0
      },

      // Map Level - Controls which zoom level this asset appears on
      // Options: 'galactic', 'galaxy', 'system', 'orbital'
      mapLevel: assetData.mapLevel || this.getDefaultMapLevel(assetData.assetType),

      // Render Data - Visual display properties for 3D maps
      renderData: assetData.renderData || null,

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

      // Storyline Arc properties (for assetType: 'storyline_arc')
      arc_setting: assetData.arc_setting || null,
      arc_themes: assetData.arc_themes || [],
      arc_conflict: assetData.arc_conflict || null,
      arc_visual_mood: assetData.arc_visual_mood || null,
      arc_quest_hooks: assetData.arc_quest_hooks || [],
      arc_linked_assets: assetData.arc_linked_assets || [],

      // Storyline NPC properties (for assetType: 'storyline_npc')
      npc_role: assetData.npc_role || null,
      npc_arc_id: assetData.npc_arc_id || null,
      npc_traits: assetData.npc_traits || [],
      npc_dialogue_style: assetData.npc_dialogue_style || null,
      npc_locations: assetData.npc_locations || [],
      npc_signature_items: assetData.npc_signature_items || [],

      // Storyline Quest properties (for assetType: 'storyline_quest')
      quest_arc_id: assetData.quest_arc_id || null,
      quest_type: assetData.quest_type || null,
      quest_trigger_condition: assetData.quest_trigger_condition || null,
      quest_objectives: assetData.quest_objectives || [],
      quest_rewards: assetData.quest_rewards || [],
      quest_prerequisites: assetData.quest_prerequisites || [],

      // Storyline Location properties (for assetType: 'storyline_location')
      location_arc_id: assetData.location_arc_id || null,
      location_mood_tags: assetData.location_mood_tags || [],
      location_interactive_elements: assetData.location_interactive_elements || [],
      location_linked_asset: assetData.location_linked_asset || null,
      location_zone_name: assetData.location_zone_name || null,

      // Storyline Script properties (for assetType: 'storyline_script')
      script_arc_id: assetData.script_arc_id || null,
      script_scene_title: assetData.script_scene_title || null,
      script_location_id: assetData.script_location_id || null,
      script_scene_description: assetData.script_scene_description || null,
      script_dialogue: assetData.script_dialogue || null,
      script_actions: assetData.script_actions || [],
      script_cinematic_trigger: assetData.script_cinematic_trigger || null,

      // ZONE DATA: Roguelite dungeon/interior map data (for assetType: 'zone')
      zoneData: assetData.zoneData ? {
        type: assetData.zoneData.type || 'dungeon', // dungeon, city, wilderness, ship_interior
        difficulty: assetData.zoneData.difficulty || 1,
        width: assetData.zoneData.width || 50,
        height: assetData.zoneData.height || 50,
        tileSize: assetData.zoneData.tileSize || 32,
        layers: {
          ground: assetData.zoneData.layers?.ground || [],
          walls: assetData.zoneData.layers?.walls || [],
          objects: assetData.zoneData.layers?.objects || [],
          sprites: assetData.zoneData.layers?.sprites || []
        },
        spawnPoints: assetData.zoneData.spawnPoints || [],
        lootTables: assetData.zoneData.lootTables || [],
        enemyPatterns: assetData.zoneData.enemyPatterns || [],
        lighting: assetData.zoneData.lighting || 'normal',
        musicTrack: assetData.zoneData.musicTrack || null,
        ambientSounds: assetData.zoneData.ambientSounds || []
      } : null,

      // SPRITE DATA: Sprite/visual element data (for assetType: 'sprite')
      spriteData: assetData.spriteData ? {
        spriteSheet: assetData.spriteData.spriteSheet || null,
        spriteSheetId: assetData.spriteData.spriteSheetId ? new ObjectId(assetData.spriteData.spriteSheetId) : null,
        frame: assetData.spriteData.frame || 0,
        frameCount: assetData.spriteData.frameCount || 1,
        width: assetData.spriteData.width || 32,
        height: assetData.spriteData.height || 32,
        collision: assetData.spriteData.collision || { x: 0, y: 0, w: 32, h: 32 },
        solid: assetData.spriteData.solid || false,
        interactive: assetData.spriteData.interactive || false,
        interactionType: assetData.spriteData.interactionType || null, // door, chest, npc, lever, etc.
        animationSpeed: assetData.spriteData.animationSpeed || 100,
        properties: assetData.spriteData.properties || {}
      } : null,

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
   * Get assets by multiple types (for physics/gravity calculations)
   */
  static async getByTypes(types = []) {
    const db = getDb();
    // Build query - don't require status for galactic objects (galaxy, anomaly)
    const query = {
      assetType: { $in: types },
      coordinates: { $exists: true }
    };

    // Only filter by status for non-galactic objects
    const galacticTypes = ['galaxy', 'anomaly'];
    const hasNonGalactic = types.some(t => !galacticTypes.includes(t));
    if (hasNonGalactic) {
      query.status = 'approved';
    }

    return await db.collection(collections.assets)
      .find(query)
      .project({
        _id: 1,
        title: 1,
        assetType: 1,
        coordinates: 1,
        physics: 1, // Include physics field
        stats: 1,
        parentId: 1, // Include parent for connections
        parentType: 1
      })
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

  /**
   * ========================================
   * HIERARCHICAL ASSET SYSTEM METHODS (NEW)
   * ========================================
   */

  /**
   * Link child asset to parent asset
   */
  static async linkToParent(childId, parentId, parentType) {
    const db = getDb();

    const parent = await this.findById(parentId);
    if (!parent) {
      throw new Error('Parent asset not found');
    }

    // Calculate depth (parent's depth + 1)
    const depth = (parent.hierarchy?.depth || 0) + 1;

    // Build path (parent's path + parent ID)
    const path = [...(parent.hierarchy?.path || []), new ObjectId(parentId)];

    // Update child with parent info
    await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(childId) },
      {
        $set: {
          'hierarchy.parent': new ObjectId(parentId),
          'hierarchy.parentType': parentType,
          'hierarchy.depth': depth,
          'hierarchy.path': path,
          updatedAt: new Date()
        }
      }
    );

    // Add child to parent's children array
    await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(parentId) },
      {
        $addToSet: {
          'hierarchy.children': new ObjectId(childId)
        },
        $set: { updatedAt: new Date() }
      }
    );

    return true;
  }

  /**
   * Get full hierarchy tree starting from asset
   */
  static async getHierarchyTree(assetId, maxDepth = 5) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset) return null;

    // Recursive function to build tree
    const buildTree = async (node, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return node;

      const children = await db.collection(collections.assets)
        .find({ 'hierarchy.parent': node._id })
        .toArray();

      node.children = await Promise.all(
        children.map(child => buildTree(child, currentDepth + 1))
      );

      return node;
    };

    return await buildTree(asset);
  }

  /**
   * Get all ancestors of an asset (path to root)
   */
  static async getAncestors(assetId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset || !asset.hierarchy?.path) return [];

    const ancestorIds = asset.hierarchy.path;
    const ancestors = await db.collection(collections.assets)
      .find({ _id: { $in: ancestorIds } })
      .toArray();

    // Sort by depth to maintain order
    return ancestors.sort((a, b) =>
      (a.hierarchy?.depth || 0) - (b.hierarchy?.depth || 0)
    );
  }

  /**
   * Get all descendants of an asset
   */
  static async getDescendants(assetId, maxDepth = 10) {
    const db = getDb();
    const descendants = [];

    const fetchChildren = async (parentId, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return;

      const children = await db.collection(collections.assets)
        .find({ 'hierarchy.parent': new ObjectId(parentId) })
        .toArray();

      descendants.push(...children);

      for (const child of children) {
        await fetchChildren(child._id, currentDepth + 1);
      }
    };

    await fetchChildren(assetId);
    return descendants;
  }

  /**
   * Get siblings of an asset (shares same parent)
   */
  static async getSiblings(assetId) {
    const db = getDb();
    const asset = await this.findById(assetId);

    if (!asset || !asset.hierarchy?.parent) return [];

    return await db.collection(collections.assets)
      .find({
        'hierarchy.parent': asset.hierarchy.parent,
        _id: { $ne: asset._id }
      })
      .toArray();
  }

  /**
   * Unlink asset from parent
   */
  static async unlinkFromParent(childId) {
    const db = getDb();
    const child = await this.findById(childId);

    if (!child || !child.hierarchy?.parent) return false;

    const parentId = child.hierarchy.parent;

    // Remove child from parent's children array
    await db.collection(collections.assets).updateOne(
      { _id: parentId },
      {
        $pull: { 'hierarchy.children': new ObjectId(childId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Clear child's parent info
    await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(childId) },
      {
        $set: {
          'hierarchy.parent': null,
          'hierarchy.parentType': null,
          'hierarchy.depth': 0,
          'hierarchy.path': [],
          updatedAt: new Date()
        }
      }
    );

    return true;
  }

  /**
   * Move asset to new parent
   */
  static async moveToNewParent(childId, newParentId, newParentType) {
    await this.unlinkFromParent(childId);
    await this.linkToParent(childId, newParentId, newParentType);
    return true;
  }

  /**
   * Find assets by status
   */
  static async findByStatus(status) {
    const db = getDb();
    return await db.collection(collections.assets)
      .find({ status: status })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Get asset statistics
   */
  static async getStats() {
    const db = getDb();
    const stats = await db.collection(collections.assets).aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Convert to object format
    const result = {
      pending: 0,
      approved: 0,
      rejected: 0,
      submitted: 0
    };

    stats.forEach(stat => {
      if (stat._id && result.hasOwnProperty(stat._id)) {
        result[stat._id] = stat.count;
      }
    });

    return result;
  }

  /**
   * Approve an asset
   */
  static async approve(assetId, adminId, adminNotes = null) {
    const db = getDb();

    const updateData = {
      status: 'approved',
      approvedBy: new ObjectId(adminId),
      approvedAt: new Date(),
      updatedAt: new Date()
    };

    if (adminNotes) {
      updateData.adminNotes = adminNotes;
    }

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      { $set: updateData }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Reject an asset
   */
  static async reject(assetId, adminId, adminNotes) {
    const db = getDb();

    if (!adminNotes) {
      throw new Error('Admin notes required for rejection');
    }

    const result = await db.collection(collections.assets).updateOne(
      { _id: new ObjectId(assetId) },
      {
        $set: {
          status: 'rejected',
          rejectedBy: new ObjectId(adminId),
          rejectedAt: new Date(),
          adminNotes: adminNotes,
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount > 0;
  }
}

export default Asset;
