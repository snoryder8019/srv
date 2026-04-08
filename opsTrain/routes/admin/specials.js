const express = require('express');
const Special = require('../../models/Special');
const Brand = require('../../models/Brand');
const router = express.Router();

// List specials (active + drafts)
router.get('/', async (req, res) => {
  const filter = { active: true };
  if (req.brandScope) filter.brand = req.brandScope;
  else if (req.query.brandId) filter.brand = req.query.brandId;

  const specials = await Special.find(filter).populate('brand', 'name').sort({ status: 1, createdAt: -1 }).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/specials/index', { title: 'Specials', specials, brands, selectedBrand: req.query.brandId || '' });
});

// New special form
router.get('/new', async (req, res) => {
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/specials/form', { title: 'New Special', special: null, brands, brandId: req.query.brandId || '' });
});

// Create
router.post('/', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    const isDraft = req.body.saveAs === 'draft';
    await Special.create({
      brand: brandId,
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price || '',
      shiftTime: req.body.shiftTime || 'all',
      status: isDraft ? 'draft' : 'active'
    });
    res.redirect(`/admin/specials?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect('/admin/specials/new?error=create_failed');
  }
});

// Edit
router.get('/:id/edit', async (req, res) => {
  const special = await Special.findById(req.params.id).lean();
  if (!special) return res.redirect('/admin/specials');
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/specials/form', { title: 'Edit Special', special, brands, brandId: special.brand.toString() });
});

// Update
router.post('/:id', async (req, res) => {
  try {
    const isDraft = req.body.saveAs === 'draft';
    await Special.findByIdAndUpdate(req.params.id, {
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price || '',
      shiftTime: req.body.shiftTime || 'all',
      status: isDraft ? 'draft' : 'active'
    });
    res.redirect(`/admin/specials?brandId=${req.body.brandId || ''}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/specials/${req.params.id}/edit?error=update_failed`);
  }
});

// Publish draft
router.post('/:id/publish', async (req, res) => {
  const s = await Special.findByIdAndUpdate(req.params.id, { status: 'active' });
  res.redirect(`/admin/specials?brandId=${s?.brand || ''}`);
});

// Unpublish to draft
router.post('/:id/unpublish', async (req, res) => {
  const s = await Special.findByIdAndUpdate(req.params.id, { status: 'draft' });
  res.redirect(`/admin/specials?brandId=${s?.brand || ''}`);
});

// Delete (archive)
router.post('/:id/delete', async (req, res) => {
  const s = await Special.findByIdAndUpdate(req.params.id, { active: false, status: 'archived' });
  res.redirect(`/admin/specials?brandId=${s?.brand || ''}`);
});

module.exports = router;
