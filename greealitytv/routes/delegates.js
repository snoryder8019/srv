const express = require('express');
const router = express.Router();
const Delegate = require('../models/Delegate');
const GameEvent = require('../models/GameEvent');
const User = require('../models/User');
const { ensureAuth, ensureRole } = require('../middleware/auth');

// --- Public: Apply to be a delegate ---
router.get('/apply', ensureAuth, async (req, res) => {
  const existing = await Delegate.findOne({ user: req.user._id });
  res.render('delegates/apply', {
    schools: Delegate.SCHOOLS,
    existing,
    page: 'delegates'
  });
});

router.post('/apply', ensureAuth, async (req, res) => {
  try {
    const existing = await Delegate.findOne({ user: req.user._id });
    if (existing) {
      req.flash('error', 'You have already applied. Check your dashboard for status.');
      return res.redirect('/delegates/dashboard');
    }

    const { fullName, phone, relation, schools, agreementSigned } = req.body;
    const schoolArr = Array.isArray(schools) ? schools : (schools ? [schools] : []);

    await Delegate.create({
      user: req.user._id,
      fullName,
      phone,
      relation,
      schools: schoolArr,
      agreementSigned: agreementSigned === 'on',
      agreementDate: agreementSigned === 'on' ? new Date() : null
    });

    // Grant delegate role on user
    if (!req.user.roles.includes('delegate')) {
      req.user.roles.push('delegate');
      await req.user.save();
    }

    req.flash('success', 'Application submitted! We\'ll review it and get back to you.');
    res.redirect('/delegates/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong submitting your application.');
    res.redirect('/delegates/apply');
  }
});

// --- Delegate Dashboard ---
router.get('/dashboard', ensureAuth, async (req, res) => {
  try {
    const delegate = await Delegate.findOne({ user: req.user._id });
    if (!delegate) {
      req.flash('error', 'You need to apply as a delegate first.');
      return res.redirect('/delegates/apply');
    }

    const upcomingGames = await GameEvent.find({
      delegates: delegate._id,
      gameDate: { $gte: new Date() },
      status: { $in: ['scheduled', 'live'] }
    }).sort({ gameDate: 1 }).limit(10);

    const pastGames = await GameEvent.find({
      delegates: delegate._id,
      status: 'completed'
    }).sort({ gameDate: -1 }).limit(10);

    res.render('delegates/dashboard', {
      delegate,
      upcomingGames,
      pastGames,
      page: 'delegates'
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load delegate dashboard.' });
  }
});

// --- Delegate: Submit recording URL for a game ---
router.post('/games/:id/recording', ensureAuth, ensureRole('delegate'), async (req, res) => {
  try {
    const game = await GameEvent.findById(req.params.id);
    if (!game) {
      req.flash('error', 'Game not found.');
      return res.redirect('/delegates/dashboard');
    }
    game.recordingUrl = req.body.recordingUrl || '';
    game.highlights = req.body.highlights || '';
    if (game.status === 'live') game.status = 'completed';
    await game.save();

    // Increment delegate stats
    const delegate = await Delegate.findOne({ user: req.user._id });
    if (delegate) {
      delegate.gamesRecorded += 1;
      await delegate.save();
    }

    req.flash('success', 'Recording submitted!');
    res.redirect('/delegates/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit recording.');
    res.redirect('/delegates/dashboard');
  }
});

module.exports = router;
