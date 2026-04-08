const express = require('express');
const Brand = require('../models/Brand');
const Shift = require('../models/Shift');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const QRScan = require('../models/QRScan');
const Special = require('../models/Special');
const { getShiftInfo } = require('../plugins/shiftTime');
const { requireRole } = require('../middleware/roles');
const router = express.Router();

// Live dashboard requires manager+ access
router.use(requireRole('manager'));

// GET /live?brandId=xxx&date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const brandId = req.query.brandId;
  if (!brandId) {
    const brands = await Brand.find({ active: true }).select('name color').lean();
    return res.render('live/pick', { title: 'Live', brands });
  }

  const brand = await Brand.findById(brandId).lean();
  if (!brand) return res.redirect('/live');

  const info = getShiftInfo(brand);
  const viewDate = req.query.date || info.date;
  const isToday = viewDate === info.date;

  // All shifts for this date
  const shifts = await Shift.find({ brand: brandId, date: viewDate }).sort({ shiftTime: 1 }).lean();
  const currentShift = isToday ? (shifts.find(s => s.shiftTime === info.shiftTime) || shifts[0]) : shifts[0];

  // Tasks + completions
  const tasks = await Task.find({ brand: brandId, active: true }).sort({ sortOrder: 1 }).lean();
  const completions = await TaskCompletion.find({ brand: brandId, shiftDate: viewDate })
    .populate('user', 'displayName posPin').sort({ createdAt: -1 }).lean();

  const doneIds = new Set(completions.map(c => c.task.toString()));
  const doneCount = new Set(completions.map(c => c.task.toString())).size;
  const totalTasks = tasks.length;
  const pct = totalTasks > 0 ? Math.round(doneCount / totalTasks * 100) : 0;

  // Recent scans (last 30)
  const scanFilter = { brand: brandId };
  if (isToday) {
    const startOfDay = new Date(viewDate + 'T00:00:00Z');
    scanFilter.createdAt = { $gte: startOfDay };
  } else {
    const start = new Date(viewDate + 'T00:00:00Z');
    const end = new Date(viewDate + 'T23:59:59Z');
    scanFilter.createdAt = { $gte: start, $lte: end };
  }
  const recentScans = await QRScan.find(scanFilter)
    .populate('qrCode', 'label type area webhookCategory')
    .populate('user', 'displayName')
    .sort({ createdAt: -1 }).limit(30).lean();

  // Specials
  const specials = await Special.find({ brand: brandId, active: true, status: 'active' }).lean();

  // Shift history — last 14 dates with shifts
  const history = await Shift.aggregate([
    { $match: { brand: brand._id } },
    { $group: {
      _id: '$date',
      shifts: { $push: { shiftTime: '$shiftTime', crewCount: { $size: '$crew' }, present: { $size: { $filter: { input: '$crew', as: 'c', cond: '$$c.present' } } } } }
    }},
    { $sort: { _id: -1 } },
    { $limit: 21 }
  ]);

  // Per-station breakdown for current view
  const stations = {};
  if (currentShift) {
    currentShift.crew.forEach(c => {
      const stn = c.station || 'unassigned';
      if (!stations[stn]) stations[stn] = { present: 0, total: 0, crew: [] };
      stations[stn].total++;
      if (c.present) stations[stn].present++;
      stations[stn].crew.push(c);
    });
  }

  res.render('live/dashboard', {
    title: brand.name + ' — Live',
    brand,
    viewDate,
    isToday,
    shifts,
    currentShift,
    tasks,
    completions,
    doneCount,
    totalTasks,
    pct,
    recentScans,
    specials,
    history,
    stations,
    currentShiftTime: info.shiftTime
  });
});

module.exports = router;
