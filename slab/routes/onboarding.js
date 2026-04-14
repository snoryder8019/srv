/**
 * Slab — Onboarding Routes
 * /start              → signup form (free)
 * /start/signup       → create preview tenant (no payment)
 * /start/check-subdomain → availability check
 * /start/go-live      → Stripe checkout to activate
 * /start/webhook      → Stripe webhook (activates tenant)
 * /start/success      → post-payment landing
 */

import express from 'express';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { createLoginToken } from '../middleware/jwtAuth.js';
import { logActivity } from '../plugins/activityLog.js';
import { notifyAdmin } from '../plugins/notify.js';
import bcrypt from 'bcrypt';

const router = express.Router();

function getStripe() {
  if (!config.SLAB_STRIPE_SECRET) return null;
  return new Stripe(config.SLAB_STRIPE_SECRET);
}

// ── Platform-level PayPal helpers ──────────────────────────────────────────
const PP_PLANS = {
  monthly:   { label: 'Monthly',     amount: '50.00',   days: 30 },
  quarterly: { label: 'Quarterly',   amount: '120.00',  days: 90 },   // ~$40/mo
  annual:    { label: 'Annual',      amount: '300.00',  days: 365 },  // $25/mo — half off
  lifetime:  { label: 'Lifetime',    amount: '1200.00', days: null },  // 2-yr equiv
};

let _ppToken = null;
let _ppTokenExp = 0;

function ppBase() {
  return config.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function ppAccessToken() {
  if (_ppToken && Date.now() < _ppTokenExp) return _ppToken;
  const res = await fetch(`${ppBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.PAYPAL_CID}:${config.PAYPAL_SEC}`).toString('base64'),
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

// ── Multi-slab discount pricing ──────────────────────────────────────────────
// First slab: full price. Second slab: 15% off. Third+: 18% off each.
const MULTI_SLAB_DISCOUNTS = { second: 0.15, additional: 0.18 };

/**
 * Count how many active/preview slabs this email owns (is admin/owner in).
 */
async function countSlabsForEmail(email) {
  if (!email) return 0;
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({
    status: { $in: ['active', 'preview'] },
  }).toArray();

  let count = 0;
  for (const t of tenants) {
    try {
      const db = getTenantDb(t.db);
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      if (user && (user.isAdmin || user.isOwner)) count++;
    } catch { /* skip */ }
  }
  return count;
}

/**
 * Calculate discounted amount for a plan based on how many slabs the user already has.
 * Returns { amount, discount, label }
 */
function calcSlabPrice(planKey, existingSlabCount) {
  const base = PP_PLANS[planKey || 'monthly'];
  if (!base) return null;
  const baseAmount = parseFloat(base.amount);

  if (existingSlabCount === 0) {
    return { amount: base.amount, discount: 0, label: 'Full price' };
  }
  if (existingSlabCount === 1) {
    const disc = MULTI_SLAB_DISCOUNTS.second;
    const amt = (baseAmount * (1 - disc)).toFixed(2);
    return { amount: amt, discount: disc, label: '15% multi-slab discount' };
  }
  // 2+
  const disc = MULTI_SLAB_DISCOUNTS.additional;
  const amt = (baseAmount * (1 - disc)).toFixed(2);
  return { amount: amt, discount: disc, label: '18% multi-slab discount' };
}

// ── Promo: first 10 signups get free custom templates ──
const PROMO_FREE_TEMPLATE_LIMIT = 10;

// ── Delegate referral promo: 30 days free ──
const DELEGATE_PROMO_DAYS = 30;

/**
 * Check for a valid delegate referral code and return the delegate doc (or null).
 */
async function lookupDelegateRef(refCode) {
  if (!refCode || typeof refCode !== 'string') return null;
  const code = refCode.trim().toUpperCase();
  if (!/^SD-[A-F0-9]{8}$/.test(code)) return null;
  const slab = getSlabDb();
  return slab.collection('sales_delegates').findOne({ refCode: code, status: 'active' });
}

/**
 * Apply delegate referral promo to a newly provisioned tenant.
 * Sets 30-day free trial perk and tracks the referral.
 */
async function applyDelegatePromo(slug, delegate, signupEmail) {
  const slab = getSlabDb();
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + DELEGATE_PROMO_DAYS * 24 * 60 * 60 * 1000);

  await slab.collection('tenants').updateOne(
    { 'meta.subdomain': slug },
    {
      $set: {
        'perks.delegatePromo': true,
        'perks.delegatePromoAt': now,
        'perks.trialEndsAt': trialEndsAt,
        'perks.referredBy': {
          delegateId: delegate._id,
          delegateEmail: delegate.email,
          refCode: delegate.refCode,
        },
      },
    },
  );

  // Track the referral for commission calculation
  await slab.collection('delegate_referrals').insertOne({
    delegateId: delegate._id,
    delegateEmail: delegate.email,
    refCode: delegate.refCode,
    signupEmail: signupEmail.toLowerCase(),
    subdomain: slug,
    promoDays: DELEGATE_PROMO_DAYS,
    trialEndsAt,
    convertedToPaid: false,
    createdAt: now,
  });

  logActivity({
    category: 'registration', action: 'delegate_referral_applied',
    status: 'success',
    actor: { email: signupEmail, role: 'signup' },
    details: { refCode: delegate.refCode, delegateEmail: delegate.email, trialEndsAt },
  });
}

// ── Pricing API — returns discounted prices for an email ────────────────────
router.get('/pricing', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  const existingCount = email ? await countSlabsForEmail(email) : 0;

  const plans = {};
  for (const [key, info] of Object.entries(PP_PLANS)) {
    const pricing = calcSlabPrice(key, existingCount);
    plans[key] = {
      label: info.label,
      baseAmount: info.amount,
      amount: pricing.amount,
      discount: pricing.discount,
      discountLabel: pricing.label,
    };
  }

  res.json({ existingSlabs: existingCount, plans });
});

// ── Signup form (free) ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const slab = getSlabDb();
  const promoUsed = await slab.collection('signups').countDocuments({ freeTemplates: true });
  const promoLeft = Math.max(0, PROMO_FREE_TEMPLATE_LIMIT - promoUsed);
  const isAddingSlab = req.query.add === '1';
  const ref = req.query.ref || null;

  // Load tenant design for branded onboarding
  let design = { ...DESIGN_DEFAULTS };
  if (req.db) {
    try {
      const rawDesign = await req.db.collection('design').find({}).toArray();
      for (const item of rawDesign) design[item.key] = item.value;
      design = enrichDesignContrast(design);
    } catch (e) { /* fallback to defaults */ }
  }

  res.render('onboarding/start', {
    error: req.query.error || null,
    success: req.query.success || null,
    promoLeft,
    googleClientId: config.GGLCID || '',
    isAddingSlab,
    ref,
    design,
  });
});

// ── Check subdomain availability ────────────────────────────────────────────
router.get('/check-subdomain', async (req, res) => {
  const slug = (req.query.s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug || slug.length < 2) return res.json({ available: false, reason: 'Too short (min 2 chars)' });
  if (slug.length > 30) return res.json({ available: false, reason: 'Too long (max 30 chars)' });

  const reserved = ['admin', 'api', 'www', 'mail', 'ftp', 'slab', 'start', 'superadmin'];
  if (reserved.includes(slug)) return res.json({ available: false, reason: 'Reserved name' });

  const slab = getSlabDb();
  const exists = await slab.collection('tenants').findOne({ 'meta.subdomain': slug });
  res.json({ available: !exists, slug });
});

// ── Google One Tap signup — provisions tenant with Google account ───────────
router.post('/google-signup', async (req, res) => {
  try {
    const { credential, subdomain, brandName, brandLocation, design, tagline, ref } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

    const slug = (subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!slug || slug.length < 2) return res.status(400).json({ error: 'Invalid subdomain' });
    if (!brandName?.trim()) return res.status(400).json({ error: 'Business name required' });

    // Verify Google token
    const tokenInfo = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    const profile = await tokenInfo.json();
    if (!profile.email || profile.aud !== config.GGLCID) {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    const slab = getSlabDb();
    const exists = await slab.collection('tenants').findOne({ 'meta.subdomain': slug });
    if (exists) return res.status(409).json({ error: 'Subdomain taken' });

    const result = await provisionTenant({
      subdomain: slug,
      brandName: brandName.trim(),
      brandLocation: (brandLocation || '').trim(),
      ownerEmail: profile.email,
    });

    // Store design + tagline
    const tenantDb = getTenantDb(result.dbName);
    const validDesigns = ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup', 'studio', 'luxe'];
    const designOps = [];
    if (design && validDesigns.includes(design)) {
      designOps.push(tenantDb.collection('design').updateOne(
        { key: 'landing_layout' }, { $set: { key: 'landing_layout', value: design, updatedAt: new Date() } }, { upsert: true },
      ));
    }
    if (tagline?.trim()) {
      designOps.push(tenantDb.collection('copy').updateOne(
        { key: 'hero_sub' }, { $set: { key: 'hero_sub', value: tagline.trim(), updatedAt: new Date() } }, { upsert: true },
      ));
    }
    if (designOps.length) await Promise.all(designOps);

    // Update user with Google provider (no password needed)
    const newUser = await tenantDb.collection('users').findOne({ email: profile.email });
    if (newUser) {
      await tenantDb.collection('users').updateOne(
        { _id: newUser._id },
        { $set: { googleId: profile.sub, providers: ['google'], provider: 'google', displayName: profile.name || brandName.trim(), isOwner: true } },
      );
    }

    // Track signup
    const promoUsed = await slab.collection('signups').countDocuments({ freeTemplates: true });
    const earnedFreeTemplates = promoUsed < PROMO_FREE_TEMPLATE_LIMIT;

    // Check for delegate referral code
    const delegateRef = await lookupDelegateRef(ref);

    await slab.collection('signups').insertOne({
      email: profile.email, brandName: brandName.trim(), subdomain: slug, domain: result.domain,
      source: 'google-one-tap', ip: req.ip, userAgent: req.get('user-agent'),
      freeTemplates: earnedFreeTemplates,
      refCode: delegateRef?.refCode || null,
      createdAt: new Date(),
    });
    if (earnedFreeTemplates) {
      await slab.collection('tenants').updateOne(
        { 'meta.subdomain': slug },
        { $set: { 'perks.freeTemplates': true, 'perks.freeTemplatesAt': new Date() } },
      );
    }

    // Apply 30-day free trial if referred by a delegate
    if (delegateRef) {
      await applyDelegatePromo(slug, delegateRef, profile.email);
    }

    logActivity({ category: 'registration', action: 'signup', tenantDomain: result.domain, status: 'success',
      actor: { email: profile.email, role: 'owner' },
      details: { subdomain: slug, brandName: brandName.trim(), plan: 'free', design: design || 'classic', method: 'google', refCode: delegateRef?.refCode || null }, ip: req.ip,
    });
    notifyAdmin({ type: 'signup', app: 'slab', email: profile.email, name: profile.name || '', ip: req.ip,
      data: { 'Brand': brandName.trim(), 'Domain': result.domain, 'Method': 'Google One Tap', 'Design': design || 'classic' } }).catch(() => {});

    // Send welcome email to registrant
    try {
      const zohoUser = process.env.ZOHO_USER;
      const zohoPass = process.env.ZOHO_PASS;
      if (zohoUser && zohoPass) {
        const transporter = nodemailer.createTransport({
          host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
          auth: { user: zohoUser, pass: zohoPass },
        });
        await transporter.sendMail({
          from: `"sLab" <${zohoUser}>`,
          to: profile.email,
          subject: `Your site is ready — ${brandName.trim()}`,
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#e5e5e5;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:28px;font-weight:700;color:#fff;"><span style="color:#c9a848;">s</span>Lab</span>
  </div>
  <h1 style="font-size:22px;font-weight:600;color:#fff;margin-bottom:12px;">Welcome to sLab!</h1>
  <p style="font-size:14px;color:#a3a3a3;line-height:1.7;margin-bottom:20px;">
    Your site <strong style="color:#c9a848;">${result.domain}</strong> is set up and ready. You have full access to the admin panel — build your site, add content, and go live when you're ready.
  </p>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Site</div>
    <a href="https://${result.domain}" style="color:#c9a848;font-size:16px;text-decoration:none;">${result.domain}</a>
  </div>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Login</div>
    <div style="font-size:14px;color:#e5e5e5;">Sign in with Google using <strong style="color:#c9a848;">${profile.email}</strong></div>
  </div>
  <a href="https://${result.domain}/admin/login" style="display:block;text-align:center;padding:14px;background:#c9a848;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;margin-bottom:16px;">Open Admin Panel</a>
  <p style="font-size:12px;color:#525252;line-height:1.6;text-align:center;">
    Sign in anytime at <a href="https://${result.domain}/admin/login" style="color:#c9a848;">${result.domain}/admin/login</a> with your Google account.
  </p>
  <hr style="border:none;border-top:1px solid #262626;margin:24px 0;">
  <p style="font-size:11px;color:#525252;text-align:center;">sLab — Built by MadLadsLab</p>
</div>`,
        });
        console.log(`[onboarding] Welcome email sent to ${profile.email} (Google signup)`);

        // Notify superadmin
        await transporter.sendMail({
          from: `"sLab Platform" <${zohoUser}>`,
          to: 'scott@madladslab.com',
          subject: `New Registration (Google): ${brandName.trim()} (${result.domain})`,
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e5e5e5;">
  <div style="font-size:11px;color:#525252;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">New Registration (Google One Tap)</div>
  <h2 style="font-size:20px;font-weight:600;color:#fff;margin-bottom:16px;">${brandName.trim()}</h2>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;">
    <div style="font-size:13px;color:#a3a3a3;line-height:2;">
      <strong style="color:#c9a848;">Domain:</strong> ${result.domain}<br>
      <strong style="color:#c9a848;">Email:</strong> ${profile.email}<br>
      <strong style="color:#c9a848;">Name:</strong> ${profile.name || 'N/A'}<br>
      <strong style="color:#c9a848;">Design:</strong> ${design || 'classic'}<br>
      <strong style="color:#c9a848;">Method:</strong> Google One Tap
    </div>
  </div></div>`,
        });
      }
    } catch(e) {}

    // Build auto-login URL so user lands directly in admin → brand builder
    let adminUrl = `https://${result.domain}/admin`;
    const updatedUser = await tenantDb.collection('users').findOne({ email: profile.email });
    if (updatedUser) {
      const token = createLoginToken({ ...updatedUser, isAdmin: true, isOwner: true }, result.dbName, '24h');
      adminUrl = `https://${result.domain}/admin?token=${token}`;
    }

    res.json({ ok: true, domain: result.domain, adminUrl });
  } catch (err) {
    console.error('[onboarding] Google signup failed:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// ── Free signup — provisions preview tenant ─────────────────────────────────
router.post('/signup', async (req, res) => {
  const { subdomain, brandName, brandLocation, email, password, design, tagline, ref } = req.body;
  const slug = (subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (!slug || slug.length < 2) return res.status(400).json({ error: 'Invalid subdomain' });
  if (!brandName?.trim()) return res.status(400).json({ error: 'Business name required' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'Password must include an uppercase letter' });
  if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'Password must include a number' });

  const slab = getSlabDb();
  const exists = await slab.collection('tenants').findOne({ 'meta.subdomain': slug });
  if (exists) return res.status(409).json({ error: 'Subdomain taken' });

  try {
    const result = await provisionTenant({
      subdomain: slug,
      brandName: brandName.trim(),
      brandLocation: (brandLocation || '').trim(),
      ownerEmail: email.trim(),
    });

    // Track signup for marketing — check promo eligibility
    const promoUsed = await slab.collection('signups').countDocuments({ freeTemplates: true });
    const earnedFreeTemplates = promoUsed < PROMO_FREE_TEMPLATE_LIMIT;

    // Check for delegate referral code
    const delegateRef = await lookupDelegateRef(ref);

    await slab.collection('signups').insertOne({
      email: email.trim().toLowerCase(),
      brandName: brandName.trim(),
      subdomain: slug,
      domain: result.domain,
      source: req.get('referer') || 'direct',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      freeTemplates: earnedFreeTemplates,
      refCode: delegateRef?.refCode || null,
      createdAt: new Date(),
    });

    // Store the perk on the tenant record so the admin panel can check it
    if (earnedFreeTemplates) {
      await slab.collection('tenants').updateOne(
        { 'meta.subdomain': slug },
        { $set: { 'perks.freeTemplates': true, 'perks.freeTemplatesAt': new Date() } },
      );
    }

    // Apply 30-day free trial if referred by a delegate
    if (delegateRef) {
      await applyDelegatePromo(slug, delegateRef, email.trim());
    }

    // Store chosen design layout + tagline
    const tenantDb = getTenantDb(result.dbName);
    const validDesigns = ['classic', 'bold', 'minimal', 'magazine', 'dark', 'startup', 'studio', 'luxe'];
    const designOps = [];
    if (design && validDesigns.includes(design)) {
      designOps.push(tenantDb.collection('design').updateOne(
        { key: 'landing_layout' }, { $set: { key: 'landing_layout', value: design, updatedAt: new Date() } }, { upsert: true },
      ));
    }
    if (tagline?.trim()) {
      designOps.push(tenantDb.collection('copy').updateOne(
        { key: 'hero_sub' }, { $set: { key: 'hero_sub', value: tagline.trim(), updatedAt: new Date() } }, { upsert: true },
      ));
    }
    if (designOps.length) await Promise.all(designOps);

    // Hash password and update the provisioned user
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await tenantDb.collection('users').findOne({ email: email.trim().toLowerCase() })
      || await tenantDb.collection('users').findOne({ email: email.trim() });

    if (newUser) {
      await tenantDb.collection('users').updateOne(
        { _id: newUser._id },
        { $set: { password: hashedPassword, providers: ['local'], provider: 'local' } },
      );
    }

    let adminUrl = `https://${result.domain}/admin`;
    if (newUser) {
      const token = createLoginToken({ ...newUser, isAdmin: true, isOwner: true }, result.dbName, '24h');
      adminUrl = `https://${result.domain}/admin?token=${token}`;
    }

    // Send welcome email with login link
    try {
      const zohoUser = process.env.ZOHO_USER;
      const zohoPass = process.env.ZOHO_PASS;
      if (zohoUser && zohoPass) {
        // Generate a longer-lived token for the email link (24h)
        const emailToken = newUser ? createLoginToken(newUser, '24h') : null;
        const emailLoginUrl = emailToken
          ? `https://${result.domain}/admin?token=${emailToken}`
          : `https://${result.domain}/admin`;

        const transporter = nodemailer.createTransport({
          host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
          auth: { user: zohoUser, pass: zohoPass },
        });

        await transporter.sendMail({
          from: `"sLab" <${zohoUser}>`,
          to: email.trim(),
          subject: `Your site is ready — ${brandName.trim()}`,
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#e5e5e5;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:28px;font-weight:700;color:#fff;"><span style="color:#c9a848;">s</span>Lab</span>
  </div>
  <h1 style="font-size:22px;font-weight:600;color:#fff;margin-bottom:12px;">Welcome to sLab!</h1>
  <p style="font-size:14px;color:#a3a3a3;line-height:1.7;margin-bottom:20px;">
    Your site <strong style="color:#c9a848;">${result.domain}</strong> is set up and ready. You have full access to the admin panel — build your site, add content, and go live when you're ready.
  </p>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Site</div>
    <a href="https://${result.domain}" style="color:#c9a848;font-size:16px;text-decoration:none;">${result.domain}</a>
  </div>
  <a href="${emailLoginUrl}" style="display:block;text-align:center;padding:14px;background:#c9a848;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;margin-bottom:16px;">Open Admin Panel</a>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Login</div>
    <div style="font-size:14px;color:#e5e5e5;margin-bottom:4px;">Email: <strong style="color:#c9a848;">${email.trim()}</strong></div>
    <div style="font-size:12px;color:#737373;">Password: the one you created during signup</div>
  </div>
  <p style="font-size:12px;color:#525252;line-height:1.6;text-align:center;">
    This quick-access link expires in 24 hours. After that, sign in at <a href="https://${result.domain}/admin/login" style="color:#c9a848;">${result.domain}/admin/login</a> with your email and password.
  </p>
  <hr style="border:none;border-top:1px solid #262626;margin:24px 0;">
  <p style="font-size:11px;color:#525252;text-align:center;">sLab — Built by MadLadsLab</p>
</div>`,
        });
        console.log(`[onboarding] Welcome email sent to ${email}`);
      }
    } catch (emailErr) {
      console.error('[onboarding] Welcome email failed:', emailErr.message);
      // Non-fatal — signup still succeeds
    }

    console.log(`[onboarding] Free signup: ${result.domain} (${email})`);
    logActivity({
      category: 'registration', action: 'signup',
      tenantDomain: result.domain, status: 'success',
      actor: { email: email.trim(), role: 'owner' },
      details: { subdomain: slug, brandName: brandName.trim(), plan: 'free', design: design || 'classic' },
      ip: req.ip,
    });

    // Notify platform superadmin of new registration
    try {
      const zohoUser = process.env.ZOHO_USER;
      const zohoPass = process.env.ZOHO_PASS;
      if (zohoUser && zohoPass) {
        const transporter = nodemailer.createTransport({
          host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
          auth: { user: zohoUser, pass: zohoPass },
        });
        await transporter.sendMail({
          from: `"sLab Platform" <${zohoUser}>`,
          to: 'scott@madladslab.com',
          subject: `New Registration: ${brandName.trim()} (${result.domain})`,
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e5e5e5;">
  <div style="font-size:11px;color:#525252;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">New Platform Registration</div>
  <h2 style="font-size:20px;font-weight:600;color:#fff;margin-bottom:16px;">${brandName.trim()}</h2>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;color:#a3a3a3;line-height:2;">
      <strong style="color:#c9a848;">Domain:</strong> ${result.domain}<br>
      <strong style="color:#c9a848;">Email:</strong> ${email.trim()}<br>
      <strong style="color:#c9a848;">Location:</strong> ${(brandLocation || '').trim() || 'Not provided'}<br>
      <strong style="color:#c9a848;">Design:</strong> ${design || 'classic'}<br>
      <strong style="color:#c9a848;">Free Templates:</strong> ${earnedFreeTemplates ? 'Yes' : 'No'}<br>
      <strong style="color:#c9a848;">IP:</strong> ${req.ip}<br>
      <strong style="color:#c9a848;">Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })}
    </div>
  </div>
  <a href="https://slab.madladslab.com/superadmin" style="display:inline-block;padding:10px 20px;background:#c9a848;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">View in Superadmin</a>
</div>`,
        });
      }
    } catch (notifyErr) {
      console.error('[onboarding] Superadmin notify failed:', notifyErr.message);
    }

    res.json({ ok: true, domain: result.domain, adminUrl });
  } catch (err) {
    console.error('[onboarding] Signup failed:', err);
    logActivity({
      category: 'registration', action: 'signup',
      tenantDomain: `${slug}.madladslab.com`, status: 'failed',
      actor: { email: email?.trim(), role: 'owner' },
      details: { subdomain: slug, brandName: brandName?.trim() },
      error: err.message, ip: req.ip,
    });
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// ── Go Live — PayPal checkout to activate ───────────────────────────────────
router.post('/go-live', async (req, res) => {
  if (!config.PAYPAL_CID || !config.PAYPAL_SEC) {
    return res.status(500).json({ error: 'Billing not configured' });
  }

  const { plan } = req.body;
  const planInfo = PP_PLANS[plan || 'monthly'];
  if (!planInfo) return res.status(400).json({ error: 'Unknown plan' });

  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ error: 'No tenant context' });

  try {
    // Apply multi-slab discount if this email already has other slabs
    const ownerEmail = tenant.meta?.ownerEmail;
    const existingCount = ownerEmail ? await countSlabsForEmail(ownerEmail) : 0;
    // existingCount includes THIS slab (preview), so subtract 1 for "other slabs"
    const otherSlabs = Math.max(0, existingCount - 1);
    const pricing = calcSlabPrice(plan || 'monthly', otherSlabs);

    const token = await ppAccessToken();
    const returnUrl = `https://${tenant.domain}/start/paypal-return`;
    const cancelUrl = `https://${tenant.domain}/admin?cancelled=1`;

    const orderRes = await fetch(`${ppBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: tenant.domain,
          description: `sLab ${planInfo.label} — Go Live` + (pricing.discount ? ` (${pricing.label})` : ''),
          custom_id: JSON.stringify({ domain: tenant.domain, plan: plan || 'monthly', discount: pricing.discount }),
          amount: { currency_code: 'USD', value: pricing.amount },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              brand_name: 'sLab by MadLadsLab',
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('[onboarding] PayPal order error:', err);
      return res.status(500).json({ error: 'Payment setup failed' });
    }

    const order = await orderRes.json();
    const approveLink = order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve');
    if (!approveLink) return res.status(500).json({ error: 'No PayPal approval link' });

    logActivity({
      category: 'payment', action: 'go_live_initiated',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
      actor: { email: tenant.meta?.ownerEmail, role: 'owner' },
      details: { plan: plan || 'monthly', amount: pricing.amount, baseAmount: planInfo.amount, discount: pricing.discount, discountLabel: pricing.label, orderId: order.id },
      ip: req.ip,
    });
    res.json({ url: approveLink.href });
  } catch (err) {
    console.error('[onboarding] PayPal session error:', err);
    logActivity({
      category: 'payment', action: 'go_live_initiated',
      tenantDomain: tenant?.domain, tenantId: tenant?._id, status: 'failed',
      actor: { email: tenant?.meta?.ownerEmail, role: 'owner' },
      details: { plan: plan || 'monthly' },
      error: err.message, ip: req.ip,
    });
    res.status(500).json({ error: 'Payment setup failed' });
  }
});

// ── PayPal Return — capture payment & activate tenant ──────────────────────
router.get('/paypal-return', async (req, res) => {
  const orderId = req.query.token; // PayPal sends ?token=ORDER_ID
  if (!orderId) return res.redirect('/admin?error=missing_token');

  try {
    const token = await ppAccessToken();

    // Capture the order
    const captureRes = await fetch(`${ppBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!captureRes.ok) {
      const err = await captureRes.text();
      console.error('[onboarding] PayPal capture failed:', err);
      return res.redirect('/admin?error=payment_failed');
    }

    const capture = await captureRes.json();
    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
      || capture.purchase_units?.[0]?.custom_id;

    let tenantDomain, plan;
    try {
      const meta = JSON.parse(customId);
      tenantDomain = meta.domain;
      plan = meta.plan;
    } catch {
      tenantDomain = req.tenant?.domain;
      plan = 'starter';
    }

    if (tenantDomain) {
      const slab = getSlabDb();
      const now = new Date();
      const planInfo = PP_PLANS[plan] || PP_PLANS.monthly;

      const expiresAt = planInfo.days
        ? new Date(now.getTime() + planInfo.days * 24 * 60 * 60 * 1000)
        : null;

      const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId;

      await slab.collection('tenants').updateOne(
        { domain: tenantDomain },
        {
          $set: {
            status: 'active',
            isPreview: false,
            'meta.plan': plan,
            'meta.paypalOrderId': orderId,
            'meta.paypalCaptureId': captureId,
            'meta.activatedAt': now,
            'meta.expiresAt': expiresAt,
            updatedAt: now,
          },
        }
      );

      bustTenantCache(tenantDomain);
      console.log(`[onboarding] Tenant activated via PayPal: ${tenantDomain} (${plan} — $${planInfo.amount})`);
      logActivity({
        category: 'payment', action: 'payment_captured',
        tenantDomain, status: 'success',
        details: { plan, amount: planInfo.amount, orderId, captureId },
      });
    }

    res.redirect('/admin?activated=1');
  } catch (err) {
    console.error('[onboarding] PayPal return error:', err);
    logActivity({
      category: 'payment', action: 'payment_captured',
      tenantDomain: req.tenant?.domain, status: 'failed',
      details: { orderId },
      error: err.message,
    });
    res.redirect('/admin?error=payment_error');
  }
});

// ── AI subtitle suggestions for signup preview ────────────────────────────
router.post('/suggest', async (req, res) => {
  const { brandName, location } = req.body;
  if (!brandName?.trim()) return res.json({ suggestions: [] });
  try {
    const { callLLM } = await import('../plugins/agentMcp.js');
    const prompt = `Generate 4 short, punchy taglines/subtitles for a business called "${brandName.trim()}"${location ? ' based in ' + location : ''}. Each should be under 10 words. Return ONLY a JSON array of strings, no other text. Example: ["Tagline one","Tagline two","Tagline three","Tagline four"]`;
    const raw = await callLLM([{ role: 'user', content: prompt }], 'You are a branding expert. Return only valid JSON.');
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      return res.json({ suggestions: arr.slice(0, 4) });
    }
    res.json({ suggestions: [] });
  } catch (err) {
    console.error('[onboarding] suggest error:', err.message);
    res.json({ suggestions: [] });
  }
});

// ── Success redirect ────────────────────────────────────────────────────────
router.get('/success', (req, res) => {
  res.render('onboarding/success', { tenant: req.tenant || null });
});

export default router;
