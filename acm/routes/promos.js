const express = require('express');
const router = express.Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const Promo = require('../models/Promo');
const PromoRedemption = require('../models/PromoRedemption');
const Subscriber = require('../models/Subscriber');
const { generatePromoCode, getPromoUrl, getPromoQRUrl } = require('../services/qrService');

const RESTAURANTS = { nook: 'The Nook', heyday: 'Heyday', graffiti: 'Graffiti Pasta', all: 'All Restaurants' };

// ═══ Admin Promo Routes ═══════════════════════════════════
router.use('/admin/promos', ensureAuth, ensureAdmin);

router.get('/admin/promos', async (req, res) => {
  try {
    const promos = await Promo.find().sort({ createdAt: -1 });
    const totalRedemptions = await PromoRedemption.countDocuments({ status: 'redeemed' });
    const activePromos = await Promo.countDocuments({ isActive: true });

    // Redemptions by restaurant
    const byRestaurant = await PromoRedemption.aggregate([
      { $match: { status: 'redeemed' } },
      { $group: { _id: '$restaurant', count: { $sum: 1 } } }
    ]);
    const restaurantStats = {};
    byRestaurant.forEach(r => { restaurantStats[r._id] = r.count; });

    res.render('admin/promos/dashboard', {
      title: 'QR Promos', section: 'promos',
      promos, stats: { activePromos, totalRedemptions, restaurantStats },
      getPromoQRUrl, RESTAURANTS
    });
  } catch (err) {
    console.error('Promo dashboard error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.get('/admin/promos/new', (req, res) => {
  const code = generatePromoCode();
  res.render('admin/promos/promo-edit', {
    title: 'New Promo', section: 'promos',
    promo: null, code, getPromoQRUrl, RESTAURANTS,
    success: null, error: null
  });
});

router.post('/admin/promos', async (req, res) => {
  try {
    const { name, description, type, restaurant, code, discountValue, discountType, maxRedemptions, validFrom, validUntil, source } = req.body;
    const promoCode = code || generatePromoCode();
    const promo = await Promo.create({
      name, description, type, restaurant,
      code: promoCode,
      qrData: getPromoUrl(promoCode),
      discountValue: discountValue ? Number(discountValue) : undefined,
      discountType: discountType || undefined,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : 0,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : undefined,
      source: source || 'newsletter',
      createdBy: req.user._id
    });
    res.redirect('/admin/promos/' + promo._id + '?success=Promo created');
  } catch (err) {
    console.error('Create promo error:', err);
    res.redirect('/admin/promos/new?error=Failed to create promo');
  }
});

router.get('/admin/promos/:id', async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).render('error', { message: 'Not found', error: { status: 404 } });
    res.render('admin/promos/promo-edit', {
      title: 'Edit Promo', section: 'promos',
      promo, code: promo.code, getPromoQRUrl, RESTAURANTS,
      success: req.query.success || null, error: req.query.error || null
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

router.post('/admin/promos/:id', async (req, res) => {
  try {
    const { name, description, type, restaurant, discountValue, discountType, maxRedemptions, validFrom, validUntil, source, isActive } = req.body;
    await Promo.findByIdAndUpdate(req.params.id, {
      name, description, type, restaurant,
      discountValue: discountValue ? Number(discountValue) : undefined,
      discountType: discountType || undefined,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : 0,
      validFrom: validFrom ? new Date(validFrom) : undefined,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      source: source || 'newsletter',
      isActive: isActive === 'true' || isActive === 'on'
    });
    res.redirect('/admin/promos/' + req.params.id + '?success=Promo updated');
  } catch (err) {
    res.redirect('/admin/promos/' + req.params.id + '?error=Update failed');
  }
});

router.delete('/admin/promos/:id', async (req, res) => {
  try {
    await Promo.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get('/admin/promos/:id/redemptions', async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).render('error', { message: 'Not found', error: { status: 404 } });
    const redemptions = await PromoRedemption.find({ promo: promo._id })
      .populate('user', 'email displayName')
      .populate('scannedBy', 'email displayName')
      .sort({ scannedAt: -1 });
    res.render('admin/promos/redemptions', {
      title: 'Redemptions — ' + promo.name, section: 'promos',
      promo, redemptions, RESTAURANTS
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ═══ Public Promo Routes ══════════════════════════════════

// Customer lands here from QR scan
router.get('/promo/:code', async (req, res) => {
  try {
    const promo = await Promo.findOne({ code: req.params.code });
    if (!promo || !promo.isActive) {
      return res.render('promo/landing', { promo: null, error: 'This promo is no longer available.', RESTAURANTS });
    }
    if (promo.validUntil && new Date() > promo.validUntil) {
      return res.render('promo/landing', { promo: null, error: 'This promo has expired.', RESTAURANTS });
    }
    if (promo.maxRedemptions > 0 && promo.currentRedemptions >= promo.maxRedemptions) {
      return res.render('promo/landing', { promo: null, error: 'This promo has reached its maximum redemptions.', RESTAURANTS });
    }
    res.render('promo/landing', { promo, error: null, RESTAURANTS });
  } catch (err) {
    res.render('promo/landing', { promo: null, error: 'Something went wrong.', RESTAURANTS });
  }
});

router.post('/promo/:code/claim', async (req, res) => {
  try {
    const promo = await Promo.findOne({ code: req.params.code, isActive: true });
    if (!promo) return res.redirect('/promo/' + req.params.code);

    const { email } = req.body;

    // Also add them as subscriber
    if (email) {
      await Subscriber.findOneAndUpdate(
        { email: email.toLowerCase() },
        { email: email.toLowerCase(), source: 'qr', restaurant: promo.restaurant, isSubscribed: true },
        { upsert: true }
      );
    }

    await PromoRedemption.create({
      promo: promo._id,
      user: req.user ? req.user._id : undefined,
      subscriberEmail: email,
      restaurant: promo.restaurant,
      status: 'scanned'
    });

    promo.currentRedemptions += 1;
    await promo.save();

    res.render('promo/claimed', { promo, RESTAURANTS });
  } catch (err) {
    res.redirect('/promo/' + req.params.code);
  }
});

// ═══ Staff Scanner ════════════════════════════════════════
router.get('/scan', ensureAuth, (req, res) => {
  res.render('promo/scan', { title: 'QR Scanner', RESTAURANTS });
});

router.post('/scan/:code', ensureAuth, async (req, res) => {
  try {
    const promo = await Promo.findOne({ code: req.params.code });
    if (!promo) return res.json({ success: false, message: 'Invalid promo code' });
    if (!promo.isActive) return res.json({ success: false, message: 'Promo is inactive' });

    await PromoRedemption.create({
      promo: promo._id,
      restaurant: promo.restaurant,
      scannedBy: req.user._id,
      status: 'redeemed'
    });

    promo.currentRedemptions += 1;
    await promo.save();

    res.json({
      success: true,
      promo: { name: promo.name, type: promo.type, restaurant: RESTAURANTS[promo.restaurant], discountValue: promo.discountValue, discountType: promo.discountType }
    });
  } catch (err) {
    res.json({ success: false, message: 'Error processing scan' });
  }
});

module.exports = router;
