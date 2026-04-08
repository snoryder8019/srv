const express = require('express');
const Task = require('../../models/Task');
const Brand = require('../../models/Brand');
const router = express.Router();

// List tasks (filtered by brand for admin/manager)
router.get('/', async (req, res) => {
  const filter = { active: true };
  if (req.brandScope) filter.brand = req.brandScope;
  else if (req.query.brandId) filter.brand = req.query.brandId;

  const tasks = await Task.find(filter).populate('brand', 'name').sort({ sortOrder: 1 }).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/tasks/index', { title: 'Tasks', tasks, brands, selectedBrand: req.query.brandId || '' });
});

// New task form
router.get('/new', async (req, res) => {
  const brands = await Brand.find({ active: true }).select('name').lean();
  res.render('admin/tasks/form', { title: 'New Task', task: null, brands, brandId: req.query.brandId || '' });
});

// Create task
router.post('/', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    await Task.create({
      brand: brandId,
      title: req.body.title,
      description: req.body.description || '',
      category: req.body.category || 'sidework',
      type: req.body.type || 'sidework',
      frequency: req.body.frequency || 'daily',
      shiftTime: req.body.shiftTime || 'any',
      requiresPhoto: req.body.requiresPhoto === 'on',
      requiresNote: req.body.requiresNote === 'on',
      sortOrder: parseInt(req.body.sortOrder) || 0
    });
    res.redirect(`/admin/tasks?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect('/admin/tasks/new?error=create_failed');
  }
});

// Edit task form
router.get('/:id/edit', async (req, res) => {
  const task = await Task.findById(req.params.id).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();
  if (!task) return res.redirect('/admin/tasks');
  res.render('admin/tasks/form', { title: 'Edit Task', task, brands, brandId: task.brand.toString() });
});

// Update task
router.post('/:id', async (req, res) => {
  try {
    const brandId = req.body.brandId || req.user.brand;
    await Task.findByIdAndUpdate(req.params.id, {
      title: req.body.title,
      description: req.body.description || '',
      category: req.body.category || 'sidework',
      type: req.body.type || 'sidework',
      frequency: req.body.frequency || 'daily',
      shiftTime: req.body.shiftTime || 'any',
      requiresPhoto: req.body.requiresPhoto === 'on',
      requiresNote: req.body.requiresNote === 'on',
      sortOrder: parseInt(req.body.sortOrder) || 0
    });
    res.redirect(`/admin/tasks?brandId=${brandId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/tasks/${req.params.id}/edit?error=update_failed`);
  }
});

// Delete task
router.post('/:id/delete', async (req, res) => {
  const task = await Task.findByIdAndUpdate(req.params.id, { active: false });
  res.redirect(`/admin/tasks?brandId=${task?.brand || ''}`);
});

module.exports = router;
