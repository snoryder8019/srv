const express = require('express');
const Brand = require('../../models/Brand');
const { requireRole } = require('../../middleware/roles');
const router = express.Router();

// Only admin+ can manage brands
router.use(requireRole('admin'));

// List brands
router.get('/', async (req, res) => {
  const brands = await Brand.find().sort({ name: 1 }).lean();
  res.render('admin/brands/index', { title: 'Brands', brands });
});

// New brand form
router.get('/new', (req, res) => {
  res.render('admin/brands/form', { title: 'New Brand', brand: null });
});

// Create brand
router.post('/', async (req, res) => {
  try {
    const slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await Brand.create({
      name: req.body.name,
      slug,
      location: req.body.location || '',
      address: req.body.address || '',
      phone: req.body.phone || '',
      color: req.body.color || '#2563eb',
      description: req.body.description || '',
      owner: req.user._id,
      settings: {
        requirePinForTasks: req.body.requirePinForTasks === 'on',
        shiftNoteRequired: req.body.shiftNoteRequired === 'on',
        specialsEnabled: req.body.specialsEnabled === 'on',
        webhooksEnabled: req.body.webhooksEnabled === 'on',
        timezone: req.body.timezone || 'America/New_York',
        shiftOpen: parseInt(req.body.shiftOpen) || 6,
        shiftMid: parseInt(req.body.shiftMid) || 14,
        shiftClose: parseInt(req.body.shiftClose) || 18,
        shiftEnd: parseInt(req.body.shiftEnd) || 2
      }
    });
    res.redirect('/admin/brands');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands/new?error=create_failed');
  }
});

// Edit brand form
router.get('/:id/edit', async (req, res) => {
  const brand = await Brand.findById(req.params.id).lean();
  if (!brand) return res.redirect('/admin/brands');
  res.render('admin/brands/form', { title: 'Edit Brand', brand });
});

// Update brand
router.post('/:id', async (req, res) => {
  try {
    await Brand.findByIdAndUpdate(req.params.id, {
      name: req.body.name,
      location: req.body.location || '',
      address: req.body.address || '',
      phone: req.body.phone || '',
      color: req.body.color || '#2563eb',
      description: req.body.description || '',
      settings: {
        requirePinForTasks: req.body.requirePinForTasks === 'on',
        shiftNoteRequired: req.body.shiftNoteRequired === 'on',
        specialsEnabled: req.body.specialsEnabled === 'on',
        webhooksEnabled: req.body.webhooksEnabled === 'on',
        timezone: req.body.timezone || 'America/New_York',
        shiftOpen: parseInt(req.body.shiftOpen) || 6,
        shiftMid: parseInt(req.body.shiftMid) || 14,
        shiftClose: parseInt(req.body.shiftClose) || 18,
        shiftEnd: parseInt(req.body.shiftEnd) || 2
      }
    });
    res.redirect('/admin/brands');
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/brands/${req.params.id}/edit?error=update_failed`);
  }
});

// Delete brand
router.post('/:id/delete', async (req, res) => {
  await Brand.findByIdAndUpdate(req.params.id, { active: false });
  res.redirect('/admin/brands');
});

module.exports = router;
