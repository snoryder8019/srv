/**
 * One-shot: send the MadLadsLab packet from the madladslab tenant mailbox.
 * Run: node /srv/slab/_send_packet.mjs
 * Self-deletes after sending.
 */
import { connectDB, getSlabDb } from './plugins/mongo.js';
import { resolveSmtp } from './plugins/mailer.js';
import nodemailer from 'nodemailer';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

await connectDB();
const slab = getSlabDb();
const tenant = await slab.collection('tenants').findOne({ domain: 'madladslab.madladslab.com' });
if (!tenant) throw new Error('madladslab tenant not found');

const smtp = resolveSmtp(tenant);
if (!smtp.user || !smtp.pass) throw new Error('SMTP credentials missing on madladslab tenant');

const transporter = nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  secure: smtp.secure,
  authMethod: 'LOGIN',
  auth: { user: smtp.user, pass: smtp.pass },
});

// Attachments — expect PDFs dropped in /tmp by the calling script
const onepager    = '/tmp/madladslab_onepager.pdf';
const projections = '/tmp/madladslab_projections.pdf';
const attachments = [];
if (existsSync(onepager))    attachments.push({ filename: 'MadLadsLab_OnePager.pdf',    path: onepager,    contentType: 'application/pdf' });
if (existsSync(projections)) attachments.push({ filename: 'MadLadsLab_Projections.pdf', path: projections, contentType: 'application/pdf' });
if (!attachments.length) throw new Error('No PDF attachments found in /tmp — copy them first');

const html = `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111418;max-width:580px;">
  <p style="margin:0 0 16px;"><strong>MadLadsLab Compute Network — Materials</strong></p>
  <p style="margin:0 0 12px;">Scott,</p>
  <p style="margin:0 0 12px;">
    Attached are two documents from our session building out the MadLadsLab pitch materials:
  </p>
  <ul style="margin:0 0 16px;padding-left:20px;">
    <li style="margin-bottom:6px;"><strong>One-Pager</strong> — pitch overview, participation &amp; economics, and technical appendix (3 pages)</li>
    <li style="margin-bottom:6px;"><strong>Revenue &amp; Growth Projections</strong> — 12-quarter model, charts, value stack ($500/mo vs $39.95), unit economics, and assumptions (2 pages)</li>
  </ul>
  <p style="margin:0 0 12px;">
    Three Claude Design prompts are ready for the visual materials — one each for investors, users, and node hosts.
  </p>
  <p style="margin:0 0 20px;">
    Next steps: finalize the projections PDF send, run the Claude Design prompts to generate visual collateral, and get the packet in front of the three audiences.
  </p>
  <p style="margin:0;font-size:12px;color:#9AA3AD;">
    This email and its attachments are confidential and prepared for internal review only.
    Not an offer of securities. Figures are illustrative and forward-looking; not guarantees.
    MadLadsLab is a working name.
  </p>
</div>`;

const info = await transporter.sendMail({
  from: `"madLadsLab" <${smtp.user}>`,
  to:   'Scott@madladslab.com',
  subject: 'MadLadsLab — One-Pager + Projections Packet',
  html,
  attachments,
});

console.log('Sent:', info.messageId, '→ accepted:', info.accepted);

// Clean up
try { await unlink('/srv/slab/_send_packet.mjs'); } catch {}
process.exit(0);
