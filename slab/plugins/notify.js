/**
 * plugins/notify.js
 *
 * Central notification hub for MadLadsLab platform.
 * Called on every signup, contact form, booking, and notable action.
 *
 * Sends email to scott@madladslab.com AND writes to slab.platform_events
 * so the superadmin panel can display a live feed.
 *
 * Usage (ESM):
 *   import { notifyAdmin } from '../plugins/notify.js';
 *   await notifyAdmin({ type: 'signup', app: 'slab', email: '...', data: {...} });
 *
 * Usage (CJS apps — games, opsTrain, ACM, graffiti-tv):
 *   const { notifyAdmin } = require('/srv/slab/plugins/notify.cjs');
 */

import nodemailer from 'nodemailer';
import { getSlabDb } from './mongo.js';

const ADMIN_EMAIL  = 'scott@madladslab.com';
const ZOHO_USER    = () => process.env.ZOHO_USER;
const ZOHO_PASS    = () => process.env.ZOHO_PASS;

// ── Type config ─────────────────────────────────────────────────────────
const TYPE_META = {
  signup:   { emoji: '🎉', label: 'New Signup',        color: '#22c55e' },
  contact:  { emoji: '📬', label: 'Contact Form',      color: '#3b82f6' },
  booking:  { emoji: '📅', label: 'Meeting Booked',    color: '#c9a848' },
  games:    { emoji: '🎮', label: 'Games Signup',      color: '#cd412b' },
  opstrain: { emoji: '🏷️',  label: 'OpsTrain Signup',  color: '#8b5cf6' },
  acm:      { emoji: '🔧', label: 'ACM Signup',        color: '#f97316' },
  gftv:     { emoji: '📺', label: 'GFTV Signup',      color: '#ec4899' },
  grv:      { emoji: '🌐', label: 'GreeAlityTV',      color: '#14b8a6' },
  ps:       { emoji: '⚔️',  label: 'Stringborn Signup',color: '#a78bfa' },
  private:  { emoji: '🔐', label: 'Private Server',   color: '#4caf50' },
};

// ── Mailer (lazy singleton) ──────────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const u = ZOHO_USER(), p = ZOHO_PASS();
  if (!u || !p) return null;
  _transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
    auth: { user: u, pass: p },
  });
  return _transporter;
}

// ── Main export ──────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.type       — 'signup'|'contact'|'booking'|'games'|'opstrain'|'acm'|'gftv'|'grv'|'ps'|'private'
 * @param {string} opts.app        — source app name (e.g. 'slab', 'games')
 * @param {string} [opts.email]    — user/submitter email
 * @param {string} [opts.name]     — user/submitter name
 * @param {object} [opts.data]     — additional key/value pairs to show
 * @param {string} [opts.ip]       — request IP
 */
export async function notifyAdmin({ type = 'signup', app = 'platform', email = '', name = '', data = {}, ip = '' }) {
  const meta = TYPE_META[type] || TYPE_META.signup;
  const ts   = new Date();

  // ── 1. Write to slab.platform_events ──────────────────────────────────
  try {
    const db = getSlabDb();
    await db.collection('platform_events').insertOne({
      type, app, email, name: name || email, data, ip,
      label: meta.label, emoji: meta.emoji,
      createdAt: ts,
    });
  } catch (e) {
    console.error('[notify] DB write failed:', e.message);
  }

  // ── 2. Send email to scott@madladslab.com ─────────────────────────────
  const t = getTransporter();
  if (!t) return; // email not configured, silently skip

  const dataRows = Object.entries(data)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:5px 10px;color:#a3a3a3;font-size:13px;white-space:nowrap">${k}</td><td style="padding:5px 10px;color:#e5e5e5;font-size:13px">${v}</td></tr>`)
    .join('');

  const subject = `${meta.emoji} ${meta.label}${email ? ': ' + email : ''}${data.brandName ? ' — ' + data.brandName : ''}`;

  const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e5e5e5">
  <div style="border-left:3px solid ${meta.color};padding-left:14px;margin-bottom:20px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#737373;margin-bottom:4px">${app.toUpperCase()} · ${meta.label}</div>
    <div style="font-size:20px;font-weight:600;color:#fff">${name || email || 'Anonymous'}</div>
    ${email && email !== name ? `<div style="font-size:13px;color:#737373;margin-top:2px">${email}</div>` : ''}
  </div>
  ${dataRows ? `<table style="width:100%;border-collapse:collapse;background:#141414;border:1px solid #262626;border-radius:6px;margin-bottom:16px">${dataRows}</table>` : ''}
  <div style="font-size:11px;color:#525252;margin-top:16px">${ts.toISOString()} · ${ip || 'no IP'}</div>
  <div style="margin-top:12px"><a href="https://slab.madladslab.com/superadmin/events" style="color:${meta.color};font-size:12px;text-decoration:none">View in superadmin →</a></div>
</div>`;

  try {
    await t.sendMail({
      from: `"MadLadsLab Platform" <${ZOHO_USER()}>`,
      to: ADMIN_EMAIL,
      subject,
      html,
    });
  } catch (e) {
    console.error('[notify] Email send failed:', e.message);
    _transporter = null; // reset so it retries next time
  }
}
