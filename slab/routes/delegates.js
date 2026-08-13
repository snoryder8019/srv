/**
 * Slab — Sales Delegates
 *
 * Public:
 *   GET  /delegates/signup          → delegate signup form
 *   POST /delegates/signup          → process signup
 *   GET  /delegates/login           → delegate login page
 *   POST /delegates/login           → process login
 *   GET  /delegates/logout          → clear cookie
 *
 * Delegate panel (requireDelegate):
 *   GET  /delegates/panel           → dashboard (stats, payout history)
 *   GET  /delegates/panel/settings  → edit profile / contact info
 *   POST /delegates/panel/settings  → save profile
 *   POST /delegates/panel/password  → change password
 *   GET  /delegates/panel/tax-info  → tax info form (SSN/EIN + W-9 upload)
 *   POST /delegates/panel/tax-info  → save encrypted tax info
 *   GET  /delegates/panel/tax-info/w9 → download own W-9
 *
 * Superadmin (requireSuperAdmin):
 *   GET  /delegates/admin                  → list all delegates
 *   GET  /delegates/admin/:id              → delegate detail
 *   POST /delegates/admin/:id/status       → activate / suspend
 *   POST /delegates/admin/:id/attach       → attach tenant
 *   POST /delegates/admin/:id/detach       → detach tenant
 *   POST /delegates/admin/:id/payout       → log a payout
 *   GET  /delegates/admin/:id/payouts      → payout history JSON
 *   GET  /delegates/admin/:id/w9           → download delegate W-9
 */

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../plugins/mongo.js';
import { requireSuperAdmin } from '../middleware/superadmin.js';
import { encrypt, decrypt } from '../plugins/crypto.js';
import { verifyCaptcha } from '../plugins/captcha.js';
import QRCode from 'qrcode';
import { sendPayoutBatch, payoutsConfigured } from '../plugins/paypalPayouts.js';
import { config } from '../config/config.js';
import { logActivity } from '../plugins/activityLog.js';
import { notifyAdmin } from '../plugins/notify.js';
import { PLANS as PRICING_PLANS, COMMISSION as PRICING_COMMISSION } from '../config/pricing.js';

// ── Multer (memory) for W-9 PDF upload ─────────────────────────────────────
const taxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PDF, JPEG, and PNG files are accepted.'));
    }
    cb(null, true);
  },
});

const router = express.Router();
const COOKIE_DOMAIN = config.NODE_ENV === 'production' ? '.madladslab.com' : undefined;

// ── Commission schedule ─────────────────────────────────────────────────────
// Percentage of NET tenant revenue (after platform owner tax). Net = gross × (1 − OWNER_TAX_RATE).
// Source of truth: config/pricing.js → Year 1 40% / Year 2 20% / Year 3+ 10%.
const COMMISSION = PRICING_COMMISSION;

// Platform owner's effective tax rate used to compute "after taxes" net.
// Federal + state blended — tune as your accounting becomes more precise.
const OWNER_TAX_RATE = 0.30;

// Plan → monthly-equivalent gross revenue (USD). Derived from config/pricing.js.
// Delegates only sell the three public Slab tiers (monthly/quarterly/annual).
// Lifetime is retired as a sellable tier (superadmin failsafe only) → pays $0
// commission; trial/free are pre-conversion → $0.
const PLAN_MONTHLY = {
  monthly:   PRICING_PLANS.monthly.monthly,
  quarterly: PRICING_PLANS.quarterly.monthly,
  annual:    PRICING_PLANS.annual.monthly,
  lifetime:  0,       // retired tier — never a delegate-sellable referral
  starter:   0,       // legacy free option
  trial:     0,       // free trial — no commission until it converts
  free:      0,
};

export function getCommissionRate(yearNumber) {
  return COMMISSION[yearNumber] || COMMISSION.default;
}

/**
 * Compute monthly commission for one referral.
 * Returns { plan, grossMonthly, ownerTax, netMonthly, year, rate, commission, inTrial, trialEndsAt }.
 *
 * `ref` is either a manual referral entry ({ plan }) — a Slab subscription on one
 * of the three public tiers — or a legacy linked tenant record ({ meta.plan }).
 * Commission is $0 while a promo free trial is still open (perks.trialEndsAt > now).
 */
export function computeMonthlyCommission(ref, attachedAt, now = new Date()) {
  const plan = ref?.plan || ref?.meta?.plan || 'monthly';
  const grossMonthly = PLAN_MONTHLY[plan] ?? PLAN_MONTHLY.monthly;

  const yearsSinceAttach = Math.floor((now.getTime() - new Date(attachedAt).getTime()) / (365.25 * 86400 * 1000)) + 1;
  const rate = getCommissionRate(yearsSinceAttach);
  const ownerTax = grossMonthly * OWNER_TAX_RATE;
  const netMonthly = grossMonthly - ownerTax;

  const trialEndsAt = ref?.perks?.trialEndsAt ? new Date(ref.perks.trialEndsAt) : null;
  const inTrial = !!(trialEndsAt && trialEndsAt > now);
  const commission = inTrial ? 0 : +(netMonthly * rate).toFixed(2);

  return {
    plan,
    grossMonthly,
    ownerTax: +ownerTax.toFixed(2),
    netMonthly: +netMonthly.toFixed(2),
    year: yearsSinceAttach,
    rate,
    commission,
    inTrial,
    trialEndsAt,
  };
}

/**
 * Monthly commission payout matrix: the 3 public Slab tiers × the commission
 * schedule (Yr1 40% / Yr2 20% / Yr3+ 10% of net). Derived live from
 * config/pricing.js so it always reflects TODAY's subscription prices.
 * Rounding mirrors computeMonthlyCommission (commission off the unrounded net).
 * Returns [{ tier, gross, net, payouts:[{ label, rate, amount }] }].
 */
export function getCommissionExamples() {
  const tiers = [
    { key: 'monthly', label: 'Monthly' },
    { key: 'quarterly', label: 'Quarterly' },
    { key: 'annual', label: 'Annual' },
  ];
  const rates = [
    { label: 'Year 1', rate: getCommissionRate(1) },
    { label: 'Year 2', rate: getCommissionRate(2) },
    { label: 'Year 3+', rate: getCommissionRate(3) },
  ];
  return tiers.map(t => {
    const gross = PLAN_MONTHLY[t.key];
    const net = gross - gross * OWNER_TAX_RATE;
    return {
      tier: t.label,
      gross: +gross.toFixed(2),
      net: +net.toFixed(2),
      payouts: rates.map(r => ({ label: r.label, rate: r.rate, amount: +(net * r.rate).toFixed(2) })),
    };
  });
}

// ── Delegate JWT helpers ────────────────────────────────────────────────────

export function issueDelegateJWT(delegate, res) {
  const payload = {
    id: delegate._id.toString(),
    email: delegate.email,
    name: `${delegate.firstName} ${delegate.lastName}`,
    role: 'delegate',
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '24h' });
  const opts = {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.cookie('slab_delegate', token, opts);
}

function requireDelegate(req, res, next) {
  const token = req.cookies?.slab_delegate;
  if (!token) return res.redirect('/delegates/login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (decoded.role !== 'delegate') {
      res.clearCookie('slab_delegate');
      return res.redirect('/delegates/login');
    }
    req.delegate = decoded;
    next();
  } catch {
    res.clearCookie('slab_delegate');
    res.redirect('/delegates/login');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateRefCode() {
  return 'SD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function validatePassword(pw) {
  if (!pw || pw.length < 12) return 'Password must be at least 12 characters.';
  if (!/[A-Z]/.test(pw)) return 'Must include an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Must include a lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Must include a special character.';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — Signup & Login
// ═══════════════════════════════════════════════════════════════════════════

router.get('/signup', (req, res) => {
  const ref = req.query.ref || null;
  res.render('delegates/signup', { error: null, formData: {}, ref, commissionExamples: getCommissionExamples() });
});

router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, phone, address, city, state, zip, password, password_confirm, agreedDisclaimer } = req.body;
  const formData = { firstName, lastName, email, phone, address, city, state, zip };

  // Anti-spam, two layers (same as the public contact/booking forms):
  //   1. Honeypot — a hidden field only bots fill. Pretend success (render the
  //      same confirmation) so the bot can't tell it was dropped; no record is
  //      written and no admin notification fires.
  //   2. Proof-of-work CAPTCHA — blocks scripted POSTs that skip the widget.
  if ((req.body.website || req.body._hp || '').trim()) {
    console.warn('[honeypot] delegate signup trap tripped', { ip: req.ip });
    return res.render('delegates/signup-success', { name: firstName || 'there' });
  }
  if (!verifyCaptcha(req.body.captcha || req.body.altcha || '').ok) {
    return res.render('delegates/signup', { error: 'Please complete the verification and try again.', formData, ref: null });
  }

  if (!agreedDisclaimer) {
    return res.render('delegates/signup', { error: 'You must agree to the tax & payout disclaimer to continue.', formData, ref: null });
  }
  if (!firstName || !lastName || !email) {
    return res.render('delegates/signup', { error: 'First name, last name, and email are required.', formData, ref: null });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('delegates/signup', { error: 'Please enter a valid email address.', formData, ref: null });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.render('delegates/signup', { error: pwErr, formData, ref: null });
  if (password !== password_confirm) {
    return res.render('delegates/signup', { error: 'Passwords do not match.', formData, ref: null });
  }

  try {
    const slab = getSlabDb();
    const existing = await slab.collection('sales_delegates').findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.render('delegates/signup', { error: 'An account with this email already exists. Please log in.', formData, ref: null });
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date();
    const refCode = generateRefCode();

    await slab.collection('sales_delegates').insertOne({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      phone: (phone || '').trim(),
      address: (address || '').trim(),
      city: (city || '').trim(),
      state: (state || '').trim(),
      zip: (zip || '').trim(),
      password: hash,
      refCode,
      status: 'pending', // pending → active (superadmin approves) or suspended
      taxInfoProvided: false,
      tenants: [],        // Array of { tenantId, tenantDomain, attachedAt }
      totalEarned: 0,
      totalPaid: 0,
      agreedDisclaimer: true,
      disclaimerAgreedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    logActivity({
      category: 'registration', action: 'delegate_signup',
      status: 'success',
      actor: { email: email.toLowerCase().trim(), role: 'delegate' },
      details: { name: `${firstName} ${lastName}`, refCode },
    });

    // Notify scott@madladslab.com (email + platform_events feed) — fire-and-forget
    notifyAdmin({
      type: 'signup',
      app: 'slab-delegate',
      email: email.toLowerCase().trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      ip: req.ip,
      data: {
        'Program': 'Sales Delegate (Slab trial)',
        'Ref Code': refCode,
        'Phone': (phone || '').trim() || '—',
        'Location': [city, state].filter(Boolean).join(', ') || '—',
        'Status': 'pending review',
        'Review': `${config.DOMAIN}/delegates/admin`,
      },
    }).catch((e) => console.error('[delegates] notifyAdmin failed:', e.message));

    res.render('delegates/signup-success', { name: firstName });
  } catch (err) {
    console.error('[delegates] signup error:', err);
    res.render('delegates/signup', { error: 'Something went wrong. Please try again.', formData, ref: null });
  }
});

router.get('/login', (req, res) => {
  res.render('delegates/login', { error: req.query.error || null, msg: req.query.msg || null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.redirect('/delegates/login?error=Invalid credentials.');

  try {
    const slab = getSlabDb();
    const delegate = await slab.collection('sales_delegates').findOne({ email: email.toLowerCase().trim() });
    if (!delegate || !delegate.password) return res.redirect('/delegates/login?error=Invalid credentials.');

    const match = await bcrypt.compare(password, delegate.password);
    if (!match) return res.redirect('/delegates/login?error=Invalid credentials.');

    if (delegate.status === 'suspended') {
      return res.redirect('/delegates/login?error=Your account has been suspended. Contact support.');
    }

    issueDelegateJWT(delegate, res);
    res.redirect('/delegates/panel');
  } catch (err) {
    console.error('[delegates] login error:', err);
    res.redirect('/delegates/login?error=Something went wrong.');
  }
});

router.get('/logout', (req, res) => {
  if (COOKIE_DOMAIN) res.clearCookie('slab_delegate', { domain: COOKIE_DOMAIN });
  res.clearCookie('slab_delegate');
  res.redirect('/delegates/login?msg=You have been logged out.');
});

// ═══════════════════════════════════════════════════════════════════════════
// DELEGATE PANEL — Protected
// ═══════════════════════════════════════════════════════════════════════════

router.use('/panel', requireDelegate);

// Server-rendered QR PNG (no external CDN — reliable + offline). Gold on near-black.
async function sendQrPng(res, url) {
  try {
    const png = await QRCode.toBuffer(url, { width: 320, margin: 2, color: { dark: '#c9a848', light: '#0a0a0a' } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (e) {
    console.error('[delegates] qr error:', e.message);
    res.status(500).end();
  }
}

// QR for a delegate's own referral link — /start?ref=THEIR_CODE.
router.get('/panel/qr.png', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.status(404).end();
  await sendQrPng(res, `${config.DOMAIN}/start?ref=${delegate.refCode}`);
});

router.get('/panel', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  const payouts = await slab.collection('delegate_payouts')
    .find({ delegateId: delegate._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  // Per-referral commission. Manual referrals carry their own plan; legacy
  // tenant-linked entries resolve the plan from the tenant record.
  const tenantDetails = [];
  for (const t of delegate.tenants || []) {
    const tenant = (!t.plan && t.tenantId) ? await slab.collection('tenants').findOne({ _id: t.tenantId }) : null;
    const calc = computeMonthlyCommission(t.plan ? t : tenant, t.attachedAt);
    tenantDetails.push({ ...t, ...calc, brandName: t.customerName || tenant?.brand?.name || t.tenantDomain || '—' });
  }

  const promoCodes = await slab.collection('delegate_promo_codes')
    .find({ delegateId: delegate._id, active: true })
    .sort({ createdAt: -1 })
    .toArray();

  res.render('delegates/panel', {
    delegate,
    payouts,
    tenantDetails,
    promoCodes,
    commission: COMMISSION,
    commissionExamples: getCommissionExamples(),
    ownerTaxRate: OWNER_TAX_RATE,
    taxComplete: isTaxComplete(delegate),
    heldTotal: +(delegate.totalHeld || 0).toFixed(2),
    payableTotal: +(((delegate.totalEarned || 0) - (delegate.totalPaid || 0))).toFixed(2),
    domain: config.DOMAIN,
  });
});

router.get('/panel/settings', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');
  res.render('delegates/settings', { delegate, error: null, msg: req.query.msg || null });
});

router.post('/panel/settings', async (req, res) => {
  const { firstName, lastName, phone, address, city, state, zip } = req.body;
  if (!firstName || !lastName) {
    const slab = getSlabDb();
    const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
    return res.render('delegates/settings', { delegate, error: 'First and last name are required.', msg: null });
  }

  try {
    const slab = getSlabDb();
    await slab.collection('sales_delegates').updateOne(
      { _id: new ObjectId(req.delegate.id) },
      {
        $set: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: (phone || '').trim(),
          address: (address || '').trim(),
          city: (city || '').trim(),
          state: (state || '').trim(),
          zip: (zip || '').trim(),
          updatedAt: new Date(),
        },
      }
    );
    res.redirect('/delegates/panel/settings?msg=Profile updated successfully.');
  } catch (err) {
    console.error('[delegates] settings update error:', err);
    const slab = getSlabDb();
    const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
    res.render('delegates/settings', { delegate, error: 'Failed to update. Please try again.', msg: null });
  }
});

router.post('/panel/password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  const match = await bcrypt.compare(current_password, delegate.password);
  if (!match) {
    return res.render('delegates/settings', { delegate, error: 'Current password is incorrect.', msg: null });
  }

  const pwErr = validatePassword(new_password);
  if (pwErr) return res.render('delegates/settings', { delegate, error: pwErr, msg: null });
  if (new_password !== confirm_password) {
    return res.render('delegates/settings', { delegate, error: 'New passwords do not match.', msg: null });
  }

  const hash = await bcrypt.hash(new_password, 12);
  await slab.collection('sales_delegates').updateOne(
    { _id: delegate._id },
    { $set: { password: hash, updatedAt: new Date() } }
  );
  res.redirect('/delegates/panel/settings?msg=Password changed successfully.');
});

// ── Tax Info ───────────────────────────────────────────────────────────────

const TAX_ENTITY_TYPES = [
  'individual', 'sole_proprietor', 'llc_single', 'llc_multi',
  'c_corp', 's_corp', 'partnership', 'trust', 'other',
];

// US delegates file a W-9; non-US delegates a W-8BEN. Both capture legal name,
// business/entity type, and a Taxpayer ID (SSN/EIN for US, foreign TIN for W-8BEN),
// all AES-encrypted at rest via plugins/crypto.js.
const TAX_FORM_TYPES = ['W-9', 'W-8BEN'];

/**
 * A delegate may accumulate PAYABLE commission and receive payouts ONLY once a
 * complete tax form is on file. "Complete" = legal name + business/entity type +
 * a Taxpayer ID appropriate to the form type.
 */
function isTaxComplete(delegate) {
  const ti = delegate?.taxInfo;
  if (!ti || !ti.legalName || !ti.entityType) return false;
  if (ti.formType === 'W-8BEN') return !!(ti.country && ti.ftin_enc);
  return !!(ti.ssn_enc || ti.ein_enc); // W-9 (default)
}

/**
 * When a delegate completes their tax form, move any commission that accrued
 * while it was incomplete from the HELD bucket into their payable balance.
 * Returns the dollar amount released.
 */
async function releaseHeldAccruals(slab, delegate, now = new Date()) {
  const held = await slab.collection('delegate_commission_accruals')
    .find({ delegateId: delegate._id, held: true }).toArray();
  if (!held.length) return 0;
  const sum = +held.reduce((s, a) => s + (a.amount || 0), 0).toFixed(2);
  await slab.collection('delegate_commission_accruals').updateMany(
    { delegateId: delegate._id, held: true },
    { $set: { held: false, releasedAt: now, releaseReason: 'tax_completed' } }
  );
  await slab.collection('sales_delegates').updateOne(
    { _id: delegate._id },
    { $inc: { totalEarned: sum, totalHeld: -sum }, $set: { updatedAt: now } }
  );
  return sum;
}

router.get('/panel/tax-info', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  // Decrypt stored tax fields for display (masked)
  let taxInfo = null;
  if (delegate.taxInfo) {
    try {
      const ssn = delegate.taxInfo.ssn_enc ? decrypt(delegate.taxInfo.ssn_enc) : '';
      const ein = delegate.taxInfo.ein_enc ? decrypt(delegate.taxInfo.ein_enc) : '';
      const ftin = delegate.taxInfo.ftin_enc ? decrypt(delegate.taxInfo.ftin_enc) : '';
      taxInfo = {
        formType: delegate.taxInfo.formType || 'W-9',
        legalName: delegate.taxInfo.legalName || '',
        entityType: delegate.taxInfo.entityType || '',
        country: delegate.taxInfo.country || '',
        ssnLast4: ssn.length >= 4 ? '***-**-' + ssn.slice(-4) : '',
        einLast4: ein.length >= 4 ? '**-***' + ein.slice(-4) : '',
        ftinLast4: ftin.length >= 4 ? '••••' + ftin.slice(-4) : (ftin ? '••••' : ''),
        hasW9: !!delegate.taxInfo.w9_enc,
        w9Filename: delegate.taxInfo.w9Filename || '',
        submittedAt: delegate.taxInfo.submittedAt,
        complete: isTaxComplete(delegate),
      };
    } catch (err) {
      console.error('[delegates] tax info decrypt error:', err);
    }
  }

  res.render('delegates/tax-info', {
    delegate,
    taxInfo,
    entityTypes: TAX_ENTITY_TYPES,
    error: null,
    msg: req.query.msg || null,
  });
});

router.post('/panel/tax-info', (req, res, next) => {
  taxUpload.single('w9_file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.redirect('/delegates/panel/tax-info?msg=File too large. Max 10 MB.');
      }
      return res.redirect(`/delegates/panel/tax-info?msg=${encodeURIComponent(err.message)}`);
    }
    next();
  });
}, async (req, res) => {
  const { legalName, entityType, ssn, ein, formType, country, ftin } = req.body;
  const form = TAX_FORM_TYPES.includes(formType) ? formType : 'W-9';

  if (!legalName?.trim()) {
    return res.redirect('/delegates/panel/tax-info?msg=Legal name is required.');
  }
  if (!TAX_ENTITY_TYPES.includes(entityType)) {
    return res.redirect('/delegates/panel/tax-info?msg=Please select a valid entity/business type.');
  }

  try {
    const slab = getSlabDb();
    const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
    if (!delegate) return res.redirect('/delegates/login');

    const now = new Date();
    const taxData = {
      formType: form,
      legalName: legalName.trim(),
      entityType,
      submittedAt: now,
    };

    if (form === 'W-8BEN') {
      // International: country of tax residence + foreign Taxpayer ID (TIN).
      if (!country?.trim()) {
        return res.redirect('/delegates/panel/tax-info?msg=Country of tax residence is required for a W-8BEN.');
      }
      const cleanFtin = (ftin || '').trim();
      if (!cleanFtin && !delegate.taxInfo?.ftin_enc) {
        return res.redirect('/delegates/panel/tax-info?msg=Foreign Taxpayer ID (TIN) is required.');
      }
      taxData.country = country.trim();
      taxData.ftin_enc = cleanFtin ? encrypt(cleanFtin) : (delegate.taxInfo?.ftin_enc || null);
      taxData.ssn_enc = null;
      taxData.ein_enc = null;
    } else {
      // US W-9: SSN or EIN, 9 digits.
      const cleanSSN = (ssn || '').replace(/[^0-9]/g, '');
      const cleanEIN = (ein || '').replace(/[^0-9]/g, '');
      if (!cleanSSN && !cleanEIN && !delegate.taxInfo?.ssn_enc && !delegate.taxInfo?.ein_enc) {
        return res.redirect('/delegates/panel/tax-info?msg=SSN or EIN is required.');
      }
      if (cleanSSN && cleanSSN.length !== 9) {
        return res.redirect('/delegates/panel/tax-info?msg=SSN must be 9 digits.');
      }
      if (cleanEIN && cleanEIN.length !== 9) {
        return res.redirect('/delegates/panel/tax-info?msg=EIN must be 9 digits.');
      }
      taxData.country = 'US';
      taxData.ssn_enc = cleanSSN ? encrypt(cleanSSN) : (delegate.taxInfo?.ssn_enc || null);
      taxData.ein_enc = cleanEIN ? encrypt(cleanEIN) : (delegate.taxInfo?.ein_enc || null);
      taxData.ftin_enc = null;
    }

    // Encrypt the uploaded tax document (W-9 / W-8BEN) if provided, else keep existing.
    if (req.file) {
      const fileBase64 = req.file.buffer.toString('base64');
      taxData.w9_enc = encrypt(fileBase64);
      taxData.w9Filename = req.file.originalname;
      taxData.w9Mimetype = req.file.mimetype;
    } else if (delegate.taxInfo) {
      taxData.w9_enc = delegate.taxInfo.w9_enc || null;
      taxData.w9Filename = delegate.taxInfo.w9Filename || null;
      taxData.w9Mimetype = delegate.taxInfo.w9Mimetype || null;
    }

    const complete = isTaxComplete({ taxInfo: taxData });
    if (complete) taxData.completedAt = delegate.taxInfo?.completedAt || now;

    await slab.collection('sales_delegates').updateOne(
      { _id: delegate._id },
      { $set: { taxInfo: taxData, taxInfoProvided: complete, updatedAt: now } }
    );

    // Completing the form releases any commission that accrued while it was missing.
    let releasedMsg = '';
    if (complete) {
      const released = await releaseHeldAccruals(slab, delegate, now);
      if (released > 0) releasedMsg = ` $${released.toFixed(2)} in held commission released for payout.`;
    }

    logActivity({
      category: 'delegate_action', action: 'tax_info_submitted',
      status: 'success',
      actor: { email: delegate.email, role: 'delegate' },
      details: { formType: form, entityType, complete, hasDoc: !!taxData.w9_enc },
    });

    res.redirect(`/delegates/panel/tax-info?msg=${encodeURIComponent('Tax information saved.' + releasedMsg)}`);
  } catch (err) {
    console.error('[delegates] tax info save error:', err);
    res.redirect('/delegates/panel/tax-info?msg=Failed to save. Please try again.');
  }
});

// ── Download own W-9 (delegate) ───────────────────────────────────────────
router.get('/panel/tax-info/w9', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate?.taxInfo?.w9_enc) return res.redirect('/delegates/panel/tax-info');

  try {
    const decoded = Buffer.from(decrypt(delegate.taxInfo.w9_enc), 'base64');
    res.set('Content-Type', delegate.taxInfo.w9Mimetype || 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${delegate.taxInfo.w9Filename || 'w9.pdf'}"`);
    res.send(decoded);
  } catch (err) {
    console.error('[delegates] w9 download decrypt error:', err);
    res.redirect('/delegates/panel/tax-info?msg=Error retrieving document.');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPERADMIN — Delegate Management
// ═══════════════════════════════════════════════════════════════════════════

router.use('/admin', requireSuperAdmin);

// QR for the delegate signup link (recruit new delegates).
router.get('/admin/signup-qr.png', async (req, res) => {
  await sendQrPng(res, `${config.DOMAIN}/delegates/signup`);
});

router.get('/admin', async (req, res) => {
  const slab = getSlabDb();
  const delegates = await slab.collection('sales_delegates').find().sort({ createdAt: -1 }).toArray();

  const stats = {
    total: delegates.length,
    active: delegates.filter(d => d.status === 'active').length,
    pending: delegates.filter(d => d.status === 'pending').length,
    totalAccounts: delegates.reduce((sum, d) => sum + (d.tenants?.length || 0), 0),
    totalPaid: delegates.reduce((sum, d) => sum + (d.totalPaid || 0), 0),
  };

  // Build signup link
  const signupUrl = `${config.DOMAIN}/delegates/signup`;

  // Payout eligibility (tax complete + payable balance) for the mass-pay control.
  let eligibleCount = 0, eligibleTotal = 0;
  for (const d of delegates) {
    const payable = (d.totalEarned || 0) - (d.totalPaid || 0);
    if (d.status === 'active' && isTaxComplete(d) && payable > 0.005) { eligibleCount++; eligibleTotal += payable; }
  }

  res.render('delegates/admin-list', {
    user: req.superAdmin,
    delegates,
    stats,
    signupUrl,
    payoutsLive: payoutsConfigured(),
    eligibleCount,
    eligibleTotal: +eligibleTotal.toFixed(2),
    payoutIdem: 'mass-' + crypto.randomBytes(6).toString('hex'),
    msg: req.query.msg || null,
    error: req.query.error || null,
  });
});

router.get('/admin/:id', async (req, res) => {
  const slab = getSlabDb();
  let delegate;
  try {
    delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/delegates/admin'); }
  if (!delegate) return res.redirect('/delegates/admin');

  const payouts = await slab.collection('delegate_payouts')
    .find({ delegateId: delegate._id })
    .sort({ createdAt: -1 })
    .toArray();

  // Referrals are Slab subscriptions on one of the 3 public tiers — not linked
  // tenant records. Legacy entries (with a tenantId, pre-refactor) still render
  // by looking up the tenant's plan; new entries carry customerName + plan.
  const legacyIds = (delegate.tenants || []).filter(t => t.tenantId).map(t => t.tenantId);
  const linkedTenants = legacyIds.length
    ? await slab.collection('tenants').find({ _id: { $in: legacyIds } }).toArray()
    : [];

  const tenantDetails = [];
  for (const t of delegate.tenants || []) {
    const tenant = t.tenantId ? linkedTenants.find(at => at._id.toString() === t.tenantId.toString()) : null;
    const calc = computeMonthlyCommission(t.plan ? t : tenant, t.attachedAt);
    tenantDetails.push({
      ...t,
      ...calc,
      key: (t.refId || t.tenantId || '').toString(),
      brandName: t.customerName || tenant?.brand?.name || t.tenantDomain || '—',
    });
  }

  const promoCodes = await slab.collection('delegate_promo_codes')
    .find({ delegateId: delegate._id })
    .sort({ createdAt: -1 })
    .toArray();

  res.render('delegates/admin-detail', {
    user: req.superAdmin,
    delegate,
    payouts,
    tenantDetails,
    tiers: ['monthly', 'quarterly', 'annual'],
    promoCodes,
    commission: COMMISSION,
    ownerTaxRate: OWNER_TAX_RATE,
    domain: config.DOMAIN,
    taxComplete: isTaxComplete(delegate),
    heldTotal: +(delegate.totalHeld || 0).toFixed(2),
    payable: +(((delegate.totalEarned || 0) - (delegate.totalPaid || 0))).toFixed(2),
    payoutsLive: payoutsConfigured(),
    payoutIdem: 'deleg-' + delegate._id + '-' + crypto.randomBytes(5).toString('hex'),
    error: req.query.error || null,
    msg: req.query.msg || null,
    tmppw: req.query.tmppw || null,
  });
});

router.post('/admin/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'pending', 'suspended'].includes(status)) return res.redirect(`/delegates/admin/${req.params.id}`);

  const slab = getSlabDb();
  await slab.collection('sales_delegates').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status, updatedAt: new Date() } }
  );

  logActivity({
    category: 'admin_action', action: `delegate_${status}`,
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
});

// Reset a delegate's password. Sets a fresh temporary password and returns it to
// the superadmin ONCE (via query param) to relay — never persisted/logged in
// plaintext. The delegate can change it under /delegates/panel/settings.
router.post('/admin/:id/reset-password', async (req, res) => {
  const back = `/delegates/admin/${req.params.id}`;
  const slab = getSlabDb();
  let delegate;
  try { delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.redirect('/delegates/admin'); }
  if (!delegate) return res.redirect('/delegates/admin');

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => chars[b % chars.length]).join('');
  const tempPw = `${pick(4)}-${pick(4)}-${pick(4)}`;
  const hash = await bcrypt.hash(tempPw, 12);
  await slab.collection('sales_delegates').updateOne(
    { _id: delegate._id },
    { $set: { password: hash, updatedAt: new Date() } }
  );
  logActivity({
    category: 'admin_action', action: 'delegate_password_reset',
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id, email: delegate.email },
  });
  res.redirect(`${back}?tmppw=${encodeURIComponent(tempPw)}`);
});

// Add a referral: a Slab subscription (slab.madladslab.com) the delegate sold,
// on one of the 3 public tiers. Referrals are NOT tenant records — just a
// customer name + chosen tier. Signups can also link automatically via ?ref=CODE.
const REFERRAL_TIERS = ['monthly', 'quarterly', 'annual'];
router.post('/admin/:id/attach', async (req, res) => {
  const { customerName, plan, signedUpAt } = req.body;
  const name = (customerName || '').trim();
  if (!name || !REFERRAL_TIERS.includes(plan)) {
    return res.redirect(`/delegates/admin/${req.params.id}?error=Enter+a+customer+name+and+a+valid+tier`);
  }
  const attachedAt = signedUpAt ? new Date(signedUpAt) : new Date();
  if (isNaN(attachedAt.getTime())) return res.redirect(`/delegates/admin/${req.params.id}?error=Invalid+date`);

  const slab = getSlabDb();
  await slab.collection('sales_delegates').updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $push: { tenants: { refId: new ObjectId(), customerName: name, plan, attachedAt } },
      $set: { updatedAt: new Date() },
    }
  );

  logActivity({
    category: 'admin_action', action: 'delegate_referral_added',
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id, customerName: name, plan },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
});

router.post('/admin/:id/detach', async (req, res) => {
  const key = req.body.key || req.body.tenantId;
  if (!key || !ObjectId.isValid(key)) return res.redirect(`/delegates/admin/${req.params.id}`);
  const oid = new ObjectId(key);

  const slab = getSlabDb();
  await slab.collection('sales_delegates').updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $pull: { tenants: { $or: [{ refId: oid }, { tenantId: oid }] } },
      $set: { updatedAt: new Date() },
    }
  );

  res.redirect(`/delegates/admin/${req.params.id}`);
});

router.post('/admin/:id/payout', async (req, res) => {
  const { amount, note, paypalTxn } = req.body;
  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) return res.redirect(`/delegates/admin/${req.params.id}`);

  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) });
  if (!delegate) return res.redirect('/delegates/admin');

  // Gate: no payout until a complete W-9 / W-8BEN is on file, and never more
  // than the payable (released) balance.
  if (!isTaxComplete(delegate)) {
    return res.redirect(`/delegates/admin/${req.params.id}?error=${encodeURIComponent('Cannot pay out — delegate has no complete W-9/W-8BEN on file.')}`);
  }
  const available = +(((delegate.totalEarned || 0) - (delegate.totalPaid || 0))).toFixed(2);
  if (parsedAmount > available + 0.005) {
    return res.redirect(`/delegates/admin/${req.params.id}?error=${encodeURIComponent(`Payout $${parsedAmount.toFixed(2)} exceeds payable balance $${available.toFixed(2)}.`)}`);
  }

  const now = new Date();
  await slab.collection('delegate_payouts').insertOne({
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    amount: parsedAmount,
    method: 'paypal',
    paypalTxn: (paypalTxn || '').trim() || null,
    note: (note || '').trim(),
    period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    createdAt: now,
    createdBy: req.superAdmin.email,
  });

  await slab.collection('sales_delegates').updateOne(
    { _id: delegate._id },
    {
      $inc: { totalPaid: parsedAmount },
      $set: { updatedAt: now },
    }
  );

  logActivity({
    category: 'admin_action', action: 'delegate_payout',
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id, amount: parsedAmount, method: 'paypal', paypalTxn: (paypalTxn || '').trim() || null },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
});

// Record a payout: ledger row + Commission Expense entry (for the platform's own
// tax deductions) + balance decrement. Shared by the single and mass API routes.
async function recordPayout(slab, delegate, p) {
  const period = `${p.now.getFullYear()}-${String(p.now.getMonth() + 1).padStart(2, '0')}`;
  await slab.collection('delegate_payouts').insertOne({
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    receiverEmail: delegate.payoutEmail || delegate.email,
    amount: p.amount,
    method: p.method,                 // 'paypal_api' (API) | 'paypal' (manual log)
    paypalBatchId: p.paypalBatchId || null,
    status: p.status || 'recorded',
    note: p.note || '',
    period,
    idemKey: p.idemKey || null,
    createdAt: p.now,
    createdBy: p.actorEmail,
  });
  await slab.collection('commission_expense').insertOne({
    account: 'Commission Expense',    // maps to your bookkeeping expense account
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    amount: p.amount,
    currency: 'USD',
    method: p.method,
    paypalBatchId: p.paypalBatchId || null,
    period,
    createdAt: p.now,
    createdBy: p.actorEmail,
  });
  await slab.collection('sales_delegates').updateOne(
    { _id: delegate._id },
    { $inc: { totalPaid: p.amount }, $set: { updatedAt: p.now } }
  );
}

// Send ONE delegate's payable balance via the live PayPal Payouts API.
router.post('/admin/:id/paypal-payout', async (req, res) => {
  const back = `/delegates/admin/${req.params.id}`;
  if (!payoutsConfigured()) return res.redirect(`${back}?error=${encodeURIComponent('PayPal payouts are not configured.')}`);

  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) });
  if (!delegate) return res.redirect('/delegates/admin');
  if (!isTaxComplete(delegate)) return res.redirect(`${back}?error=${encodeURIComponent('Cannot pay out — no complete W-9/W-8BEN on file.')}`);

  const payable = +(((delegate.totalEarned || 0) - (delegate.totalPaid || 0))).toFixed(2);
  const reqAmt = req.body.amount ? parseFloat(req.body.amount) : payable;
  const amount = +Math.min(reqAmt || 0, payable).toFixed(2);
  if (!(amount > 0)) return res.redirect(`${back}?error=${encodeURIComponent('Nothing payable.')}`);

  // Idempotency: the batch id doubles as the dedup key. A resubmit reuses it, and
  // PayPal rejects a duplicate sender_batch_id — so a double-click cannot double-pay.
  const batchId = (req.body.idemKey || '').trim() || `deleg-${delegate._id}-${Date.now()}`;
  const dupe = await slab.collection('delegate_payouts').findOne({ idemKey: batchId });
  if (dupe) return res.redirect(`${back}?msg=${encodeURIComponent('That payout was already processed.')}`);

  const receiver = delegate.payoutEmail || delegate.email;
  const result = await sendPayoutBatch(
    [{ receiver, amount, note: `Slab commission — ${delegate.firstName} ${delegate.lastName}`, senderItemId: String(delegate._id) }],
    { batchId, subject: 'Your Slab commission payout' }
  );
  if (!result.ok) {
    logActivity({ category: 'admin_action', action: 'delegate_paypal_payout', status: 'error', actor: { email: req.superAdmin.email, role: 'superadmin' }, details: { delegateId: req.params.id, amount, error: result.error } });
    return res.redirect(`${back}?error=${encodeURIComponent('PayPal payout failed: ' + result.error)}`);
  }

  const now = new Date();
  await recordPayout(slab, delegate, { amount, method: 'paypal_api', paypalBatchId: result.payoutBatchId, status: result.status || 'PENDING', note: 'PayPal Payouts API', idemKey: batchId, actorEmail: req.superAdmin.email, now });
  logActivity({ category: 'admin_action', action: 'delegate_paypal_payout', status: 'success', actor: { email: req.superAdmin.email, role: 'superadmin' }, details: { delegateId: req.params.id, amount, receiver, payoutBatchId: result.payoutBatchId } });
  res.redirect(`${back}?msg=${encodeURIComponent(`Sent $${amount.toFixed(2)} to ${receiver} via PayPal (batch ${result.payoutBatchId || ''}, ${result.status || 'PENDING'}).`)}`);
});

// Mass-pay every eligible delegate (tax complete + payable > 0) in one batch.
router.post('/admin/payout-all', async (req, res) => {
  const back = '/delegates/admin';
  if (!payoutsConfigured()) return res.redirect(`${back}?error=${encodeURIComponent('PayPal payouts are not configured.')}`);

  const slab = getSlabDb();
  const batchId = (req.body.idemKey || '').trim() || `mass-${Date.now()}`;
  const dupe = await slab.collection('delegate_payouts').findOne({ idemKey: batchId });
  if (dupe) return res.redirect(`${back}?msg=${encodeURIComponent('That payout run was already processed.')}`);

  const delegates = await slab.collection('sales_delegates').find({ status: 'active' }).toArray();
  const eligible = [];
  for (const d of delegates) {
    const payable = +(((d.totalEarned || 0) - (d.totalPaid || 0))).toFixed(2);
    if (isTaxComplete(d) && payable > 0) eligible.push({ d, payable });
  }
  if (!eligible.length) return res.redirect(`${back}?msg=${encodeURIComponent('No delegates are eligible for payout right now.')}`);

  const items = eligible.map(({ d, payable }) => ({
    receiver: d.payoutEmail || d.email,
    amount: payable,
    note: `Slab commission — ${d.firstName} ${d.lastName}`,
    senderItemId: String(d._id),
  }));

  const result = await sendPayoutBatch(items, { batchId, subject: 'Your Slab commission payout' });
  if (!result.ok) {
    logActivity({ category: 'admin_action', action: 'delegate_mass_payout', status: 'error', actor: { email: req.superAdmin.email, role: 'superadmin' }, details: { count: eligible.length, error: result.error } });
    return res.redirect(`${back}?error=${encodeURIComponent('Mass payout failed: ' + result.error)}`);
  }

  const now = new Date();
  let total = 0;
  for (const { d, payable } of eligible) {
    await recordPayout(slab, d, { amount: payable, method: 'paypal_api', paypalBatchId: result.payoutBatchId, status: result.status || 'PENDING', note: 'PayPal mass payout', idemKey: batchId, actorEmail: req.superAdmin.email, now });
    total += payable;
  }
  total = +total.toFixed(2);
  logActivity({ category: 'admin_action', action: 'delegate_mass_payout', status: 'success', actor: { email: req.superAdmin.email, role: 'superadmin' }, details: { count: eligible.length, total, payoutBatchId: result.payoutBatchId } });
  res.redirect(`${back}?msg=${encodeURIComponent(`Paid ${eligible.length} delegate(s) $${total.toFixed(2)} via PayPal (batch ${result.payoutBatchId || ''}, ${result.status || 'PENDING'}).`)}`);
});

// ── Superadmin: create / list / expire delegate promo codes ──────────────
// A promo code is a shareable token tied to a delegate. When used at /start?ref=CODE,
// the tenant gets `freeDays` free trial AND no delegate commission accrues during that window.
function generatePromoCode(base) {
  const slug = (base || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PROMO';
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${slug}-${suffix}`;
}

router.post('/admin/:id/promo-codes', async (req, res) => {
  const { code, freeDays, expiresAt, label } = req.body;
  const slab = getSlabDb();
  let delegate;
  try { delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.redirect('/delegates/admin'); }
  if (!delegate) return res.redirect('/delegates/admin');

  const normalized = (code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const finalCode = normalized || generatePromoCode(delegate.lastName || delegate.refCode);
  const days = Math.max(1, Math.min(365, parseInt(freeDays, 10) || 30));
  const expDate = expiresAt ? new Date(expiresAt) : null;
  if (expDate && isNaN(expDate.getTime())) {
    return res.redirect(`/delegates/admin/${req.params.id}?error=Invalid+expiry`);
  }

  // Reject duplicate codes
  const existing = await slab.collection('delegate_promo_codes').findOne({ code: finalCode });
  if (existing) return res.redirect(`/delegates/admin/${req.params.id}?error=Code+already+exists`);

  await slab.collection('delegate_promo_codes').insertOne({
    code: finalCode,
    label: (label || '').trim() || finalCode,
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    refCode: delegate.refCode,
    freeDays: days,
    expiresAt: expDate,
    active: true,
    usageCount: 0,
    createdAt: new Date(),
    createdBy: req.superAdmin.email,
  });

  logActivity({
    category: 'admin_action', action: 'delegate_promo_code_created',
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id, code: finalCode, freeDays: days, expiresAt: expDate },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
});

router.post('/admin/:id/promo-codes/:codeId/disable', async (req, res) => {
  const slab = getSlabDb();
  try {
    await slab.collection('delegate_promo_codes').updateOne(
      { _id: new ObjectId(req.params.codeId), delegateId: new ObjectId(req.params.id) },
      { $set: { active: false, disabledAt: new Date(), disabledBy: req.superAdmin.email } }
    );
  } catch { /* invalid id */ }
  res.redirect(`/delegates/admin/${req.params.id}`);
});

// ── Superadmin: send login reminder email to a delegate ──────────────────
router.post('/admin/:id/send-reminder', async (req, res) => {
  const slab = getSlabDb();
  let delegate;
  try { delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.redirect('/delegates/admin'); }
  if (!delegate?.email) return res.redirect(`/delegates/admin/${req.params.id}?error=Delegate+missing+email`);

  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) {
    return res.redirect(`/delegates/admin/${req.params.id}?error=Email+not+configured+(ZOHO_USER/ZOHO_PASS)`);
  }

  const loginUrl = `${config.DOMAIN}/delegates/login`;
  const shareUrl = `${config.DOMAIN}/start?ref=${delegate.refCode}`;
  const acctCount = (delegate.tenants || []).length;
  const earned = (delegate.totalEarned || 0).toFixed(2);
  const subject = `Your sLab Delegate account — log in and start sharing`;
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1a1a1a;">
  <h2 style="color:#c9a848;margin-bottom:8px;">Hi ${delegate.firstName || 'there'},</h2>
  <p style="line-height:1.6;font-size:15px;">This is a quick reminder that your sLab Delegate account is active and ready to use.</p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f7f4ec;border-radius:8px;">
    <tr><td style="padding:14px 18px;border-bottom:1px solid #e6e1d6;font-size:13px;">Accounts attached</td><td style="padding:14px 18px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;font-weight:600;">${acctCount}</td></tr>
    <tr><td style="padding:14px 18px;border-bottom:1px solid #e6e1d6;font-size:13px;">Total earned</td><td style="padding:14px 18px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;font-weight:600;color:#c9a848;">$${earned}</td></tr>
    <tr><td style="padding:14px 18px;font-size:13px;">Your share code</td><td style="padding:14px 18px;font-size:13px;text-align:right;font-family:monospace;color:#c9a848;font-weight:600;">${delegate.refCode}</td></tr>
  </table>

  <p style="line-height:1.6;font-size:15px;">Log in to manage your leads, track commissions, and view your sales sheets:</p>
  <p style="text-align:center;margin:28px 0;">
    <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;background:#c9a848;color:#0a0a0a;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">Open Delegate Panel</a>
  </p>

  <p style="line-height:1.6;font-size:14px;color:#525252;">Share this link to refer a new Slab subscriber — you earn commission once they subscribe:</p>
  <p style="background:#f7f4ec;padding:12px 16px;border-radius:6px;font-family:monospace;font-size:13px;color:#1a1a1a;word-break:break-all;">${shareUrl}</p>

  <p style="line-height:1.6;font-size:13px;color:#737373;margin-top:32px;">If you have any questions or need anything, just reply to this email.</p>
  <p style="line-height:1.6;font-size:13px;color:#737373;">— The sLab Team</p>
</div>`;

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
      auth: { user: zohoUser, pass: zohoPass },
    });
    await transporter.sendMail({
      from: `"sLab Platform" <${zohoUser}>`,
      to: delegate.email,
      subject,
      html,
    });

    logActivity({
      category: 'admin_action', action: 'delegate_reminder_sent',
      status: 'success',
      actor: { email: req.superAdmin.email, role: 'superadmin' },
      details: { delegateId: req.params.id, to: delegate.email, refCode: delegate.refCode },
    });

    res.redirect(`/delegates/admin/${req.params.id}?msg=Reminder+sent+to+${encodeURIComponent(delegate.email)}`);
  } catch (err) {
    console.error('[delegates] reminder email failed:', err.message);
    logActivity({
      category: 'admin_action', action: 'delegate_reminder_sent',
      status: 'failed',
      actor: { email: req.superAdmin.email, role: 'superadmin' },
      details: { delegateId: req.params.id, to: delegate.email },
      error: err.message,
    });
    res.redirect(`/delegates/admin/${req.params.id}?error=${encodeURIComponent('Send failed: ' + err.message)}`);
  }
});

// ── Superadmin: download delegate W-9 ─────────────────────────────────────
router.get('/admin/:id/w9', async (req, res) => {
  const slab = getSlabDb();
  let delegate;
  try { delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.redirect('/delegates/admin'); }
  if (!delegate?.taxInfo?.w9_enc) return res.redirect(`/delegates/admin/${req.params.id}`);

  try {
    const decoded = Buffer.from(decrypt(delegate.taxInfo.w9_enc), 'base64');
    res.set('Content-Type', delegate.taxInfo.w9Mimetype || 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${delegate.taxInfo.w9Filename || 'w9.pdf'}"`);
    res.send(decoded);
  } catch (err) {
    console.error('[delegates] admin w9 download decrypt error:', err);
    res.redirect(`/delegates/admin/${req.params.id}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELEGATE PANEL — Sales Sheets & Leads
// ═══════════════════════════════════════════════════════════════════════════

const LEAD_STATUSES = ['new', 'contacted', 'callback', 'interested', 'converted', 'lost'];
const LEAD_TAGS     = ['hot', 'warm', 'cold', 'follow-up', 'demo-scheduled', 'pricing-sent', 'no-answer'];

// ── Sales Sheets (per brand) ───────────────────────────────────────────────
// Active, shareable promo codes for a delegate — mirrors the redemption rules in
// onboarding.lookupDelegateRef (active + unexpired). Disabled or expired codes are
// excluded so a delegate never advertises a code that would fail at /start.
async function getActivePromoCodes(slab, delegateId, now = new Date()) {
  const codes = await slab.collection('delegate_promo_codes')
    .find({ delegateId, active: true })
    .sort({ createdAt: -1 })
    .toArray();
  return codes.filter(p => !p.expiresAt || new Date(p.expiresAt) > now);
}

router.get('/panel/sales-sheets', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  // Build brand info for each assigned tenant
  const brands = [];
  for (const t of delegate.tenants || []) {
    const tenant = await slab.collection('tenants').findOne({ _id: t.tenantId });
    if (!tenant) continue;

    // Count leads for this brand
    const leadCount = await slab.collection('delegate_leads').countDocuments({
      delegateId: delegate._id, tenantId: t.tenantId,
    });
    const convertedCount = await slab.collection('delegate_leads').countDocuments({
      delegateId: delegate._id, tenantId: t.tenantId, status: 'converted',
    });

    brands.push({
      tenantId: t.tenantId,
      domain: t.tenantDomain,
      brandName: tenant.brand?.name || t.tenantDomain,
      tagline: tenant.brand?.tagline || '',
      description: tenant.brand?.description || '',
      services: tenant.brand?.services || [],
      pricingNotes: tenant.brand?.pricingNotes || '',
      targetAudience: tenant.brand?.targetAudience || '',
      phone: tenant.brand?.phone || '',
      email: tenant.brand?.email || '',
      leadCount,
      convertedCount,
    });
  }

  const promoCodes = await getActivePromoCodes(slab, delegate._id);

  res.render('delegates/sales-sheets', {
    delegate,
    brands,
    promoCodes,
    promo: { type: 'Refer & Earn', description: 'Share your referral link and earn commission on every Slab subscription you convert. Plans start at $39.95/mo. Any active promo codes assigned to you appear below.' },
  });
});

// ── Sales Sheet Detail (single brand) ──────────────────────────────────────
router.get('/panel/sales-sheets/:tenantId', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  let tenantId;
  try { tenantId = new ObjectId(req.params.tenantId); } catch { return res.redirect('/delegates/panel/sales-sheets'); }

  const assigned = (delegate.tenants || []).find(t => t.tenantId.toString() === tenantId.toString());
  if (!assigned) return res.redirect('/delegates/panel/sales-sheets');

  const tenant = await slab.collection('tenants').findOne({ _id: tenantId });
  if (!tenant) return res.redirect('/delegates/panel/sales-sheets');

  const leads = await slab.collection('delegate_leads')
    .find({ delegateId: delegate._id, tenantId })
    .sort({ updatedAt: -1 })
    .toArray();

  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    interested: leads.filter(l => l.status === 'interested').length,
    converted: leads.filter(l => l.status === 'converted').length,
    lost: leads.filter(l => l.status === 'lost').length,
  };

  const promoCodes = await getActivePromoCodes(slab, delegate._id);

  res.render('delegates/sales-sheet-detail', {
    delegate,
    tenant,
    brand: tenant.brand || {},
    leads,
    stats,
    promoCodes,
    leadStatuses: LEAD_STATUSES,
    leadTags: LEAD_TAGS,
    promo: { type: 'Refer & Earn', description: 'Share your referral link and earn commission on every Slab subscription you convert. Plans start at $39.95/mo. Any active promo codes assigned to you appear below.' },
  });
});

// ── Add Lead ───────────────────────────────────────────────────────────────
router.post('/panel/leads/add', async (req, res) => {
  const { tenantId, name, email, phone, company, notes, tags } = req.body;
  if (!tenantId || !name?.trim()) return res.redirect('/delegates/panel/sales-sheets');

  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  let tid;
  try { tid = new ObjectId(tenantId); } catch { return res.redirect('/delegates/panel/sales-sheets'); }

  const assigned = (delegate.tenants || []).find(t => t.tenantId.toString() === tid.toString());
  if (!assigned) return res.redirect('/delegates/panel/sales-sheets');

  const now = new Date();
  const parsedTags = Array.isArray(tags) ? tags : (tags ? [tags] : []);

  await slab.collection('delegate_leads').insertOne({
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    tenantId: tid,
    tenantDomain: assigned.tenantDomain,
    name: name.trim(),
    email: (email || '').trim().toLowerCase(),
    phone: (phone || '').trim(),
    company: (company || '').trim(),
    notes: (notes || '').trim(),
    tags: parsedTags.filter(t => LEAD_TAGS.includes(t)),
    status: 'new',
    callLog: [],
    createdAt: now,
    updatedAt: now,
  });

  logActivity({
    category: 'delegate_action', action: 'lead_added',
    status: 'success',
    actor: { email: delegate.email, role: 'delegate' },
    details: { leadName: name.trim(), tenantDomain: assigned.tenantDomain },
  });

  res.redirect(`/delegates/panel/sales-sheets/${tenantId}`);
});

// ── Update Lead Status / Tags ──────────────────────────────────────────────
router.post('/panel/leads/:leadId/update', async (req, res) => {
  const { status, tags, tenantId } = req.body;
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  let leadId;
  try { leadId = new ObjectId(req.params.leadId); } catch { return res.redirect('/delegates/panel/sales-sheets'); }

  const update = { $set: { updatedAt: new Date() } };
  if (status && LEAD_STATUSES.includes(status)) update.$set.status = status;
  if (tags !== undefined) {
    const parsedTags = Array.isArray(tags) ? tags : (tags ? [tags] : []);
    update.$set.tags = parsedTags.filter(t => LEAD_TAGS.includes(t));
  }

  await slab.collection('delegate_leads').updateOne(
    { _id: leadId, delegateId: delegate._id },
    update,
  );

  res.redirect(`/delegates/panel/sales-sheets/${tenantId || ''}`);
});

// ── Log a Call on a Lead ───────────────────────────────────────────────────
router.post('/panel/leads/:leadId/log-call', async (req, res) => {
  const { outcome, notes, tenantId } = req.body;
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  let leadId;
  try { leadId = new ObjectId(req.params.leadId); } catch { return res.redirect('/delegates/panel/sales-sheets'); }

  const callEntry = {
    date: new Date(),
    outcome: (outcome || 'no-answer').trim(),
    notes: (notes || '').trim(),
  };

  await slab.collection('delegate_leads').updateOne(
    { _id: leadId, delegateId: delegate._id },
    { $push: { callLog: callEntry }, $set: { updatedAt: new Date() } },
  );

  res.redirect(`/delegates/panel/sales-sheets/${tenantId || ''}`);
});

// ── Delete Lead ────────────────────────────────────────────────────────────
router.post('/panel/leads/:leadId/delete', async (req, res) => {
  const { tenantId } = req.body;
  const slab = getSlabDb();

  let leadId;
  try { leadId = new ObjectId(req.params.leadId); } catch { return res.redirect('/delegates/panel/sales-sheets'); }

  await slab.collection('delegate_leads').deleteOne({
    _id: leadId, delegateId: new ObjectId(req.delegate.id),
  });

  res.redirect(`/delegates/panel/sales-sheets/${tenantId || ''}`);
});

// ── Monthly commission calculation endpoint ─────────────────────────────────
router.post('/admin/calculate-commissions', async (req, res) => {
  const slab = getSlabDb();
  const delegates = await slab.collection('sales_delegates').find({ status: 'active' }).toArray();
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const results = [];

  for (const d of delegates) {
    let monthlyTotal = 0;
    const breakdown = [];
    for (const t of d.tenants || []) {
      let ref = t;
      // Legacy tenant-linked entries: only accrue while the tenant is still active.
      if (!t.plan && t.tenantId) {
        const tenant = await slab.collection('tenants').findOne({ _id: t.tenantId, status: 'active' });
        if (!tenant) continue;
        ref = tenant;
      }

      const calc = computeMonthlyCommission(ref, t.attachedAt, now);
      if (calc.commission <= 0) continue;
      monthlyTotal += calc.commission;
      breakdown.push({
        customer: t.customerName || t.tenantDomain || null,
        tenantId: t.tenantId || null,
        plan: calc.plan,
        year: calc.year,
        rate: calc.rate,
        grossMonthly: calc.grossMonthly,
        netMonthly: calc.netMonthly,
        commission: calc.commission,
      });
    }

    monthlyTotal = +monthlyTotal.toFixed(2);

    // Accrue-but-hold: commission is always recorded in the ledger, but if the
    // delegate has no complete tax form on file it lands in the HELD bucket
    // (not payable) until they finish their W-9 / W-8BEN, at which point
    // releaseHeldAccruals() moves it into totalEarned.
    const taxComplete = isTaxComplete(d);

    if (monthlyTotal > 0) {
      await slab.collection('delegate_commission_accruals').insertOne({
        delegateId: d._id,
        delegateEmail: d.email,
        period,
        amount: monthlyTotal,
        ownerTaxRate: OWNER_TAX_RATE,
        breakdown,
        held: !taxComplete,
        heldReason: taxComplete ? null : 'tax_incomplete',
        createdAt: now,
      });
      await slab.collection('sales_delegates').updateOne(
        { _id: d._id },
        { $inc: taxComplete ? { totalEarned: monthlyTotal } : { totalHeld: monthlyTotal }, $set: { updatedAt: now } }
      );
    }

    results.push({
      name: `${d.firstName} ${d.lastName}`,
      email: d.email,
      accounts: d.tenants?.length || 0,
      monthlyCommission: monthlyTotal,
      held: !taxComplete && monthlyTotal > 0,
    });
  }

  if (req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true, period, results });
  }
  res.redirect('/delegates/admin');
});

// ── State tax compliance: revenue by tenant business state ──────────────────
// Aggregates payment_captured activity log entries by tenant business state.
// Use this as the source of truth handed to a CPA for multistate sales-tax filings.
router.get('/admin/reports/state-tax', async (req, res) => {
  const slab = getSlabDb();
  const sinceDays = parseInt(req.query.days || '90', 10);
  const since = new Date(Date.now() - sinceDays * 86400 * 1000);

  const payments = await slab.collection('activity_log').find({
    category: 'payment',
    action: 'payment_captured',
    status: 'success',
    createdAt: { $gte: since },
  }).toArray();

  // Group by tenant, then resolve to business state
  const tenantTotals = new Map();
  for (const p of payments) {
    const domain = p.tenantDomain;
    if (!domain) continue;
    const amount = parseFloat(p.details?.amount || 0);
    if (!amount) continue;
    tenantTotals.set(domain, (tenantTotals.get(domain) || 0) + amount);
  }

  const domains = [...tenantTotals.keys()];
  const tenants = domains.length
    ? await slab.collection('tenants').find({ domain: { $in: domains } }).toArray()
    : [];
  const tenantByDomain = new Map(tenants.map(t => [t.domain, t]));

  const byState = new Map(); // state → { state, revenue, tenants:Set }
  let unknownStateRevenue = 0;
  for (const [domain, revenue] of tenantTotals) {
    const t = tenantByDomain.get(domain);
    const state = (t?.meta?.businessState || t?.brand?.state || '').trim().toUpperCase();
    if (!state) { unknownStateRevenue += revenue; continue; }
    if (!byState.has(state)) byState.set(state, { state, revenue: 0, tenants: new Set() });
    const row = byState.get(state);
    row.revenue += revenue;
    row.tenants.add(domain);
  }

  const stateRows = [...byState.values()]
    .map(r => ({ state: r.state, revenue: +r.revenue.toFixed(2), tenantCount: r.tenants.size, tenants: [...r.tenants] }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = stateRows.reduce((s, r) => s + r.revenue, 0) + unknownStateRevenue;

  res.render('delegates/admin-state-tax', {
    user: req.superAdmin,
    sinceDays,
    since,
    stateRows,
    unknownStateRevenue: +unknownStateRevenue.toFixed(2),
    totalRevenue: +totalRevenue.toFixed(2),
    ownerTaxRate: OWNER_TAX_RATE,
  });
});

// Set a tenant's business state (used for state tax allocation)
router.post('/admin/reports/tenant/:tenantId/business-state', async (req, res) => {
  const { state } = req.body;
  const clean = (state || '').trim().toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(clean)) return res.redirect('/delegates/admin/reports/state-tax?error=Invalid+state+code');

  const slab = getSlabDb();
  try {
    await slab.collection('tenants').updateOne(
      { _id: new ObjectId(req.params.tenantId) },
      { $set: { 'meta.businessState': clean, updatedAt: new Date() } }
    );
  } catch { /* invalid ObjectId */ }
  res.redirect('/delegates/admin/reports/state-tax');
});

export default router;
