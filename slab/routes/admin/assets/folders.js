import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../../plugins/s3.js';
import { config } from '../../../config/config.js';
import { callLLM, callVisionLLM, webSearch, tryParseAgentResponse, runTool, generateSdImage, recordTrainingCandidate, buildBrandedSdPrompt } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { buildAssetReferenceIndex, annotateAssets } from '../../../plugins/usageMap.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import { PACKS, getPack, fileUrl, listingUrl } from '../../../data/asset-packs.js';
import { generateThumbnail, deriveThumbKey } from '../../../plugins/thumbnails.js';
import { generateWebVariant, deriveWebKey } from '../../../plugins/webVariant.js';
import {
  PLATFORM_LIST, unpackCredentials, isAccountConfigured,
  resourceSlotsFor, findResourceSlot, slotSupportsPush, pushResource,
} from '../../../plugins/socialPublish.js';
import {
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  fetchPackIndex, SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource, NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE,
  NEEDS_OPTIMIZE, wantsThumb, wantsWeb, describeAssetDoc, visionDescribeAsset,
  loadAssetImageBuffer,
} from './shared.js';

const router = express.Router();

router.get('/folders', async (req, res) => {
  try {
    const db = req.db;
    const folders = await db.collection('asset_folders').find({}).sort({ name: 1 }).toArray();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/folders — create a custom folder
router.post('/folders', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    // Slug: lowercase, alphanumeric + dashes
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid folder name' });
    // Don't collide with built-in folders
    const builtIn = ['all', 'general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];
    if (builtIn.includes(slug)) return res.status(400).json({ error: 'That folder name is reserved' });
    // Don't allow duplicates
    const existing = await db.collection('asset_folders').findOne({ slug });
    if (existing) return res.status(400).json({ error: 'Folder already exists' });
    const doc = { name, slug, createdAt: new Date() };
    const r = await db.collection('asset_folders').insertOne(doc);
    res.json({ success: true, folder: { ...doc, _id: r.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/folders/:id — rename a custom folder
router.put('/folders/:id', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const folder = await db.collection('asset_folders').findOne({ _id: new ObjectId(req.params.id) });
    if (!folder) return res.status(404).json({ error: 'Not found' });
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!newSlug) return res.status(400).json({ error: 'Invalid folder name' });
    const builtIn = ['all', 'general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];
    if (builtIn.includes(newSlug)) return res.status(400).json({ error: 'That folder name is reserved' });
    // Check for duplicate slug (excluding self)
    const dup = await db.collection('asset_folders').findOne({ slug: newSlug, _id: { $ne: folder._id } });
    if (dup) return res.status(400).json({ error: 'A folder with that name already exists' });
    const oldSlug = folder.slug;
    await db.collection('asset_folders').updateOne({ _id: folder._id }, { $set: { name, slug: newSlug, updatedAt: new Date() } });
    // Update all assets that reference the old slug
    if (oldSlug !== newSlug) {
      // Update `folders` array entries
      await db.collection('assets').updateMany(
        { folders: oldSlug },
        { $set: { 'folders.$': newSlug } }
      );
      // Update legacy `folder` field
      await db.collection('assets').updateMany(
        { folder: oldSlug },
        { $set: { folder: newSlug } }
      );
    }
    res.json({ success: true, folder: { _id: folder._id, name, slug: newSlug } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/folders/:id — delete a custom folder
// Assets with ONLY this folder → fully deleted (incl. S3 file)
// Assets with multiple folders → just remove this folder tag
router.delete('/folders/:id', async (req, res) => {
  try {
    const db = req.db;
    const folder = await db.collection('asset_folders').findOne({ _id: new ObjectId(req.params.id) });
    if (!folder) return res.status(404).json({ error: 'Not found' });

    const slug = folder.slug;

    // Find assets that have ONLY this folder (delete them fully)
    const soloAssets = await db.collection('assets').find({
      $or: [
        { folders: [slug] },                             // folders array is exactly [slug]
        { folders: slug, $expr: { $eq: [{ $size: '$folders' }, 1] } },
      ]
    }).toArray();
    // Also catch legacy assets with folder=slug and no folders array
    const legacySolo = await db.collection('assets').find({
      folder: slug,
      $or: [{ folders: { $exists: false } }, { folders: null }, { folders: { $size: 0 } }]
    }).toArray();
    const allSoloAssets = [...soloAssets, ...legacySolo];

    // Delete solo assets from S3
    let s3Deleted = 0;
    for (const asset of allSoloAssets) {
      if (asset.bucketKey && config.LINODE_KEY) {
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
          s3Deleted++;
        } catch (s3Err) {
          console.warn('S3 folder-delete warning:', s3Err.message);
        }
      }
      await deleteThumb(asset);
      await deleteWebVariant(asset);
    }
    // Delete solo assets from DB
    const soloIds = allSoloAssets.map(a => a._id);
    if (soloIds.length) {
      await db.collection('assets').deleteMany({ _id: { $in: soloIds } });
    }

    // For multi-folder assets, just pull this slug
    await db.collection('assets').updateMany(
      { folders: slug },
      { $pull: { folders: slug } }
    );
    // Fix legacy field if it pointed to this folder
    await db.collection('assets').updateMany(
      { folder: slug },
      [{ $set: { folder: { $ifNull: [{ $arrayElemAt: ['$folders', 0] }, 'general'] } } }]
    );

    // Remove the folder record
    await db.collection('asset_folders').deleteOne({ _id: folder._id });

    res.json({ success: true, assetsDeleted: soloIds.length, s3Deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SOCIAL CHANNELS & CAMPAIGNS (asset tagging) ──────────────────────────────

// GET /admin/assets/channels — social platforms an asset can be assigned to.
// Drives the channel checkboxes in the asset editor (excludes coming-soon ones).

export default router;
