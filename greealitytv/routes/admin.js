const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const Petition = require('../models/Petition');
const { ensureAdmin } = require('../middleware/auth');

router.use(ensureAdmin);

router.get('/', async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, newUsers,
      totalPosts, publishedPosts,
      totalVideos,
      totalPetitions, activePetitions,
      recentPosts, recentVideos, recentUsers
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Post.countDocuments(),
      Post.countDocuments({ published: true }),
      Video.countDocuments(),
      Petition.countDocuments(),
      Petition.countDocuments({ active: true }),
      Post.find().populate('author').sort({ createdAt: -1 }).limit(10),
      Video.find().populate('author').sort({ createdAt: -1 }).limit(5),
      User.find().sort({ createdAt: -1 }).limit(10)
    ]);

    res.render('admin/dashboard', {
      stats: { totalUsers, newUsers, totalPosts, publishedPosts, totalVideos, totalPetitions, activePetitions },
      recentPosts, recentVideos, recentUsers
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Admin dashboard error.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin/users', { users });
  } catch (err) {
    res.render('error', { message: 'Could not load users.' });
  }
});

router.put('/users/:id/admin', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.json({ error: 'User not found' });
    user.isAdmin = !user.isAdmin;
    await user.save();
    res.json({ isAdmin: user.isAdmin });
  } catch (err) {
    res.json({ error: 'Failed to update user.' });
  }
});

router.put('/posts/:id/publish', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.json({ error: 'Not found' });
    post.published = !post.published;
    await post.save();
    res.json({ published: post.published });
  } catch (err) {
    res.json({ error: 'Failed.' });
  }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    req.flash('success', 'Post deleted.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to delete post.');
    res.redirect('/admin');
  }
});

router.delete('/videos/:id', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    req.flash('success', 'Video deleted.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to delete video.');
    res.redirect('/admin');
  }
});

router.put('/petitions/:id/toggle', async (req, res) => {
  try {
    const p = await Petition.findById(req.params.id);
    if (!p) return res.json({ error: 'Not found' });
    p.active = !p.active;
    await p.save();
    res.json({ active: p.active });
  } catch (err) {
    res.json({ error: 'Failed.' });
  }
});

module.exports = router;
