const express = require('express');
const router = express.Router();
const Petition = require('../models/Petition');
const { ensureAuth } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const petitions = await Petition.find({ active: true }).populate('author').sort({ createdAt: -1 });
    res.render('petitions/index', { petitions });
  } catch (err) {
    res.render('error', { message: 'Could not load petitions.' });
  }
});

router.get('/new', ensureAuth, (req, res) => {
  res.render('petitions/new');
});

router.post('/', ensureAuth, async (req, res) => {
  try {
    const { title, description, goal } = req.body;
    await Petition.create({
      title,
      description,
      goal: parseInt(goal) || 100,
      author: req.user._id,
      signatories: [req.user._id]
    });
    req.flash('success', 'Vote started!');
    res.redirect('/votes');
  } catch (err) {
    req.flash('error', 'Failed to start vote.');
    res.redirect('/votes/new');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const petition = await Petition.findById(req.params.id).populate('author').populate('signatories', 'displayName avatar');
    if (!petition) return res.render('error', { message: 'Petition not found.' });
    const signed = req.user ? petition.signatories.some(s => s._id.toString() === req.user._id.toString()) : false;
    res.render('petitions/show', { petition, signed });
  } catch (err) {
    res.render('error', { message: 'Petition not found.' });
  }
});

router.post('/:id/sign', ensureAuth, async (req, res) => {
  try {
    const petition = await Petition.findById(req.params.id);
    if (!petition) return res.render('error', { message: 'Petition not found.' });

    const alreadySigned = petition.signatories.some(s => s.toString() === req.user._id.toString());
    if (!alreadySigned) {
      petition.signatories.push(req.user._id);
      await petition.save();
      req.flash('success', 'Your vote has been cast!');
    } else {
      req.flash('error', 'You already voted on this.');
    }
    res.redirect(`/votes/${req.params.id}`);
  } catch (err) {
    req.flash('error', 'Could not cast vote.');
    res.redirect(`/votes/${req.params.id}`);
  }
});

module.exports = router;
