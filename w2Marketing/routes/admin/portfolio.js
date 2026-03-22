import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { portfolioUpload } from '../../middleware/upload.js';
import { bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';

const router = express.Router();

// List
router.get('/', async (req, res) => {
  const db = getDb();
  const items = await db.collection('w2_portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray();
  res.render('admin/portfolio/index', { user: req.adminUser, items });
});

// New form
router.get('/new', (req, res) => {
  res.render('admin/portfolio/form', { user: req.adminUser, item: null, error: null });
});

// Create
router.post('/', portfolioUpload.single('image'), async (req, res) => {
  try {
    const db = getDb();
    const { title, category, description, clientName, projectDate, featured, tags, order, displayLayout } = req.body;

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

    await db.collection('w2_portfolio').insertOne({
      title: title?.trim(),
      category: category?.trim() || '',
      description: description?.trim() || '',
      clientName: clientName?.trim() || '',
      projectDate: projectDate || null,
      featured: featured === 'on',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      order: parseInt(order) || 0,
      displayLayout: displayLayout || 'grid',
      imageUrl,
      bucketKey,
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
  const db = getDb();
  const item = await db.collection('w2_portfolio').findOne({ _id: new ObjectId(req.params.id) });
  if (!item) return res.redirect('/admin/portfolio');
  res.render('admin/portfolio/form', { user: req.adminUser, item, error: null });
});

// Update
router.post('/:id', portfolioUpload.single('image'), async (req, res) => {
  try {
    const db = getDb();
    const { title, category, description, clientName, projectDate, featured, tags, order, displayLayout } = req.body;
    const existing = await db.collection('w2_portfolio').findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.redirect('/admin/portfolio');

    let imageUrl = existing.imageUrl;
    let bucketKey = existing.bucketKey;

    if (req.file?.location) {
      imageUrl = req.file.location;
      bucketKey = req.file.key;
    } else if (req.body.imageUrlManual) {
      imageUrl = req.body.imageUrlManual;
    }

    await db.collection('w2_portfolio').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        title: title?.trim(),
        category: category?.trim() || '',
        description: description?.trim() || '',
        clientName: clientName?.trim() || '',
        projectDate: projectDate || null,
        featured: featured === 'on',
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        order: parseInt(order) || 0,
        displayLayout: displayLayout || 'grid',
        imageUrl,
        bucketKey,
        updatedAt: new Date(),
      }}
    );
    res.redirect('/admin/portfolio');
  } catch (err) {
    console.error(err);
    const db = getDb();
    const item = await db.collection('w2_portfolio').findOne({ _id: new ObjectId(req.params.id) });
    res.render('admin/portfolio/form', { user: req.adminUser, item, error: err.message });
  }
});

// Delete
router.post('/:id/delete', async (req, res) => {
  const db = getDb();
  await db.collection('w2_portfolio').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/portfolio');
});

export default router;
