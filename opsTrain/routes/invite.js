const express = require('express');
const bcrypt = require('bcrypt');
const Brand = require('../models/Brand');
const User = require('../models/User');
const router = express.Router();

// GET /invite/:token — show manager signup form
router.get('/:token', async (req, res) => {
  const brand = await Brand.findOne({ inviteToken: req.params.token, active: true }).select('name slug').lean();
  if (!brand) {
    return res.render('errors/error', {
      title: 'Invalid Invite',
      message: 'This invite link is invalid or has expired.',
    });
  }

  res.render('invite', {
    title: `Join ${brand.name} — OpsTrain`,
    brand,
    token: req.params.token,
    error: req.query.error || null,
  });
});

// POST /invite/:token — create manager account
router.post('/:token', async (req, res) => {
  try {
    const brand = await Brand.findOne({ inviteToken: req.params.token, active: true });
    if (!brand) {
      return res.render('errors/error', {
        title: 'Invalid Invite',
        message: 'This invite link is invalid or has expired.',
      });
    }

    const { displayName, email, password, passwordConfirm } = req.body;
    if (!displayName?.trim() || !email?.trim()) {
      return res.redirect(`/invite/${req.params.token}?error=Name and email are required`);
    }
    if (!password || password.length < 8) {
      return res.redirect(`/invite/${req.params.token}?error=Password must be at least 8 characters`);
    }
    if (password !== passwordConfirm) {
      return res.redirect(`/invite/${req.params.token}?error=Passwords do not match`);
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      // If user exists but has no brand, promote to manager for this brand
      if (!existing.brand) {
        existing.role = 'manager';
        existing.brand = brand._id;
        if (!existing.password) existing.password = await bcrypt.hash(password, 12);
        await existing.save();
      } else {
        return res.redirect(`/invite/${req.params.token}?error=An account with this email already exists`);
      }

      req.logIn(existing, (err) => {
        if (err) return res.redirect('/auth/login');
        res.redirect('/admin');
      });
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: cleanEmail,
      displayName: displayName.trim(),
      password: hashed,
      provider: 'local',
      role: 'manager',
      brand: brand._id,
    });

    req.logIn(user, (err) => {
      if (err) return res.redirect('/auth/login');
      res.redirect('/admin');
    });
  } catch (err) {
    console.error('[invite] error:', err);
    res.redirect(`/invite/${req.params.token}?error=Something went wrong`);
  }
});

module.exports = router;
