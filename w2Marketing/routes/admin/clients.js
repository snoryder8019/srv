import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { clientFileUpload } from '../../middleware/upload.js';

const router = express.Router();

// List
router.get('/', async (req, res) => {
  const db = getDb();
  const clients = await db.collection('w2_clients').find({}).sort({ createdAt: -1 }).toArray();
  res.render('admin/clients/index', { user: req.adminUser, clients });
});

// New form
router.get('/new', (req, res) => {
  res.render('admin/clients/form', { user: req.adminUser, client: null, error: null });
});

// Create
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { name, email, phone, company, status, notes, website, address } = req.body;
    const result = await db.collection('w2_clients').insertOne({
      name: name?.trim(),
      email: email?.trim() || '',
      phone: phone?.trim() || '',
      company: company?.trim() || '',
      website: website?.trim() || '',
      address: address?.trim() || '',
      status: status || 'prospect',
      notes: notes?.trim() || '',
      onboarding: { complete: false, step: 0, data: {} },
      createdAt: new Date(),
    });
    res.redirect(`/admin/clients/${result.insertedId}`);
  } catch (err) {
    res.render('admin/clients/form', { user: req.adminUser, client: null, error: err.message });
  }
});

// Detail (tabs: overview, invoices, files, onboarding)
router.get('/:id', async (req, res) => {
  const db = getDb();
  const client = await db.collection('w2_clients').findOne({ _id: new ObjectId(req.params.id) });
  if (!client) return res.redirect('/admin/clients');
  const invoices = await db.collection('w2_invoices').find({ clientId: client._id.toString() }).sort({ createdAt: -1 }).toArray();
  const files = await db.collection('w2_files').find({ clientId: client._id.toString() }).sort({ uploadedAt: -1 }).toArray();
  const tab = req.query.tab || 'overview';
  res.render('admin/clients/detail', { user: req.adminUser, client, invoices, files, tab });
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  const db = getDb();
  const client = await db.collection('w2_clients').findOne({ _id: new ObjectId(req.params.id) });
  if (!client) return res.redirect('/admin/clients');
  res.render('admin/clients/form', { user: req.adminUser, client, error: null });
});

// Update client
router.post('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, email, phone, company, status, notes, website, address } = req.body;
    await db.collection('w2_clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { name: name?.trim(), email: email?.trim(), phone: phone?.trim(), company: company?.trim(), website: website?.trim(), address: address?.trim(), status, notes: notes?.trim(), updatedAt: new Date() } }
    );
    res.redirect(`/admin/clients/${req.params.id}`);
  } catch (err) {
    const db = getDb();
    const client = await db.collection('w2_clients').findOne({ _id: new ObjectId(req.params.id) });
    res.render('admin/clients/form', { user: req.adminUser, client, error: err.message });
  }
});

// Delete client
router.post('/:id/delete', async (req, res) => {
  const db = getDb();
  await db.collection('w2_clients').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/clients');
});

// ── INVOICES ──
router.post('/:id/invoices', async (req, res) => {
  try {
    const db = getDb();
    const { title, amount, status, dueDate, notes } = req.body;
    await db.collection('w2_invoices').insertOne({
      clientId: req.params.id,
      title: title?.trim() || 'Invoice',
      amount: parseFloat(amount) || 0,
      status: status || 'draft',
      dueDate: dueDate || null,
      notes: notes?.trim() || '',
      createdAt: new Date(),
    });
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
  } catch (err) {
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices&error=1`);
  }
});

router.post('/:id/invoices/:invoiceId/delete', async (req, res) => {
  const db = getDb();
  await db.collection('w2_invoices').deleteOne({ _id: new ObjectId(req.params.invoiceId) });
  res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
});

router.post('/:id/invoices/:invoiceId/status', async (req, res) => {
  const db = getDb();
  await db.collection('w2_invoices').updateOne(
    { _id: new ObjectId(req.params.invoiceId) },
    { $set: { status: req.body.status } }
  );
  res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
});

// ── FILES ──
router.post('/:id/files', clientFileUpload.single('file'), async (req, res) => {
  try {
    const db = getDb();
    let fileUrl = '', bucketKey = '', fileName = '', fileSize = 0, fileType = '';

    if (req.file) {
      fileName = req.file.originalname;
      fileSize = req.file.size;
      fileType = req.file.mimetype;
      if (req.file.location) {
        fileUrl = req.file.location;
        bucketKey = req.file.key;
      }
    }

    await db.collection('w2_files').insertOne({
      clientId: req.params.id,
      name: fileName,
      label: req.body.label?.trim() || fileName,
      url: fileUrl,
      bucketKey,
      size: fileSize,
      type: fileType,
      uploadedAt: new Date(),
    });
    res.redirect(`/admin/clients/${req.params.id}?tab=files`);
  } catch (err) {
    res.redirect(`/admin/clients/${req.params.id}?tab=files&error=1`);
  }
});

router.post('/:id/files/:fileId/delete', async (req, res) => {
  const db = getDb();
  await db.collection('w2_files').deleteOne({ _id: new ObjectId(req.params.fileId) });
  res.redirect(`/admin/clients/${req.params.id}?tab=files`);
});

// ── ONBOARDING ──
router.post('/:id/onboarding', async (req, res) => {
  try {
    const db = getDb();
    const { businessType, goals, budget, timeline, socialPlatforms, currentWebsite, brandNotes, step } = req.body;
    await db.collection('w2_clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        'onboarding.data': { businessType, goals, budget, timeline, socialPlatforms, currentWebsite, brandNotes },
        'onboarding.step': parseInt(step) || 1,
        'onboarding.complete': step === 'done',
        'onboarding.updatedAt': new Date(),
      }}
    );
    res.redirect(`/admin/clients/${req.params.id}?tab=onboarding`);
  } catch (err) {
    res.redirect(`/admin/clients/${req.params.id}?tab=onboarding&error=1`);
  }
});

export default router;
