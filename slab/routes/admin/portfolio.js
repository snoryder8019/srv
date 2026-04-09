import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { portfolioUpload } from '../../middleware/upload.js';
import { bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';

const router = express.Router();

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
      imageUrl = req.file.location;
      bucketKey = req.file.key;
    } else if (req.body.imageUrlManual) {
      imageUrl = req.body.imageUrlManual;
    }

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

// Delete
router.post('/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('portfolio').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/portfolio');
});

export default router;
