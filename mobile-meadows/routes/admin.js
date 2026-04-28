const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { ensureAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Booking = require('../models/Booking');
const CalendarSlot = require('../models/CalendarSlot');
const SiteContent = require('../models/SiteContent');
const SiteTheme = require('../models/SiteTheme');
const RoofCalculator = require('../models/RoofCalculator');
const { sendBookingConfirmation } = require('../utils/mailer');

// Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1000)}${ext}`);
  }
});
const upload = multer({ storage });

// All admin routes require admin role
router.use(ensureAdmin);

// Use admin layout for all admin views
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

// ── Dashboard ──
router.get('/', async (req, res) => {
  const [bookings, slots, users] = await Promise.all([
    Booking.find().sort({ createdAt: -1 }).limit(20).populate('slot'),
    CalendarSlot.find({ date: { $gte: new Date() } }).sort({ date: 1 }).limit(20),
    User.countDocuments()
  ]);
  res.render('pages/admin/dashboard', {
    title: 'Admin Dashboard',
    bookings, slots, userCount: users
  });
});

// ── CMS: Site Content ──
router.get('/content', async (req, res) => {
  const sections = await SiteContent.find({}).sort({ section: 1 });
  res.render('pages/admin/content', { title: 'Edit Site Content', sections });
});

router.post('/content/:section', upload.single('image'), async (req, res) => {
  const data = {
    heading: req.body.heading,
    subheading: req.body.subheading,
    body: req.body.body,
    buttonText: req.body.buttonText,
    buttonLink: req.body.buttonLink,
    updatedBy: req.user._id,
    updatedAt: new Date()
  };
  if (req.file) {
    data.image = `/uploads/${req.file.filename}`;
  }
  await SiteContent.findOneAndUpdate(
    { section: req.params.section },
    data,
    { upsert: true, new: true }
  );
  res.redirect('/admin/content');
});

// ── Calendar Slots ──
router.get('/calendar', async (req, res) => {
  const slots = await CalendarSlot.find().sort({ date: 1 });
  res.render('pages/admin/calendar', { title: 'Manage Calendar', slots });
});

router.post('/calendar/slot', async (req, res) => {
  await CalendarSlot.create({
    date: req.body.date,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    serviceType: req.body.serviceType,
    location: {
      label: req.body.locationLabel || '',
      address: req.body.locationAddress || ''
    },
    maxBookings: req.body.maxBookings || 1,
    createdBy: req.user._id
  });
  res.redirect('/admin/calendar');
});

router.delete('/calendar/slot/:id', async (req, res) => {
  await CalendarSlot.findByIdAndDelete(req.params.id);
  res.redirect('/admin/calendar');
});

// ── Bookings ──
router.get('/bookings', async (req, res) => {
  const bookings = await Booking.find()
    .sort({ createdAt: -1 })
    .populate('user slot');
  res.render('pages/admin/bookings', { title: 'Manage Bookings', bookings });
});

router.post('/bookings/:id/confirm', async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (booking) {
    booking.status = 'confirmed';
    booking.confirmedAt = new Date();
    booking.adminNotes = req.body.adminNotes || booking.adminNotes;
    await booking.save();
    const email = booking.guestEmail || (booking.user ? (await User.findById(booking.user))?.email : null);
    if (email) await sendBookingConfirmation(email, booking);
    const io = req.app.get('io');
    io.emit('booking-confirmed', { bookingId: booking._id });
  }
  res.redirect('/admin/bookings');
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (booking) {
    booking.status = 'cancelled';
    await booking.save();
    if (booking.slot) {
      await CalendarSlot.findByIdAndUpdate(booking.slot, {
        $inc: { currentBookings: -1 },
        isAvailable: true
      });
    }
  }
  res.redirect('/admin/bookings');
});

// ── User Management ──
router.get('/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.render('pages/admin/users', { title: 'Manage Users', users });
});

router.post('/users/:id/role', async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { role: req.body.role });
  res.redirect('/admin/users');
});

// ── Design / Theme ──
router.get('/design', async (req, res) => {
  const theme = await SiteTheme.getActive();
  res.render('pages/admin/design', { title: 'Site Design', theme });
});

router.post('/design/theme', async (req, res) => {
  await SiteTheme.findOneAndUpdate(
    {},
    { activeTheme: req.body.activeTheme, updatedBy: req.user._id, updatedAt: new Date() },
    { upsert: true }
  );
  res.redirect('/admin/design');
});

router.post('/design/settings', async (req, res) => {
  const update = {
    heroStyle: req.body.heroStyle,
    heroOverlayOpacity: parseFloat(req.body.heroOverlayOpacity) || 0.6,
    updatedBy: req.user._id,
    updatedAt: new Date()
  };
  if (req.body.customColors) {
    const cc = {};
    for (const [key, val] of Object.entries(req.body.customColors)) {
      if (val && val.trim() && val.trim().startsWith('#') && val.trim().length >= 4) {
        cc[key] = val.trim();
      }
    }
    if (Object.keys(cc).length > 0) update.customColors = cc;
  }
  await SiteTheme.findOneAndUpdate({}, update, { upsert: true });
  res.redirect('/admin/design');
});

router.post('/design/reset', async (req, res) => {
  await SiteTheme.findOneAndUpdate(
    {},
    { $unset: { customColors: 1 }, updatedBy: req.user._id, updatedAt: new Date() },
    { upsert: true }
  );
  res.redirect('/admin/design');
});

// ── Roof Calculator Admin ──
router.get('/calculator', async (req, res) => {
  const calc = await RoofCalculator.getConfig();
  res.render('pages/admin/calculator', { title: 'Roof Cost Calculator', calc });
});

router.post('/calculator/rates', async (req, res) => {
  await RoofCalculator.findOneAndUpdate({}, {
    costPerFoot: parseFloat(req.body.costPerFoot) || 12,
    costPerAC:   parseFloat(req.body.costPerAC)   || 75,
    noteText:    req.body.noteText || 'Estimate only — final price confirmed on inspection.',
    enabled:     req.body.enabled === 'on',
    updatedBy:   req.user._id,
    updatedAt:   new Date()
  }, { upsert: true });
  res.redirect('/admin/calculator');
});

router.post('/calculator/addon/add', async (req, res) => {
  const cfg = await RoofCalculator.getConfig();
  const id = req.body.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  cfg.addOns.push({
    id: id + '-' + Date.now(),
    label: req.body.label,
    cost: parseFloat(req.body.cost) || 0,
    type: req.body.type || 'checkbox',
    enabled: true
  });
  cfg.updatedAt = new Date();
  await cfg.save();
  res.redirect('/admin/calculator');
});

router.post('/calculator/addon/delete/:addonId', async (req, res) => {
  const cfg = await RoofCalculator.getConfig();
  cfg.addOns = cfg.addOns.filter(a => a.id !== req.params.addonId);
  cfg.updatedAt = new Date();
  await cfg.save();
  res.redirect('/admin/calculator');
});

router.post('/calculator/addon/update/:addonId', async (req, res) => {
  const cfg = await RoofCalculator.getConfig();
  const addon = cfg.addOns.find(a => a.id === req.params.addonId);
  if (addon) {
    addon.label   = req.body.label   || addon.label;
    addon.cost    = parseFloat(req.body.cost) || 0;
    addon.type    = req.body.type    || addon.type;
    addon.enabled = req.body.enabled === 'on';
  }
  cfg.updatedAt = new Date();
  await cfg.save();
  res.redirect('/admin/calculator');
});

// ── AI Content Suggest (Ollama) ──
router.post('/ai/suggest', async (req, res) => {
  const { section, field, currentValue } = req.body;
  if (!section || !field) return res.status(400).json({ error: 'section and field required' });

  const sectionLabels = {
    'hero': 'the hero/banner section of a mobile RV & motorhome repair business website',
    'mobile-repair': 'the mobile RV & motorhome on-site repair service section',
    'roof-repair': 'the RV roof repair service section (inspections, patching, coating, replacement)',
    'about': 'the about section for a Branson, MO mobile RV repair business',
    'contact': 'the contact section for a mobile RV repair business',
    'footer': 'the footer of a mobile RV repair business website'
  };
  const fieldLabels = {
    heading: 'a short, punchy heading (under 10 words)',
    subheading: 'a brief subheading/tagline (under 20 words)',
    body: 'compelling body copy (2-3 sentences, persuasive, professional)',
    buttonText: 'short call-to-action button text (2-4 words)'
  };
  const context = sectionLabels[section] || `the ${section} section`;
  const ask = fieldLabels[field] || `${field} content`;
  const prompt = currentValue
    ? `Improve the following ${field} for ${context}. Current text: "${currentValue}". Write ${ask}. Return ONLY the new text, no quotes or explanation.`
    : `Write ${ask} for ${context}. The business is Mobile Meadows — mobile RV & motorhome repair in Branson, MO. Return ONLY the text, no quotes or explanation.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const response = await fetch(`${process.env.OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OLLAMA_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-r1:7b',
        messages: [
          { role: 'system', content: 'You are a professional copywriter. Write concise, compelling website copy. Never include quotes, labels, or explanations — only the final text.' },
          { role: 'user', content: prompt }
        ],
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content) || '';
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    res.json({ success: true, suggestion: cleaned });
  } catch (err) {
    console.error('AI suggest error:', err.message);
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

module.exports = router;
