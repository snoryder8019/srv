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
          from: `"Slab" <${zohoUser}>`,
          to: email.trim(),
          subject: `Your site is ready — ${brandName.trim()}`,
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#e5e5e5;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:28px;font-weight:700;color:#fff;"><span style="color:#c9a848;">S</span>lab</span>
  </div>
  <h1 style="font-size:22px;font-weight:600;color:#fff;margin-bottom:12px;">Welcome to Slab!</h1>
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
  <p style="font-size:11px;color:#525252;text-align:center;">Slab — Built by MadLadsLab</p>
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

// ── Go Live — Stripe checkout to activate ───────────────────────────────────
router.post('/go-live', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(500).json({ error: 'Billing not configured' });

  const { plan } = req.body;
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ error: 'No tenant context' });

  // Plan → Stripe price mapping (set these in env or slab.plans collection)
  const slab = getSlabDb();
  const planDoc = await slab.collection('plans').findOne({ slug: plan || 'monthly' });
  if (!planDoc) return res.status(400).json({ error: 'Unknown plan' });

  try {
    const sessionParams = {
      payment_method_types: ['card'],
      customer_email: tenant.meta?.ownerEmail,
      metadata: {
        tenantDomain: tenant.domain,
        plan: planDoc.slug,
      },
      success_url: `https://${tenant.domain}/admin?activated=1`,
      cancel_url: `https://${tenant.domain}/admin?cancelled=1`,
    };

    if (planDoc.mode === 'subscription') {
      sessionParams.mode = 'subscription';
      sessionParams.line_items = [{ price: planDoc.stripePriceId, quantity: 1 }];
    } else {
      // One-time payment (lifetime, promo)
      sessionParams.mode = 'payment';
      sessionParams.line_items = [{ price: planDoc.stripePriceId, quantity: 1 }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[onboarding] Stripe session error:', err);
    res.status(500).json({ error: 'Payment setup failed' });
  }
});

// ── Stripe Webhook — activates tenant on payment ───────────────────────────
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).send('Not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      config.SLAB_STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('[onboarding] Webhook sig failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { tenantDomain, plan } = session.metadata || {};

    if (tenantDomain) {
      const slab = getSlabDb();
      const now = new Date();

      // Calculate expiry based on plan
      let expiresAt = null;
      if (plan === 'monthly') {
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      } else if (plan === 'annual') {
        expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      }
      // lifetime = no expiry

      await slab.collection('tenants').updateOne(
        { domain: tenantDomain },
        {
          $set: {
            status: 'active',
            'meta.plan': plan,
            'meta.stripeCustomerId': session.customer,
            'meta.stripeSubscriptionId': session.subscription || null,
            'meta.activatedAt': now,
            'meta.expiresAt': expiresAt,
            updatedAt: now,
          },
        }
      );

      bustTenantCache(tenantDomain);
      console.log(`[onboarding] Tenant activated: ${tenantDomain} (${plan})`);
    }
  }

  // Handle subscription cancellation
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const slab = getSlabDb();
    const tenant = await slab.collection('tenants').findOne({
      'meta.stripeSubscriptionId': sub.id,
    });
    if (tenant) {
      await slab.collection('tenants').updateOne(
        { _id: tenant._id },
        { $set: { status: 'suspended', 'meta.suspendedAt': new Date(), updatedAt: new Date() } }
      );
      bustTenantCache(tenant.domain);
      console.log(`[onboarding] Tenant suspended: ${tenant.domain}`);
    }
  }

  res.json({ received: true });
});

// ── Success redirect ────────────────────────────────────────────────────────
router.get('/success', (req, res) => {
  res.render('onboarding/success', { tenant: req.tenant || null });
});

export default router;
