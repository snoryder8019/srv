import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { portfolioUpload } from '../../middleware/upload.js';
import { bucketUrl, s3Client, BUCKET } from '../../plugins/s3.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../../config/config.js';

const router = express.Router();

async function deleteS3Key(key) {
  if (!key || !config.LINODE_KEY) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.warn('[portfolio] S3 delete warning:', err.message);
  }
}

function s3KeyFromUrl(url) {
  if (!url || !BUCKET) return '';
  const prefix = `https://${BUCKET}.${config.LINODE_REGION}.linodeobjects.com/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : '';
}

function parseGallery(raw) {
  if (!raw) return [];
  let arr = [];
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(g => ({
      url: (g?.url || '').trim(),
      caption: (g?.caption || '').trim(),
    }))
    .filter(g => g.url);
}

// List
router.get('/', async (req, res) => {
  const db = req.db;
  const items = await db.collection('portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray();
  res.render('admin/portfolio/index', { user: req.adminUser, items });
});

// New form
router.get('/new', (req, res) => {
  res.render('admin/portfolio/form', { user: req.adminUser, item: null, error: null });
});

// Create
router.post('/', portfolioUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const { title, category, description, clientName, projectDate, featured, showDate, tags, order, displayLayout, group } = req.body;

    let imageUrl = req.body.imageUrlManual || '';
    let bucketKey = '';

    if (req.file) {
      if (req.file.location) {
        imageUrl = req.file.location;
        bucketKey = req.file.key;
      } else if (req.file.buffer) {
        imageUrl = ''; // no S3 configured — can't persist
      }
    }

    const gallery = parseGallery(req.body.gallery);
    if (!imageUrl && gallery.length) imageUrl = gallery[0].url;

    await db.collection('portfolio').insertOne({
      title: title?.trim(),
      category: category?.trim() || '',
      description: description?.trim() || '',
      clientName: clientName?.trim() || '',
      projectDate: projectDate || null,
      featured: featured === 'on',
      showDate: showDate === 'on',
      group: group?.trim() || '',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      order: parseInt(order) || 0,
      displayLayout: displayLayout || 'grid',
      imageUrl,
      bucketKey,
      gallery,
      status: 'published',
      createdAt: new Date(),
    });

    res.redirect('/admin/portfolio');
  } catch (err) {
    console.error(err);
    res.render('admin/portfolio/form', { user: req.adminUser, item: null, error: err.message });
  }
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  const db = req.db;
  const item = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
  if (!item) return res.redirect('/admin/portfolio');
  res.render('admin/portfolio/form', { user: req.adminUser, item, error: null });
});

// Update
router.post('/:id', portfolioUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const { title, category, description, clientName, projectDate, featured, showDate, tags, order, displayLayout, group } = req.body;
    const existing = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.redirect('/admin/portfolio');

    let imageUrl = existing.imageUrl;
    let bucketKey = existing.bucketKey;

    if (req.file?.location) {
      // Replacing image — delete the old uploaded one from S3
      if (existing.bucketKey) await deleteS3Key(existing.bucketKey);
      imageUrl = req.file.location;
      bucketKey = req.file.key;
    } else if (req.body.removeImage === '1') {
      if (existing.bucketKey) await deleteS3Key(existing.bucketKey);
      imageUrl = '';
      bucketKey = '';
    } else if (req.body.imageUrlManual !== undefined && req.body.imageUrlManual !== existing.imageUrl) {
      // URL changed manually — drop the old S3 file if any (the manual URL is now authoritative)
      if (existing.bucketKey && !req.body.imageUrlManual) await deleteS3Key(existing.bucketKey);
      imageUrl = req.body.imageUrlManual;
      if (!req.body.imageUrlManual) bucketKey = '';
    }

    const gallery = parseGallery(req.body.gallery);

    // Clean up S3 for gallery items that were uploaded directly to this portfolio item but have been removed
    const existingGallery = Array.isArray(existing.gallery) ? existing.gallery : [];
    const newUrls = new Set(gallery.map(g => g.url));
    for (const g of existingGallery) {
      if (g.url && !newUrls.has(g.url)) {
        // Only delete keys under portfolio/* — leave shared asset-library files alone
        const key = s3KeyFromUrl(g.url);
        if (key && key.includes('/portfolio/')) await deleteS3Key(key);
      }
    }

    if (!imageUrl && gallery.length) imageUrl = gallery[0].url;

    await db.collection('portfolio').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        title: title?.trim(),
        category: category?.trim() || '',
        description: description?.trim() || '',
        clientName: clientName?.trim() || '',
        projectDate: projectDate || null,
        featured: featured === 'on',
        showDate: showDate === 'on',
        group: group?.trim() || '',
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        order: parseInt(order) || 0,
        displayLayout: displayLayout || 'grid',
        imageUrl,
        bucketKey,
        gallery,
        updatedAt: new Date(),
      }}
    );
    res.redirect('/admin/portfolio');
  } catch (err) {
    console.error(err);
    const db = req.db;
    const item = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
    res.render('admin/portfolio/form', { user: req.adminUser, item, error: err.message });
  }
});

// Remove just the main image (AJAX endpoint)
router.post('/:id/image/delete', async (req, res) => {
  try {
    const db = req.db;
    const item = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    if (item.bucketKey) await deleteS3Key(item.bucketKey);
    await db.collection('portfolio').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { imageUrl: '', bucketKey: '', updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[portfolio] image delete error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Remove a single gallery image (AJAX endpoint)
router.post('/:id/gallery/delete', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });
    const item = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    const newGallery = (item.gallery || []).filter(g => g.url !== url);
    // Only delete from S3 if this URL is uniquely owned by this portfolio item
    const key = s3KeyFromUrl(url);
    if (key && key.includes('/portfolio/')) await deleteS3Key(key);
    await db.collection('portfolio').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { gallery: newGallery, updatedAt: new Date() } }
    );
    res.json({ ok: true, gallery: newGallery });
  } catch (err) {
    console.error('[portfolio] gallery delete error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete
router.post('/:id/delete', async (req, res) => {
  const db = req.db;
  const item = await db.collection('portfolio').findOne({ _id: new ObjectId(req.params.id) });
  if (item) {
    if (item.bucketKey) await deleteS3Key(item.bucketKey);
    for (const g of (item.gallery || [])) {
      const key = s3KeyFromUrl(g.url);
      if (key && key.includes('/portfolio/')) await deleteS3Key(key);
    }
  }
  await db.collection('portfolio').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/portfolio');
});

export default router;
