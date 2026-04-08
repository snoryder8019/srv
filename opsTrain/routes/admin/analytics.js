const express = require('express');
const mongoose = require('mongoose');
const QRScan = require('../../models/QRScan');
const TaskCompletion = require('../../models/TaskCompletion');
const QRCode = require('../../models/QRCode');
const Task = require('../../models/Task');
const Brand = require('../../models/Brand');
const User = require('../../models/User');
const router = express.Router();

router.get('/', async (req, res) => {
  const brandId = req.query.brandId || null;
  const range = parseInt(req.query.range) || 14;
  const since = new Date();
  since.setDate(since.getDate() - range);
  const today = new Date().toISOString().slice(0, 10);

  const brandFilter = {};
  if (req.brandScope) brandFilter.brand = req.brandScope;
  else if (brandId) brandFilter.brand = new mongoose.Types.ObjectId(brandId);

  const brands = await Brand.find({ active: true }).select('name color').lean();

  // --- Totals ---
  const [totalScans, totalCompletions, totalTasks, totalUsers] = await Promise.all([
    QRScan.countDocuments({ ...brandFilter, createdAt: { $gte: since } }),
    TaskCompletion.countDocuments({ ...brandFilter, createdAt: { $gte: since } }),
    Task.countDocuments({ ...(brandFilter.brand ? { brand: brandFilter.brand } : {}), active: true }),
    User.countDocuments(brandFilter.brand ? { brand: brandFilter.brand } : {})
  ]);

  const todayCompletions = await TaskCompletion.countDocuments({ ...brandFilter, shiftDate: today });
  const completionRate = totalTasks > 0 ? Math.round((todayCompletions / totalTasks) * 100) : 0;

  // --- Scans per day ---
  const scansByDay = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  // --- Completions per day ---
  const completionsByDay = await TaskCompletion.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: '$shiftDate', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  // --- Heatmap: 90 days of scan activity (GitHub style) ---
  const heatSince = new Date();
  heatSince.setDate(heatSince.getDate() - 90);
  const heatmapRaw = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: heatSince } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
  ]);
  // Build full 90 day map
  const heatmap = [];
  const heatLookup = {};
  heatmapRaw.forEach(h => { heatLookup[h._id] = h.count; });
  for (let i = 90; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    heatmap.push({ date: ds, count: heatLookup[ds] || 0, dow: d.getDay() });
  }

  // --- Multi-tier: scans by type + area (nested) ---
  const scansByTypeArea = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $lookup: { from: 'qrcodes', localField: 'qrCode', foreignField: '_id', as: 'qrDoc' } },
    { $unwind: { path: '$qrDoc', preserveNullAndEmptyArrays: true } },
    { $group: {
      _id: { type: '$type', area: { $ifNull: ['$qrDoc.area', 'unknown'] } },
      count: { $sum: 1 }
    }},
    { $sort: { count: -1 } }
  ]);

  // Restructure for nested chart: outer = type, inner = area
  const typeMap = {};
  scansByTypeArea.forEach(r => {
    const type = r._id.type || 'unknown';
    const area = r._id.area || 'unknown';
    if (!typeMap[type]) typeMap[type] = { total: 0, areas: {} };
    typeMap[type].total += r.count;
    typeMap[type].areas[area] = (typeMap[type].areas[area] || 0) + r.count;
  });

  // --- Scan breakdown by type (simple) ---
  const scansByType = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  // --- Top QRs ---
  const topQRs = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: '$qrCode', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'qrcodes', localField: '_id', foreignField: '_id', as: 'qr' } },
    { $unwind: { path: '$qr', preserveNullAndEmptyArrays: true } }
  ]);

  // --- Top performers ---
  const topUsers = await TaskCompletion.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: '$user', completions: { $sum: 1 } } },
    { $sort: { completions: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
  ]);

  // --- Station completion rates by shift ---
  const taskFilter = brandFilter.brand ? { brand: brandFilter.brand } : {};
  const allTasks = await Task.find({ ...taskFilter, active: true }).lean();
  const todayComps = await TaskCompletion.find({ ...brandFilter, shiftDate: today }).populate('task', 'type category area').lean();

  // Group tasks by area (from linked QR codes)
  const qrCodes = await QRCode.find({ ...(brandFilter.brand ? { brand: brandFilter.brand } : {}), active: true }).lean();
  const taskAreaMap = {};
  qrCodes.forEach(qr => {
    if (qr.task) taskAreaMap[qr.task.toString()] = qr.area || 'General';
  });
  allTasks.forEach(t => {
    if (!taskAreaMap[t._id.toString()]) taskAreaMap[t._id.toString()] = 'General';
  });

  // Build station cards: { area: { total, completed, byShift: { open: {total,done}, mid, close } } }
  const stationCards = {};
  allTasks.forEach(t => {
    const area = taskAreaMap[t._id.toString()] || 'General';
    const shift = t.shiftTime || 'any';
    if (!stationCards[area]) stationCards[area] = { total: 0, completed: 0, byShift: {} };
    stationCards[area].total++;
    if (!stationCards[area].byShift[shift]) stationCards[area].byShift[shift] = { total: 0, done: 0 };
    stationCards[area].byShift[shift].total++;
  });
  const completedTaskIds = new Set(todayComps.map(c => c.task?._id?.toString() || c.task?.toString()));
  allTasks.forEach(t => {
    if (completedTaskIds.has(t._id.toString())) {
      const area = taskAreaMap[t._id.toString()] || 'General';
      const shift = t.shiftTime || 'any';
      stationCards[area].completed++;
      if (stationCards[area].byShift[shift]) stationCards[area].byShift[shift].done++;
    }
  });

  // --- Recent scans ---
  const recentScans = await QRScan.find(brandFilter)
    .populate('qrCode', 'label type area position webhookCategory')
    .populate('user', 'displayName posPin')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  // --- Webhook scans ---
  const webhookScans = await QRScan.find({ ...brandFilter, type: 'webhook' })
    .populate('qrCode', 'label webhookCategory area position')
    .populate('user', 'displayName')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  // --- Hourly scan distribution (radar) ---
  const hourlyScans = await QRScan.aggregate([
    { $match: { ...brandFilter, createdAt: { $gte: since } } },
    { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  const hourlyData = Array(24).fill(0);
  hourlyScans.forEach(h => { hourlyData[h._id] = h.count; });

  res.render('admin/analytics/dashboard', {
    title: res.locals.t('analytics.title'),
    brands,
    selectedBrand: brandId || '',
    range,
    stats: { totalScans, totalCompletions, totalTasks, totalUsers, completionRate, todayCompletions },
    scansByDay,
    completionsByDay,
    heatmap,
    typeMap,
    scansByType,
    topQRs,
    topUsers,
    stationCards,
    hourlyData,
    recentScans,
    webhookScans
  });
});

module.exports = router;
