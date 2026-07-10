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

router.get('/social/presets', async (req, res) => {
  try {
    const db = req.db;
    const query = {};
    if (req.query.clientId) query.clientId = req.query.clientId;
    const presets = await db.collection('social_presets')
      .find(query).sort({ updatedAt: -1 }).toArray();
    res.json({ presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social/presets — save a new preset
router.post('/social/presets', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, canvasW, canvasH, sizePreset, bgColor, bgTransparent, palette, layers, clientId, folder, brandTarget } = req.body;
    const doc = {
      name: name || 'Untitled',
      canvasW: canvasW || 1080,
      canvasH: canvasH || 1080,
      sizePreset: sizePreset || 'ig-post',
      bgColor: bgColor || '#F5F3EF',
      bgTransparent: !!bgTransparent,
      palette: palette || [],
      layers: layers || [],
      clientId: clientId || null,
      brandTarget: brandTarget || 'tenant',
      folder: folder || 'clients',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = await db.collection('social_presets').insertOne(doc);
    res.json({ success: true, preset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/social/presets/:id
router.get('/social/presets/:id', async (req, res) => {
  try {
    const db = req.db;
    const preset = await db.collection('social_presets').findOne({ _id: new ObjectId(req.params.id) });
    if (!preset) return res.status(404).json({ error: 'Not found' });
    res.json({ preset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/social/presets/:id — update existing preset
router.put('/social/presets/:id', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, canvasW, canvasH, sizePreset, bgColor, bgTransparent, palette, layers, clientId, folder, brandTarget } = req.body;
    const $set = { updatedAt: new Date() };
    if (name !== undefined) $set.name = name;
    if (canvasW !== undefined) $set.canvasW = canvasW;
    if (canvasH !== undefined) $set.canvasH = canvasH;
    if (sizePreset !== undefined) $set.sizePreset = sizePreset;
    if (bgColor !== undefined) $set.bgColor = bgColor;
    if (bgTransparent !== undefined) $set.bgTransparent = !!bgTransparent;
    if (palette !== undefined) $set.palette = palette;
    if (layers !== undefined) $set.layers = layers;
    if (clientId !== undefined) $set.clientId = clientId || null;
    if (brandTarget !== undefined) $set.brandTarget = brandTarget || 'tenant';
    if (folder !== undefined) $set.folder = folder;
    await db.collection('social_presets').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/social/presets/:id
router.delete('/social/presets/:id', async (req, res) => {
  try {
    const db = req.db;
    const id = req.params.id;
    await db.collection('social_presets').deleteOne({ _id: new ObjectId(id) });
    // Also remove the linked library snapshot asset (image + thumb), if any.
    const linked = await db.collection('assets').findOne({ editorPresetId: id });
    if (linked) {
      if (linked.bucketKey && config.LINODE_KEY) {
        try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: linked.bucketKey })); }
        catch (e) { console.warn('S3 preset-asset delete warning:', e.message); }
      }
      await deleteThumb(linked);
      await deleteWebVariant(linked);
      await db.collection('assets').deleteOne({ _id: linked._id });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social/presets/:id/snapshot — upsert a library asset that
// mirrors the latest rendered state of a saved generator. One asset per preset
// (keyed by `editorPresetId`); re-saving replaces its image so the grid card
// always shows the current design and links back into the editor for "Edit".
router.post('/social/presets/:id/snapshot', assetMem.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const presetId = req.params.id;
    if (!ObjectId.isValid(presetId)) return res.status(400).json({ error: 'Invalid id' });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }
    const preset = await db.collection('social_presets').findOne({ _id: new ObjectId(presetId) });
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    if (req.tenant && await wouldExceedQuota(db, req.tenant, req.file.size || 0)) {
      return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const folder = preset.folder || 'clients';
    const title = preset.name || 'Saved Generator';
    const name = `${title.replace(/\s+/g, '-')}-design.png`;
    const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, 'image/png', req.tenant?.s3Prefix);
    const { thumbUrl = null, thumbKey = null } = await tryThumb(req.file.buffer, key);
    const { webUrl = null, webKey = null, webSize = null } = await tryWebVariant(req.file.buffer, key, 'image/png');

    const existing = await db.collection('assets').findOne({ editorPresetId: presetId });
    if (existing) {
      // Swap in the fresh render; best-effort delete of the superseded files.
      if (existing.bucketKey && existing.bucketKey !== key && config.LINODE_KEY) {
        try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existing.bucketKey })); }
        catch (e) { console.warn('S3 snapshot replace warning:', e.message); }
      }
      await deleteThumb(existing);
      await deleteWebVariant(existing);
      await db.collection('assets').updateOne({ _id: existing._id }, { $set: {
        filename, originalName: name, folders: [folder], folder,
        clientId: preset.clientId || null, publicUrl: url, bucketKey: key,
        thumbUrl, thumbKey, webUrl, webKey, webSize, size: req.file.size, title, updatedAt: new Date(),
      }});
      return res.json({ success: true, assetId: existing._id });
    }

    const doc = {
      filename, originalName: name, folders: [folder], folder,
      clientId: preset.clientId || null, publicUrl: url, bucketKey: key,
      thumbUrl, thumbKey, webUrl, webKey, webSize, fileType: 'image', mimeType: 'image/png', size: req.file.size,
      title, tags: ['generator', 'editable'],
      editorPresetId: presetId,
      source: { type: 'generator', presetId },
      uploadedAt: new Date(),
    };
    const r = await db.collection('assets').insertOne(doc);
    res.json({ success: true, assetId: r.insertedId });
  } catch (err) {
    console.error('[preset snapshot] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/list — JSON API with filtering

export default router;
