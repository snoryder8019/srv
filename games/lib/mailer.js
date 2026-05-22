'use strict';

// Shared Zoho SMTP transporter. Used by the newsletter (welcome + issue blasts)
// and any other module that needs to send from scott@madladslab.com. The
// suggest route has its own copy that pre-dates this; leaving it alone to
// avoid churn until we centralize.
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.ZOHO_USER || !process.env.ZOHO_PASS) {
    throw new Error('ZOHO_USER / ZOHO_PASS not configured');
  }
  _transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    authMethod: 'LOGIN',
    auth: {
      user: process.env.ZOHO_USER,
      pass: process.env.ZOHO_PASS,
    },
  });
  return _transporter;
}

const FROM = () => `"MadLadsLab Games" <${process.env.ZOHO_USER}>`;
const BASE_URL = process.env.GAMES_API_BASE || 'https://games.madladslab.com';

// Minimal HTML escape for body interpolation. mail clients render <html>,
// so we don't want a stray < in the user's content blowing up the layout.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _shell({ title, bodyHtml, unsubscribeUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;background:#0a0a0a;color:#e8e8e8;font-family:'Courier New',Consolas,monospace;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="border-bottom:1px solid #cd412b;padding-bottom:12px;margin-bottom:20px;">
      <a href="${BASE_URL}" style="color:#cd412b;text-decoration:none;font-weight:bold;letter-spacing:0.1em;font-size:1rem;">MADLADSLAB</a>
      <span style="color:#666;font-size:0.7rem;margin-left:8px;letter-spacing:0.08em;">GAMES</span>
    </div>
    <div style="background:#151515;border:1px solid #222;border-radius:8px;padding:24px;">
      ${bodyHtml}
    </div>
    ${unsubscribeUrl ? `<div style="margin-top:20px;text-align:center;font-size:0.7rem;color:#555;">
      You're getting this because you subscribed at games.madladslab.com.<br>
      <a href="${unsubscribeUrl}" style="color:#cd412b;">Unsubscribe</a>
    </div>` : ''}
  </div>
</body></html>`;
}

async function sendWelcome({ to, token }) {
  const unsubscribeUrl = `${BASE_URL}/newsletter/api/unsubscribe/${token}`;
  const subject = 'Welcome to the MadLadsLab Games newsletter';
  const bodyHtml = `
    <h2 style="color:#cd412b;font-size:1.1rem;letter-spacing:0.06em;margin:0 0 12px;">YOU'RE IN</h2>
    <p style="font-size:0.95rem;line-height:1.6;color:#e8e8e8;">
      Thanks for signing up. You'll get heads-ups on server wipes, new game launches,
      live broadcasts, events, and the occasional patch note. Low volume — we don't spam.
    </p>
    <p style="font-size:0.9rem;line-height:1.6;color:#aaa;">
      Jump in: <a href="${BASE_URL}" style="color:#cd412b;">games.madladslab.com</a>
    </p>`;
  const html = _shell({ title: subject, bodyHtml, unsubscribeUrl });
  const text = `You're subscribed to the MadLadsLab Games newsletter.\n\n` +
    `Jump in: ${BASE_URL}\n\nUnsubscribe: ${unsubscribeUrl}`;
  return getTransporter().sendMail({
    from: FROM(),
    to,
    subject,
    html,
    text,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
  });
}

async function sendIssue({ to, token, subject, bodyText, kind = 'news', thumbnailUrl = null }) {
  const unsubscribeUrl = `${BASE_URL}/newsletter/api/unsubscribe/${token}`;
  const KIND_COLOR = { news:'#4caf82', update:'#4a7c9e', help:'#e6b800', maintenance:'#cd412b', event:'#9c27b0', note:'#666' };
  const accent = KIND_COLOR[kind] || '#cd412b';
  // Preserve newlines from the composed body. Anything HTML-y in the source
  // gets escaped — admins write copy in plain text.
  const bodyHtml = `
    ${thumbnailUrl ? `<img src="${esc(thumbnailUrl)}" alt="" style="width:100%;max-height:240px;object-fit:cover;border-radius:4px;margin-bottom:16px;display:block;">` : ''}
    <div style="font-size:0.6rem;color:${accent};letter-spacing:0.12em;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">${esc(kind.toUpperCase())}</div>
    <h2 style="color:#e8e8e8;font-size:1.15rem;margin:0 0 14px;">${esc(subject)}</h2>
    <div style="font-size:0.92rem;line-height:1.65;color:#ddd;white-space:pre-wrap;">${esc(bodyText)}</div>`;
  const html = _shell({ title: subject, bodyHtml, unsubscribeUrl });
  const text = `${subject}\n\n${bodyText}\n\nUnsubscribe: ${unsubscribeUrl}`;
  return getTransporter().sendMail({
    from: FROM(),
    to,
    subject,
    html,
    text,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
  });
}

// Verify SMTP creds without sending. Useful for the admin health check.
async function verify() {
  return getTransporter().verify();
}

module.exports = { sendWelcome, sendIssue, verify, getTransporter };
