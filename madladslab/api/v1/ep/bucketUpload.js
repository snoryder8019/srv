import express from 'express';
const router = express.Router();
import multer from 'multer';
import Asset from '../models/Asset.js';
import { uploadToLinode, deleteFromLinode } from '../../../lib/linodeStorage.js';
import crypto from 'crypto';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept images, videos, 3D objects, documents
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/avi',
      'application/pdf',
      'model/obj', 'model/gltf+json', 'model/gltf-binary'
    ];

    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(obj|gltf|glb|fbx|dae)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: images, videos, 3D objects, PDFs'));
    }
  }
});

/**
 * Helper: Determine file type from mimetype
 */
function getFileType(mimetype, filename) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype === 'application/pdf') return 'document';
  if (mimetype.startsWith('model/') || filename.match(/\.(obj|gltf|glb|fbx|dae)$/i)) return 'object';
  return 'other';
}

/**
 * Helper: Generate unique filename
 */
function generateUniqueFilename(originalFilename) {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const extension = originalFilename.split('.').pop();
  return `${timestamp}-${randomString}.${extension}`;
}

/**
 * POST /api/v1/bucket/upload
 * Upload file(s) to Linode bucket
 */
router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { bucket, subdirectory, visibility, tags, linkedTo } = req.body;

    if (!bucket) {
      return res.status(400).json({ error: 'Bucket is required' });
    }

    const uploadedAssets = [];

    for (const file of req.files) {
      const filename = generateUniqueFilename(file.originalname);
      const fileType = getFileType(file.mimetype, file.originalname);

      // Build bucket path
      const bucketPath = subdirectory
        ? `${bucket}/${subdirectory}/${filename}`
        : `${bucket}/${filename}`;

      // Upload to Linode
      const publicUrl = await uploadToLinode(file.buffer, file.originalname, bucketPath.replace(`/${filename}`, ''));

      // Create Asset record
      const asset = new Asset({
        filename,
        originalName: file.originalname,
        bucket,
        subdirectory: subdirectory || '',
        bucketPath,
        publicUrl,
        fileType,
        mimeType: file.mimetype,
        size: file.size,
        visibility: visibility || 'public',
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
        uploadedBy: req.user ? req.user._id : null,
        linkedTo: linkedTo ? JSON.parse(linkedTo) : null
      });

      await asset.save();
      uploadedAssets.push(asset);
    }

    res.json({
      success: true,
      assets: uploadedAssets
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/bucket/assets
 * List assets with filters
 */
router.get('/assets', async (req, res) => {
  try {
    const { bucket, subdirectory, fileType, search, limit = 50, skip = 0 } = req.query;

    const query = {};
    if (bucket) query.bucket = bucket;
    if (subdirectory !== undefined) query.subdirectory = subdirectory;
    if (fileType) query.fileType = fileType;
    if (search) {
      query.$or = [
        { originalName: new RegExp(search, 'i') },
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { tags: new RegExp(search, 'i') }
      ];
    }

    const assets = await Asset.find(query)
      .sort({ uploadedAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('uploadedBy', 'displayName email');

    const total = await Asset.countDocuments(query);

    res.json({
      success: true,
      assets,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });

  } catch (error) {
    console.error('List assets error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/bucket/directories
 * Get directory tree with file counts
 */
router.get('/directories', async (req, res) => {
  try {
    const buckets = ['madladslab', 'acm', 'sna', 'twww', 'ps', 'graffiti-tv', 'nocometalworkz', 'sfg', 'madThree', 'w2MongoClient', 'servers'];

    const tree = [];

    for (const bucket of buckets) {
      // Get all unique subdirectories for this bucket
      const subdirs = await Asset.distinct('subdirectory', { bucket });

      // Get file count for root of bucket
      const rootCount = await Asset.countDocuments({ bucket, subdirectory: '' });

      const bucketNode = {
        name: bucket,
        path: bucket,
        type: 'bucket',
        count: rootCount,
        children: []
      };

      // Add subdirectories
      for (const subdir of subdirs) {
        if (subdir) {
          const count = await Asset.countDocuments({ bucket, subdirectory: subdir });
          bucketNode.children.push({
            name: subdir,
            path: `${bucket}/${subdir}`,
            type: 'directory',
            count
          });
        }
      }

      tree.push(bucketNode);
    }

    res.json({ success: true, tree });

  } catch (error) {
    console.error('Get directories error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bucket/directory
 * Create new subdirectory by uploading a .keep placeholder file
 */
router.post('/directory', async (req, res) => {
  try {
    const { bucket, subdirectory } = req.body;

    if (!bucket || !subdirectory) {
      return res.status(400).json({ error: 'Bucket and subdirectory are required' });
    }

    // Validate subdirectory name (alphanumeric, dashes, underscores, slashes)
    if (!/^[a-zA-Z0-9\-_\/]+$/.test(subdirectory)) {
      return res.status(400).json({ error: 'Invalid subdirectory name' });
    }

    // Create a .keep file to establish the directory in S3
    // S3 doesn't have true directories, so we need at least one object
    const keepFileContent = Buffer.from(JSON.stringify({
      created: new Date().toISOString(),
      type: 'directory_placeholder',
      message: 'This file maintains the directory structure in object storage'
    }, null, 2));

    const bucketPath = `${bucket}/${subdirectory}`;

    // Upload .keep file to Linode (preserve exact filename)
    const publicUrl = await uploadToLinode(keepFileContent, '.keep', bucketPath, true);

    // Create Asset record for the .keep file
    const asset = new Asset({
      filename: '.keep',
      originalName: '.keep',
      bucket,
      subdirectory,
      bucketPath: `${bucketPath}/.keep`,
      publicUrl,
      fileType: 'other',
      mimeType: 'application/json',
      size: keepFileContent.length,
      visibility: 'public',
      tags: ['directory', 'placeholder'],
      uploadedBy: req.user ? req.user._id : null
    });

    await asset.save();

    res.json({
      success: true,
      message: `Subdirectory ${bucket}/${subdirectory} created successfully`,
      asset
    });

  } catch (error) {
    console.error('Create directory error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/bucket/asset/:id
 * Get single asset
 */
router.get('/asset/:id', async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('uploadedBy', 'displayName email');

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({ success: true, asset });

  } catch (error) {
    console.error('Get asset error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/bucket/asset/:id
 * Update asset metadata
 */
router.put('/asset/:id', async (req, res) => {
  try {
    const { title, description, tags, visibility, linkedTo } = req.body;

    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Update fields
    if (title !== undefined) asset.title = title;
    if (description !== undefined) asset.description = description;
    if (tags !== undefined) asset.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    if (visibility !== undefined) asset.visibility = visibility;
    if (linkedTo !== undefined) asset.linkedTo = linkedTo;

    await asset.save();

    res.json({ success: true, asset });

  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bucket/asset/:id/move
 * Move asset to different directory
 */
router.post('/asset/:id/move', async (req, res) => {
  try {
    const { newBucket, newSubdirectory } = req.body;

    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Update bucket path
    const oldBucketPath = asset.bucketPath;
    const newBucketPath = newSubdirectory
      ? `${newBucket}/${newSubdirectory}/${asset.filename}`
      : `${newBucket}/${asset.filename}`;

    // Note: In production, you'd actually move the file in Linode
    // For now, we'll just update the metadata
    asset.bucket = newBucket;
    asset.subdirectory = newSubdirectory || '';
    asset.bucketPath = newBucketPath;

    // Update public URL
    const region = 'us-ord-1';
    const bucketName = process.env.S3_LOCATION;
    asset.publicUrl = `https://${bucketName}.${region}.linodeobjects.com/${newBucketPath}`;

    await asset.save();

    res.json({
      success: true,
      message: `Moved from ${oldBucketPath} to ${newBucketPath}`,
      asset
    });

  } catch (error) {
    console.error('Move asset error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/bucket/asset/:id
 * Delete asset from bucket and database
 */
router.delete('/asset/:id', async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Delete from Linode
    try {
      await deleteFromLinode(asset.publicUrl);
    } catch (linodeError) {
      console.error('Error deleting from Linode:', linodeError);
      // Continue anyway to delete from DB
    }

    // Delete from database
    await Asset.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: `Deleted ${asset.originalName}`
    });

  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/bucket/stats
 * Get bucket statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const totalAssets = await Asset.countDocuments();
    const totalSize = await Asset.aggregate([
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]);

    const byBucket = await Asset.aggregate([
      { $group: { _id: '$bucket', count: { $sum: 1 }, size: { $sum: '$size' } } }
    ]);

    const byType = await Asset.aggregate([
      { $group: { _id: '$fileType', count: { $sum: 1 }, size: { $sum: '$size' } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalAssets,
        totalSize: totalSize[0]?.total || 0,
        byBucket,
        byType
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bucket/trim-video
 * Upload trimmed video (trimming done client-side)
 */
router.post('/trim-video', upload.single('video'), async (req, res) => {
  try {
    const { startTime, endTime, bucket, subdirectory, filename } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!bucket) {
      return res.status(400).json({ error: 'Bucket is required' });
    }

    // Use provided filename or generate unique one
    const trimmedFilename = filename || generateUniqueFilename(req.file.originalname);
    const fileType = 'video';

    // Build bucket path
    const bucketPath = subdirectory
      ? `${bucket}/${subdirectory}/${trimmedFilename}`
      : `${bucket}/${trimmedFilename}`;

    // Upload to Linode
    const publicUrl = await uploadToLinode(
      req.file.buffer,
      req.file.originalname,
      bucketPath.replace(`/${trimmedFilename}`, '')
    );

    // Create Asset record
    const asset = new Asset({
      filename: trimmedFilename,
      originalName: req.file.originalname,
      bucket,
      subdirectory: subdirectory || '',
      bucketPath,
      publicUrl,
      fileType,
      mimeType: req.file.mimetype,
      size: req.file.size,
      visibility: 'public',
      tags: ['trimmed', 'video'],
      uploadedBy: req.user ? req.user._id : null,
      title: `Trimmed: ${req.file.originalname}`,
      description: `Trimmed from ${startTime}s to ${endTime}s`
    });

    await asset.save();

    res.json({
      success: true,
      asset,
      message: 'Trimmed video uploaded successfully'
    });

  } catch (error) {
    console.error('Trim and upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
