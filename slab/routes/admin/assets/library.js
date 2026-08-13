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
import { composeStudioVideo, MAX_COMPOSE_SECONDS } from '../../../plugins/videoCompose.js';
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

router.get('/', (req, res) => {
  res.render('admin/assets/index', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/social — social media asset generator
router.get('/social', (req, res) => {
  res.render('admin/assets/social', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/trim — Video Trimmer disabled for this release
// router.get('/trim', (req, res) => {
//   res.render('admin/assets/trim', { user: req.adminUser, page: 'assets' });
// });

// ── ASSET PACKS (free CC0/MIT icon & illustration libraries) ─────────────────
// In-memory cache of jsDelivr pack listings. Pack indexes are sizable
// (Tabler has ~4k icons) and the upstream API is rate-limited, so we cache
// for the lifetime of the process.
router.get('/export', async (req, res) => {
  try {
    const db = req.db;
    const { folder, clientId, type } = req.query;
    const query = {};
    if (folder && folder !== 'all') {
      query.$or = [{ folders: folder }, { folder: folder }];
    }
    if (clientId) query.clientId = clientId;
    if (type && type !== 'all') query.fileType = type;
    const assets = await db.collection('assets').find(query).sort({ uploadedAt: -1 }).toArray();
    const exported = assets.map(a => {
      normaliseFolders(a);
      return {
        id: a._id,
        title: a.title,
        url: a.publicUrl,
        type: a.fileType,
        folders: a.folders,
        folder: a.folders[0],
        tags: a.tags || [],
        size: a.size,
        clientId: a.clientId || null,
        uploadedAt: a.uploadedAt,
      };
    });
    res.json({ count: exported.length, assets: exported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/clients — lightweight client list for dropdowns (includes brand colors/fonts + status)
router.get('/list', async (req, res) => {
  try {
    const db = req.db;
    const { folder, type, search, clientId, channel, campaign, sort: sortParam, limit = 100, skip = 0 } = req.query;
    const query = {};
    const andClauses = [];
    if (folder && folder !== 'all') {
      // Support both legacy `folder` string and new `folders` array
      andClauses.push({ $or: [{ folders: folder }, { folder: folder }] });
    }
    if (type && type !== 'all') query.fileType = type;
    if (clientId) query.clientId = clientId;
    if (channel) query.channels = channel;
    if (campaign) query.campaigns = campaign;
    if (search) {
      andClauses.push({ $or: [
        { title: { $regex: search, $options: 'i' } },
        { originalName: { $regex: search, $options: 'i' } },
        { tags: { $elemMatch: { $regex: search, $options: 'i' } } },
      ]});
    }
    if (andClauses.length) query.$and = andClauses;

    // Sorting
    let sortObj = { uploadedAt: -1 };
    if (sortParam === 'name') sortObj = { title: 1 };
    else if (sortParam === 'size') sortObj = { size: -1 };
    else if (sortParam === 'oldest') sortObj = { uploadedAt: 1 };

    const [assets, total, refIdx] = await Promise.all([
      db.collection('assets').find(query).sort(sortObj).skip(Number(skip)).limit(Number(limit)).toArray(),
      db.collection('assets').countDocuments(query),
      buildAssetReferenceIndex(db),
    ]);
    res.json({ assets: annotateAssets(assets, refIdx), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/counts — every folder/client badge in one aggregation.
// The folder panel used to fetch the full asset list once per folder just to
// read `total` off it; this replaces N unbounded queries with two grouped ones.
router.get('/counts', async (req, res) => {
  try {
    const col = req.db.collection('assets');
    const [total, byFolder, byClient] = await Promise.all([
      col.countDocuments({}),
      // Assets carry both the `folders` array and the legacy `folder` string;
      // union them so an asset is counted once per folder regardless of shape.
      col.aggregate([
        { $project: { slugs: { $setUnion: [
          { $ifNull: ['$folders', []] },
          { $cond: [{ $ifNull: ['$folder', false] }, ['$folder'], []] },
        ] } } },
        { $unwind: '$slugs' },
        { $group: { _id: '$slugs', n: { $sum: 1 } } },
      ]).toArray(),
      col.aggregate([
        { $match: { clientId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$clientId', n: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const folders = {};
    byFolder.forEach((r) => { if (r._id) folders[String(r._id)] = r.n; });
    const clients = {};
    byClient.forEach((r) => { if (r._id) clients[String(r._id)] = r.n; });

    res.json({ total, folders, clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query fragments for images still missing an optimized derivative (and that
// haven't permanently failed). One backfill pass covers both the grid thumbnail
// and the internet-safe WebP web variant off a single S3 fetch.
router.get('/:id/download', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.status(400).send('Invalid id');
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).send('Not found');
    if (!asset.bucketKey) return res.status(410).send('Asset has no bucket key');

    const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
    const filename = (asset.originalName || asset.filename || 'download').replace(/"/g, '');
    res.setHeader('Content-Type', asset.mimeType || obj.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
    obj.Body.pipe(res);
  } catch (err) {
    console.error('Asset download error:', err);
    res.status(500).send('Download failed');
  }
});

// POST /admin/assets/upload — multi-file upload
router.post('/upload', assetMem.array('files', 20), async (req, res) => {
  try {
    const db = req.db;
    // Support both `folders` (array/CSV) and legacy `folder` (string)
    let folders = req.body.folders;
    if (folders && typeof folders === 'string') folders = folders.split(',').map(f => f.trim()).filter(Boolean);
    if (!folders?.length) folders = [req.body.folder || 'general'];
    const folder = folders[0]; // primary folder for S3 path
    const clientId = req.body.clientId || null;
    if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    // Storage quota check
    const totalUploadSize = req.files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (req.tenant && await wouldExceedQuota(db, req.tenant, totalUploadSize)) {
      const label = getQuotaLabel(req.tenant);
      return res.status(413).json({ error: `Storage limit reached (${label}). Delete files or upgrade your plan.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const results = [];
    for (const file of req.files) {
      const fileType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const { key, url, filename } = await uploadToLinode(file.buffer, folder, file.originalname, file.mimetype, req.tenant?.s3Prefix);
      const { thumbUrl = null, thumbKey = null } = fileType === 'image' ? await tryThumb(file.buffer, key) : {};
      // Internet-safe front-end delivery: WebP variant capped under 1MB. Front-end
      // pages serve `webUrl`; the original stays available for editing/downloads.
      const { webUrl = null, webKey = null, webSize = null } = fileType === 'image'
        ? await tryWebVariant(file.buffer, key, file.mimetype) : {};
      const doc = {
        filename,
        originalName: file.originalname,
        folders,
        folder: folders[0], // legacy compat
        clientId,
        publicUrl: url,
        bucketKey: key,
        thumbUrl,
        thumbKey,
        webUrl,
        webKey,
        webSize,
        fileType,
        mimeType: file.mimetype,
        size: file.size,
        title: file.originalname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        tags: [],
        uploadedAt: new Date(),
      };
      const r = await db.collection('assets').insertOne(doc);
      results.push({ ...doc, _id: r.insertedId });
    }
    res.json({ success: true, assets: results });
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/trim-upload — upload a pre-trimmed video from client-side MediaRecorder
// Video Trimmer disabled for this release
// router.post('/trim-upload', assetMem.single('video'), async (req, res) => {
//   try {
//     const db = req.db;
//     const { folder = 'general', filename: customName, startTime, endTime } = req.body;
//     if (!req.file) return res.status(400).json({ error: 'No file provided' });
//     if (!config.LINODE_KEY || !config.LINODE_SECRET) {
//       return res.status(500).json({ error: 'S3 storage not configured' });
//     }
//     if (req.tenant && await wouldExceedQuota(db, req.tenant, req.file.size || 0)) {
//       return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
//     }
//
//     const name = customName || req.file.originalname;
//     const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, req.file.mimetype, req.tenant?.s3Prefix);
//     const doc = {
//       filename,
//       originalName: name,
//       folders: [folder],
//       folder,
//       publicUrl: url,
//       bucketKey: key,
//       fileType: 'video',
//       mimeType: req.file.mimetype,
//       size: req.file.size,
//       title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
//       tags: ['trimmed'],
//       trimmedFrom: { startTime: parseFloat(startTime) || 0, endTime: parseFloat(endTime) || 0 },
//       uploadedAt: new Date(),
//     };
//     const r = await db.collection('assets').insertOne(doc);
//     res.json({ success: true, asset: { ...doc, _id: r.insertedId } });
//   } catch (err) {
//     console.error('Trim upload error:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// PUT /admin/assets/:id — update metadata
router.put('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { title, tags, folders, folder, clientId, altText, caption, channels, campaigns } = req.body;
    const $set = { updatedAt: new Date() };
    if (title !== undefined) $set.title = title;
    if (altText !== undefined) $set.altText = String(altText).slice(0, 250);
    if (caption !== undefined) $set.caption = String(caption).slice(0, 500);
    // Social channel + campaign assignment (arrays or CSV strings)
    const toSlugArr = (v) => (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean);
    if (channels !== undefined) $set.channels = toSlugArr(channels);
    if (campaigns !== undefined) $set.campaigns = toSlugArr(campaigns);
    // Support `folders` array or legacy `folder` string
    if (folders !== undefined) {
      const arr = Array.isArray(folders) ? folders : folders.split(',').map(f => f.trim()).filter(Boolean);
      $set.folders = arr.length ? arr : ['general'];
      $set.folder = $set.folders[0]; // legacy compat
    } else if (folder !== undefined) {
      $set.folder = folder;
      $set.folders = [folder];
    }
    if (clientId !== undefined) $set.clientId = clientId || null;
    if (tags !== undefined) {
      $set.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    await db.collection('assets').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social-upload — upload a generated social media image
router.post('/social-upload', assetMem.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const { folder = 'clients', title, preset, clientId } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }
    if (req.tenant && await wouldExceedQuota(db, req.tenant, req.file.size || 0)) {
      return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const name = title ? `${title.replace(/\s+/g, '-')}-${preset || 'social'}.png` : req.file.originalname;
    const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, 'image/png', req.tenant?.s3Prefix);
    const { thumbUrl = null, thumbKey = null } = await tryThumb(req.file.buffer, key);
    const { webUrl = null, webKey = null, webSize = null } = await tryWebVariant(req.file.buffer, key, 'image/png');
    const doc = {
      filename,
      originalName: name,
      folders: [folder],
      folder,
      clientId: clientId || null,
      publicUrl: url,
      bucketKey: key,
      thumbUrl,
      thumbKey,
      webUrl,
      webKey,
      webSize,
      fileType: 'image',
      mimeType: 'image/png',
      size: req.file.size,
      title: title || name.replace(/\.[^.]+$/, ''),
      tags: ['social', preset || 'generated'].filter(Boolean),
      generatedFrom: { preset, createdAt: new Date() },
      uploadedAt: new Date(),
    };
    const r = await db.collection('assets').insertOne(doc);
    res.json({ success: true, asset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    console.error('Social upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social-upload-video — flatten a Studio design that has a
// video layer into a real MP4 and store it as a video asset.
//
// The PNG export path above freezes a video layer into a still — which is how a
// video design ended up published as a photo. The client sends the design split
// around the video (under/over PNGs) so ffmpeg can rebuild the exact z-order.
router.post('/social-upload-video', assetMem.fields([{ name: 'under', maxCount: 1 }, { name: 'over', maxCount: 1 }]), async (req, res) => {
  try {
    const db = req.db;
    const { folder = 'clients', title, preset, clientId, videoUrl } = req.body;
    const under = req.files?.under?.[0];
    const over = req.files?.over?.[0];
    if (!under || !over) return res.status(400).json({ error: 'Design layers missing' });
    if (!videoUrl) return res.status(400).json({ error: 'No video layer in this design' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    let box;
    try { box = JSON.parse(req.body.box || '{}'); }
    catch { return res.status(400).json({ error: 'Bad video placement data' }); }
    if (!(box.w > 0 && box.h > 0)) return res.status(400).json({ error: 'Bad video placement data' });

    const { buffer, seconds } = await composeStudioVideo({
      videoUrl,
      underPng: under.buffer,
      overPng: over.buffer,
      canvasW: Number(req.body.canvasW) || 1080,
      canvasH: Number(req.body.canvasH) || 1080,
      box,
    });

    // Quota is checked against the ENCODED size — the composite, not the inputs.
    if (req.tenant && await wouldExceedQuota(db, req.tenant, buffer.length)) {
      return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const name = `${(title || 'social-asset').replace(/\s+/g, '-')}-${preset || 'social'}.mp4`;
    const { key, url, filename } = await uploadToLinode(buffer, folder, name, 'video/mp4', req.tenant?.s3Prefix);
    const doc = {
      filename,
      originalName: name,
      folders: [folder],
      folder,
      clientId: clientId || null,
      publicUrl: url,
      bucketKey: key,
      thumbUrl: null, thumbKey: null,
      webUrl: null, webKey: null, webSize: null,
      fileType: 'video',
      mimeType: 'video/mp4',
      size: buffer.length,
      title: title || name.replace(/\.[^.]+$/, ''),
      tags: ['social', 'video', preset || 'generated'].filter(Boolean),
      generatedFrom: { preset, source: videoUrl, seconds, createdAt: new Date() },
      uploadedAt: new Date(),
    };
    const r = await db.collection('assets').insertOne(doc);
    res.json({
      success: true,
      asset: { ...doc, _id: r.insertedId },
      seconds,
      trimmed: seconds >= MAX_COMPOSE_SECONDS,
    });
  } catch (err) {
    console.error('Social video compose error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/bulk-delete — delete multiple assets
router.post('/bulk-delete', async (req, res) => {
  try {
    const db = req.db;
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

    const objectIds = ids.map(id => new ObjectId(id));
    const assets = await db.collection('assets').find({ _id: { $in: objectIds } }).toArray();

    // Delete from S3
    for (const asset of assets) {
      if (asset.bucketKey && config.LINODE_KEY) {
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
        } catch (s3Err) {
          console.warn('S3 bulk delete warning:', s3Err.message);
        }
      }
      await deleteThumb(asset);
      await deleteWebVariant(asset);
    }

    await db.collection('assets').deleteMany({ _id: { $in: objectIds } });
    res.json({ success: true, deleted: assets.length });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/bulk-move — move multiple assets to a folder/client
// Folder assignment supports two modes:
//   addFolders: []  → ADD these folders to each asset, preserving its existing
//                     folder tags (per-image folders are NOT clobbered)
//   folders: []     → REPLACE each asset's folder set with exactly these
//   folder: 'slug'  → legacy single-folder replace
router.post('/bulk-move', async (req, res) => {
  try {
    const db = req.db;
    const { ids, folder, folders, addFolders, clientId, addChannels, addCampaigns } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

    const { altText, caption } = req.body;
    const objectIds = ids.map(id => new ObjectId(id));
    const filter = { _id: { $in: objectIds } };
    const cleanArr = (v) => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean);

    // Shared field updates (client/alt/caption) applied in every mode
    const common = { updatedAt: new Date() };
    if (clientId !== undefined) common.clientId = clientId || null;
    if (altText !== undefined) common.altText = String(altText).slice(0, 250);
    if (caption !== undefined) common.caption = String(caption).slice(0, 500);

    // Additive mode — union new folders / channels / campaigns with each doc's
    // existing tags so we never strip what an individual image already carries.
    // Uses an aggregation pipeline update so the union is computed per-document.
    const adds = cleanArr(addFolders);
    const chanAdds = cleanArr(addChannels);
    const campAdds = cleanArr(addCampaigns);
    if (adds.length || chanAdds.length || campAdds.length) {
      const setStage = { ...common };
      if (adds.length) {
        setStage.folders = {
          $setUnion: [
            { $ifNull: ['$folders', []] },
            // fold the legacy single `folder` string in too, if present
            { $cond: [{ $eq: [{ $type: '$folder' }, 'string'] }, ['$folder'], []] },
            adds,
          ],
        };
      }
      if (chanAdds.length) setStage.channels = { $setUnion: [{ $ifNull: ['$channels', []] }, chanAdds] };
      if (campAdds.length) setStage.campaigns = { $setUnion: [{ $ifNull: ['$campaigns', []] }, campAdds] };
      const pipeline = [{ $set: setStage }];
      if (adds.length) pipeline.push({ $set: { folder: { $ifNull: ['$folder', { $arrayElemAt: ['$folders', 0] }] } } });
      await db.collection('assets').updateMany(filter, pipeline);
      return res.json({ success: true, updated: ids.length });
    }

    // Replace mode
    const $set = { ...common };
    if (folders && Array.isArray(folders) && folders.length) {
      $set.folders = folders;
      $set.folder = folders[0];
    } else if (folder) {
      $set.folder = folder;
      $set.folders = [folder];
    }
    if (Array.isArray(req.body.channels)) $set.channels = cleanArr(req.body.channels);
    if (Array.isArray(req.body.campaigns)) $set.campaigns = cleanArr(req.body.campaigns);

    await db.collection('assets').updateMany(filter, { $set });
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/:id
router.delete('/:id', async (req, res) => {
  try {
    const db = req.db;
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ error: 'Not found' });

    if (asset.bucketKey && config.LINODE_KEY) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
      } catch (s3Err) {
        console.warn('S3 delete warning:', s3Err.message);
      }
    }
    await deleteThumb(asset);
    await deleteWebVariant(asset);

    await db.collection('assets').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error('Asset delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SHARE / API ──

// POST /admin/assets/:id/share — generate a public share token
router.post('/:id/share', async (req, res) => {
  try {
    const db = req.db;
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ error: 'Not found' });
    // If already shared, return existing token
    if (asset.shareToken) return res.json({ success: true, shareToken: asset.shareToken, shareUrl: `/assets/share/${asset.shareToken}` });
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.collection('assets').updateOne({ _id: asset._id }, { $set: { shareToken: token, sharedAt: new Date() } });
    res.json({ success: true, shareToken: token, shareUrl: `/assets/share/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/:id/share — revoke share
router.delete('/:id/share', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('assets').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $unset: { shareToken: '', sharedAt: '' } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── ASSET METADATA FOR AGENT SUPPORT ─────────────────────────────────────────
// Build searchable internal metadata (title, description, tags) from what we
// already know about an asset — its title, filename, folder, and any SD prompt /
// caption / seed captured at generation. No vision model is available, so for
// plain uploads this infers from the title; for generated assets it is rich.

export default router;
