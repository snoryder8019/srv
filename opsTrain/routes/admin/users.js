const express = require('express');
const User = require('../../models/User');
const Brand = require('../../models/Brand');
const router = express.Router();

// List users
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.brandId) filter.brand = req.query.brandId;
  else if (req.user.role === 'brandAdmin') filter.brand = req.user.brand;

  const users = await User.find(filter).populate('brand', 'name').sort({ role: 1, displayName: 1 }).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/users/index', { title: 'Users', users, brands, selectedBrand: req.query.brandId || '' });
});

// New user form
router.get('/new', async (req, res) => {
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/users/form', { title: 'New User', editUser: null, brands, brandId: req.query.brandId || '' });
});

// Create user
router.post('/', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    await User.create({
      displayName: req.body.displayName,
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      email: req.body.email || '',
      posPin: req.body.posPin || '',
      role: req.body.role || 'user',
      brand: brandId,
      provider: 'local'
    });
    res.redirect(`/admin/users?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect('/admin/users/new?error=create_failed');
  }
});

// Edit user form
router.get('/:id/edit', async (req, res) => {
  const editUser = await User.findById(req.params.id).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();
  if (!editUser) return res.redirect('/admin/users');
  res.render('admin/users/form', { title: 'Edit User', editUser, brands, brandId: editUser.brand?.toString() || '' });
});

// Update user
router.post('/:id', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    await User.findByIdAndUpdate(req.params.id, {
      displayName: req.body.displayName,
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      email: req.body.email || '',
      posPin: req.body.posPin || '',
      role: req.body.role || 'user',
      brand: brandId
    });
    res.redirect(`/admin/users?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/users/${req.params.id}/edit?error=update_failed`);
  }
});

// Delete user
router.post('/:id/delete', async (req, res) => {
  const u = await User.findByIdAndDelete(req.params.id);
  res.redirect(`/admin/users?brandId=${u?.brand || ''}`);
});

module.exports = router;
