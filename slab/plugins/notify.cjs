/**
 * notify.cjs — CJS wrapper for non-ESM apps (games, opsTrain, ACM, graffiti-tv)
 * Require from any CJS app: const { notifyAdmin } = require('/srv/slab/plugins/notify.cjs');
 *
 * Falls back to loading /srv/slab/.env if DB_URL is not in the calling app's env.
 */
'use strict';

const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const path = require('path');

// Bootstrap DB_URL / ZOHO creds from slab .env if the calling app doesn't have them
if (!process.env.DB_URL) {
  try {
    require('dotenv').config({ path: '/srv/slab/.env', override: false });
  } catch {}
}

const ADMIN_EMAIL  = 'scott@madladslab.com';
const SLAB_DB_NAME = process.env.SLAB_DB || 'slab';

const TYPE_META = {
  signup:   { emoji: '🎉', label: 'New Signup',         color: '#22c55e' },
  contact:  { emoji: '📬', label: 'Contact Form',       color: '#3b82f6' },
  booking:  { emoji: '📅', label: 'Meeting Booked',     color: '#c9a848' },
  games:    { emoji: '🎮', label: 'Games Signup',       color: '#cd412b' },
  opstrain: { emoji: '🏷️',  label: 'OpsTrain Signup',   color: '#8b5cf6' },
  acm:      { emoji: '🔧', label: 'ACM Signup',         color: '#f97316' },
  gftv:     { emoji: '📺', label: 'GFTV Signup',        color: '#ec4899' },
  grv:      { emoji: '🌐', label: 'GreeAlityTV Signup', color: '#14b8a6' },
  ps:       { emoji: '⚔️',  label: 'Stringborn Signup', color: '#a78bfa' },
  private:  { emoji: '🔐', label: 'Private Server',     color: '#4caf50' },
};

// Lazy Mongo — reuses a single connection per process
let _slabClient = null;
let _slabDb     = null;

async function getSlabDb() {
  if (_slabDb) return _slabDb;
  const url = process.env.DB_URL || process.env.MONGO_URI;
  if (!url) throw new Error('DB_URL not set — cannot write to platform_events');
  _slabClient = new MongoClient(url);
  await _slabClient.connect();
  _slabDb = _slabClient.db(SLAB_DB_NAME);
  return _slabDb;
}

// Lazy mailer
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const u = process.env.ZOHO_USER;
  const p = process.env.ZOHO_PASS;
  if (!u || !p) return null;
  _transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
    auth: { user: u, pass: p },
  });
  return _transporter;
}

/**
 * @param {object} opts
 * @param {string} opts.type    — event type key
 * @param {string} opts.app     — source app name
 * @param {string} [opts.email]
 * @param {string} [opts.name]
 * @param {object} [opts.data]
 * @param {string} [opts.ip]
 */
async function notifyAdmin({ type = 'signup', app = 'platform', email = '', name = '', data = {}, ip = '' }) {
  const meta = TYPE_META[type] || TYPE_META.signup;
  const ts   = new Date();

  // 1. Write to slab.platform_events (non-blocking — never throws to caller)
  try {
    const db = await getSlabDb();
    await db.collection('platform_events').insertOne({
      type, app,
      email:    email || '',
      name:     name  || email || '',
      data:     data  || {},
      ip:       ip    || '',
      label:    meta.label,
      emoji:    meta.emoji,
      createdAt: ts,
    });
  } catch (e) {
    console.error('[notify] DB write failed:', e.message);
  }

  // 2. Email scott@madladslab.com
  const t = getTransporter();
  if (!t) return; // Zoho not configured — skip silently

  const dataRows = Object.entries(data || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr>
      <td style="padding:5px 10px;color:#a3a3a3;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td>
      <td style="padding:5px 10px;color:#e5e5e5;font-size:13px">${String(v).slice(0, 300)}</td>
    </tr>`)
    .join('');

  const subjectParts = [meta.emoji, meta.label];
  if (email) subjectParts.push(': ' + email);
  if (data && data.brandName) subjectParts.push(' — ' + data.brandName);
  if (data && data.Brand) subjectParts.push(' — ' + data.Brand);
  const subject = subjectParts.join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0a">
<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e5e5e5">
  <div style="border-left:3px solid ${meta.color};padding-left:14px;margin-bottom:20px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#737373;margin-bottom:4px">
      ${app.toUpperCase()} &middot; ${meta.label}
    </div>
    <div style="font-size:20px;font-weight:600;color:#fff">${name || email || 'Anonymous'}</div>
    ${(email && email !== name) ? `<div style="font-size:13px;color:#737373;margin-top:2px">${email}</div>` : ''}
  </div>
  ${dataRows ? `<table style="width:100%;border-collapse:collapse;background:#141414;border:1px solid #262626;border-radius:6px;margin-bottom:16px">${dataRows}</table>` : ''}
  <div style="font-size:11px;color:#525252;padding-top:12px;border-top:1px solid #1a1a1a">
    ${ts.toISOString()} &middot; ${ip || 'no IP'}
  </div>
  <div style="margin-top:10px">
    <a href="https://slab.madladslab.com/superadmin/events"
       style="color:${meta.color};font-size:12px;text-decoration:none">
      View all events in superadmin &rarr;
    </a>
  </div>
</div>
</body></html>`;

  try {
    await t.sendMail({
      from:    `"MadLadsLab Platform" <${process.env.ZOHO_USER}>`,
      to:      ADMIN_EMAIL,
      subject,
      html,
    });
  } catch (e) {
    console.error('[notify] Email send failed:', e.message);
    _transporter = null; // reset so next call retries
  }
}

module.exports = { notifyAdmin };
