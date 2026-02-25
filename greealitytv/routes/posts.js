const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { ensureAuth } = require('../middleware/auth');
const { imageUpload } = require('../config/storage');

router.get('/', async (req, res) => {
  try {
    const tag = req.query.tag;
    const query = tag ? { published: true, tags: tag } : { published: true };
    const posts = await Post.find(query).populate('author').sort({ createdAt: -1 });
    res.render('posts/index', { posts, tag: tag || null });
  } catch (err) {
    res.render('error', { message: 'Could not load posts.' });
  }
});

router.get('/new', ensureAuth, (req, res) => {
  res.render('posts/new');
});

router.post('/', ensureAuth, imageUpload.single('coverImage'), async (req, res) => {
  try {
    const { title, body, tags } = req.body;
    const tagArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const excerpt = body.replace(/<[^>]*>/g, '').substring(0, 200) + '...';

    await Post.create({
      title,
      body,
      excerpt,
      tags: tagArray,
      author: req.user._id,
      coverImage: req.file ? req.file.location : null
    });

    req.flash('success', 'Post published!');
    res.redirect('/posts');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create post.');
    res.redirect('/posts/new');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('author');
    if (!post || !post.published) return res.render('error', { message: 'Post not found.' });

    await Post.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    const comments = await Comment.find({ contentType: 'post', contentId: post._id })
      .populate('author').sort({ createdAt: -1 });

    res.render('posts/show', { post, comments });
  } catch (err) {
    res.render('error', { message: 'Post not found.' });
  }
});

router.get('/:id/edit', ensureAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.render('error', { message: 'Post not found.' });
    if (post.author.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).render('error', { message: 'Not authorized.' });
    }
    res.render('posts/edit', { post });
  } catch (err) {
    res.render('error', { message: 'Post not found.' });
  }
});

router.put('/:id', ensureAuth, imageUpload.single('coverImage'), async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.render('error', { message: 'Post not found.' });
    if (post.author.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).render('error', { message: 'Not authorized.' });
    }

    const { title, body, tags } = req.body;
    const tagArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const excerpt = body.replace(/<[^>]*>/g, '').substring(0, 200) + '...';

    const update = { title, body, excerpt, tags: tagArray, updatedAt: new Date() };
    if (req.file) update.coverImage = req.file.location;

    await Post.findByIdAndUpdate(req.params.id, update);
    req.flash('success', 'Post updated.');
    res.redirect(`/posts/${req.params.id}`);
  } catch (err) {
    req.flash('error', 'Failed to update post.');
    res.redirect(`/posts/${req.params.id}/edit`);
  }
});

router.delete('/:id', ensureAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.render('error', { message: 'Post not found.' });
    if (post.author.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).render('error', { message: 'Not authorized.' });
    }
    await Post.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ contentType: 'post', contentId: req.params.id });
    req.flash('success', 'Post deleted.');
    res.redirect('/posts');
  } catch (err) {
    req.flash('error', 'Failed to delete post.');
    res.redirect('/posts');
  }
});

// Comments
router.post('/:id/comments', ensureAuth, async (req, res) => {
  try {
    await Comment.create({
      body: req.body.body,
      author: req.user._id,
      contentType: 'post',
      contentId: req.params.id
    });
    res.redirect(`/posts/${req.params.id}#comments`);
  } catch (err) {
    req.flash('error', 'Failed to post comment.');
    res.redirect(`/posts/${req.params.id}`);
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
      if (hasUp) {
        comment.upvotes.pull(uid);
      } else {
        comment.upvotes.push(uid);
        if (hasDown) comment.downvotes.pull(uid);
      }
    } else if (type === 'down') {
      if (hasDown) {
        comment.downvotes.pull(uid);
      } else {
        comment.downvotes.push(uid);
        if (hasUp) comment.upvotes.pull(uid);
      }
    }

    await comment.save();
    res.json({ upvotes: comment.upvotes.length, downvotes: comment.downvotes.length });
  } catch (err) {
    res.json({ error: 'Vote failed' });
  }
});

module.exports = router;
