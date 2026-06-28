const express = require('express');
const router = express.Router();
const ShareDigest = require('../models/ShareDigest');
const { ensureAuth } = require('../middleware/auth');

// Public digest listing
router.get('/', async (req, res) => {
  try {
    const platform = req.query.platform;
    const query = platform ? { status: 'approved', platform } : { status: 'approved' };
    const shares = await ShareDigest.find(query).populate('submittedBy').sort({ createdAt: -1 });
    res.render('shares/index', { shares, platform: platform || null });
  } catch (err) {
    res.render('error', { message: 'Could not load digest.' });
  }
});

// Submit form
router.get('/new', ensureAuth, (req, res) => {
  res.render('shares/new');
});

router.post('/', ensureAuth, async (req, res) => {
  try {
    const { title, url, platform, description } = req.body;
    await ShareDigest.create({
      title,
      url,
      platform,
      description,
      submittedBy: req.user._id,
      status: 'pending'
    });
    req.flash('success', 'Link submitted! It will appear in the digest after admin review.');
    res.redirect('/shares');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit link.');
    res.redirect('/shares/new');
  }
});

module.exports = router;
