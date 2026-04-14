const router = require('express').Router();
const SiteContent = require('../models/SiteContent');

// @route  GET /
router.get('/', async (req, res) => {
  try {
    // Load all CMS content keyed by section
    const sections = await SiteContent.find({});
    const content = {};
    sections.forEach(s => { content[s.section] = s; });

    res.render('pages/public/landing', {
      title: 'Mobile Meadows — RV & Motorhome Repair',
      content
    });
  } catch (err) {
    console.error(err);
    res.render('pages/public/landing', { title: 'Mobile Meadows', content: {} });
  }
});

// @route  GET /calendar
router.get('/calendar', async (req, res) => {
  res.render('pages/public/calendar', {
    title: 'Service Calendar — Mobile Meadows'
  });
});

module.exports = router;
