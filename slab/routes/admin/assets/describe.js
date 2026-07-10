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

router.post('/:id/describe', express.json(), async (req, res) => {
  try {
    const asset = await req.db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ success: false, error: 'Not found' });
    const meta = await describeAssetDoc(asset);
    await req.db.collection('assets').updateOne({ _id: asset._id }, { $set: { ...meta, aiDescribed: true, describedAt: new Date() } });
    res.json({ success: true, ...meta });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Backfill metadata for a folder (default: auto) — skips already-described
router.post('/metadata/backfill', express.json(), async (req, res) => {
  try {
    const folder = (req.body?.folder || 'auto').toString();
    const limit = Math.max(1, Math.min(40, parseInt(req.body?.limit, 10) || 20));
    const assets = await req.db.collection('assets')
      .find({ folder, fileType: 'image', aiDescribed: { $ne: true } }).limit(limit).toArray();
    let done = 0;
    for (const a of assets) {
      try { const meta = await describeAssetDoc(a); await req.db.collection('assets').updateOne({ _id: a._id }, { $set: { ...meta, aiDescribed: true, describedAt: new Date() } }); done++; } catch {}
    }
    res.json({ success: true, scanned: assets.length, described: done });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── VISION DESCRIBE (an AI that actually *looks* at the image) ────────────────
// Two steps: (1) a vision model produces a factual description of the pixels,
// (2) the text model formats that into accessibility-ready altText + caption +
// tags. Two small models beat asking one tiny vision model for strict JSON.
router.post('/:id/vision-describe', express.json(), async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    const asset = await req.db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ success: false, error: 'Not found' });
    if (asset.fileType !== 'image') return res.status(400).json({ success: false, error: 'Only images can be described', skipped: true });
    // Vision models need raster pixels — SVGs without a generated thumbnail can't be read.
    if (asset.mimeType === 'image/svg+xml' && !asset.thumbKey && !asset.thumbUrl) {
      return res.status(400).json({ success: false, error: 'Vector image has no raster preview to view', skipped: true });
    }

    const imageBuffer = await loadAssetImageBuffer(asset);
    const meta = await visionDescribeAsset(asset, imageBuffer);
    await req.db.collection('assets').updateOne(
      { _id: asset._id },
      { $set: { ...meta, aiDescribed: true, aiVision: true, describedAt: new Date() } }
    );
    res.json({ success: true, ...meta });
  } catch (e) {
    console.error('[vision-describe] error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});


export default router;
