const express = require('express');
const bcrypt = require('bcrypt');
const Brand = require('../models/Brand');
const User = require('../models/User');
const router = express.Router();

// GET /start — signup page
router.get('/', (req, res) => {
  res.render('start', {
    title: res.locals.lang === 'es' ? 'Empezar' : 'Get Started',
    error: req.query.error || null,
  });
});

// POST /start/signup — create brand + owner account, auto-login
router.post('/signup', async (req, res) => {
  try {
    const { restaurantName, ownerName, phone, email, password, passwordConfirm, location, timezone } = req.body;

    // Validation
    if (!restaurantName?.trim()) {
      return res.redirect('/start?error=Restaurant name is required');
    }
    if (!email?.trim()) {
      return res.redirect('/start?error=Email is required');
    }
    if (!password || password.length < 8) {
      return res.redirect('/start?error=Password must be at least 8 characters');
    }
    if (password !== passwordConfirm) {
      return res.redirect('/start?error=Passwords do not match');
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.redirect('/start?error=An account with this email already exists. Sign in instead.');
    }

    // Generate slug
    const baseSlug = restaurantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    const existingBrand = await Brand.findOne({ slug });
    if (existingBrand) slug = baseSlug + '-' + Date.now().toString(36);

    // Create brand with 7-day trial
    const now = new Date();
    const brand = await Brand.create({
      name: restaurantName.trim(),
      slug,
      location: (location || '').trim(),
      phone: (phone || '').trim(),
      status: 'preview',
      trialExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      plan: 'free',
      settings: {
        timezone: timezone || 'America/New_York',
      },
    });

    // Create owner user as brandAdmin
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: cleanEmail,
      displayName: (ownerName || '').trim() || cleanEmail.split('@')[0],
      password: hashed,
      provider: 'local',
      role: 'brandAdmin',
      brand: brand._id,
    });

    // Set brand owner
    brand.owner = user._id;
    await brand.save();

    // Auto-login via Passport
    req.logIn(user, (err) => {
      if (err) {
        console.error('[start] auto-login failed:', err);
        return res.redirect('/auth/login?error=signup_ok_login_failed');
      }
      res.redirect('/admin');
    });
  } catch (err) {
    console.error('[start] signup error:', err);
    res.redirect('/start?error=Something went wrong. Please try again.');
  }
});

// POST /start/google-signup — Google credential + brand creation
router.post('/google-signup', express.json(), async (req, res) => {
  try {
    const { credential, restaurantName, location, timezone, phone } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    if (!restaurantName?.trim()) return res.status(400).json({ error: 'Restaurant name required' });

    // Verify Google token
    const tokenRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    const profile = await tokenRes.json();
    if (!profile.email || profile.aud !== process.env.GGLCID) {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    // Check if user exists
    let user = await User.findOne({ email: profile.email });
    if (user && user.brand) {
      return res.status(409).json({ error: 'Account already exists. Sign in instead.' });
    }

    // Generate slug
    const baseSlug = restaurantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    const existing = await Brand.findOne({ slug });
    if (existing) slug = baseSlug + '-' + Date.now().toString(36);

    // Create brand
    const now = new Date();
    const brand = await Brand.create({
      name: restaurantName.trim(),
      slug,
      location: (location || '').trim(),
      phone: (phone || '').trim(),
      status: 'preview',
      trialExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      plan: 'free',
      settings: { timezone: timezone || 'America/New_York' },
    });

    if (user) {
      // Existing Google user without a brand — promote and assign
      user.role = 'brandAdmin';
      user.brand = brand._id;
      if (!user.googleId) user.googleId = profile.sub;
      await user.save();
    } else {
      user = await User.create({
        email: profile.email,
        displayName: profile.name || profile.email.split('@')[0],
        googleId: profile.sub,
        provider: 'google',
        role: 'brandAdmin',
        brand: brand._id,
      });
    }

    brand.owner = user._id;
    await brand.save();

    // Auto-login
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json({ ok: true, redirect: '/admin' });
    });
  } catch (err) {
    console.error('[start] google-signup error:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

module.exports = router;
