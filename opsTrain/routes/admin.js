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

// All admin routes require at least manager
router.use(requireRole('manager'));

// Brand-scoping middleware: admin/manager only see their own brand
// superadmin sees everything
router.use((req, res, next) => {
  if (req.user.role === 'superadmin') {
    req.brandScope = null; // no filter — sees all
  } else {
    req.brandScope = req.user.brand; // scoped to their brand
  }
  next();
});

// Dashboard
router.get('/', async (req, res) => {
  const Brand = require('../models/Brand');
  const User = require('../models/User');
  const Task = require('../models/Task');
  const QRCode = require('../models/QRCode');

  let brands, userCount, taskCount, qrCount;

  if (!req.brandScope) {
    // superadmin — all brands
    brands = await Brand.find({ active: true }).lean();
    userCount = await User.countDocuments();
    taskCount = await Task.countDocuments({ active: true });
    qrCount = await QRCode.countDocuments({ active: true });
  } else {
    // admin/manager — own brand only
    brands = await Brand.find({ _id: req.brandScope, active: true }).lean();
    userCount = await User.countDocuments({ brand: req.brandScope });
    taskCount = await Task.countDocuments({ brand: req.brandScope, active: true });
    qrCount = await QRCode.countDocuments({ brand: req.brandScope, active: true });
  }

  // Get trial/plan info for the user's brand
  let trialBrand = null;
  if (req.user.brand) {
    trialBrand = await Brand.findById(req.user.brand).select('status trialExpiresAt expiresAt plan name delegatePromo delegateTrialEndsAt').lean();
  }

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    brands,
    stats: { userCount, taskCount, qrCount, brandCount: brands.length },
    trialBrand,
    success: req.query.success || null,
    error: req.query.error || null,
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
