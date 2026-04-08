const express = require('express');
const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');
const Brand = require('../models/Brand');
const User = require('../models/User');
const router = express.Router();

// ── PayPal config (same credentials as slab — platform-level) ─────────────
const PP_PLANS = {
  monthly:   { label: 'Monthly',   amount: '50.00',  days: 30 },
  quarterly: { label: 'Quarterly', amount: '120.00', days: 90 },
  annual:    { label: 'Annual',    amount: '300.00', days: 365 },
  lifetime:  { label: 'Lifetime',  amount: '1200.00', days: null },
};

let _ppToken = null;
let _ppTokenExp = 0;

function ppBase() {
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function ppAccessToken() {
  if (_ppToken && Date.now() < _ppTokenExp) return _ppToken;
  const res = await fetch(`${ppBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.PAYPAL_CID}:${process.env.PAYPAL_SEC}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  _ppToken = data.access_token;
  _ppTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _ppToken;
}

// ── Slab DB connection (for delegate lookups & referral tracking) ─────────
let _slabClient = null;
async function getSlabDb() {
  if (!_slabClient) {
    _slabClient = new MongoClient(process.env.SLAB_DB_URL);
    await _slabClient.connect();
  }
  return _slabClient.db('slab');
}

// ── Delegate referral helpers ─────────────────────────────────────────────
const DELEGATE_PROMO_DAYS = 30;

async function lookupDelegateRef(refCode) {
  if (!refCode || typeof refCode !== 'string') return null;
  const code = refCode.trim().toUpperCase();
  if (!/^SD-[A-F0-9]{8}$/.test(code)) return null;
  const slab = await getSlabDb();
  return slab.collection('sales_delegates').findOne({ refCode: code, status: 'active' });
}

async function applyDelegatePromo(brand, delegate, signupEmail) {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + DELEGATE_PROMO_DAYS * 24 * 60 * 60 * 1000);

  // Update brand with promo info
  brand.delegatePromo = true;
  brand.delegatePromoAt = now;
  brand.delegateTrialEndsAt = trialEndsAt;
  brand.referredBy = {
    delegateId: delegate._id.toString(),
    delegateEmail: delegate.email,
    refCode: delegate.refCode,
  };
  await brand.save();

  // Track referral in slab DB for delegate commission
  const slab = await getSlabDb();
  await slab.collection('delegate_referrals').insertOne({
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    refCode: delegate.refCode,
    signupEmail: signupEmail.toLowerCase(),
    product: 'opsTrain',
    brandSlug: brand.slug,
    promoDays: DELEGATE_PROMO_DAYS,
    trialEndsAt,
    convertedToPaid: false,
    createdAt: now,
  });
}

// ── GET /start — signup page ──────────────────────────────────────────────
router.get('/', (req, res) => {
  const ref = req.query.ref || null;
  res.render('start', {
    title: res.locals.lang === 'es' ? 'Empezar' : 'Get Started',
    error: req.query.error || null,
    ref,
    plans: PP_PLANS,
  });
});

// ── POST /start/signup — create brand + owner account, auto-login ─────────
router.post('/signup', async (req, res) => {
  try {
    const { restaurantName, ownerName, phone, email, password, passwordConfirm, location, timezone, ref } = req.body;

    // Validation
    if (!restaurantName?.trim()) {
      return res.redirect('/start?error=Restaurant name is required' + (ref ? '&ref=' + ref : ''));
    }
    if (!email?.trim()) {
      return res.redirect('/start?error=Email is required' + (ref ? '&ref=' + ref : ''));
    }
    if (!password || password.length < 8) {
      return res.redirect('/start?error=Password must be at least 8 characters' + (ref ? '&ref=' + ref : ''));
    }
    if (password !== passwordConfirm) {
      return res.redirect('/start?error=Passwords do not match' + (ref ? '&ref=' + ref : ''));
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

    // Create owner user as admin (brand owner)
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: cleanEmail,
      displayName: (ownerName || '').trim() || cleanEmail.split('@')[0],
      password: hashed,
      provider: 'local',
      role: 'admin',
      brand: brand._id,
    });

    // Set brand owner
    brand.owner = user._id;
    await brand.save();

    // Check for delegate referral & apply 30-day promo
    const delegateRef = await lookupDelegateRef(ref);
    if (delegateRef) {
      await applyDelegatePromo(brand, delegateRef, cleanEmail);
    }

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

// ── POST /start/google-signup — Google credential + brand creation ────────
router.post('/google-signup', express.json(), async (req, res) => {
  try {
    const { credential, restaurantName, location, timezone, phone, ref } = req.body;
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
      user.role = 'admin';
      user.brand = brand._id;
      if (!user.googleId) user.googleId = profile.sub;
      await user.save();
    } else {
      user = await User.create({
        email: profile.email,
        displayName: profile.name || profile.email.split('@')[0],
        googleId: profile.sub,
        provider: 'google',
        role: 'admin',
        brand: brand._id,
      });
    }

    brand.owner = user._id;
    await brand.save();

    // Check for delegate referral & apply 30-day promo
    const delegateRef = await lookupDelegateRef(ref);
    if (delegateRef) {
      await applyDelegatePromo(brand, delegateRef, profile.email);
    }

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

// ── POST /start/go-live — PayPal checkout to activate paid plan ───────────
router.post('/go-live', async (req, res) => {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.redirect('/auth/login');
    }

    const { plan } = req.body;
    const planInfo = PP_PLANS[plan];
    if (!planInfo) return res.redirect('/admin?error=Invalid plan');

    const brand = await Brand.findById(req.user.brand);
    if (!brand) return res.redirect('/admin?error=No brand found');

    const token = await ppAccessToken();
    const domain = process.env.DOMAIN || 'https://ops-train.madladslab.com';

    const orderRes = await fetch(`${ppBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: planInfo.amount },
          description: `OpsTrain ${planInfo.label} — ${brand.name}`,
          custom_id: brand._id.toString(),
        }],
        application_context: {
          brand_name: 'OpsTrain by MadLadsLab',
          return_url: `${domain}/start/paypal-return?plan=${plan}&brandId=${brand._id}`,
          cancel_url: `${domain}/admin?error=Payment cancelled`,
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('[go-live] PayPal order error:', err);
      return res.redirect('/admin?error=Payment setup failed');
    }

    const order = await orderRes.json();
    const approveUrl = order.links.find(l => l.rel === 'approve')?.href;
    if (!approveUrl) return res.redirect('/admin?error=PayPal redirect failed');

    res.redirect(approveUrl);
  } catch (err) {
    console.error('[go-live] error:', err);
    res.redirect('/admin?error=Payment error');
  }
});

// ── GET /start/paypal-return — capture payment & activate brand ───────────
router.get('/paypal-return', async (req, res) => {
  try {
    const { token: orderId, plan, brandId } = req.query;
    if (!orderId || !plan || !brandId) return res.redirect('/admin?error=Invalid payment return');

    const planInfo = PP_PLANS[plan];
    if (!planInfo) return res.redirect('/admin?error=Invalid plan');

    const ppToken = await ppAccessToken();
    const captureRes = await fetch(`${ppBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ppToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!captureRes.ok) {
      const err = await captureRes.text();
      console.error('[paypal-return] capture error:', err);
      return res.redirect('/admin?error=Payment capture failed');
    }

    const capture = await captureRes.json();
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || '';

    // Activate brand
    const now = new Date();
    const updates = {
      status: 'active',
      plan,
      activatedAt: now,
      paypalOrderId: orderId,
      paypalCaptureId: captureId,
    };
    if (planInfo.days) {
      updates.expiresAt = new Date(now.getTime() + planInfo.days * 24 * 60 * 60 * 1000);
    }

    await Brand.findByIdAndUpdate(brandId, { $set: updates });

    // Track in slab activity log
    try {
      const slab = await getSlabDb();
      await slab.collection('activity_logs').insertOne({
        category: 'payment',
        action: 'opstrain_activation',
        status: 'success',
        actor: { email: req.user?.email || 'unknown', role: 'admin' },
        details: { brandId, plan, amount: planInfo.amount, orderId, captureId },
        createdAt: now,
      });
    } catch (e) {
      console.error('[paypal-return] activity log error:', e);
    }

    res.redirect('/admin?success=Plan activated! Welcome to OpsTrain.');
  } catch (err) {
    console.error('[paypal-return] error:', err);
    res.redirect('/admin?error=Payment processing error');
  }
});

// ── GET /start/pricing — public pricing info ──────────────────────────────
router.get('/pricing', (req, res) => {
  const plans = {};
  for (const [key, info] of Object.entries(PP_PLANS)) {
    plans[key] = { label: info.label, amount: info.amount };
  }
  res.json({ product: 'opsTrain', plans });
});

module.exports = router;
