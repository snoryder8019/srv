// ─────────────────────────────────────────────────────────────────────────────
// subscriptionCron.js — platform subscription lifecycle sweep.
//
// Recurring subscriptions auto-renew via Stripe: the /start/webhook handler
// rolls meta.expiresAt forward on every successful charge, so a HEALTHY sub
// never approaches expiry. This daily sweep is the safety net for the unhealthy
// ones — a failed card, a cancel-at-period-end, or a subscription that stopped
// renewing for any reason:
//
//   • T-7d / T-1d before expiry  → email the owner a renewal reminder
//   • past expiry + grace window → flip meta.billingState to 'lapsed'
//        (read-only enforcement lives in middleware/billingEnforce.js —
//         the public site STAYS UP, only admin writes are blocked)
//
// NEVER touches grandfathered tenants, lifetime plans, or non-recurring tenants.
// Uses cronSafe.scheduleDailyJob (claims-before-run, WSL2 skipped-tick tolerant).
// ─────────────────────────────────────────────────────────────────────────────
import nodemailer from 'nodemailer';
import { getSlabDb } from './mongo.js';
import { scheduleDailyJob } from './cronSafe.js';
import { logActivity } from './activityLog.js';
import { notifyAdmin } from './notify.js';
import { config } from '../config/config.js';
import { BILLING_GRACE_DAYS } from '../config/pricing.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Platform (not tenant) mailer — mirrors the onboarding welcome-email transport.
function platformTransport() {
  const user = process.env.ZOHO_USER;
  const pass = process.env.ZOHO_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN', auth: { user, pass } });
}

async function emailOwner(tenant, subject, html) {
  const to = tenant.meta?.ownerEmail || tenant.brand?.email;
  if (!to) return false;
  const tx = platformTransport();
  if (!tx) return false;
  try {
    await tx.sendMail({ from: `"sLab" <${process.env.ZOHO_USER}>`, to, subject, html });
    return true;
  } catch (e) {
    console.error(`[subscription-sweep] email to ${to} failed:`, e.message);
    return false;
  }
}

const manageUrl = (t) => `${config.DOMAIN}/admin`;

function renewalWarnHtml(tenant, days) {
  const name = tenant.brand?.name || 'your site';
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;color:#0F1B30;">
      <h2 style="font-family:Georgia,serif;">Your sLab subscription renews soon</h2>
      <p>Hi — this is a heads-up that the subscription for <strong>${name}</strong> is set to renew in <strong>${days} day${days === 1 ? '' : 's'}</strong>.</p>
      <p>If your card is current there's nothing to do — it renews automatically. If a recent payment failed or you cancelled, update your billing to keep everything running.</p>
      <p><a href="${manageUrl(tenant)}" style="display:inline-block;background:#C9A848;color:#0F1B30;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600;">Manage billing</a></p>
      <p style="font-size:12px;color:#6B7380;">If it lapses, your public site stays online — only the admin dashboard becomes read-only until you reactivate.</p>
    </div>`;
}

function lapsedHtml(tenant) {
  const name = tenant.brand?.name || 'your site';
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;color:#0F1B30;">
      <h2 style="font-family:Georgia,serif;">Your sLab subscription has lapsed</h2>
      <p><strong>${name}</strong>'s subscription didn't renew, so the admin dashboard is now <strong>read-only</strong>. Your public site is still online and no data has been touched.</p>
      <p>Reactivate any time to restore full access:</p>
      <p><a href="${manageUrl(tenant)}" style="display:inline-block;background:#C9A848;color:#0F1B30;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600;">Reactivate</a></p>
    </div>`;
}

// True when this tenant is exempt from renewal/lapse enforcement.
function isExempt(t) {
  const m = t.meta || {};
  return !!m.billingGrandfathered
    || m.plan === 'lifetime'
    || !m.recurring
    || !m.expiresAt;
}

export async function runSubscriptionSweep() {
  const slab = getSlabDb();
  const now = Date.now();

  // Only recurring, non-grandfathered, active-ish tenants can be affected.
  const candidates = await slab.collection('tenants').find({
    'meta.recurring': true,
    'meta.billingGrandfathered': { $ne: true },
    'meta.plan': { $ne: 'lifetime' },
    'meta.expiresAt': { $exists: true, $ne: null },
  }).toArray();

  let warned = 0, lapsed = 0;

  for (const t of candidates) {
    if (isExempt(t)) continue;
    const m = t.meta || {};
    const expires = new Date(m.expiresAt).getTime();
    const graceEnd = expires + BILLING_GRACE_DAYS * DAY_MS;
    const daysLeft = Math.ceil((expires - now) / DAY_MS);

    try {
      // ── Lapse: past expiry + grace, not already lapsed ──
      if (now > graceEnd && m.billingState !== 'lapsed') {
        await slab.collection('tenants').updateOne(
          { _id: t._id },
          { $set: { 'meta.billingState': 'lapsed', 'meta.lapsedAt': new Date(), updatedAt: new Date() } }
        );
        await emailOwner(t, 'Your sLab subscription has lapsed', lapsedHtml(t));
        notifyAdmin({ type: 'subscription_lapsed', app: 'slab', email: m.ownerEmail, name: t.brand?.name, data: { domain: t.domain } }).catch(() => {});
        logActivity({ category: 'payment', action: 'subscription_lapsed', tenantDomain: t.domain, status: 'success', details: { expiresAt: m.expiresAt } });
        console.log(`[subscription-sweep] ${t.domain} → lapsed (read-only)`);
        lapsed++;
        continue;
      }

      // ── Reminders: only while still active and inside the warning windows ──
      if (m.billingState === 'lapsed') continue;
      if (daysLeft <= 1 && daysLeft >= 0 && !m.renewalWarn1At) {
        if (await emailOwner(t, 'Your sLab subscription renews tomorrow', renewalWarnHtml(t, Math.max(daysLeft, 1)))) {
          await slab.collection('tenants').updateOne({ _id: t._id }, { $set: { 'meta.renewalWarn1At': new Date() } });
          warned++;
        }
      } else if (daysLeft <= 7 && daysLeft > 1 && !m.renewalWarn7At) {
        if (await emailOwner(t, 'Your sLab subscription renews soon', renewalWarnHtml(t, daysLeft))) {
          await slab.collection('tenants').updateOne({ _id: t._id }, { $set: { 'meta.renewalWarn7At': new Date() } });
          warned++;
        }
      }
    } catch (e) {
      console.error(`[subscription-sweep] ${t.domain} failed:`, e.message);
    }
  }

  console.log(`[subscription-sweep] done — ${candidates.length} checked, ${warned} warned, ${lapsed} lapsed`);
  return { checked: candidates.length, warned, lapsed };
}

// Boot: daily at 08:00, WSL-skip-tolerant + claims-before-run (won't double-charge state).
export function startSubscriptionSweep() {
  scheduleDailyJob('subscription-sweep', 8, runSubscriptionSweep, { label: 'Subscription lifecycle sweep' });
}
