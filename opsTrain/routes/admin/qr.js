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

// Print page — QR codes + sidework sheets for a brand
router.get('/print', async (req, res) => {
  const brandId = req.query.brandId;
  if (!brandId) return res.redirect('/admin/qr');

  const brand = await Brand.findById(brandId).lean();

  // Filters from query
  const typeFilter = req.query.type || '';       // qr type filter
  const areaFilter = req.query.area || '';       // area filter
  const shiftFilter = req.query.shift || '';     // shift filter (for sidework mode)
  const mode = req.query.mode || 'qr';          // 'qr' or 'sidework'

  // --- QR codes ---
  const qrFilter = { brand: brandId, active: true };
  if (typeFilter) qrFilter.type = typeFilter;
  if (areaFilter) qrFilter.area = areaFilter;

  const qrCodes = await QRCode.find(qrFilter).populate('task', 'title type shiftTime').sort({ area: 1, position: 1, label: 1 }).lean();

  // Ensure data URLs
  for (const qr of qrCodes) {
    if (!qr.dataUrl) {
      const scanUrl = `${DOMAIN}/scan/${qr.code}`;
      qr.dataUrl = await QRCodeLib.toDataURL(scanUrl, { width: 400, margin: 2 });
    }
  }

  // Group QRs by area
  const grouped = {};
  qrCodes.forEach(qr => {
    const area = qr.area || 'Unassigned';
    if (!grouped[area]) grouped[area] = [];
    grouped[area].push(qr);
  });

  // All unique areas across QR codes (for filter dropdown)
  const allQrCodes = await QRCode.find({ brand: brandId, active: true }).select('area').lean();
  const areas = [...new Set(allQrCodes.map(q => q.area || 'Unassigned'))].sort();

  // --- Sidework tasks (grouped by shiftTime) ---
  const taskFilter = { brand: brandId, active: true };
  if (shiftFilter && shiftFilter !== 'all') taskFilter.shiftTime = shiftFilter;

  const allTasks = await Task.find(taskFilter).sort({ shiftTime: 1, type: 1, sortOrder: 1, title: 1 }).lean();

  // Group tasks by shiftTime
  const tasksByShift = {};
  allTasks.forEach(tk => {
    const s = tk.shiftTime || 'any';
    if (!tasksByShift[s]) tasksByShift[s] = [];
    tasksByShift[s].push(tk);
  });

  // Find the best QR code to represent each shift group (task-list type, or fallback to shift-login)
  // One QR per shift group for the sidework sheet
  const allBrandQRs = await QRCode.find({ brand: brandId, active: true, type: { $in: ['task-list', 'shift-login', 'task-checkin'] } }).lean();

  const shiftQR = {};
  ['open', 'mid', 'close', 'any'].forEach(s => {
    // Prefer task-list, then shift-login, then any
    const match = allBrandQRs.find(q => q.type === 'task-list') ||
                  allBrandQRs.find(q => q.type === 'shift-login') ||
                  allBrandQRs[0];
    if (match) shiftQR[s] = match;
  });

  res.render('admin/qr/print', {
    title: `Print — ${brand?.name}`,
    brand,
    qrCodes,
    grouped,
    areas,
    tasksByShift,
    shiftQR,
    mode,
    typeFilter,
    areaFilter,
    shiftFilter: shiftFilter || 'all'
  });
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
