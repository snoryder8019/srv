const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const Video = require('../models/Video');
const Petition = require('../models/Petition');

router.get('/', async (req, res) => {
  try {
    const [posts, videos, petitions] = await Promise.all([
      Post.find({ published: true }).populate('author').sort({ createdAt: -1 }).limit(3),
      Video.find({ published: true }).populate('author').sort({ createdAt: -1 }).limit(3),
      Petition.find({ active: true }).populate('author').sort({ createdAt: -1 }).limit(3)
    ]);
    res.render('index', { posts, videos, petitions, page: 'home' });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load page.' });
  }
});

router.get('/feed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const [posts, videos, totalPosts, totalVideos] = await Promise.all([
      Post.find({ published: true }).populate('author').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Video.find({ published: true }).populate('author').sort({ createdAt: -1 }).limit(6),
      Post.countDocuments({ published: true }),
      Video.countDocuments({ published: true })
    ]);

    const totalPages = Math.ceil(totalPosts / limit);
    res.render('feed', { posts, videos, page, totalPages, totalPosts, totalVideos });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load feed.' });
  }
});

module.exports = router;
