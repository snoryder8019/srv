const express = require('express');
const router = express.Router();
const Gig = require('../models/Gig');
const { ensureAuth } = require('../middleware/auth');

// GET /gigs — browse approved gigs & jobs
router.get('/', async (req, res) => {
  try {
    const gigs = await Gig.find({ status: 'approved' })
      .populate('submittedBy', 'displayName avatar')
      .sort({ createdAt: -1 });

    res.render('gigs/index', {
      gigs,
      neighborhoods: Gig.NEIGHBORHOODS,
      categories:    Gig.CATEGORIES,
      title: 'Gigs & Jobs'
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load gigs.' });
  }
});

// GET /gigs/new — submission form
router.get('/new', ensureAuth, (req, res) => {
  res.render('gigs/new', {
    neighborhoods: Gig.NEIGHBORHOODS,
    categories:    Gig.CATEGORIES,
    title: 'Post a Gig or Job'
  });
});

// POST /gigs — submit for approval
router.post('/', ensureAuth, async (req, res) => {
  try {
    const { title, type, category, company, description, pay, contact, neighborhood, isRemote, expiresAt } = req.body;
    await Gig.create({
      title, type, category,
      company:      company      || '',
      description,
      pay:          pay          || '',
      contact,
      neighborhood: neighborhood || '',
      isRemote:     isRemote === 'on',
      expiresAt:    expiresAt ? new Date(expiresAt) : undefined,
      submittedBy:  req.user._id,
      status:       'pending'
    });
    req.flash('success', 'Posting submitted! It will appear after admin review.');
    res.redirect('/gigs');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit posting.');
    res.redirect('/gigs/new');
  }
});

module.exports = router;
