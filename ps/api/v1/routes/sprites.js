/**
 * Sprite API Routes
 * Handles sprite creation, import, and zone assignment
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { Asset } from '../models/Asset.js';
import { isAuthenticated } from '../../../utilities/helpers.js';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for sprite uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../../public/uploads/sprites'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'sprite-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * POST /api/v1/sprites/import
 * Bulk import sprites from JSON definition
 */
router.post('/import', isAuthenticated, upload.single('spriteSheet'), async (req, res) => {
  try {
    const { definition, zoneId } = req.body;

    if (!definition) {
      return res.status(400).json({
        success: false,
        error: 'JSON definition is required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Sprite sheet image is required'
      });
    }

    // Parse JSON definition
    const data = JSON.parse(definition);
    const spriteSheetPath = `/uploads/sprites/${req.file.filename}`;

    // Create sprite sheet asset first
    const spriteSheetAsset = await Asset.create({
      userId: req.user._id,
      title: data.name,
      description: `Sprite sheet: ${data.name}`,
      assetType: 'sprite_sheet',
      images: {
        fullscreen: spriteSheetPath,
        indexCard: spriteSheetPath
      }
    });

    // Create individual sprite assets
    const createdSprites = [];
    for (const spriteData of data.sprites) {
      const sprite = await Asset.create({
        userId: req.user._id,
        title: spriteData.name,
        description: spriteData.description || `Sprite from ${data.name}`,
        assetType: 'sprite',
        spriteData: {
          spriteSheet: data.name,
          spriteSheetId: spriteSheetAsset._id,
          frame: spriteData.frame || 0,
          frameCount: spriteData.frameCount || 1,
          width: data.tileWidth,
          height: data.tileHeight,
          collision: spriteData.collision || { x: 0, y: 0, w: data.tileWidth, h: data.tileHeight },
          solid: spriteData.solid || false,
          interactive: spriteData.interactive || false,
          interactionType: spriteData.interactionType || null,
          animationSpeed: spriteData.animationSpeed || 100,
          properties: spriteData.properties || {}
        },
        hierarchy: zoneId ? {
          parent: new ObjectId(zoneId),
          parentType: 'zone',
          depth: 1
        } : null
      });

      createdSprites.push(sprite);
    }

    // If zone ID provided, link sprites to zone
    if (zoneId) {
      const db = getDb();
      const spriteIds = createdSprites.map(s => s._id);

      await db.collection('assets').updateOne(
        { _id: new ObjectId(zoneId) },
        {
          $push: {
            'zoneData.layers.sprites': {
              $each: spriteIds.map(id => ({ spriteId: id, x: 0, y: 0 }))
            }
          }
        }
      );
    }

    res.json({
      success: true,
      count: createdSprites.length,
      spriteSheetId: spriteSheetAsset._id,
      spriteIds: createdSprites.map(s => s._id)
    });

  } catch (error) {
    console.error('Error importing sprites:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/sprites/create
 * Create individual sprite manually
 */
router.post('/create', isAuthenticated, upload.single('spriteImage'), async (req, res) => {
  try {
    const {
      name,
      description,
      width,
      height,
      frame,
      frameCount,
      animationSpeed,
      solid,
      interactive,
      interactionType,
      collision,
      zoneId,
      spriteSheetId
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Sprite name is required'
      });
    }

    const spriteData = {
      width: parseInt(width) || 32,
      height: parseInt(height) || 32,
      frame: parseInt(frame) || 0,
      frameCount: parseInt(frameCount) || 1,
      animationSpeed: parseInt(animationSpeed) || 100,
      solid: solid === 'true' || solid === true,
      interactive: interactive === 'true' || interactive === true,
      interactionType: interactive ? interactionType : null,
      collision: collision ? JSON.parse(collision) : { x: 0, y: 0, w: 32, h: 32 },
      properties: {}
    };

    // Handle sprite sheet reference or upload
    if (spriteSheetId) {
      spriteData.spriteSheetId = new ObjectId(spriteSheetId);
    } else if (req.file) {
      spriteData.spriteSheet = `/uploads/sprites/${req.file.filename}`;
    }

    const sprite = await Asset.create({
      userId: req.user._id,
      title: name,
      description: description || '',
      assetType: 'sprite',
      spriteData,
      images: req.file ? {
        fullscreen: `/uploads/sprites/${req.file.filename}`,
        indexCard: `/uploads/sprites/${req.file.filename}`
      } : {},
      hierarchy: zoneId ? {
        parent: new ObjectId(zoneId),
        parentType: 'zone',
        depth: 1
      } : null
    });

    // Link to zone if provided
    if (zoneId) {
      const db = getDb();
      await db.collection('assets').updateOne(
        { _id: new ObjectId(zoneId) },
        {
          $push: {
            'zoneData.layers.sprites': { spriteId: sprite._id, x: 0, y: 0 }
          }
        }
      );
    }

    res.json({
      success: true,
      sprite
    });

  } catch (error) {
    console.error('Error creating sprite:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/sprites/library
 * Get all available sprite assets
 */
router.get('/library', isAuthenticated, async (req, res) => {
  try {
    const db = getDb();
    const sprites = await db.collection('assets')
      .find({ assetType: 'sprite' })
      .sort({ title: 1 })
      .toArray();

    res.json({
      success: true,
      sprites
    });

  } catch (error) {
    console.error('Error fetching sprite library:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/sprites/assign-to-zone
 * Assign existing sprites to a zone
 */
router.post('/assign-to-zone', isAuthenticated, async (req, res) => {
  try {
    const { zoneId, spriteIds } = req.body;

    if (!zoneId || !spriteIds || !Array.isArray(spriteIds)) {
      return res.status(400).json({
        success: false,
        error: 'zoneId and spriteIds array are required'
      });
    }

    const db = getDb();

    // Update zone with sprite references
    const spriteReferences = spriteIds.map(id => ({
      spriteId: new ObjectId(id),
      x: 0,
      y: 0
    }));

    await db.collection('assets').updateOne(
      { _id: new ObjectId(zoneId) },
      {
        $push: {
          'zoneData.layers.sprites': { $each: spriteReferences }
        }
      }
    );

    // Update sprite hierarchy to link to zone
    await db.collection('assets').updateMany(
      { _id: { $in: spriteIds.map(id => new ObjectId(id)) } },
      {
        $set: {
          'hierarchy.parent': new ObjectId(zoneId),
          'hierarchy.parentType': 'zone',
          'hierarchy.depth': 1
        }
      }
    );

    res.json({
      success: true,
      assigned: spriteIds.length
    });

  } catch (error) {
    console.error('Error assigning sprites to zone:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/sprites/by-zone/:zoneId
 * Get all sprites assigned to a zone
 */
router.get('/by-zone/:zoneId', isAuthenticated, async (req, res) => {
  try {
    const { zoneId } = req.params;
    const db = getDb();

    // Get zone data
    const zone = await db.collection('assets').findOne({
      _id: new ObjectId(zoneId)
    });

    if (!zone) {
      return res.status(404).json({
        success: false,
        error: 'Zone not found'
      });
    }

    // Get sprite IDs from zone data
    const spriteRefs = zone.zoneData?.layers?.sprites || [];
    const spriteIds = spriteRefs.map(ref => ref.spriteId);

    // Fetch sprite assets
    const sprites = await db.collection('assets')
      .find({ _id: { $in: spriteIds } })
      .toArray();

    res.json({
      success: true,
      sprites
    });

  } catch (error) {
    console.error('Error fetching zone sprites:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
