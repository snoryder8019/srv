const express = require('express');
const router = express.Router();
const Delegate = require('../../models/Delegate');
const GameEvent = require('../../models/GameEvent');
const User = require('../../models/User');
const { ensureAdmin } = require('../../middleware/auth');

router.use(ensureAdmin);

// --- Delegate Management ---
router.get('/', async (req, res) => {
  try {
    const [delegates, counts] = await Promise.all([
      Delegate.find().populate('user', 'displayName email avatar').sort({ createdAt: -1 }),
      Promise.all([
        Delegate.countDocuments({ status: 'pending' }),
        Delegate.countDocuments({ status: 'approved' }),
        Delegate.countDocuments({ status: 'rejected' }),
        Delegate.countDocuments({ status: 'suspended' })
      ])
    ]);
    res.render('admin/delegates', {
      delegates,
      counts: { pending: counts[0], approved: counts[1], rejected: counts[2], suspended: counts[3] },
      schools: Delegate.SCHOOLS
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load delegates.' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const delegate = await Delegate.findById(req.params.id).populate('user');
    if (!delegate) { req.flash('error', 'Delegate not found.'); return res.redirect('/admin/delegates'); }

    delegate.status = 'approved';
    await delegate.save();

    // Grant permissions on user
    if (delegate.user) {
      const user = delegate.user;
      if (!user.roles.includes('delegate')) user.roles.push('delegate');
      user.permissions.canUploadVideo = true;
      user.permissions.canBroadcast = true;
      await user.save();
    }

    req.flash('success', `${delegate.fullName} approved as delegate.`);
    res.redirect('/admin/delegates');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to approve delegate.');
    res.redirect('/admin/delegates');
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    await Delegate.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    req.flash('success', 'Delegate rejected.');
    res.redirect('/admin/delegates');
  } catch (err) {
    req.flash('error', 'Failed.');
    res.redirect('/admin/delegates');
  }
});

router.post('/:id/suspend', async (req, res) => {
  try {
    const delegate = await Delegate.findById(req.params.id).populate('user');
    delegate.status = 'suspended';
    await delegate.save();

    if (delegate.user) {
      delegate.user.permissions.canBroadcast = false;
      await delegate.user.save();
    }

    req.flash('success', 'Delegate suspended.');
    res.redirect('/admin/delegates');
  } catch (err) {
    req.flash('error', 'Failed.');
    res.redirect('/admin/delegates');
  }
});

// --- Game Event Management ---
router.get('/games', async (req, res) => {
  try {
    const games = await GameEvent.find()
      .populate('delegates', 'fullName schools')
      .populate('createdBy', 'displayName')
      .sort({ gameDate: -1 });

    const approvedDelegates = await Delegate.find({ status: 'approved' }).populate('user', 'displayName');

    res.render('admin/games', {
      games,
      approvedDelegates,
      sports: GameEvent.SPORTS,
      venues: GameEvent.VENUES,
      schools: Delegate.SCHOOLS
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load games.' });
  }
});

router.post('/games', async (req, res) => {
  try {
    const { title, sport, homeTeam, awayTeam, venue, venueAddress, gameDate, gameTime, broadcastType, delegates } = req.body;
    const delegateArr = Array.isArray(delegates) ? delegates : (delegates ? [delegates] : []);

    await GameEvent.create({
      title, sport, homeTeam, awayTeam, venue, venueAddress,
      gameDate, gameTime, broadcastType,
      delegates: delegateArr,
      createdBy: req.user._id
    });

    req.flash('success', 'Game event created.');
    res.redirect('/admin/delegates/games');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create game event.');
    res.redirect('/admin/delegates/games');
  }
});

router.post('/games/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['scheduled', 'live', 'completed', 'cancelled'].includes(status)) {
      return res.json({ error: 'Invalid status' });
    }
    await GameEvent.findByIdAndUpdate(req.params.id, { status });
    req.flash('success', 'Game status updated.');
    res.redirect('/admin/delegates/games');
  } catch (err) {
    req.flash('error', 'Failed.');
    res.redirect('/admin/delegates/games');
  }
});

router.delete('/games/:id', async (req, res) => {
  try {
    await GameEvent.findByIdAndDelete(req.params.id);
    req.flash('success', 'Game deleted.');
    res.redirect('/admin/delegates/games');
  } catch (err) {
    req.flash('error', 'Failed.');
    res.redirect('/admin/delegates/games');
  }
});

// --- User Role Management (enhanced) ---
router.post('/users/:id/roles', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.json({ error: 'User not found' });

    const { roles, canPost, canUploadVideo, canBroadcast, canModerate, canManageEvents } = req.body;
    user.roles = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    user.permissions.canPost = canPost === 'on';
    user.permissions.canUploadVideo = canUploadVideo === 'on';
    user.permissions.canBroadcast = canBroadcast === 'on';
    user.permissions.canModerate = canModerate === 'on';
    user.permissions.canManageEvents = canManageEvents === 'on';
    await user.save();

    req.flash('success', `Roles updated for ${user.displayName}`);
    res.redirect('/admin/delegates');
  } catch (err) {
    req.flash('error', 'Failed to update roles.');
    res.redirect('/admin/delegates');
  }
});

module.exports = router;
