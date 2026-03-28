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
import { bustTenantCache } from '../middleware/tenant.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const router = express.Router();

function getStripe() {
  if (!config.SLAB_STRIPE_SECRET) return null;
  return new Stripe(config.SLAB_STRIPE_SECRET);
}

// ── Platform-level PayPal helpers ──────────────────────────────────────────
const PP_PLANS = {
  starter:  { label: 'Starter',  amount: '1.00',   days: 30 },
  monthly:  { label: 'Monthly',  amount: '50.00',  days: 30 },
  annual:   { label: 'Annual',   amount: '360.00', days: 365 },
  lifetime: { label: 'Lifetime', amount: '499.00', days: null },
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

// ── Signup form (free) ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('onboarding/start', {
    error: req.query.error || null,
    success: req.query.success || null,
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

// ── Free signup — provisions preview tenant ─────────────────────────────────
router.post('/signup', async (req, res) => {
  const { subdomain, brandName, brandLocation, email } = req.body;
  const slug = (subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (!slug || slug.length < 2) return res.status(400).json({ error: 'Invalid subdomain' });
  if (!brandName?.trim()) return res.status(400).json({ error: 'Business name required' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email required' });

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

    // Track signup for marketing
    await slab.collection('signups').insertOne({
      email: email.trim().toLowerCase(),
      brandName: brandName.trim(),
      subdomain: slug,
      domain: result.domain,
      source: req.get('referer') || 'direct',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      createdAt: new Date(),
    });

    // Get the provisioned user to create a login token
    const tenantDb = getTenantDb(result.dbName);
    const newUser = await tenantDb.collection('users').findOne({ email: email.trim().toLowerCase() })
      || await tenantDb.collection('users').findOne({ email: email.trim() });

    let adminUrl = `https://${result.domain}/admin`;
    if (newUser) {
      const token = createLoginToken(newUser);
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
  <p style="font-size:12px;color:#525252;line-height:1.6;text-align:center;">
    This login link expires in 24 hours. After that, sign in with Google from your admin page.
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
    res.json({ ok: true, domain: result.domain, adminUrl });
  } catch (err) {
    console.error('[onboarding] Signup failed:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// ── Go Live — PayPal checkout to activate ───────────────────────────────────
router.post('/go-live', async (req, res) => {
  if (!config.PAYPAL_CID || !config.PAYPAL_SEC) {
    return res.status(500).json({ error: 'Billing not configured' });
  }

  const { plan } = req.body;
  const planInfo = PP_PLANS[plan || 'starter'];
  if (!planInfo) return res.status(400).json({ error: 'Unknown plan' });

  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ error: 'No tenant context' });

  try {
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
          description: `sLab ${planInfo.label} — Go Live`,
          custom_id: JSON.stringify({ domain: tenant.domain, plan: plan || 'starter' }),
          amount: { currency_code: 'USD', value: planInfo.amount },
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

    res.json({ url: approveLink.href });
  } catch (err) {
    console.error('[onboarding] PayPal session error:', err);
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
      const planInfo = PP_PLANS[plan] || PP_PLANS.starter;

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
    }

    res.redirect('/admin?activated=1');
  } catch (err) {
    console.error('[onboarding] PayPal return error:', err);
    res.redirect('/admin?error=payment_error');
  }
});

// ── Success redirect ────────────────────────────────────────────────────────
router.get('/success', (req, res) => {
  res.render('onboarding/success', { tenant: req.tenant || null });
});

export default router;
