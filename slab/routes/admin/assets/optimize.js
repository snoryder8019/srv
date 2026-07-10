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

router.get('/thumbnails/status', async (req, res) => {
  try {
    const db = req.db;
    const [remaining, totalImages] = await Promise.all([
      db.collection('assets').countDocuments(NEEDS_OPTIMIZE),
      db.collection('assets').countDocuments({ fileType: 'image' }),
    ]);
    res.json({ remaining, totalImages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Does this asset still need its grid thumbnail?
router.post('/thumbnails/backfill', express.json(), async (req, res) => {
  try {
    const db = req.db;
    if (!config.LINODE_KEY) return res.status(500).json({ error: 'S3 storage not configured' });
    const batch = Math.min(Math.max(Number(req.body?.limit) || 20, 1), 50);

    const assets = await db.collection('assets').find(NEEDS_OPTIMIZE).limit(batch).toArray();
    let processed = 0, skipped = 0;
    for (const a of assets) {
      let buf;
      try {
        const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: a.bucketKey }));
        buf = await streamToBuffer(obj.Body);
      } catch (e) {
        // Couldn't even fetch the source — mark both so we don't loop forever.
        console.warn('Backfill fetch failed for', String(a._id), '-', e.message);
        await db.collection('assets').updateOne({ _id: a._id }, { $set: { thumbSkipped: true, webSkipped: true } });
        skipped++;
        continue;
      }

      const set = {};
      // Thumbnail
      if (wantsThumb(a)) {
        try {
          const t = await uploadThumbnail(buf, a.bucketKey);
          if (t) { set.thumbUrl = t.thumbUrl; set.thumbKey = t.thumbKey; }
          else set.thumbSkipped = true; // can't rasterise — grid falls back to original
        } catch (e) {
          console.warn('Backfill thumb failed for', String(a._id), '-', e.message);
          set.thumbSkipped = true;
        }
      }
      // WebP web variant
      if (wantsWeb(a)) {
        try {
          const w = await uploadWebVariant(buf, a.bucketKey, a.mimeType);
          if (w) { set.webUrl = w.webUrl; set.webKey = w.webKey; set.webSize = w.webSize; }
          else set.webSkipped = true; // vector/animated/undecodable — front-end keeps the original
        } catch (e) {
          console.warn('Backfill web variant failed for', String(a._id), '-', e.message);
          set.webSkipped = true;
        }
      }

      if (Object.keys(set).length) await db.collection('assets').updateOne({ _id: a._id }, { $set: set });
      if (set.thumbUrl || set.webUrl) processed++; else skipped++;
    }
    const remaining = await db.collection('assets').countDocuments(NEEDS_OPTIMIZE);
    res.json({ success: true, processed, skipped, remaining });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/:id/download — stream the asset with attachment headers

export default router;
