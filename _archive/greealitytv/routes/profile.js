const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const { ensureAuth } = require('../middleware/auth');

router.get('/', ensureAuth, async (req, res) => {
  try {
    const [posts, videos] = await Promise.all([
      Post.find({ author: req.user._id }).sort({ createdAt: -1 }),
      Video.find({ author: req.user._id }).sort({ createdAt: -1 })
    ]);
    res.render('profile/me', { profileUser: req.user, posts, videos });
  } catch (err) {
    res.render('error', { message: 'Could not load profile.' });
  }
});

router.post('/bio', ensureAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { bio: req.body.bio });
    req.flash('success', 'Bio updated.');
    res.redirect('/profile');
  } catch (err) {
    req.flash('error', 'Failed to update bio.');
    res.redirect('/profile');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const profileUser = await User.findById(req.params.id);
    if (!profileUser) return res.render('error', { message: 'User not found.' });

    const [posts, videos] = await Promise.all([
      Post.find({ author: profileUser._id, published: true }).sort({ createdAt: -1 }),
      Video.find({ author: profileUser._id, published: true }).sort({ createdAt: -1 })
    ]);
    res.render('profile/show', { profileUser, posts, videos });
  } catch (err) {
    res.render('error', { message: 'User not found.' });
  }
});

module.exports = router;
