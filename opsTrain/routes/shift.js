const express = require('express');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const ShiftNote = require('../models/ShiftNote');
const Special = require('../models/Special');
const Brand = require('../models/Brand');
const { requireShiftUser } = require('../middleware/roles');
const router = express.Router();

// Shift check-in page (enter PIN) — intentionally public (staff scan QR to get here)
router.get('/checkin', async (req, res) => {
  const brandId = req.query.brandId;
  let brand = null;
  if (brandId) brand = await Brand.findById(brandId).lean();
  res.render('shift/checkin', {
    title: 'Shift Check-In',
    brand,
    qrCode: null
  });
});

// All routes below require a shift user (PIN login) or admin session
router.use(requireShiftUser);

// Task list for a brand
router.get('/tasks', async (req, res) => {
  const brandId = req.query.brandId || req.session?.shiftUser?.brand;
  if (!brandId) return res.redirect('/shift/checkin');

  const brand = await Brand.findById(brandId).lean();
  const today = new Date().toISOString().slice(0, 10);

  const tasks = await Task.find({ brand: brandId, active: true }).sort({ sortOrder: 1 }).lean();
  const completions = await TaskCompletion.find({ brand: brandId, shiftDate: today }).lean();

  // Map completions to tasks
  const completedTaskIds = new Set(completions.map(c => c.task.toString()));
  const tasksWithStatus = tasks.map(t => ({
    ...t,
    completed: completedTaskIds.has(t._id.toString()),
    completion: completions.find(c => c.task.toString() === t._id.toString())
  }));

  // Shift notes for today
  const notes = await ShiftNote.find({
    brand: brandId,
    active: true,
    $or: [
      { shiftDate: today },
      { pinned: true }
    ]
  }).populate('author', 'displayName').sort({ pinned: -1, createdAt: -1 }).lean();

  // Active specials
  const specials = await Special.find({ brand: brandId, active: true, status: 'active' }).lean();

  const shiftUser = req.session?.shiftUser || req.user;

  res.render('shift/tasks', {
    title: 'Shift Tasks',
    brand,
    tasks: tasksWithStatus,
    notes,
    specials,
    shiftUser,
    today
  });
});

// Complete a task via the task list (POST)
router.post('/tasks/:taskId/complete', async (req, res) => {
  try {
    const shiftUser = req.session?.shiftUser || req.user;
    const today = new Date().toISOString().slice(0, 10);

    await TaskCompletion.create({
      task: req.params.taskId,
      brand: req.body.brandId,
      user: shiftUser?._id,
      posPin: req.body.posPin || shiftUser?.posPin || '',
      note: req.body.note || '',
      shiftDate: today,
      shiftTime: req.body.shiftTime || 'any'
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error completing task' });
  }
});

// Shift notes page (standalone)
router.get('/notes', async (req, res) => {
  const brandId = req.query.brandId || req.session?.shiftUser?.brand;
  if (!brandId) return res.redirect('/');

  const Brand = require('../models/Brand');
  const brand = await Brand.findById(brandId).lean();
  const { getShiftInfo } = require('../plugins/shiftTime');
  const { date: today } = getShiftInfo(brand);

  const notes = await ShiftNote.find({
    brand: brandId, active: true,
    $or: [{ shiftDate: today }, { pinned: true }]
  }).populate('author', 'displayName').sort({ pinned: -1, createdAt: -1 }).lean();

  const specials = await Special.find({ brand: brandId, active: true, status: 'active' }).lean();
  const shiftUser = req.session?.shiftUser || req.user;

  res.render('shift/notes', { title: res.locals.t('shift.shiftNotes'), brand, notes, specials, shiftUser, today });
});

// Acknowledge a shift note
router.post('/notes/:noteId/ack', async (req, res) => {
  try {
    const shiftUser = req.session?.shiftUser || req.user;
    if (!shiftUser) return res.status(401).json({ success: false });

    await ShiftNote.findByIdAndUpdate(req.params.noteId, {
      $addToSet: {
        acknowledgedBy: { user: shiftUser._id, at: new Date() }
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
