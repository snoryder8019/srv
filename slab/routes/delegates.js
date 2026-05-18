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
import { config } from '../config/config.js';
import { logActivity } from '../plugins/activityLog.js';

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
const COMMISSION = {
  1: 0.32,        // Year 1: 32% of net revenue
  2: 0.12,        // Year 2: 12% of net revenue
  default: 0.05,  // Year 3+: 5% lifetime royalty of net revenue
};

// Platform owner's effective tax rate used to compute "after taxes" net.
// Federal + state blended — tune as your accounting becomes more precise.
const OWNER_TAX_RATE = 0.30;

// Plan → monthly-equivalent gross revenue (USD)
const PLAN_MONTHLY = {
  monthly:   50.00,
  quarterly: 40.00,   // $120 / 3
  annual:    25.00,   // $300 / 12
  lifetime:  20.79,   // $499 / 24 — amortized over the window, then 0
  starter:   0,       // free trial
  free:      0,
};
const LIFETIME_AMORTIZE_MONTHS = 24;

export function getCommissionRate(yearNumber) {
  return COMMISSION[yearNumber] || COMMISSION.default;
}

/**
 * Compute monthly commission for one tenant assignment.
 * Returns { plan, grossMonthly, ownerTax, netMonthly, year, rate, commission, inTrial, trialEndsAt }.
 *
 * Commission is $0 while the tenant is still inside their delegate-promo free trial
 * (perks.trialEndsAt > now). This is what "promo negates 30 days commission" means.
 */
export function computeMonthlyCommission(tenant, attachedAt, now = new Date()) {
  const plan = tenant?.meta?.plan || 'monthly';
  let grossMonthly = PLAN_MONTHLY[plan] ?? PLAN_MONTHLY.monthly;

  // Lifetime: only attribute revenue during the amortization window
  if (plan === 'lifetime') {
    const activatedAt = tenant?.meta?.activatedAt ? new Date(tenant.meta.activatedAt) : new Date(attachedAt);
    const monthsSinceActive = Math.floor((now.getTime() - activatedAt.getTime()) / (30.44 * 86400 * 1000));
    if (monthsSinceActive >= LIFETIME_AMORTIZE_MONTHS) grossMonthly = 0;
  }

  const yearsSinceAttach = Math.floor((now.getTime() - new Date(attachedAt).getTime()) / (365.25 * 86400 * 1000)) + 1;
  const rate = getCommissionRate(yearsSinceAttach);
  const ownerTax = grossMonthly * OWNER_TAX_RATE;
  const netMonthly = grossMonthly - ownerTax;

  const trialEndsAt = tenant?.perks?.trialEndsAt ? new Date(tenant.perks.trialEndsAt) : null;
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
  res.render('delegates/signup', { error: null, formData: {}, ref });
});

router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, phone, address, city, state, zip, password, password_confirm, agreedDisclaimer } = req.body;
  const formData = { firstName, lastName, email, phone, address, city, state, zip };

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

router.get('/panel', async (req, res) => {
  const slab = getSlabDb();
  const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
  if (!delegate) return res.redirect('/delegates/login');

  const payouts = await slab.collection('delegate_payouts')
    .find({ delegateId: delegate._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  // Calculate per-tenant commission info
  const tenantDetails = [];
  for (const t of delegate.tenants || []) {
    const tenant = await slab.collection('tenants').findOne({ _id: t.tenantId });
    const calc = computeMonthlyCommission(tenant, t.attachedAt);
    tenantDetails.push({ ...t, ...calc });
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
    ownerTaxRate: OWNER_TAX_RATE,
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
      taxInfo = {
        legalName: delegate.taxInfo.legalName || '',
        entityType: delegate.taxInfo.entityType || '',
        ssnLast4: ssn.length >= 4 ? '***-**-' + ssn.slice(-4) : '',
        einLast4: ein.length >= 4 ? '**-***' + ein.slice(-4) : '',
        hasW9: !!delegate.taxInfo.w9_enc,
        w9Filename: delegate.taxInfo.w9Filename || '',
        submittedAt: delegate.taxInfo.submittedAt,
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
  const { legalName, entityType, ssn, ein } = req.body;

  if (!legalName?.trim()) {
    return res.redirect('/delegates/panel/tax-info?msg=Legal name is required.');
  }
  if (!TAX_ENTITY_TYPES.includes(entityType)) {
    return res.redirect('/delegates/panel/tax-info?msg=Please select a valid entity type.');
  }
  // Require at least SSN or EIN
  const cleanSSN = (ssn || '').replace(/[^0-9]/g, '');
  const cleanEIN = (ein || '').replace(/[^0-9]/g, '');
  if (!cleanSSN && !cleanEIN) {
    return res.redirect('/delegates/panel/tax-info?msg=SSN or EIN is required.');
  }
  if (cleanSSN && cleanSSN.length !== 9) {
    return res.redirect('/delegates/panel/tax-info?msg=SSN must be 9 digits.');
  }
  if (cleanEIN && cleanEIN.length !== 9) {
    return res.redirect('/delegates/panel/tax-info?msg=EIN must be 9 digits.');
  }

  try {
    const slab = getSlabDb();
    const delegate = await slab.collection('sales_delegates').findOne({ _id: new ObjectId(req.delegate.id) });
    if (!delegate) return res.redirect('/delegates/login');

    const now = new Date();
    const taxData = {
      legalName: legalName.trim(),
      entityType,
      ssn_enc: cleanSSN ? encrypt(cleanSSN) : (delegate.taxInfo?.ssn_enc || null),
      ein_enc: cleanEIN ? encrypt(cleanEIN) : (delegate.taxInfo?.ein_enc || null),
      submittedAt: now,
    };

    // Encrypt W-9 file if uploaded, otherwise keep existing
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

    await slab.collection('sales_delegates').updateOne(
      { _id: delegate._id },
      {
        $set: {
          taxInfo: taxData,
          taxInfoProvided: true,
          updatedAt: now,
        },
      }
    );

    logActivity({
      category: 'delegate_action', action: 'tax_info_submitted',
      status: 'success',
      actor: { email: delegate.email, role: 'delegate' },
      details: { entityType, hasW9: !!taxData.w9_enc },
    });

    res.redirect('/delegates/panel/tax-info?msg=Tax information saved successfully.');
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

  res.render('delegates/admin-list', {
    user: req.superAdmin,
    delegates,
    stats,
    signupUrl,
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

  // Get available tenants (active ones not already attached)
  const attachedIds = (delegate.tenants || []).map(t => t.tenantId.toString());
  const allTenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .sort({ 'brand.name': 1 })
    .toArray();

  const availableTenants = allTenants.filter(t => !attachedIds.includes(t._id.toString()));

  // Calculate per-tenant commission info
  const tenantDetails = [];
  for (const t of delegate.tenants || []) {
    const tenant = allTenants.find(at => at._id.toString() === t.tenantId.toString());
    const calc = computeMonthlyCommission(tenant, t.attachedAt);
    tenantDetails.push({
      ...t,
      ...calc,
      brandName: tenant?.brand?.name || t.tenantDomain,
      tenantStatus: tenant?.status || 'unknown',
      businessState: tenant?.meta?.businessState || tenant?.brand?.state || null,
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
    availableTenants,
    promoCodes,
    commission: COMMISSION,
    ownerTaxRate: OWNER_TAX_RATE,
    domain: config.DOMAIN,
    error: req.query.error || null,
    msg: req.query.msg || null,
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

router.post('/admin/:id/attach', async (req, res) => {
  const { tenantId } = req.body;
  if (!tenantId) return res.redirect(`/delegates/admin/${req.params.id}`);

  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(tenantId) });
  if (!tenant) return res.redirect(`/delegates/admin/${req.params.id}`);

  await slab.collection('sales_delegates').updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $addToSet: {
        tenants: {
          tenantId: tenant._id,
          tenantDomain: tenant.domain,
          attachedAt: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  logActivity({
    category: 'admin_action', action: 'delegate_tenant_attached',
    tenantDomain: tenant.domain, tenantId: tenant._id,
    status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { delegateId: req.params.id },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
});

router.post('/admin/:id/detach', async (req, res) => {
  const { tenantId } = req.body;
  if (!tenantId) return res.redirect(`/delegates/admin/${req.params.id}`);

  const slab = getSlabDb();
  await slab.collection('sales_delegates').updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $pull: { tenants: { tenantId: new ObjectId(tenantId) } },
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

  <p style="line-height:1.6;font-size:14px;color:#525252;">Share this link to refer a new tenant (they get a free trial, you earn commission once they convert):</p>
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

  res.render('delegates/sales-sheets', {
    delegate,
    brands,
    promo: { type: '30-day free trial', description: 'New signups get 30 days free on any platform when using your referral code.' },
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

  res.render('delegates/sales-sheet-detail', {
    delegate,
    tenant,
    brand: tenant.brand || {},
    leads,
    stats,
    leadStatuses: LEAD_STATUSES,
    leadTags: LEAD_TAGS,
    promo: { type: '30-day free trial', description: 'New signups get 30 days free on any platform when using your referral code.' },
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
      const tenant = await slab.collection('tenants').findOne({ _id: t.tenantId, status: 'active' });
      if (!tenant) continue;

      const calc = computeMonthlyCommission(tenant, t.attachedAt, now);
      if (calc.commission <= 0) continue;
      monthlyTotal += calc.commission;
      breakdown.push({
        tenantId: tenant._id,
        tenantDomain: tenant.domain,
        plan: calc.plan,
        year: calc.year,
        rate: calc.rate,
        grossMonthly: calc.grossMonthly,
        netMonthly: calc.netMonthly,
        commission: calc.commission,
      });
    }

    monthlyTotal = +monthlyTotal.toFixed(2);

    // Record the accrual so we have an auditable ledger separate from payouts
    if (monthlyTotal > 0) {
      await slab.collection('delegate_commission_accruals').insertOne({
        delegateId: d._id,
        delegateEmail: d.email,
        period,
        amount: monthlyTotal,
        ownerTaxRate: OWNER_TAX_RATE,
        breakdown,
        createdAt: now,
      });
    }

    await slab.collection('sales_delegates').updateOne(
      { _id: d._id },
      { $inc: { totalEarned: monthlyTotal }, $set: { updatedAt: now } }
    );

    results.push({
      name: `${d.firstName} ${d.lastName}`,
      email: d.email,
      accounts: d.tenants?.length || 0,
      monthlyCommission: monthlyTotal,
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
