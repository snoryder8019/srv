const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const Petition = require('../models/Petition');
const ShareDigest = require('../models/ShareDigest');
const Local = require('../models/Local');
const Gig = require('../models/Gig');
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
      approvedLocals, totalLocals,
      approvedGigs, totalGigs,
      recentPosts, recentVideos, recentUsers,
      pendingPosts, pendingVideos, pendingShares,
      pendingLocals, pendingGigs
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Post.countDocuments(),
      Post.countDocuments({ published: true }),
      Video.countDocuments(),
      Petition.countDocuments(),
      Petition.countDocuments({ active: true }),
      Local.countDocuments({ status: 'approved' }),
      Local.countDocuments(),
      Gig.countDocuments({ status: 'approved' }),
      Gig.countDocuments(),
      Post.find({ status: { $ne: 'pending' } }).populate('author').sort({ createdAt: -1 }).limit(10),
      Video.find({ status: { $ne: 'pending' } }).populate('author').sort({ createdAt: -1 }).limit(5),
      User.find().sort({ createdAt: -1 }).limit(10),
      Post.find({ status: 'pending' }).populate('author').sort({ createdAt: -1 }),
      Video.find({ status: 'pending' }).populate('author').sort({ createdAt: -1 }),
      ShareDigest.find({ status: 'pending' }).populate('submittedBy').sort({ createdAt: -1 }),
      Local.find({ status: 'pending' }).populate('submittedBy').sort({ createdAt: -1 }),
      Gig.find({ status: 'pending' }).populate('submittedBy').sort({ createdAt: -1 })
    ]);

    res.render('admin/dashboard', {
      stats: {
        totalUsers, newUsers,
        totalPosts, publishedPosts,
        totalVideos,
        totalPetitions, activePetitions,
        approvedLocals, totalLocals,
        approvedGigs, totalGigs
      },
      recentPosts, recentVideos, recentUsers,
      pendingPosts, pendingVideos, pendingShares,
      pendingLocals, pendingGigs
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

// Local listings management
router.get('/local', async (req, res) => {
  try {
    const [locals, counts] = await Promise.all([
      Local.find().populate('submittedBy', 'displayName').sort({ createdAt: -1 }),
      Promise.all([
        Local.countDocuments({ status: 'pending' }),
        Local.countDocuments({ status: 'approved' }),
        Local.countDocuments({ status: 'rejected' })
      ])
    ]);
    res.render('admin/local', {
      locals,
      counts: { pending: counts[0], approved: counts[1], rejected: counts[2] },
      neighborhoods: Local.NEIGHBORHOODS
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load local listings.' });
  }
});

// Gigs management
router.get('/gigs', async (req, res) => {
  try {
    const [gigs, counts] = await Promise.all([
      Gig.find().populate('submittedBy', 'displayName').sort({ createdAt: -1 }),
      Promise.all([
        Gig.countDocuments({ status: 'pending' }),
        Gig.countDocuments({ status: 'approved' }),
        Gig.countDocuments({ status: 'rejected' })
      ])
    ]);
    res.render('admin/gigs', {
      gigs,
      counts: { pending: counts[0], approved: counts[1], rejected: counts[2] },
      categories: Gig.CATEGORIES
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load gigs.' });
  }
});

// Inline status update APIs (used by management views)
router.put('/local/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.json({ error: 'Invalid status' });
    await Local.findByIdAndUpdate(req.params.id, { status });
    res.json({ status });
  } catch (err) {
    res.json({ error: 'Failed.' });
  }
});

router.put('/gigs/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.json({ error: 'Invalid status' });
    await Gig.findByIdAndUpdate(req.params.id, { status });
    res.json({ status });
  } catch (err) {
    res.json({ error: 'Failed.' });
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

// Post approval
router.post('/posts/:id/approve', async (req, res) => {
  try {
    await Post.findByIdAndUpdate(req.params.id, { status: 'approved', published: true });
    req.flash('success', 'Post approved.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to approve post.');
    res.redirect('/admin');
  }
});

router.post('/posts/:id/reject', async (req, res) => {
  try {
    await Post.findByIdAndUpdate(req.params.id, { status: 'rejected', published: false });
    req.flash('success', 'Post rejected.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to reject post.');
    res.redirect('/admin');
  }
});

router.put('/posts/:id/publish', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.json({ error: 'Not found' });
    post.published = !post.published;
    post.status = post.published ? 'approved' : 'rejected';
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

// Video approval
router.post('/videos/:id/approve', async (req, res) => {
  try {
    await Video.findByIdAndUpdate(req.params.id, { status: 'approved', published: true });
    req.flash('success', 'Video approved.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to approve video.');
    res.redirect('/admin');
  }
});

router.post('/videos/:id/reject', async (req, res) => {
  try {
    await Video.findByIdAndUpdate(req.params.id, { status: 'rejected', published: false });
    req.flash('success', 'Video rejected.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to reject video.');
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

// Share digest approval
router.post('/shares/:id/approve', async (req, res) => {
  try {
    await ShareDigest.findByIdAndUpdate(req.params.id, { status: 'approved' });
    req.flash('success', 'Share approved.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to approve share.');
    res.redirect('/admin');
  }
});

router.post('/shares/:id/reject', async (req, res) => {
  try {
    await ShareDigest.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    req.flash('success', 'Share rejected.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to reject share.');
    res.redirect('/admin');
  }
});

router.delete('/shares/:id', async (req, res) => {
  try {
    await ShareDigest.findByIdAndDelete(req.params.id);
    req.flash('success', 'Share deleted.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to delete share.');
    res.redirect('/admin');
  }
});

// Local listing approval
router.post('/local/:id/approve', async (req, res) => {
  try {
    await Local.findByIdAndUpdate(req.params.id, { status: 'approved' });
    req.flash('success', 'Local listing approved.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to approve listing.');
    res.redirect('/admin');
  }
});

router.post('/local/:id/reject', async (req, res) => {
  try {
    await Local.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    req.flash('success', 'Local listing rejected.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to reject listing.');
    res.redirect('/admin');
  }
});

router.delete('/local/:id', async (req, res) => {
  try {
    await Local.findByIdAndDelete(req.params.id);
    req.flash('success', 'Local listing deleted.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to delete listing.');
    res.redirect('/admin');
  }
});

// Gig/job approval
router.post('/gigs/:id/approve', async (req, res) => {
  try {
    await Gig.findByIdAndUpdate(req.params.id, { status: 'approved' });
    req.flash('success', 'Gig/job approved.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to approve gig.');
    res.redirect('/admin');
  }
});

router.post('/gigs/:id/reject', async (req, res) => {
  try {
    await Gig.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    req.flash('success', 'Gig/job rejected.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to reject gig.');
    res.redirect('/admin');
  }
});

router.delete('/gigs/:id', async (req, res) => {
  try {
    await Gig.findByIdAndDelete(req.params.id);
    req.flash('success', 'Gig/job deleted.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Failed to delete gig.');
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
