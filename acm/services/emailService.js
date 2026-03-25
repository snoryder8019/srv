/**
 * Email service — Zoho SMTP integration placeholder.
 * Logs to console until ZOHO credentials are configured.
 */
const Campaign = require('../models/Campaign');
const Subscriber = require('../models/Subscriber');

const ZOHO_HOST = process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com';
const ZOHO_PORT = parseInt(process.env.ZOHO_SMTP_PORT || '465', 10);
const ZOHO_EMAIL = process.env.ZOHO_EMAIL || '';
const ZOHO_PASS  = process.env.ZOHO_PASSWORD || '';

function isConfigured() {
  return !!(ZOHO_EMAIL && ZOHO_PASS);
}

function interpolate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v || '');
  }
  return out;
}

async function sendEmail({ to, subject, html, text }) {
  if (!isConfigured()) {
    console.log('[EmailService] ZOHO not configured — simulating send to:', to);
    console.log('[EmailService] Subject:', subject);
    return { success: true, simulated: true };
  }

  // Use Node built-in TLS to talk SMTP (basic implementation)
  const tls = require('tls');
  return new Promise((resolve, reject) => {
    const socket = tls.connect(ZOHO_PORT, ZOHO_HOST, () => {
      let step = 0;
      const commands = [
        'EHLO acmhospitality.com\r\n',
        'AUTH LOGIN\r\n',
        Buffer.from(ZOHO_EMAIL).toString('base64') + '\r\n',
        Buffer.from(ZOHO_PASS).toString('base64') + '\r\n',
        `MAIL FROM:<${ZOHO_EMAIL}>\r\n`,
        `RCPT TO:<${to}>\r\n`,
        'DATA\r\n',
        `From: ACM Hospitality <${ZOHO_EMAIL}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n.\r\n`,
        'QUIT\r\n'
      ];

      socket.on('data', () => {
        if (step < commands.length) {
          socket.write(commands[step]);
          step++;
        } else {
          socket.end();
          resolve({ success: true });
        }
      });
    });

    socket.on('error', (err) => {
      console.error('[EmailService] SMTP error:', err.message);
      resolve({ success: false, error: err.message });
    });

    setTimeout(() => { socket.destroy(); resolve({ success: false, error: 'timeout' }); }, 30000);
  });
}

async function sendCampaign(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  campaign.status = 'sending';
  await campaign.save();

  let query = { isSubscribed: true };
  if (campaign.restaurant !== 'all') {
    query.$or = [{ restaurant: 'all' }, { restaurant: campaign.restaurant }];
  }
  if (campaign.targetTags && campaign.targetTags.length) {
    query.tags = { $in: campaign.targetTags };
  }

  const subscribers = await Subscriber.find(query);
  let sent = 0, bounced = 0;

  for (const sub of subscribers) {
    const vars = {
      firstName: sub.firstName,
      lastName: sub.lastName,
      email: sub.email,
      unsubscribeLink: (process.env.BASE_URL || '') + '/unsubscribe?email=' + encodeURIComponent(sub.email)
    };
    const html = interpolate(campaign.htmlContent, vars);
    const result = await sendEmail({
      to: sub.email,
      subject: campaign.subject,
      html,
      text: campaign.textContent || ''
    });
    if (result.success) sent++;
    else bounced++;
  }

  campaign.status = 'sent';
  campaign.sentAt = new Date();
  campaign.stats.sent = sent;
  campaign.stats.bounced = bounced;
  campaign.stats.delivered = sent;
  await campaign.save();

  return campaign;
}

module.exports = { sendEmail, sendCampaign, interpolate, isConfigured };
