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

router.get('/channels', (req, res) => {
  const channels = PLATFORM_LIST
    .filter(p => !p.comingSoon)
    .map(p => ({ key: p.key, name: p.name, icon: p.icon, color: p.color }));
  res.json({ channels });
});

// GET /admin/assets/campaigns — list named campaigns (collections)
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await req.db.collection('asset_campaigns').find({}).sort({ name: 1 }).toArray();
    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/campaigns — create a campaign
router.post('/campaigns', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Campaign name required' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid campaign name' });
    const existing = await db.collection('asset_campaigns').findOne({ slug });
    if (existing) return res.status(400).json({ error: 'Campaign already exists' });
    const doc = { name, slug, createdAt: new Date() };
    const r = await db.collection('asset_campaigns').insertOne(doc);
    res.json({ success: true, campaign: { ...doc, _id: r.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/campaigns/:id — rename a campaign (retags member assets)
router.put('/campaigns/:id', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('asset_campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Campaign name required' });
    const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!newSlug) return res.status(400).json({ error: 'Invalid campaign name' });
    const dup = await db.collection('asset_campaigns').findOne({ slug: newSlug, _id: { $ne: campaign._id } });
    if (dup) return res.status(400).json({ error: 'A campaign with that name already exists' });
    const oldSlug = campaign.slug;
    await db.collection('asset_campaigns').updateOne({ _id: campaign._id }, { $set: { name, slug: newSlug, updatedAt: new Date() } });
    if (oldSlug !== newSlug) {
      await db.collection('assets').updateMany({ campaigns: oldSlug }, { $set: { 'campaigns.$': newSlug } });
    }
    res.json({ success: true, campaign: { _id: campaign._id, name, slug: newSlug } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/campaigns/:id — delete a campaign (untags member assets)
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('asset_campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    await db.collection('assets').updateMany({ campaigns: campaign.slug }, { $pull: { campaigns: campaign.slug } });
    await db.collection('asset_campaigns').deleteOne({ _id: campaign._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ACCOUNT RESOURCES (static per-channel brand assets: avatar/banner/…) ──────

// Build the per-platform resource view: each platform with slots gets its slot
// list + the currently-assigned asset (if any) + connection status.

export default router;
