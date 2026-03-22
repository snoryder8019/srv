import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../plugins/mongo.js';
import { s3Client, BUCKET, DIR_PREFIX, bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';

const router = express.Router();

// multer memory storage — large files (images + videos up to 200MB)
const assetMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    ok ? cb(null, true) : cb(new Error('Images and videos only'));
  },
});

async function uploadToLinode(buffer, folder, originalName, mimeType) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = originalName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const filename = `${ts}-${rand}-${safe}`;
  const key = `${DIR_PREFIX}/assets/${folder}/${filename}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ACL: 'public-read',
  }));

  return { key, url: bucketUrl(key), filename };
}

// GET /admin/assets
router.get('/', (req, res) => {
  res.render('admin/assets/index', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/trim
router.get('/trim', (req, res) => {
  res.render('admin/assets/trim', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/list — JSON API with filtering
router.get('/list', async (req, res) => {
  try {
    const db = getDb();
    const { folder, type, search, limit = 100, skip = 0 } = req.query;
    const query = {};
    if (folder && folder !== 'all') query.folder = folder;
    if (type && type !== 'all') query.fileType = type;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { originalName: { $regex: search, $options: 'i' } },
        { tags: { $elemMatch: { $regex: search, $options: 'i' } } },
      ];
    }
    const [assets, total] = await Promise.all([
      db.collection('w2_assets').find(query).sort({ uploadedAt: -1 }).skip(Number(skip)).limit(Number(limit)).toArray(),
      db.collection('w2_assets').countDocuments(query),
    ]);
    res.json({ assets, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/upload — multi-file upload
router.post('/upload', assetMem.array('files', 20), async (req, res) => {
  try {
    const db = getDb();
    const folder = req.body.folder || 'general';
    if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    const results = [];
    for (const file of req.files) {
      const fileType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const { key, url, filename } = await uploadToLinode(file.buffer, folder, file.originalname, file.mimetype);
      const doc = {
        filename,
        originalName: file.originalname,
        folder,
        publicUrl: url,
        bucketKey: key,
        fileType,
        mimeType: file.mimetype,
        size: file.size,
        title: file.originalname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        tags: [],
        uploadedAt: new Date(),
      };
      const r = await db.collection('w2_assets').insertOne(doc);
      results.push({ ...doc, _id: r.insertedId });
    }
    res.json({ success: true, assets: results });
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/trim-upload — upload a pre-trimmed video from client-side MediaRecorder
router.post('/trim-upload', assetMem.single('video'), async (req, res) => {
  try {
    const db = getDb();
    const { folder = 'general', filename: customName, startTime, endTime } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    const name = customName || req.file.originalname;
    const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, req.file.mimetype);
    const doc = {
      filename,
      originalName: name,
      folder,
      publicUrl: url,
      bucketKey: key,
      fileType: 'video',
      mimeType: req.file.mimetype,
      size: req.file.size,
      title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      tags: ['trimmed'],
      trimmedFrom: { startTime: parseFloat(startTime) || 0, endTime: parseFloat(endTime) || 0 },
      uploadedAt: new Date(),
    };
    const r = await db.collection('w2_assets').insertOne(doc);
    res.json({ success: true, asset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    console.error('Trim upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/:id — update metadata
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { title, tags, folder } = req.body;
    const $set = { updatedAt: new Date() };
    if (title !== undefined) $set.title = title;
    if (folder !== undefined) $set.folder = folder;
    if (tags !== undefined) {
      $set.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    await db.collection('w2_assets').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/:id
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const asset = await db.collection('w2_assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ error: 'Not found' });

    if (asset.bucketKey && config.LINODE_KEY) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
      } catch (s3Err) {
        console.warn('S3 delete warning:', s3Err.message);
      }
    }

    await db.collection('w2_assets').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error('Asset delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
