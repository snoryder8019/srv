const express = require('express');
const { requireSuperadmin } = require('../middleware/superadmin');
const Brand = require('../models/Brand');
const User = require('../models/User');
const Shift = require('../models/Shift');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const QRScan = require('../models/QRScan');
const QRCode = require('../models/QRCode');
const router = express.Router();

router.use(requireSuperadmin);

// GET /superadmin — platform dashboard
router.get('/', async (req, res) => {
  const brands = await Brand.find().sort({ active: -1, createdAt: -1 }).lean();
  const since30 = new Date(); since30.setDate(since30.getDate() - 30);

  // Platform totals
  const totalUsers = await User.countDocuments();
  const totalBrands = brands.length;
  const activeBrands = brands.filter(b => b.active).length;
  const totalScans30 = await QRScan.countDocuments({ createdAt: { $gte: since30 } });
  const totalCompletions30 = await TaskCompletion.countDocuments({ createdAt: { $gte: since30 } });
  const totalTasks = await Task.countDocuments({ active: true });
  const totalQRs = await QRCode.countDocuments({ active: true });

  // Per-brand stats
  const brandStats = [];
  for (const b of brands) {
    const users = await User.countDocuments({ brand: b._id });
    const scans = await QRScan.countDocuments({ brand: b._id, createdAt: { $gte: since30 } });
    const completions = await TaskCompletion.countDocuments({ brand: b._id, createdAt: { $gte: since30 } });
    const tasks = await Task.countDocuments({ brand: b._id, active: true });
    const qrs = await QRCode.countDocuments({ brand: b._id, active: true });
    const today = new Date().toISOString().slice(0, 10);
    const todayShifts = await Shift.find({ brand: b._id, date: today });
    const onDuty = todayShifts.reduce((n, s) => n + s.crew.filter(c => c.present).length, 0);

    brandStats.push({
      ...b,
      users, scans, completions, tasks, qrs, onDuty
    });
  }

  // Scan volume per day (platform-wide, 30 days)
  const dailyScans = await QRScan.aggregate([
    { $match: { createdAt: { $gte: since30 } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  res.render('superadmin/dashboard', {
    title: 'Platform Admin',
    stats: { totalUsers, totalBrands, activeBrands, totalScans30, totalCompletions30, totalTasks, totalQRs },
    brandStats,
    dailyScans
  });
});

// GET /superadmin/brand/:id — drill into a brand
router.get('/brand/:id', async (req, res) => {
  const brand = await Brand.findById(req.params.id).lean();
  if (!brand) return res.redirect('/superadmin');

  const users = await User.find({ brand: brand._id }).sort({ role: 1, displayName: 1 }).lean();
  const tasks = await Task.find({ brand: brand._id }).sort({ active: -1, sortOrder: 1 }).lean();
  const qrs = await QRCode.find({ brand: brand._id }).sort({ active: -1 }).lean();

  const since30 = new Date(); since30.setDate(since30.getDate() - 30);
  const scans30 = await QRScan.countDocuments({ brand: brand._id, createdAt: { $gte: since30 } });
  const completions30 = await TaskCompletion.countDocuments({ brand: brand._id, createdAt: { $gte: since30 } });

  res.render('superadmin/brand-detail', {
    title: brand.name + ' — Admin',
    brand, users, tasks, qrs, scans30, completions30
  });
});

// POST /superadmin/brand/:id/toggle — activate/deactivate a brand
router.post('/brand/:id/toggle', async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  brand.active = !brand.active;
  await brand.save();
  res.redirect('/superadmin');
});

// POST /superadmin/user/:id/role — change any user's role
router.post('/user/:id/role', async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { role: req.body.role });
  res.redirect(req.headers.referer || '/superadmin');
});

module.exports = router;
