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

router.get('/packs', (req, res) => {
  res.render('admin/assets/packs', {
    user: req.adminUser,
    page: 'assets',
    packs: PACKS,
  });
});

// GET /admin/assets/packs/:packId/items?q=search&limit=200
router.get('/packs/:packId/items', async (req, res) => {
  try {
    const pack = getPack(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    const q = (req.query.q || '').toLowerCase().trim();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

    const all = await fetchPackIndex(pack);
    const filtered = q ? all.filter(n => n.toLowerCase().includes(q)) : all;
    const items = filtered.slice(0, limit).map(name => ({
      name,
      url: fileUrl(pack, name),
    }));
    res.json({ pack: { id: pack.id, name: pack.name, license: pack.license, source: pack.source }, total: filtered.length, items });
  } catch (err) {
    console.error('[packs] items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/packs/import — body { packId, names: [], folder? }
// Fetches each SVG from jsDelivr, uploads to tenant S3, inserts asset doc.
router.post('/packs/import', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { packId, names, folder = 'icons' } = req.body || {};
    const pack = getPack(packId);
    if (!pack) return res.status(400).json({ error: 'Unknown pack' });
    if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names[] required' });
    if (names.length > 100) return res.status(400).json({ error: 'Max 100 per import' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    const imported = [];
    const errors = [];
    let totalBytes = 0;

    for (const rawName of names) {
      const name = String(rawName).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!name) { errors.push({ name: rawName, error: 'invalid name' }); continue; }
      try {
        const url = fileUrl(pack, name);
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) { errors.push({ name, error: `fetch ${r.status}` }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        totalBytes += buf.length;

        // Quota check after each fetch — fail soft if we run out
        if (req.tenant && await wouldExceedQuota(db, req.tenant, totalBytes)) {
          errors.push({ name, error: 'quota exceeded' });
          break;
        }

        const filename = `${pack.id}-${name}${pack.extension}`;
        const { key, url: publicUrl } = await uploadToLinode(buf, folder, filename, 'image/svg+xml', req.tenant?.s3Prefix);

        const doc = {
          filename: key.split('/').pop(),
          originalName: filename,
          folders: [folder],
          folder,
          clientId: null,
          publicUrl,
          bucketKey: key,
          fileType: 'image',
          mimeType: 'image/svg+xml',
          size: buf.length,
          title: name.replace(/[-_]/g, ' '),
          tags: [pack.id, pack.kind, pack.name.toLowerCase().split(' ')[0]],
          source: { type: 'pack', packId: pack.id, packName: pack.name, license: pack.license, url },
          uploadedAt: new Date(),
        };
        const ins = await db.collection('assets').insertOne(doc);
        imported.push({ ...doc, _id: ins.insertedId });
      } catch (e) {
        errors.push({ name, error: e.message });
      }
    }

    res.json({ success: true, imported, errors, importedCount: imported.length });
  } catch (err) {
    console.error('[packs] import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SD BACKGROUND GENERATION (for social generator frontend) ─────────────────


export default router;
