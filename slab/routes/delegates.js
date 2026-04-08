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
const COMMISSION = {
  1: 5.00,   // Year 1: $5 per account per month
  2: 2.50,   // Year 2: $2.50
  default: 2.00, // Year 3+: $2 lifetime royalty
};

export function getCommissionRate(yearNumber) {
  return COMMISSION[yearNumber] || COMMISSION.default;
}

// ── Delegate JWT helpers ────────────────────────────────────────────────────

function issueDelegateJWT(delegate, res) {
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
    const attachedAt = new Date(t.attachedAt);
    const yearsSinceAttach = Math.floor((Date.now() - attachedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1;
    const rate = getCommissionRate(yearsSinceAttach);
    tenantDetails.push({
      ...t,
      year: yearsSinceAttach,
      rate,
    });
  }

  res.render('delegates/panel', {
    delegate,
    payouts,
    tenantDetails,
    commission: COMMISSION,
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
    const attachedAt = new Date(t.attachedAt);
    const yearsSinceAttach = Math.floor((Date.now() - attachedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1;
    const rate = getCommissionRate(yearsSinceAttach);
    const tenant = allTenants.find(at => at._id.toString() === t.tenantId.toString());
    tenantDetails.push({
      ...t,
      year: yearsSinceAttach,
      rate,
      brandName: tenant?.brand?.name || t.tenantDomain,
      tenantStatus: tenant?.status || 'unknown',
    });
  }

  res.render('delegates/admin-detail', {
    user: req.superAdmin,
    delegate,
    payouts,
    tenantDetails,
    availableTenants,
    commission: COMMISSION,
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
  const { amount, note, method } = req.body;
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
    method: method || 'manual',
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
    details: { delegateId: req.params.id, amount: parsedAmount, method },
  });

  res.redirect(`/delegates/admin/${req.params.id}`);
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
  const results = [];

  for (const d of delegates) {
    let monthlyTotal = 0;
    for (const t of d.tenants || []) {
      // Only count active tenants
      const tenant = await slab.collection('tenants').findOne({ _id: t.tenantId, status: 'active' });
      if (!tenant) continue;

      const attachedAt = new Date(t.attachedAt);
      const yearsSinceAttach = Math.floor((now.getTime() - attachedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1;
      monthlyTotal += getCommissionRate(yearsSinceAttach);
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
    return res.json({ ok: true, results });
  }
  res.redirect('/delegates/admin');
});

export default router;
