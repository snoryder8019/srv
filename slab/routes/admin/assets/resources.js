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

router.get('/resources', (req, res) => {
  res.render('admin/assets/resources', { user: req.adminUser, page: 'resources' });
});

// GET /admin/assets/resources/data — JSON: platforms + slots + assignments
router.get('/resources/data', async (req, res) => {
  try {
    const platforms = await buildResourceView(req.db);
    res.json({ platforms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attempt a live push of one assignment; returns a lastPush record (never throws).
router.post('/resources/assign', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { platform, slot, assetId, push } = req.body || {};
    const slotDef = findResourceSlot(platform, slot);
    if (!slotDef) return res.status(400).json({ error: 'Unknown platform/slot' });
    if (!ObjectId.isValid(assetId || '')) return res.status(400).json({ error: 'Valid assetId required' });
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(assetId) });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.fileType !== 'image') return res.status(400).json({ error: 'Only image assets can be account resources' });

    let lastPush = null;
    if (push && slotDef.push) lastPush = await tryPushResource(db, platform, slot, asset);

    const doc = {
      platform, slot,
      assetId: asset._id, assetUrl: asset.publicUrl, assetTitle: asset.title || asset.originalName || null,
      updatedAt: new Date(), updatedBy: req.adminUser?.email || null,
      ...(lastPush ? { lastPush } : {}),
    };
    await db.collection('social_resources').updateOne(
      { platform, slot }, { $set: doc }, { upsert: true },
    );
    res.json({ success: true, assignment: { ...doc, assetId: String(asset._id) }, lastPush });
  } catch (err) {
    console.error('[resources/assign] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/resources/clear — remove an assignment. Body: { platform, slot }
router.post('/resources/clear', express.json(), async (req, res) => {
  try {
    const { platform, slot } = req.body || {};
    if (!findResourceSlot(platform, slot)) return res.status(400).json({ error: 'Unknown platform/slot' });
    await req.db.collection('social_resources').deleteOne({ platform, slot });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/resources/push — re-apply an existing assignment live.
// Body: { platform, slot }. Only valid for push-capable slots.
router.post('/resources/push', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { platform, slot } = req.body || {};
    const slotDef = findResourceSlot(platform, slot);
    if (!slotDef) return res.status(400).json({ error: 'Unknown platform/slot' });
    if (!slotDef.push) return res.status(400).json({ error: 'This slot cannot be pushed via API — set it in the app' });
    const assignment = await db.collection('social_resources').findOne({ platform, slot });
    if (!assignment) return res.status(404).json({ error: 'Nothing assigned to this slot yet' });
    const asset = assignment.assetId ? await db.collection('assets').findOne({ _id: assignment.assetId }) : null;
    if (!asset) return res.status(404).json({ error: 'Assigned asset no longer exists' });
    const lastPush = await tryPushResource(db, platform, slot, asset);
    await db.collection('social_resources').updateOne({ platform, slot }, { $set: { lastPush } });
    res.json({ success: lastPush?.ok !== false, lastPush });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SOCIAL PRESETS ──

// GET /admin/assets/social/presets — list all saved presets

export default router;
