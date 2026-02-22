const router = require('express').Router();
const Ticket = require('../models/Ticket');

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

function isStaff(user) {
  return user && (user.isAdmin === true || user.isBIH === true);
}

function ensureStaff(req, res, next) {
  if (isStaff(req.user)) return next();
  res.status(403).render('tickets/forbidden');
}

// Ticket list — users see own, staff see all
router.get('/', ensureAuth, async (req, res) => {
  try {
    const staff = isStaff(req.user);
    const query = staff ? {} : { user: req.user._id };
    const tickets = await Ticket.find(query)
      .populate('user', 'displayName email avatar')
      .sort({ updatedAt: -1 })
      .lean();
    res.render('tickets/index', { tickets, staff });
  } catch (err) {
    console.error(err);
    res.render('tickets/index', { tickets: [], staff: false });
  }
});

// New ticket form
router.get('/new', ensureAuth, (req, res) => {
  res.render('tickets/new', { error: null });
});

// Create ticket
router.post('/', ensureAuth, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !subject.trim() || !message || !message.trim()) {
      return res.render('tickets/new', { error: 'Subject and message are required' });
    }
    await Ticket.create({
      user: req.user._id,
      subject: subject.trim(),
      message: message.trim()
    });
    res.redirect('/tickets');
  } catch (err) {
    console.error(err);
    res.render('tickets/new', { error: 'Failed to create ticket' });
  }
});

// Ticket detail
router.get('/:id', ensureAuth, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('user', 'displayName email avatar')
      .populate('actions.by', 'displayName email avatar')
      .lean();
    if (!ticket) return res.redirect('/tickets');
    const staff = isStaff(req.user);
    // Regular users can only view their own tickets
    if (!staff && ticket.user._id.toString() !== req.user._id.toString()) {
      return res.redirect('/tickets');
    }
    res.render('tickets/show', { ticket, staff });
  } catch (err) {
    console.error(err);
    res.redirect('/tickets');
  }
});

// Add action (staff only)
router.post('/:id/action', ensureAuth, ensureStaff, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.redirect(`/tickets/${req.params.id}`);
    await Ticket.findByIdAndUpdate(req.params.id, {
      $push: { actions: { by: req.user._id, message: message.trim() } },
      updatedAt: new Date()
    });
    res.redirect(`/tickets/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/tickets/${req.params.id}`);
  }
});

// Update status (staff only)
router.post('/:id/status', ensureAuth, ensureStaff, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['open', 'in-progress', 'closed'];
    if (!valid.includes(status)) return res.redirect(`/tickets/${req.params.id}`);
    await Ticket.findByIdAndUpdate(req.params.id, { status, updatedAt: new Date() });
    res.redirect(`/tickets/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/tickets/${req.params.id}`);
  }
});

module.exports = router;
