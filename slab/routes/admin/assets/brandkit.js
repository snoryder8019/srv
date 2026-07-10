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

router.get('/clients', async (req, res) => {
  try {
    const db = req.db;
    const clients = await db.collection('clients')
      .find({}, { projection: { name: 1, company: 1, brandColors: 1, brandFonts: 1, status: 1 } })
      .sort({ name: 1 }).toArray();
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/brand-kit/:type/:id — unified brand kit for tenant or client
// type = "tenant" (id ignored) or "client" (id = client _id)
router.get('/brand-kit/:type/:id?', async (req, res) => {
  try {
    const db = req.db;
    const { type } = req.params;

    if (type === 'tenant') {
      // Load tenant design settings
      const rawDesign = await db.collection('design').find({}).toArray();
      const design = {};
      for (const item of rawDesign) design[item.key] = item.value;
      const brand = req.tenant?.brand || {};

      // Build palette from design colors
      const colors = [
        design.color_primary || '#1C2B4A',
        design.color_accent || '#C9A848',
        design.color_bg || '#F5F3EF',
        design.color_primary_deep || '#0F1B30',
        design.color_primary_mid || '#2E4270',
        design.color_accent_light || '#E8D08A',
      ].filter(Boolean);

      // Load brand images for logo
      const brandImages = await db.collection('brand_images').find({}).toArray();
      const logo = brandImages.find(b => b.slot === 'logo_primary')?.url || null;

      // Load presets tagged to tenant (no clientId)
      const presets = await db.collection('social_presets')
        .find({ $or: [{ clientId: null }, { clientId: '' }, { clientId: { $exists: false } }, { brandTarget: 'tenant' }] })
        .sort({ updatedAt: -1 }).toArray();

      res.json({
        type: 'tenant',
        name: brand.name || 'My Brand',
        colors,
        fonts: {
          heading: design.font_heading || 'Cormorant Garamond',
          body: design.font_body || 'Jost',
        },
        logo,
        presets,
      });
    } else if (type === 'client') {
      const clientId = req.params.id;
      if (!clientId) return res.status(400).json({ error: 'Client ID required' });
      const client = await db.collection('clients').findOne({ _id: new ObjectId(clientId) });
      if (!client) return res.status(404).json({ error: 'Client not found' });

      const presets = await db.collection('social_presets')
        .find({ $or: [{ clientId }, { brandTarget: clientId }] })
        .sort({ updatedAt: -1 }).toArray();

      res.json({
        type: 'client',
        _id: client._id,
        name: client.company || client.name,
        colors: client.brandColors || [],
        fonts: client.brandFonts || { heading: '', body: '' },
        presets,
      });
    } else {
      res.status(400).json({ error: 'Type must be "tenant" or "client"' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/brand-kit/:type/:id? — save brand colors/fonts back
router.put('/brand-kit/:type/:id?', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { type } = req.params;
    const { colors, fonts } = req.body;

    if (type === 'tenant') {
      // Update design color settings
      if (colors?.length >= 3) {
        const colorKeys = ['color_primary', 'color_accent', 'color_bg', 'color_primary_deep', 'color_primary_mid', 'color_accent_light'];
        const ops = colors.slice(0, 6).map((val, i) =>
          db.collection('design').updateOne(
            { key: colorKeys[i] },
            { $set: { key: colorKeys[i], value: val, updatedAt: new Date() } },
            { upsert: true }
          )
        );
        await Promise.all(ops);
      }
      if (fonts) {
        const fontOps = [];
        if (fonts.heading) fontOps.push(db.collection('design').updateOne({ key: 'font_heading' }, { $set: { key: 'font_heading', value: fonts.heading, updatedAt: new Date() } }, { upsert: true }));
        if (fonts.body) fontOps.push(db.collection('design').updateOne({ key: 'font_body' }, { $set: { key: 'font_body', value: fonts.body, updatedAt: new Date() } }, { upsert: true }));
        if (fontOps.length) await Promise.all(fontOps);
      }
      res.json({ success: true });
    } else if (type === 'client') {
      const clientId = req.params.id;
      if (!clientId) return res.status(400).json({ error: 'Client ID required' });
      const $set = { updatedAt: new Date() };
      if (colors) $set.brandColors = colors;
      if (fonts) $set.brandFonts = fonts;
      await db.collection('clients').updateOne({ _id: new ObjectId(clientId) }, { $set });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Type must be "tenant" or "client"' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM FOLDERS ──

// GET /admin/assets/folders — list custom folders

export default router;
