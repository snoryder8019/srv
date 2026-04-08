const express = require('express');
const crypto = require('crypto');
const QRCodeLib = require('qrcode');
const QRCode = require('../../models/QRCode');
const Brand = require('../../models/Brand');
const Task = require('../../models/Task');
const router = express.Router();

const DOMAIN = process.env.DOMAIN || 'https://ops-train.madladslab.com';

// List QR codes
router.get('/', async (req, res) => {
  const filter = { active: true };
  if (req.brandScope) filter.brand = req.brandScope;
  else if (req.query.brandId) filter.brand = req.query.brandId;

  const qrCodes = await QRCode.find(filter).populate('brand', 'name color').populate('task', 'title').sort({ area: 1, position: 1, label: 1 }).lean();
  const brands = await Brand.find({ active: true }).select('name color').lean();

  // Group by area (dept), then by position (station)
  const grouped = {};
  qrCodes.forEach(qr => {
    const area = qr.area || 'Unassigned';
    const station = qr.position || 'General';
    if (!grouped[area]) grouped[area] = {};
    if (!grouped[area][station]) grouped[area][station] = [];
    grouped[area][station].push(qr);
  });

  res.render('admin/qr/index', { title: 'QR Codes', qrCodes, grouped, brands, selectedBrand: req.query.brandId || '' });
});

// New QR form
router.get('/new', async (req, res) => {
  const brands = await Brand.find({ active: true }).select('name').lean();
  const brandId = req.query.brandId || '';
  const tasks = brandId ? await Task.find({ brand: brandId, active: true }).select('title').lean() : [];
  res.render('admin/qr/form', { title: 'New QR Code', qr: null, brands, tasks, brandId });
});

// Create QR code
router.post('/', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    const code = crypto.randomBytes(6).toString('hex');
    const scanUrl = `${DOMAIN}/scan/${code}`;
    const dataUrl = await QRCodeLib.toDataURL(scanUrl, { width: 400, margin: 2 });

    await QRCode.create({
      brand: brandId,
      label: req.body.label,
      code,
      type: req.body.type || 'task-checkin',
      task: req.body.taskId || undefined,
      webhookCategory: req.body.webhookCategory || '',
      webhookMeta: req.body.webhookMeta ? JSON.parse(req.body.webhookMeta) : {},
      area: req.body.area || '',
      position: req.body.position || '',
      dataUrl
    });
    res.redirect(`/admin/qr?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect('/admin/qr/new?error=create_failed');
  }
});

// Print page — all QR codes for a brand
router.get('/print', async (req, res) => {
  const brandId = req.query.brandId;
  if (!brandId) return res.redirect('/admin/qr');

  const brand = await Brand.findById(brandId).lean();
  const qrCodes = await QRCode.find({ brand: brandId, active: true }).populate('task', 'title').sort({ area: 1, position: 1, label: 1 }).lean();

  // Generate data URLs for any missing ones
  for (const qr of qrCodes) {
    if (!qr.dataUrl) {
      const scanUrl = `${DOMAIN}/scan/${qr.code}`;
      qr.dataUrl = await QRCodeLib.toDataURL(scanUrl, { width: 400, margin: 2 });
    }
  }

  // Group for print layout
  const grouped = {};
  qrCodes.forEach(qr => {
    const area = qr.area || 'Unassigned';
    if (!grouped[area]) grouped[area] = [];
    grouped[area].push(qr);
  });

  res.render('admin/qr/print', { title: `Print QR Codes — ${brand?.name}`, brand, qrCodes, grouped });
});

// Edit QR form
router.get('/:id/edit', async (req, res) => {
  const qr = await QRCode.findById(req.params.id).lean();
  if (!qr) return res.redirect('/admin/qr');
  const brands = await Brand.find({ active: true }).select('name').lean();
  const tasks = await Task.find({ brand: qr.brand, active: true }).select('title').lean();
  res.render('admin/qr/form', { title: 'Edit QR Code', qr, brands, tasks, brandId: qr.brand.toString() });
});

// Update QR
router.post('/:id', async (req, res) => {
  try {
    await QRCode.findByIdAndUpdate(req.params.id, {
      label: req.body.label,
      type: req.body.type || 'task-checkin',
      task: req.body.taskId || undefined,
      webhookCategory: req.body.webhookCategory || '',
      area: req.body.area || '',
      position: req.body.position || ''
    });
    res.redirect(`/admin/qr?brandId=${req.body.brandId || ''}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/qr/${req.params.id}/edit?error=update_failed`);
  }
});

// Delete QR
router.post('/:id/delete', async (req, res) => {
  const qr = await QRCode.findByIdAndUpdate(req.params.id, { active: false });
  res.redirect(`/admin/qr?brandId=${qr?.brand || ''}`);
});

module.exports = router;
