'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// Rate limit: 1 suggestion per IP per 5 minutes
const rateMap = new Map();
const RATE_WINDOW = 5 * 60 * 1000;

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      authMethod: 'LOGIN',
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
      },
    });
  }
  return transporter;
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login?next=/suggest');
}

// Serve the suggestion form (auth required)
router.get('/', requireAuth, (req, res) => {
  res.sendFile('suggest.html', { root: __dirname + '/../public' });
});

// Submit suggestion (auth required)
router.post('/', requireAuth, express.json(), async (req, res) => {
  const { name, email, category, message } = req.body;

  // Validate
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
  }

  // Rate limit
  const ip = req.ip || req.connection.remoteAddress;
  const lastSent = rateMap.get(ip);
  if (lastSent && Date.now() - lastSent < RATE_WINDOW) {
    return res.status(429).json({ error: 'Please wait a few minutes before sending another suggestion' });
  }

  // Build email — prefer session user data
  const u = req.user;
  const userName = (name || '').trim().slice(0, 100) || u.displayName || u.firstName || u.email;
  const userEmail = (email || '').trim().slice(0, 200) || u.email || 'Not provided';
  const cat = (category || 'general').trim().slice(0, 50);
  const cleanMsg = message.trim().slice(0, 2000);

  const subject = `[Games Suggestion] ${cat} — from ${userName}`;
  const html = `
    <div style="font-family:monospace;background:#0d0d0d;color:#e0e0e0;padding:24px;border-radius:8px;">
      <h2 style="color:#cd412b;margin:0 0 16px;">New Game Suggestion</h2>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="color:#666;padding:6px 12px 6px 0;vertical-align:top;">From</td><td style="padding:6px 0;">${esc(userName)}</td></tr>
        <tr><td style="color:#666;padding:6px 12px 6px 0;vertical-align:top;">Email</td><td style="padding:6px 0;">${esc(userEmail)}</td></tr>
        <tr><td style="color:#666;padding:6px 12px 6px 0;vertical-align:top;">Category</td><td style="padding:6px 0;color:#e6b800;">${esc(cat)}</td></tr>
        <tr><td style="color:#666;padding:6px 12px 6px 0;vertical-align:top;">Message</td><td style="padding:6px 0;white-space:pre-wrap;">${esc(cleanMsg)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #2a2a2a;margin:16px 0;">
      <div style="color:#666;font-size:0.75em;">Sent from games.madladslab.com/suggest</div>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: `"MadLadsLab Games" <${process.env.ZOHO_USER}>`,
      to: process.env.SUGGEST_TO || 'scott@madladslab.com',
      replyTo: userEmail !== 'Not provided' ? userEmail : undefined,
      subject,
      html,
    });

    rateMap.set(ip, Date.now());
    res.json({ ok: true });
  } catch (e) {
    console.error('[suggest] Email send failed:', e.message);
    res.status(500).json({ error: 'Failed to send — try again later' });
  }
});

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = router;
