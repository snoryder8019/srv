const express = require('express');
const router = express.Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const Subscriber = require('../models/Subscriber');
const NewsletterTemplate = require('../models/NewsletterTemplate');
const { sendCampaign, isConfigured } = require('../services/emailService');

router.use('/admin/email', ensureAuth, ensureAdmin);

// ─── Email Dashboard ──────────────────────────────────────
router.get('/admin/email', async (req, res) => {
  try {
    const totalSubs = await Subscriber.countDocuments({ isSubscribed: true });
    const totalCampaigns = await Campaign.countDocuments();
    const sentCampaigns = await Campaign.countDocuments({ status: 'sent' });
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(10);

    // Aggregate total sent
    const agg = await Campaign.aggregate([
      { $match: { status: 'sent' } },
      { $group: { _id: null, totalSent: { $sum: '$stats.sent' }, totalOpened: { $sum: '$stats.opened' } } }
    ]);
    const emailStats = agg[0] || { totalSent: 0, totalOpened: 0 };
    const openRate = emailStats.totalSent > 0 ? Math.round((emailStats.totalOpened / emailStats.totalSent) * 100) : 0;

    res.render('admin/email/dashboard', {
      title: 'Email Marketing',
      section: 'email',
      stats: { totalSubs, totalCampaigns, sentCampaigns, totalSent: emailStats.totalSent, openRate },
      campaigns,
      zohoConfigured: isConfigured()
    });
  } catch (err) {
    console.error('Email dashboard error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ─── Campaigns ────────────────────────────────────────────
router.get('/admin/email/campaigns', async (req, res) => {
  try {
    const status = req.query.status || '';
    let query = {};
    if (status) query.status = status;
    const campaigns = await Campaign.find(query).sort({ createdAt: -1 });
    res.render('admin/email/campaigns', { title: 'Campaigns', section: 'email', campaigns, statusFilter: status });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.get('/admin/email/campaigns/new', async (req, res) => {
  const templates = await NewsletterTemplate.find().sort({ createdAt: -1 });
  res.render('admin/email/campaign-edit', {
    title: 'New Campaign', section: 'email',
    campaign: null, templates, success: null, error: null
  });
});

router.post('/admin/email/campaigns', async (req, res) => {
  try {
    const { name, subject, htmlContent, textContent, restaurant, targetTags } = req.body;
    const tags = targetTags ? targetTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await Campaign.create({
      name, subject, htmlContent, textContent,
      restaurant: restaurant || 'all',
      targetTags: tags,
      createdBy: req.user._id
    });
    res.redirect('/admin/email/campaigns');
  } catch (err) {
    res.status(500).render('error', { message: 'Failed to create campaign', error: { status: 500 } });
  }
});

router.get('/admin/email/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).render('error', { message: 'Not found', error: { status: 404 } });
    const templates = await NewsletterTemplate.find().sort({ createdAt: -1 });
    res.render('admin/email/campaign-edit', {
      title: 'Edit Campaign', section: 'email',
      campaign, templates,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.post('/admin/email/campaigns/:id', async (req, res) => {
  try {
    const { name, subject, htmlContent, textContent, restaurant, targetTags } = req.body;
    const tags = targetTags ? targetTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await Campaign.findByIdAndUpdate(req.params.id, {
      name, subject, htmlContent, textContent,
      restaurant: restaurant || 'all',
      targetTags: tags,
      updatedAt: new Date()
    });
    res.redirect('/admin/email/campaigns/' + req.params.id + '?success=Campaign updated');
  } catch (err) {
    res.redirect('/admin/email/campaigns/' + req.params.id + '?error=Update failed');
  }
});

router.post('/admin/email/campaigns/:id/send', async (req, res) => {
  try {
    const campaign = await sendCampaign(req.params.id);
    res.redirect('/admin/email/campaigns/' + req.params.id + '?success=Campaign sent to ' + campaign.stats.sent + ' subscribers');
  } catch (err) {
    console.error('Send campaign error:', err);
    res.redirect('/admin/email/campaigns/' + req.params.id + '?error=Send failed: ' + err.message);
  }
});

router.post('/admin/email/campaigns/:id/schedule', async (req, res) => {
  try {
    const { scheduledAt } = req.body;
    await Campaign.findByIdAndUpdate(req.params.id, {
      status: 'scheduled',
      scheduledAt: new Date(scheduledAt)
    });
    res.redirect('/admin/email/campaigns/' + req.params.id + '?success=Campaign scheduled');
  } catch (err) {
    res.redirect('/admin/email/campaigns/' + req.params.id + '?error=Schedule failed');
  }
});

// ─── Subscribers ──────────────────────────────────────────
router.get('/admin/email/subscribers', async (req, res) => {
  try {
    const search = req.query.search || '';
    const restaurant = req.query.restaurant || '';
    let query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }
    if (restaurant) query.restaurant = restaurant;
    const subscribers = await Subscriber.find(query).sort({ createdAt: -1 });
    res.render('admin/email/subscribers', {
      title: 'Subscribers', section: 'email',
      subscribers, search, restaurant
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.post('/admin/email/subscribers', async (req, res) => {
  try {
    const { email, firstName, lastName, restaurant, tags } = req.body;
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await Subscriber.create({
      email, firstName, lastName,
      restaurant: restaurant || 'all',
      tags: tagArr, source: 'admin'
    });
    res.redirect('/admin/email/subscribers');
  } catch (err) {
    console.error('Add subscriber error:', err);
    res.redirect('/admin/email/subscribers');
  }
});

router.post('/admin/email/subscribers/import', async (req, res) => {
  try {
    const { csvData } = req.body;
    const lines = csvData.split('\n').filter(Boolean);
    let imported = 0;
    for (const line of lines) {
      const [email, firstName, lastName, restaurant] = line.split(',').map(s => s.trim());
      if (!email) continue;
      try {
        await Subscriber.create({
          email, firstName, lastName,
          restaurant: restaurant || 'all',
          source: 'import'
        });
        imported++;
      } catch (e) { /* skip duplicates */ }
    }
    res.redirect('/admin/email/subscribers?imported=' + imported);
  } catch (err) {
    res.redirect('/admin/email/subscribers');
  }
});

router.delete('/admin/email/subscribers/:id', async (req, res) => {
  try {
    await Subscriber.findByIdAndUpdate(req.params.id, {
      isSubscribed: false,
      unsubscribedAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─── Templates ────────────────────────────────────────────
router.get('/admin/email/templates', async (req, res) => {
  try {
    const templates = await NewsletterTemplate.find().sort({ createdAt: -1 });
    res.render('admin/email/templates', { title: 'Newsletter Templates', section: 'templates', templates });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.get('/admin/email/templates/new', (req, res) => {
  res.render('admin/email/template-edit', {
    title: 'New Template', section: 'templates',
    template: null, success: null, error: null
  });
});

router.post('/admin/email/templates', async (req, res) => {
  try {
    const { name, description, htmlContent, restaurant } = req.body;
    await NewsletterTemplate.create({
      name, description, htmlContent,
      restaurant: restaurant || 'all',
      createdBy: req.user._id
    });
    res.redirect('/admin/email/templates');
  } catch (err) {
    res.status(500).render('error', { message: 'Failed to create template', error: { status: 500 } });
  }
});

router.get('/admin/email/templates/:id', async (req, res) => {
  try {
    const template = await NewsletterTemplate.findById(req.params.id);
    if (!template) return res.status(404).render('error', { message: 'Not found', error: { status: 404 } });
    res.render('admin/email/template-edit', {
      title: 'Edit Template', section: 'templates',
      template, success: req.query.success || null, error: req.query.error || null
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.post('/admin/email/templates/:id', async (req, res) => {
  try {
    const { name, description, htmlContent, restaurant } = req.body;
    await NewsletterTemplate.findByIdAndUpdate(req.params.id, {
      name, description, htmlContent, restaurant: restaurant || 'all'
    });
    res.redirect('/admin/email/templates/' + req.params.id + '?success=Template updated');
  } catch (err) {
    res.redirect('/admin/email/templates/' + req.params.id + '?error=Update failed');
  }
});

// ─── Public subscribe endpoint ────────────────────────────
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.redirect('/#contact');
    await Subscriber.findOneAndUpdate(
      { email: email.toLowerCase() },
      { email: email.toLowerCase(), source: 'website', isSubscribed: true },
      { upsert: true }
    );
    res.redirect('/?subscribed=1');
  } catch (err) {
    res.redirect('/');
  }
});

// ─── Public unsubscribe ───────────────────────────────────
router.get('/unsubscribe', async (req, res) => {
  try {
    const { email } = req.query;
    if (email) {
      await Subscriber.findOneAndUpdate(
        { email: email.toLowerCase() },
        { isSubscribed: false, unsubscribedAt: new Date() }
      );
    }
    res.send('<html><body style="background:#0a0a0a;color:#f5f0eb;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center;"><h1>Unsubscribed</h1><p>You have been unsubscribed from ACM emails.</p></div></body></html>');
  } catch (err) {
    res.redirect('/');
  }
});

module.exports = router;
