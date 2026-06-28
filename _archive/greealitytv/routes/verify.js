// TODO: Implement full verification flow tomorrow (Phase 2)
// See GREELEY_VERIFIED_PLAN.md for complete spec

const express = require('express');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
// const VerificationRequest = require('../models/VerificationRequest');
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const VALID_CITIES = ['Greeley', 'Evans', 'Eaton'];
const VALID_ZIPS = ['80631', '80634', '80638', '80639', '80620', '80615'];

// GET /verify/apply — Address submission form
router.get('/apply', ensureAuth, (req, res) => {
  // TODO: check user is not already verified or has pending request
  res.render('verify/apply', { user: req.user });
});

// POST /verify/apply — Validate address, create pending request, redirect to payment
router.post('/apply', ensureAuth, async (req, res) => {
  // TODO: validate city/zip, create VerificationRequest, redirect to /verify/pay
  res.redirect('/verify/pay');
});

// GET /verify/pay — Stripe Checkout redirect (or hosted payment page)
router.get('/pay', ensureAuth, (req, res) => {
  // TODO: create Stripe Checkout session and redirect
  res.render('verify/pending', { user: req.user });
});

// POST /verify/pay/webhook — Stripe webhook (no auth)
router.post('/pay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // TODO: verify Stripe signature, update VerificationRequest on checkout.session.completed
  res.sendStatus(200);
});

// GET /verify/confirm — Enter postcard code
router.get('/confirm', ensureAuth, (req, res) => {
  res.render('verify/confirm', { user: req.user });
});

// POST /verify/confirm — Validate code, activate badge
router.post('/confirm', ensureAuth, async (req, res) => {
  // TODO: find matching VerificationRequest by code, check expiry, set user.isVerified = true
  req.flash('error', 'Code validation coming soon.');
  res.redirect('/verify/confirm');
});

module.exports = router;
