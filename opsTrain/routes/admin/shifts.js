const express = require('express');
const Shift = require('../../models/Shift');
const Brand = require('../../models/Brand');
const User = require('../../models/User');
const ShiftNote = require('../../models/ShiftNote');
const { getShiftInfo } = require('../../plugins/shiftTime');
const router = express.Router();

// GET /admin/shifts — list shifts
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.brandId) filter.brand = req.query.brandId;
  else if (req.user.role === 'brandAdmin') filter.brand = req.user.brand;
  if (req.query.date) filter.date = req.query.date;

  const shifts = await Shift.find(filter).populate('brand', 'name color').sort({ date: -1, shiftTime: 1 }).limit(50).lean();
  const brands = await Brand.find({ active: true }).select('name').lean();

  res.render('admin/shifts/index', {
    title: lang(res) === 'es' ? 'Turnos' : 'Shifts',
    shifts,
    brands,
    selectedBrand: req.query.brandId || '',
    selectedDate: req.query.date || ''
  });
});

// GET /admin/shifts/command — live shift command dashboard
router.get('/command', async (req, res) => {
  const brandId = req.query.brandId;
  if (!brandId) {
    const brands = await Brand.find({ active: true }).select('name color').lean();
    return res.render('admin/shifts/pick-brand', {
      title: lang(res) === 'es' ? 'Comando de Turno' : 'Shift Command',
      brands
    });
  }

  const brand = await Brand.findById(brandId).lean();
  const { date: d, shiftTime: currentShift, timezone } = getShiftInfo(brand);

  // Auto-create today's shifts if they don't exist (we live in the shift)
  for (const st of ['open', 'mid', 'close']) {
    const exists = await Shift.findOne({ brand: brandId, date: d, shiftTime: st });
    if (!exists) {
      await Shift.create({ brand: brandId, date: d, shiftTime: st, status: 'active', activatedAt: new Date(), createdBy: req.user._id });
    }
  }

  const shifts = await Shift.find({ brand: brandId, date: d }).sort({ shiftTime: 1 }).lean();
  const activeShift = shifts.find(s => s.shiftTime === currentShift) || shifts[0];

  // Available staff
  const staff = await User.find({ brand: brandId, role: 'user' }).select('displayName posPin').sort({ displayName: 1 }).lean();

  // Tasks + completions for today
  const Task = require('../../models/Task');
  const TaskCompletion = require('../../models/TaskCompletion');
  const tasks = await Task.find({ brand: brandId, active: true }).sort({ sortOrder: 1 }).lean();
  const completions = await TaskCompletion.find({ brand: brandId, shiftDate: d })
    .populate('user', 'displayName posPin').lean();

  const completedMap = {};
  completions.forEach(c => {
    const tid = c.task.toString();
    if (!completedMap[tid]) completedMap[tid] = [];
    completedMap[tid].push({
      _id: c._id,
      by: c.user?.displayName || c.posPin || '?',
      at: c.createdAt,
      photo: c.photoUrl || '',
      validated: c.validated || false,
      note: c.note || ''
    });
  });

  const tasksWithStatus = tasks.map(t => ({
    ...t,
    completed: !!completedMap[t._id.toString()],
    completions: completedMap[t._id.toString()] || []
  }));

  res.render('admin/shifts/command', {
    title: lang(res) === 'es' ? 'Comando de Turno' : 'Shift Command',
    brand,
    shifts,
    activeShift,
    staff,
    tasks: tasksWithStatus,
    today: d
  });
});

// POST /admin/shifts — create a shift
router.post('/', async (req, res) => {
  try {
    const { brandId, date, shiftTime, notes } = req.body;
    let shift = await Shift.findOne({ brand: brandId, date: date || new Date().toISOString().slice(0,10), shiftTime });
    if (shift) {
      return res.status(409).json({ success: false, message: 'Shift already exists', shiftId: shift._id });
    }
    shift = await Shift.create({
      brand: brandId,
      date: date || new Date().toISOString().slice(0,10),
      shiftTime,
      status: 'draft',
      notes: notes || '',
      createdBy: req.user._id
    });
    res.json({ success: true, shiftId: shift._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error creating shift' });
  }
});

// POST /admin/shifts/:id/crew — add crew member
router.post('/:id/crew', async (req, res) => {
  try {
    const { userId, displayName, posPin, role, station } = req.body;
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ success: false });

    // Check if already on crew
    const existing = shift.crew.find(c =>
      (userId && c.user?.toString() === userId) ||
      (posPin && c.posPin === posPin)
    );
    if (existing) {
      existing.role = role || existing.role;
      existing.station = station || existing.station;
      existing.displayName = displayName || existing.displayName;
    } else {
      shift.crew.push({
        user: userId || undefined,
        displayName,
        posPin: posPin || '',
        role: role || '',
        station: station || '',
        present: false
      });
    }
    await shift.save();
    res.json({ success: true, crew: shift.crew });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/crew/:crewId/remove — remove crew member
router.post('/:id/crew/:crewId/remove', async (req, res) => {
  try {
    await Shift.findByIdAndUpdate(req.params.id, {
      $pull: { crew: { _id: req.params.crewId } }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/crew/:crewId/clockin — clock in crew member
router.post('/:id/crew/:crewId/clockin', async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    const member = shift.crew.id(req.params.crewId);
    if (member) {
      member.present = true;
      member.clockIn = new Date();
      await shift.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/crew/:crewId/clockout — clock out crew member
router.post('/:id/crew/:crewId/clockout', async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    const member = shift.crew.id(req.params.crewId);
    if (member) {
      member.present = false;
      member.clockOut = new Date();
      await shift.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/crew/:crewId/update — update role/station/note
router.post('/:id/crew/:crewId/update', async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    const member = shift.crew.id(req.params.crewId);
    if (member) {
      if (req.body.role !== undefined) member.role = req.body.role;
      if (req.body.station !== undefined) member.station = req.body.station;
      if (req.body.note !== undefined) member.note = req.body.note;
      await shift.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/activate
router.post('/:id/activate', async (req, res) => {
  try {
    // Deactivate other active shifts for same brand+date
    const shift = await Shift.findById(req.params.id);
    await Shift.updateMany(
      { brand: shift.brand, date: shift.date, status: 'active' },
      { $set: { status: 'draft' } }
    );
    shift.status = 'active';
    shift.activatedAt = new Date();
    await shift.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/close
router.post('/:id/close', async (req, res) => {
  try {
    await Shift.findByIdAndUpdate(req.params.id, {
      status: 'closed',
      closedAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/notes — update shift notes
router.post('/:id/notes', async (req, res) => {
  try {
    await Shift.findByIdAndUpdate(req.params.id, { notes: req.body.notes || '' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/:id/roster — bulk add crew from roster scan
router.post('/:id/roster', async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ success: false });

    const entries = req.body.entries || [];
    for (const e of entries) {
      if (!e.displayName) continue;
      const existing = shift.crew.find(c => c.posPin === e.posPin && e.posPin);
      if (!existing) {
        shift.crew.push({
          user: e.userId || undefined,
          displayName: e.displayName,
          posPin: e.posPin || '',
          role: e.role || '',
          station: e.station || '',
          present: false
        });
      }
    }
    await shift.save();
    res.json({ success: true, crew: shift.crew });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// --- Task completion management ---

// POST /admin/shifts/completions/:id/validate — admin validates a completion
router.post('/completions/:id/validate', async (req, res) => {
  try {
    const TaskCompletion = require('../../models/TaskCompletion');
    await TaskCompletion.findByIdAndUpdate(req.params.id, {
      validated: true,
      validatedBy: req.user._id,
      validatedAt: new Date()
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// POST /admin/shifts/completions/:id/unvalidate — undo validation
router.post('/completions/:id/unvalidate', async (req, res) => {
  try {
    const TaskCompletion = require('../../models/TaskCompletion');
    await TaskCompletion.findByIdAndUpdate(req.params.id, {
      validated: false, validatedBy: null, validatedAt: null
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// POST /admin/shifts/completions/:id/photo — admin attaches photo to completion
router.post('/completions/:id/photo', async (req, res) => {
  try {
    const TaskCompletion = require('../../models/TaskCompletion');
    await TaskCompletion.findByIdAndUpdate(req.params.id, {
      photoUrl: req.body.photo || ''
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// --- Inline task management from command view ---

// POST /admin/shifts/tasks — quick-add task
router.post('/tasks', async (req, res) => {
  try {
    const Task = require('../../models/Task');
    await Task.create({
      brand: req.body.brandId,
      title: req.body.title,
      type: req.body.type || 'sidework',
      frequency: 'daily',
      shiftTime: req.body.shiftTime || 'any',
      sortOrder: parseInt(req.body.sortOrder) || 99
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/tasks/:id/update — inline edit
router.post('/tasks/:id/update', async (req, res) => {
  try {
    const Task = require('../../models/Task');
    const update = {};
    if (req.body.title !== undefined) update.title = req.body.title;
    if (req.body.type !== undefined) update.type = req.body.type;
    if (req.body.shiftTime !== undefined) update.shiftTime = req.body.shiftTime;
    if (req.body.sortOrder !== undefined) update.sortOrder = parseInt(req.body.sortOrder);
    if (req.body.active !== undefined) update.active = req.body.active;
    await Task.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /admin/shifts/tasks/:id/delete — disable task
router.post('/tasks/:id/delete', async (req, res) => {
  try {
    const Task = require('../../models/Task');
    await Task.findByIdAndUpdate(req.params.id, { active: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

function lang(res) { return res.locals.lang || 'en'; }

module.exports = router;
