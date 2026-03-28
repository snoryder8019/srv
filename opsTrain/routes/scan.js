const express = require('express');
const UAParser = require('ua-parser-js');
const QRCode = require('../models/QRCode');
const QRScan = require('../models/QRScan');
const User = require('../models/User');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const ShiftNote = require('../models/ShiftNote');
const Special = require('../models/Special');
const Shift = require('../models/Shift');
const Brand = require('../models/Brand');
const { getShiftInfo } = require('../plugins/shiftTime');
const router = express.Router();

// GET /scan/:code — QR scanned, prompt PIN (always)
router.get('/:code', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true })
      .populate('brand')
      .populate('task');

    if (!qr) {
      return res.status(404).render('errors/error', {
        title: '404',
        message: res.locals.t('scan.invalidQR')
      });
    }

    // If already authed for THIS brand, skip PIN
    const shiftUser = req.session?.shiftUser;
    if (shiftUser && shiftUser.brand?.toString() === qr.brand._id.toString()) {
      return await logAndRoute(req, res, qr, shiftUser);
    }

    // Show PIN entry — brand-branded
    res.render('scan/pin-entry', {
      title: res.locals.t('scan.enterPos'),
      brand: qr.brand,
      qrCode: qr
    });
  } catch (err) {
    console.error('[scan error]', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      message: res.locals.t('errors.somethingWrong')
    });
  }
});

// POST /scan/:code/identify — validate PIN, log scan, redirect to shift view
router.post('/:code/identify', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true })
      .populate('brand')
      .populate('task');
    if (!qr) return res.status(404).json({ success: false, message: 'Invalid QR' });

    const pin = req.body.pin;
    if (!pin) return res.status(400).json({ success: false, message: 'PIN required' });

    // Look up user by PIN + brand
    const user = await User.findOne({ posPin: pin, brand: qr.brand._id });
    if (!user) {
      return res.status(401).json({ success: false, message: res.locals.t('scan.pinNotRecognized') });
    }

    // Store in session
    req.session.shiftUser = {
      _id: user._id,
      displayName: user.displayName,
      posPin: user.posPin,
      brand: user.brand,
      role: user.role
    };

    // Log the scan
    await logScan(req, qr, user);

    // Route based on QR type
    let redirect;
    if (qr.type === 'shift-login') {
      // Multi-step shift checkin: specials quiz, section, sidework
      redirect = `/scan/${qr.code}/checkin`;
    } else if (qr.type === 'webhook') {
      redirect = `/scan/${qr.code}/shift?webhook=1`;
    } else {
      redirect = `/scan/${qr.code}/shift`;
    }

    res.json({ success: true, user: user.displayName, redirect });
  } catch (err) {
    console.error('[identify error]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /scan/:code/checkin — multi-step shift checkin (specials quiz, section, sidework)
router.get('/:code/checkin', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true }).populate('brand');
    if (!qr) return res.redirect('/');
    const shiftUser = req.session?.shiftUser;
    if (!shiftUser) return res.redirect(`/scan/${req.params.code}`);

    const brandId = qr.brand._id;
    const d = new Date().toISOString().slice(0, 10);


    const specials = await Special.find({ brand: brandId, active: true, status: 'active' }).lean();
    const tasks = await Task.find({ brand: brandId, active: true, type: 'sidework' }).sort({ sortOrder: 1 }).lean();
    const notes = await ShiftNote.find({
      brand: brandId, active: true,
      $or: [{ shiftDate: d }, { pinned: true }]
    }).populate('author', 'displayName').sort({ pinned: -1, createdAt: -1 }).lean();

    // Find or create today's active shift using brand timezone
    const brandDoc = await Brand.findById(brandId).lean();
    const shiftInfo = getShiftInfo(brandDoc);
    let activeShift = await Shift.findOne({ brand: brandId, date: shiftInfo.date, status: 'active', shiftTime: shiftInfo.shiftTime });
    if (!activeShift) {
      activeShift = await Shift.findOneAndUpdate(
        { brand: brandId, date: shiftInfo.date, shiftTime: shiftInfo.shiftTime },
        { $setOnInsert: { status: 'active', activatedAt: new Date() } },
        { upsert: true, new: true }
      );
    }

    res.render('scan/checkin-flow', {
      title: res.locals.t('shift.checkin'),
      brand: qr.brand,
      qrCode: qr,
      shiftUser,
      specials,
      tasks,
      notes,
      activeShift,
      today: d
    });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// POST /scan/:code/checkin/quiz — generate quiz from shift content via Ollama
router.post('/:code/checkin/quiz', async (req, res) => {
  try {
    const { specials, notes } = req.body;
    const lang = res.locals.lang === 'es' ? 'Spanish' : 'English';

    // Build context from what the user just read
    let context = '';
    if (specials && specials.length) {
      context += 'TODAY\'S SPECIALS:\n';
      specials.forEach(s => { context += `- ${s.name}: ${s.description || ''} ${s.price || ''}\n`; });
    }
    if (notes && notes.length) {
      context += '\nSHIFT NOTES:\n';
      notes.forEach(n => { context += `- ${n.title || ''}: ${n.body}\n`; });
    }

    if (!context.trim()) {
      // No content to quiz on — return empty
      return res.json({ success: true, questions: [] });
    }

    const prompt = `You are a restaurant shift quiz generator. Based on this shift information, generate exactly 3 multiple-choice questions to test if the employee read and understood the content. Each question should have 4 answer options (A, B, C, D) with exactly 1 correct answer.

${context}

Respond in ${lang}. Return ONLY valid JSON, no markdown, no explanation. Format:
[{"q":"question text","options":["A answer","B answer","C answer","D answer"],"correct":0}]

Where "correct" is the 0-based index of the right answer. Mix up where the correct answer appears. Make wrong answers plausible but clearly wrong if you read the material.`;

    const response = await fetch(process.env.OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OLLAMA_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    // Parse JSON from response (handle possible markdown wrapping)
    let questions = [];
    try {
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      questions = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[quiz parse error]', content);
      questions = [];
    }

    res.json({ success: true, questions });
  } catch (err) {
    console.error('[quiz gen error]', err);
    res.json({ success: true, questions: [] }); // fail gracefully — skip quiz
  }
});

// POST /scan/:code/checkin/complete — submit full checkin
router.post('/:code/checkin/complete', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true });
    if (!qr) return res.status(404).json({ success: false });
    const shiftUser = req.session?.shiftUser;
    if (!shiftUser) return res.status(401).json({ success: false });


    const d = new Date().toISOString().slice(0, 10);

    // Clock into active shift
    if (req.body.shiftId) {
      const shift = await Shift.findById(req.body.shiftId);
      if (shift) {
        const member = shift.crew.find(c => c.posPin === shiftUser.posPin || c.user?.toString() === shiftUser._id?.toString());
        if (member) {
          member.present = true;
          member.clockIn = new Date();
          member.station = req.body.section || member.station;
        } else {
          shift.crew.push({
            user: shiftUser._id,
            displayName: shiftUser.displayName,
            posPin: shiftUser.posPin,
            present: true,
            clockIn: new Date(),
            station: req.body.section || ''
          });
        }
        await shift.save();
      }
    }

    // Mark sidework tasks as acknowledged
    const sideworkIds = req.body.sideworkIds || [];
    const today = new Date().toISOString().slice(0, 10);
    for (const taskId of sideworkIds) {
      await TaskCompletion.create({
        task: taskId,
        brand: qr.brand,
        user: shiftUser._id,
        posPin: shiftUser.posPin,
        shiftDate: today,
        shiftTime: 'any',
        note: 'Checked in via shift QR'
      });
    }

    // Acknowledge notes
    const noteIds = req.body.noteIds || [];
    for (const noteId of noteIds) {
      await ShiftNote.findByIdAndUpdate(noteId, {
        $addToSet: { acknowledgedBy: { user: shiftUser._id, at: new Date() } }
      });
    }

    // Log scan
    await logScan(req, qr, shiftUser);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// GET /scan/:code/shift — the main shift view after PIN auth
// Shows: tasks + personal analytics
router.get('/:code/shift', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true })
      .populate('brand')
      .populate('task');
    if (!qr) return res.redirect('/');

    const shiftUser = req.session?.shiftUser;
    if (!shiftUser) return res.redirect(`/scan/${req.params.code}`);

    const brandId = qr.brand._id;
    const brandDoc = await Brand.findById(brandId).lean();
    const { date: today } = getShiftInfo(brandDoc);
    const uid = shiftUser._id?.toString();
    const pin = shiftUser.posPin;

    // Tasks + completions
    const tasks = await Task.find({ brand: brandId, active: true }).sort({ sortOrder: 1 }).lean();
    const completions = await TaskCompletion.find({ brand: brandId, shiftDate: today })
      .populate('user', 'displayName posPin').lean();
    const completedTaskIds = new Set(completions.map(c => c.task.toString()));

    const tasksWithStatus = tasks.map(t => {
      const tid = t._id.toString();
      const comp = completions.find(c => c.task.toString() === tid);
      const myComp = completions.find(c => c.task.toString() === tid && (c.user?._id?.toString() === uid || c.posPin === pin));
      return {
        ...t,
        completed: completedTaskIds.has(tid),
        completion: comp,
        completedByMe: !!myComp,
        completedBy: comp?.user?.displayName || comp?.posPin || null
      };
    });

    // --- Personal analytics ---
    const userFilter = { brand: brandId, $or: [{ user: shiftUser._id }, { posPin: pin }] };
    const since7 = new Date(); since7.setDate(since7.getDate() - 7);
    const since30 = new Date(); since30.setDate(since30.getDate() - 30);

    // Today's personal stats
    const myTodayCount = completions.filter(c => c.user?._id?.toString() === uid || c.posPin === pin).length;
    const totalToday = tasks.length;
    const myTodayPct = totalToday > 0 ? Math.round(myTodayCount / totalToday * 100) : 0;

    // My scans today
    const myScansToday = await QRScan.countDocuments({ ...userFilter, createdAt: { $gte: new Date(today + 'T00:00:00Z') } });

    // 7-day completion history
    const myWeek = await TaskCompletion.aggregate([
      { $match: { brand: brandId, createdAt: { $gte: since7 }, $or: [{ user: shiftUser._id }, { posPin: pin }] } },
      { $group: { _id: '$shiftDate', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // 30-day total
    const my30Total = await TaskCompletion.countDocuments({ ...userFilter, createdAt: { $gte: since30 } });

    // Streak (consecutive days with at least 1 completion)
    const myDays = await TaskCompletion.aggregate([
      { $match: { brand: brandId, $or: [{ user: shiftUser._id }, { posPin: pin }] } },
      { $group: { _id: '$shiftDate' } },
      { $sort: { _id: -1 } }
    ]);
    let streak = 0;
    const checkDate = new Date();
    for (const d of myDays) {
      const ds = checkDate.toISOString().slice(0, 10);
      if (d._id === ds) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else break;
    }

    // Task type breakdown (my completions, 30 days)
    const myTypeBreakdown = await TaskCompletion.aggregate([
      { $match: { brand: brandId, createdAt: { $gte: since30 }, $or: [{ user: shiftUser._id }, { posPin: pin }] } },
      { $lookup: { from: 'tasks', localField: 'task', foreignField: '_id', as: 'taskDoc' } },
      { $unwind: { path: '$taskDoc', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$taskDoc.type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Leaderboard (30 days) with names
    const leaderboard = await TaskCompletion.aggregate([
      { $match: { brand: brandId, createdAt: { $gte: since30 } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } }
    ]);
    const myRank = leaderboard.findIndex(r => r._id?.toString() === uid) + 1 ||
      (await TaskCompletion.aggregate([
        { $match: { brand: brandId, createdAt: { $gte: since30 } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])).findIndex(r => r._id?.toString() === uid) + 1;
    const totalStaff = leaderboard.length;

    // Webhook confirmation flag
    const webhookLogged = req.query.webhook === '1';

    res.render('scan/shift-dashboard', {
      title: qr.brand.name,
      brand: qr.brand,
      qrCode: qr,
      tasks: tasksWithStatus,
      shiftUser,
      today,
      webhookLogged,
      me: {
        todayCount: myTodayCount,
        todayTotal: totalToday,
        todayPct: myTodayPct,
        scansToday: myScansToday,
        week: myWeek,
        total30: my30Total,
        streak,
        typeBreakdown: myTypeBreakdown,
        rank: myRank,
        totalStaff,
        leaderboard
      }
    });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// POST /scan/:code/complete — complete a task
router.post('/:code/complete', async (req, res) => {
  try {
    const qr = await QRCode.findOne({ code: req.params.code, active: true });
    if (!qr) return res.status(404).json({ success: false, message: 'Invalid QR' });

    const shiftUser = req.session?.shiftUser;
    const today = new Date().toISOString().slice(0, 10);

    const completion = await TaskCompletion.create({
      task: req.body.taskId || qr.task,
      brand: qr.brand,
      user: shiftUser?._id,
      posPin: shiftUser?.posPin || '',
      note: req.body.note || '',
      photoUrl: req.body.photo || '',
      shiftDate: today,
      shiftTime: req.body.shiftTime || 'any'
    });

    // Check shift completion % for confetti triggers
    const brandDoc = await Brand.findById(qr.brand).lean();
    const { date: shiftDate } = getShiftInfo(brandDoc);
    const totalTasks = await Task.countDocuments({ brand: qr.brand, active: true });
    const doneCount = await TaskCompletion.countDocuments({ brand: qr.brand, shiftDate });
    const pct = totalTasks > 0 ? Math.round(doneCount / totalTasks * 100) : 0;
    const isFirst = doneCount === 1;

    res.json({ success: true, message: 'OK', completionId: completion._id, pct, isFirst });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// Helper — ensure user is on today's shift crew (any scan = on the clock)
async function ensureOnShift(brandId, user) {
  const brand = await Brand.findById(brandId).lean();
  const { shiftTime, date: d } = getShiftInfo(brand);

  let shift = await Shift.findOne({ brand: brandId, date: d, shiftTime });
  if (!shift) {
    shift = await Shift.create({ brand: brandId, date: d, shiftTime, status: 'active', activatedAt: new Date() });
  }

  const uid = (user._id || user).toString();
  const pin = user.posPin || '';
  const onCrew = shift.crew.find(c =>
    (c.user && c.user.toString() === uid) || (pin && c.posPin === pin)
  );

  if (onCrew) {
    if (!onCrew.present) {
      onCrew.present = true;
      onCrew.clockIn = new Date();
      await shift.save();
    }
  } else {
    shift.crew.push({
      user: user._id || user,
      displayName: user.displayName || 'Unknown',
      posPin: pin,
      present: true,
      clockIn: new Date()
    });
    await shift.save();
  }
}

// Helper — log scan with device info + auto clock-in
async function logScan(req, qr, user) {
  const ua = new UAParser(req.headers['user-agent']);
  const device = ua.getResult();

  const brandId = qr.brand?._id || qr.brand;

  // Log the scan
  await QRScan.create({
    qrCode: qr._id,
    brand: brandId,
    user: user._id || user,
    posPin: user.posPin || '',
    type: qr.type,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    device: device.device?.model || device.device?.type || 'unknown',
    os: `${device.os?.name || ''} ${device.os?.version || ''}`.trim(),
    browser: `${device.browser?.name || ''} ${device.browser?.version || ''}`.trim(),
    webhookCategory: qr.webhookCategory,
    webhookMeta: qr.webhookMeta
  });

  // Auto clock-in to today's shift
  await ensureOnShift(brandId, user);
}

// Helper — for already-authed users, log & route
async function logAndRoute(req, res, qr, shiftUser) {
  await logScan(req, qr, shiftUser);
  if (qr.type === 'shift-login') {
    return res.redirect(`/scan/${qr.code}/checkin`);
  }
  const webhook = qr.type === 'webhook' ? '?webhook=1' : '';
  return res.redirect(`/scan/${qr.code}/shift${webhook}`);
}

module.exports = router;
