/**
 * routes/booking.js — Public visitor booking page for sLab tenants
 *
 * GET  /book           — booking page (shows availability)
 * POST /book           — submit booking request → emails tenant + admin
 * GET  /book/confirm   — confirmation landing
 *
 * Admin side is in /admin/meetings (existing) — tenant enables availability there.
 * Availability stored in tenant DB: collection('booking_settings')
 * Bookings stored in tenant DB: collection('bookings')
 */

import express from 'express';
import nodemailer from 'nodemailer';
import { notifyAdmin } from '../plugins/notify.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { getSlabDb } from '../plugins/mongo.js';

const router = express.Router();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function loadDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  try {
    const rows = await db.collection('design').find({}).toArray();
    for (const r of rows) design[r.key] = r.value;
  } catch {}
  return enrichDesignContrast(design);
}

async function loadSettings(db) {
  const doc = await db.collection('booking_settings').findOne({ key: 'config' });
  return doc?.value || {
    enabled: false,
    title: 'Book a Meeting',
    subtitle: 'Choose a time that works for you.',
    meetingLength: 30,       // minutes
    bufferMinutes: 15,       // gap between bookings
    advanceDays: 14,         // how far ahead they can book
    minNoticeHours: 2,       // minimum notice before a slot
    availability: {           // which days + hours are open
      1: { enabled: true, start: '09:00', end: '17:00' },  // Monday
      2: { enabled: true, start: '09:00', end: '17:00' },
      3: { enabled: true, start: '09:00', end: '17:00' },
      4: { enabled: true, start: '09:00', end: '17:00' },
      5: { enabled: true, start: '09:00', end: '17:00' },
    },
  };
}

/** Generate available time slots for a given date */
function generateSlots(date, settings, existingBookings) {
  const dow = date.getDay();
  const avail = settings.availability?.[dow];
  if (!avail?.enabled) return [];

  const [startH, startM] = avail.start.split(':').map(Number);
  const [endH, endM]     = avail.end.split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin   = endH * 60 + endM;
  const slotLen  = settings.meetingLength || 30;
  const buffer   = settings.bufferMinutes || 0;
  const step     = slotLen + buffer;
  const minNoticeMs = (settings.minNoticeHours || 2) * 60 * 60 * 1000;

  const bookedMinutes = existingBookings.map(b => {
    const d = new Date(b.startAt);
    return d.getHours() * 60 + d.getMinutes();
  });

  const slots = [];
  for (let m = startMin; m + slotLen <= endMin; m += step) {
    const h   = Math.floor(m / 60);
    const min = m % 60;
    const slotDate = new Date(date);
    slotDate.setHours(h, min, 0, 0);

    // Skip past slots (with minimum notice)
    if (slotDate.getTime() - Date.now() < minNoticeMs) continue;

    // Skip already-booked slots
    const conflict = bookedMinutes.some(bm => Math.abs(bm - m) < slotLen);
    if (conflict) continue;

    const label12 = slotDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    slots.push({ time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`, label: label12, iso: slotDate.toISOString() });
  }
  return slots;
}

// ── GET /book ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    if (!db) {
      // No tenant resolved (direct IP / platform domain) — show generic unavailable
      return res.status(404).send('Booking page not found. Visit a tenant site to book a meeting.');
    }
    const settings = await loadSettings(db);
    const design   = await loadDesign(db);
    const brand    = res.locals.brand || {};

    if (!settings.enabled) {
      return res.render('booking/unavailable', { design, brand, settings });
    }

    // Build calendar: today + advanceDays
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + (settings.advanceDays || 14));

    // Pre-fetch bookings for the visible window
    const existingBookings = await db.collection('bookings').find({
      startAt: { $gte: today, $lte: maxDate },
      status: { $nin: ['cancelled'] },
    }).toArray();

    const days = [];
    for (let d = new Date(today); d <= maxDate; d.setDate(d.getDate() + 1)) {
      const dayBookings = existingBookings.filter(b => {
        const bd = new Date(b.startAt);
        return bd.toDateString() === d.toDateString();
      });
      const slots = generateSlots(new Date(d), settings, dayBookings);
      if (slots.length) {
        days.push({
          date: new Date(d),
          iso: d.toISOString().slice(0, 10),
          label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          slots,
        });
      }
    }

    res.render('booking/index', {
      design, brand, settings, days,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[booking] GET error:', err);
    res.status(500).send('Booking page error');
  }
});

// ── POST /book ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    if (!db) return res.redirect('/');
    const { name, email, phone, company, message, slotIso } = req.body;
    const brand = res.locals.brand || {};

    if (!name || !email || !slotIso) {
      return res.redirect('/book?error=missing');
    }

    const settings = await loadSettings(db);
    if (!settings.enabled) return res.redirect('/book');

    const startAt  = new Date(slotIso);
    const endAt    = new Date(startAt.getTime() + (settings.meetingLength || 30) * 60000);

    // Double-check slot still available
    const conflict = await db.collection('bookings').findOne({
      startAt: { $lt: endAt },
      endAt:   { $gt: startAt },
      status:  { $nin: ['cancelled'] },
    });
    if (conflict) return res.redirect('/book?error=taken');

    // Save booking
    await db.collection('bookings').insertOne({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || '',
      company: company?.trim() || '',
      message: message?.trim() || '',
      startAt,
      endAt,
      duration: settings.meetingLength || 30,
      status: 'pending',
      tenantDomain: req.tenant?.domain || '',
      createdAt: new Date(),
    });

    const dateStr = startAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const brandName = brand.name || req.tenant?.domain || 'your site';

    // Notify platform admin
    notifyAdmin({ type: 'booking', app: 'slab', email, name, ip: req.ip,
      data: {
        'Brand': brandName,
        'Domain': req.tenant?.domain || '',
        'Date': dateStr,
        'Time': timeStr,
        'Duration': `${settings.meetingLength || 30} min`,
        'Phone': phone || '',
        'Company': company || '',
        'Message': message?.slice(0, 150) || '',
      },
    }).catch(() => {});

    // Email confirmation to visitor
    const tenantRecord = await getSlabDb().collection('tenants').findOne({ domain: req.tenant?.domain });
    const zohoUser = tenantRecord?.secrets?.zohoUser || tenantRecord?.public?.zohoUser || process.env.ZOHO_USER;
    const zohoPass = tenantRecord?.secrets?.zohoPass || process.env.ZOHO_PASS;
    const ownerEmail = tenantRecord?.meta?.ownerEmail;

    if (zohoUser && zohoPass) {
      const t = nodemailer.createTransport({ host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN', auth: { user: zohoUser, pass: zohoPass } });

      // To visitor
      await t.sendMail({
        from: `"${brandName}" <${zohoUser}>`,
        to: email,
        subject: `Your meeting is confirmed — ${dateStr} at ${timeStr}`,
        html: `<div style="font-family:Inter,sans-serif;max-width:500px;padding:32px;background:#0a0a0a;color:#e5e5e5">
          <h2 style="color:#fff;margin-bottom:4px">Meeting Confirmed</h2>
          <p style="color:#737373;margin-bottom:24px">with ${brandName}</p>
          <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:20px">
            <div style="font-size:22px;font-weight:700;color:#c9a848;margin-bottom:4px">${dateStr}</div>
            <div style="font-size:16px;color:#e5e5e5">${timeStr} · ${settings.meetingLength || 30} minutes</div>
          </div>
          <p style="color:#737373;font-size:13px">We'll be in touch with meeting details. If you need to reschedule, reply to this email.</p>
        </div>`,
      }).catch(() => {});

      // To tenant owner
      if (ownerEmail) {
        await t.sendMail({
          from: `"${brandName}" <${zohoUser}>`,
          to: ownerEmail,
          replyTo: email,
          subject: `New Booking: ${name} — ${dateStr} at ${timeStr}`,
          html: `<div style="font-family:Inter,sans-serif;max-width:500px;padding:24px;background:#0a0a0a;color:#e5e5e5">
            <h2 style="color:#fff;margin-bottom:16px">New Booking</h2>
            <table style="width:100%;border-collapse:collapse;background:#141414;border:1px solid #262626;border-radius:6px">
              <tr><td style="padding:8px 12px;color:#737373;width:90px">Name</td><td style="padding:8px 12px"><strong>${name}</strong></td></tr>
              <tr><td style="padding:8px 12px;color:#737373">Email</td><td style="padding:8px 12px"><a href="mailto:${email}" style="color:#c9a848">${email}</a></td></tr>
              ${phone ? `<tr><td style="padding:8px 12px;color:#737373">Phone</td><td style="padding:8px 12px">${phone}</td></tr>` : ''}
              ${company ? `<tr><td style="padding:8px 12px;color:#737373">Company</td><td style="padding:8px 12px">${company}</td></tr>` : ''}
              <tr><td style="padding:8px 12px;color:#737373">Date</td><td style="padding:8px 12px;color:#c9a848;font-weight:600">${dateStr}</td></tr>
              <tr><td style="padding:8px 12px;color:#737373">Time</td><td style="padding:8px 12px">${timeStr} · ${settings.meetingLength || 30} min</td></tr>
              ${message ? `<tr><td style="padding:8px 12px;color:#737373;vertical-align:top">Note</td><td style="padding:8px 12px">${message}</td></tr>` : ''}
            </table>
          </div>`,
        }).catch(() => {});
      }
    }

    res.redirect('/book?success=1');
  } catch (err) {
    console.error('[booking] POST error:', err);
    res.redirect('/book?error=1');
  }
});

export default router;
