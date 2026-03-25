const express = require('express');
const router = express.Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const BlogPost = require('../models/BlogPost');
const agentService = require('../services/agentService');

// ═══ Admin Blog Routes ════════════════════════════════════
router.use('/admin/blog', ensureAuth, ensureAdmin);

router.get('/admin/blog', async (req, res) => {
  try {
    const status = req.query.status || '';
    let query = {};
    if (status) query.status = status;
    const posts = await BlogPost.find(query).sort({ createdAt: -1 });
    const published = await BlogPost.countDocuments({ status: 'published' });
    const drafts = await BlogPost.countDocuments({ status: 'draft' });
    res.render('admin/blog/list', {
      title: 'Blog', section: 'blog',
      posts, stats: { published, drafts }, statusFilter: status
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.get('/admin/blog/new', (req, res) => {
  res.render('admin/blog/edit', {
    title: 'New Post', section: 'blog',
    post: null, success: null, error: null
  });
});

router.post('/admin/blog', async (req, res) => {
  try {
    const { title, slug, excerpt, content, restaurant, category, tags, status, coverImage } = req.body;
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const postSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Collision check
    const existing = await BlogPost.findOne({ slug: postSlug });
    const finalSlug = existing ? postSlug + '-' + Date.now() : postSlug;

    const post = await BlogPost.create({
      title, slug: finalSlug, excerpt, content,
      restaurant: restaurant || 'all',
      category, tags: tagArr, coverImage,
      status: status || 'draft',
      author: req.user._id,
      publishedAt: status === 'published' ? new Date() : undefined
    });
    res.redirect('/admin/blog/' + post._id + '?success=Post created');
  } catch (err) {
    console.error('Create blog error:', err);
    res.redirect('/admin/blog/new?error=Failed to create post');
  }
});

router.get('/admin/blog/:id', async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);
    if (!post) return res.status(404).render('error', { message: 'Not found', error: { status: 404 } });
    res.render('admin/blog/edit', {
      title: 'Edit Post', section: 'blog',
      post, success: req.query.success || null, error: req.query.error || null
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.post('/admin/blog/:id', async (req, res) => {
  try {
    const { title, slug, excerpt, content, restaurant, category, tags, status, coverImage } = req.body;
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const update = {
      title, excerpt, content,
      restaurant: restaurant || 'all',
      category, tags: tagArr, coverImage,
      status: status || 'draft'
    };
    if (slug) update.slug = slug;
    if (status === 'published') {
      const post = await BlogPost.findById(req.params.id);
      if (!post.publishedAt) update.publishedAt = new Date();
    }
    await BlogPost.findByIdAndUpdate(req.params.id, update);
    res.redirect('/admin/blog/' + req.params.id + '?success=Post updated');
  } catch (err) {
    res.redirect('/admin/blog/' + req.params.id + '?error=Update failed');
  }
});

router.delete('/admin/blog/:id', async (req, res) => {
  try {
    await BlogPost.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ═══ Blog Agent Endpoint ══════════════════════════════════
router.post('/admin/blog/agent', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await agentService.chat([{
      role: 'user',
      content: 'Write a blog post for ACM Hospitality Group restaurants (The Nook, Heyday, Graffiti Pasta). ' + prompt +
        '\nReturn ONLY valid JSON: {"title":"post title","slug":"url-slug","excerpt":"1-2 sentence excerpt","content":"full HTML blog post content with inline styles","category":"category","tags":"tag1, tag2, tag3","restaurant":"all or nook or heyday or graffiti"}'
    }]);
    res.json({ success: result.success, content: result.content });
  } catch (err) {
    res.json({ success: false, content: 'Error: ' + err.message });
  }
});

// ═══ Public Blog Routes ═══════════════════════════════════
router.get('/blog', async (req, res) => {
  try {
    const posts = await BlogPost.find({ status: 'published' }).sort({ publishedAt: -1 });
    res.render('blog/list', { title: 'Blog — ACM', posts });
  } catch (err) {
    res.redirect('/');
  }
});

router.get('/blog/:slug', async (req, res) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, status: 'published' });
    if (!post) return res.status(404).render('error', { message: 'Post not found', error: { status: 404 } });
    res.render('blog/post', { title: post.title + ' — ACM', post });
  } catch (err) {
    res.redirect('/blog');
  }
});

module.exports = router;
