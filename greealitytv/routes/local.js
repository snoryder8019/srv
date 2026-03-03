const express = require('express');
const router = express.Router();
const Local = require('../models/Local');
const { imageUpload } = require('../config/storage');
const { ensureAuth } = require('../middleware/auth');

// GET /local — browse listings (all approved)
router.get('/', async (req, res) => {
  try {
    const listings = await Local.find({ status: 'approved' })
      .populate('submittedBy', 'displayName avatar')
      .sort({ createdAt: -1 });

    res.render('local/index', {
      listings,
      neighborhoods: Local.NEIGHBORHOODS,
      title: 'Local Greeley'
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load local listings.' });
  }
});

// GET /local/new — submission form
router.get('/new', ensureAuth, (req, res) => {
  res.render('local/new', {
    neighborhoods: Local.NEIGHBORHOODS,
    title: 'Add a Local Listing'
  });
});

// POST /local — submit listing for approval
router.post('/', ensureAuth, imageUpload.single('image'), async (req, res) => {
  try {
    const { name, category, neighborhood, address, description, website, phone, hours } = req.body;
    await Local.create({
      name, category, neighborhood,
      address:     address     || '',
      description,
      website:     website     || '',
      phone:       phone       || '',
      hours:       hours       || '',
      image:       req.file ? req.file.location : '',
      submittedBy: req.user._id,
      status:      'pending'
    });
    req.flash('success', 'Listing submitted! It will appear after admin review.');
    res.redirect('/local');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit listing.');
    res.redirect('/local/new');
  }
});

module.exports = router;
