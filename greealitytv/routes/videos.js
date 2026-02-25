const express = require('express');
const router = express.Router();
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const { ensureAuth } = require('../middleware/auth');
const { videoUpload, imageUpload } = require('../config/storage');
const multer = require('multer');

const uploadFields = multer({
  storage: require('multer-s3')({
    s3: new (require('@aws-sdk/client-s3').S3Client)({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.LINODE_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.LINODE_ACCESS,
        secretAccessKey: process.env.LINODE_SECRET
      },
      forcePathStyle: false
    }),
    bucket: process.env.LINODE_BUCKET,
    acl: 'public-read',
    contentType: require('multer-s3').AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const folder = file.fieldname === 'video' ? 'videos' : 'thumbnails';
      cb(null, `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

router.get('/', async (req, res) => {
  try {
    const videos = await Video.find({ published: true }).populate('author').sort({ createdAt: -1 });
    res.render('videos/index', { videos });
  } catch (err) {
    res.render('error', { message: 'Could not load videos.' });
  }
});

router.get('/new', ensureAuth, (req, res) => {
  res.render('videos/new');
});

router.post('/', ensureAuth, uploadFields.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  try {
    const { title, description, tags } = req.body;
    const tagArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    if (!req.files || !req.files.video) {
      req.flash('error', 'Video file is required.');
      return res.redirect('/videos/new');
    }

    await Video.create({
      title,
      description,
      tags: tagArray,
      author: req.user._id,
      videoUrl: req.files.video[0].location,
      thumbnail: req.files.thumbnail ? req.files.thumbnail[0].location : null
    });

    req.flash('success', 'Video uploaded!');
    res.redirect('/videos');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Upload failed.');
    res.redirect('/videos/new');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('author');
    if (!video || !video.published) return res.render('error', { message: 'Video not found.' });

    await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    const comments = await Comment.find({ contentType: 'video', contentId: video._id })
      .populate('author').sort({ createdAt: -1 });

    res.render('videos/show', { video, comments });
  } catch (err) {
    res.render('error', { message: 'Video not found.' });
  }
});

router.delete('/:id', ensureAuth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.render('error', { message: 'Video not found.' });
    if (video.author.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).render('error', { message: 'Not authorized.' });
    }
    await Video.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ contentType: 'video', contentId: req.params.id });
    req.flash('success', 'Video deleted.');
    res.redirect('/videos');
  } catch (err) {
    req.flash('error', 'Failed to delete video.');
    res.redirect('/videos');
  }
});

router.post('/:id/comments', ensureAuth, async (req, res) => {
  try {
    await Comment.create({
      body: req.body.body,
      author: req.user._id,
      contentType: 'video',
      contentId: req.params.id
    });
    res.redirect(`/videos/${req.params.id}#comments`);
  } catch (err) {
    req.flash('error', 'Failed to post comment.');
    res.redirect(`/videos/${req.params.id}`);
  }
});

router.post('/:id/comments/:cid/vote', ensureAuth, async (req, res) => {
  try {
    const { type } = req.body;
    const uid = req.user._id;
    const comment = await Comment.findById(req.params.cid);
    if (!comment) return res.json({ error: 'Not found' });

    const hasUp = comment.upvotes.some(v => v.toString() === uid.toString());
    const hasDown = comment.downvotes.some(v => v.toString() === uid.toString());

    if (type === 'up') {
      if (hasUp) { comment.upvotes.pull(uid); }
      else { comment.upvotes.push(uid); if (hasDown) comment.downvotes.pull(uid); }
    } else if (type === 'down') {
      if (hasDown) { comment.downvotes.pull(uid); }
      else { comment.downvotes.push(uid); if (hasUp) comment.upvotes.pull(uid); }
    }

    await comment.save();
    res.json({ upvotes: comment.upvotes.length, downvotes: comment.downvotes.length });
  } catch (err) {
    res.json({ error: 'Vote failed' });
  }
});

module.exports = router;
