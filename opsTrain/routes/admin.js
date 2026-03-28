const express = require('express');
const { requireRole } = require('../middleware/roles');
const router = express.Router();

const brandsRouter = require('./admin/brands');
const tasksRouter = require('./admin/tasks');
const usersRouter = require('./admin/users');
const qrRouter = require('./admin/qr');
const shiftsRouter = require('./admin/shifts');
const specialsRouter = require('./admin/specials');
const analyticsRouter = require('./admin/analytics');
const rosterRouter = require('./admin/roster');

// All admin routes require at least brandAdmin
router.use(requireRole('brandAdmin'));

// Dashboard
router.get('/', async (req, res) => {
  const Brand = require('../models/Brand');
  const User = require('../models/User');
  const Task = require('../models/Task');
  const QRCode = require('../models/QRCode');

  let brands, userCount, taskCount, qrCount;

  if (['superadmin', 'admin'].includes(req.user.role)) {
    brands = await Brand.find({ active: true }).lean();
    userCount = await User.countDocuments();
    taskCount = await Task.countDocuments({ active: true });
    qrCount = await QRCode.countDocuments({ active: true });
  } else {
    brands = await Brand.find({ _id: req.user.brand, active: true }).lean();
    userCount = await User.countDocuments({ brand: req.user.brand });
    taskCount = await Task.countDocuments({ brand: req.user.brand, active: true });
    qrCount = await QRCode.countDocuments({ brand: req.user.brand, active: true });
  }

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    brands,
    stats: { userCount, taskCount, qrCount, brandCount: brands.length }
  });
});

router.use('/brands', brandsRouter);
router.use('/tasks', tasksRouter);
router.use('/users', usersRouter);
router.use('/qr', qrRouter);
router.use('/shifts', shiftsRouter);
router.use('/specials', specialsRouter);
router.use('/analytics', analyticsRouter);
router.use('/roster', rosterRouter);

module.exports = router;
