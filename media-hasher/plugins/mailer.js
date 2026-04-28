import nodemailer from 'nodemailer';
import { config } from '../config/config.js';

let transporter = null;

function getTransporter() {
  if (!config.mailEnabled()) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com',
    port: 465,
    secure: true,
    authMethod: 'LOGIN',
    auth: { user: config.ZOHO_USER, pass: config.ZOHO_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[media-hasher] Mail not configured — skipping send to', to);
    return null;
  }
  return t.sendMail({
    from: `"${config.ZOHO_FROM_NAME}" <${config.ZOHO_USER}>`,
    to,
    subject,
    html,
    text,
  });
}

export async function sendLicenseEmail({ to, displayName, licenseKey, type, expiresAt }) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const isTrial = type === 'trial';
  const subject = isTrial
    ? `Your ${config.PRODUCT_NAME} trial key`
    : `Your ${config.PRODUCT_NAME} license key`;

  const expiryLine = isTrial && expiresAt
    ? `<p>Your trial expires on <strong>${new Date(expiresAt).toLocaleString()}</strong>.</p>`
    : '<p>This is a lifetime license — it will not expire.</p>';

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="margin:0 0 16px;">${config.PRODUCT_NAME}</h2>
      <p>${greeting}</p>
      <p>Here is your license key. Open ${config.PRODUCT_NAME} and paste it on the activation screen.</p>
      <pre style="background:#f4f4f4;padding:14px;border-radius:8px;font-size:16px;letter-spacing:1px;">${licenseKey}</pre>
      ${expiryLine}
      <p>Need help? Just reply to this email.</p>
      <p style="color:#666;font-size:12px;margin-top:32px;">${config.PRODUCT_NAME} · madladslab</p>
    </div>
  `;
  return sendMail({ to, subject, html });
}

export async function sendTrialExpiringEmail({ to, displayName, expiresAt, upgradeUrl }) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="margin:0 0 16px;">Your ${config.PRODUCT_NAME} trial is almost up</h2>
      <p>${greeting}</p>
      <p>Your trial expires on <strong>${new Date(expiresAt).toLocaleString()}</strong>.</p>
      <p>Upgrade to a lifetime license for $${(config.PRODUCT_PRICE_CENTS / 100).toFixed(2)} — one payment, never expires.</p>
      <p><a href="${upgradeUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;">Upgrade now</a></p>
    </div>
  `;
  return sendMail({ to, subject: `Your ${config.PRODUCT_NAME} trial is ending soon`, html });
}
