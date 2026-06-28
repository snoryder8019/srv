/**
 * One-off: send the onboarding welcome email that never fired for the
 * Lawrie Wallace tenant (provisioning was truncated by the collection cap
 * before the email step ran). Replicates routes/onboarding.js free-signup
 * welcome exactly: platform Zoho SMTP, "sLab" sender, dark template, with a
 * 24h magic-login link (the owner has no password/Google set yet).
 *
 * Run from /srv/slab:  node scripts/_send-lawrie-welcome.js
 */
import nodemailer from 'nodemailer';
import '../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const DBNAME = 'slab_lawrie-wallace';
const SUBDOMAIN = 'lawrie-wallace';

async function main() {
  await connectDB();
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ 'meta.subdomain': SUBDOMAIN });
  if (!tenant) throw new Error('tenant not found');

  const db = getTenantDb(DBNAME);
  const owner = await db.collection('users').findOne({ email: tenant.meta.ownerEmail });
  if (!owner) throw new Error('owner user not found');

  const domain = tenant.domain;                 // lawrie-wallace.madladslab.com
  const brandName = tenant.brand?.name || 'Lawrie Wallace';
  const to = tenant.meta.ownerEmail;            // lawriewallace@yahoo.com

  // 24h one-time magic-login link (signs them straight into admin)
  const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, DBNAME, '24h');
  const emailLoginUrl = `https://${domain}/admin?token=${token}`;

  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) throw new Error('platform SMTP not configured');

  const transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
    auth: { user: zohoUser, pass: zohoPass },
  });

  const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#e5e5e5;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:28px;font-weight:700;color:#fff;"><span style="color:#c9a848;">s</span>Lab</span>
  </div>
  <h1 style="font-size:22px;font-weight:600;color:#fff;margin-bottom:12px;">Welcome to sLab, ${brandName}!</h1>
  <p style="font-size:14px;color:#a3a3a3;line-height:1.7;margin-bottom:20px;">
    Your site <strong style="color:#c9a848;">${domain}</strong> is set up and ready. You have full access to the admin panel — build your site, add content, and go live when you're ready.
  </p>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Site</div>
    <a href="https://${domain}" style="color:#c9a848;font-size:16px;text-decoration:none;">${domain}</a>
  </div>
  <a href="${emailLoginUrl}" style="display:block;text-align:center;padding:14px;background:#c9a848;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;margin-bottom:16px;">Open Admin Panel</a>
  <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;margin-bottom:20px;">
    <div style="font-size:12px;color:#737373;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Login</div>
    <div style="font-size:14px;color:#e5e5e5;margin-bottom:4px;">Account: <strong style="color:#c9a848;">${to}</strong></div>
    <div style="font-size:12px;color:#737373;">The button above signs you in directly. Once inside, set a password or connect Google from Settings so you can sign in anytime.</div>
  </div>
  <p style="font-size:12px;color:#525252;line-height:1.6;text-align:center;">
    This quick-access link expires in 24 hours. After that, sign in at <a href="https://${domain}/admin/login" style="color:#c9a848;">${domain}/admin/login</a>.
  </p>
  <hr style="border:none;border-top:1px solid #262626;margin:24px 0;">
  <p style="font-size:11px;color:#525252;text-align:center;">sLab — Built by MadLadsLab</p>
</div>`;

  const info = await transporter.sendMail({
    from: `"sLab" <${zohoUser}>`,
    to,
    subject: `Your site is ready — ${brandName}`,
    html,
  });

  console.log('Welcome email sent.');
  console.log('  to:        ', to);
  console.log('  from:      ', zohoUser);
  console.log('  subject:   ', `Your site is ready — ${brandName}`);
  console.log('  messageId: ', info.messageId);
  console.log('  accepted:  ', JSON.stringify(info.accepted));
  console.log('  rejected:  ', JSON.stringify(info.rejected));
  console.log('  login link valid for 24h');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
