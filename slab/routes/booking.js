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
import { ObjectId } from 'mongodb';
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

async function loadLogos(db) {
  try {
    const rows = await db.collection('brand_images').find({
      slot: { $in: ['logo_primary', 'logo_white', 'logo_icon'] },
    }).toArray();
    const out = {};
    for (const r of rows) out[r.slot] = r.url;
    return out;
  } catch { return {}; }
}

async function loadBrandModels(db) {
  try {
    const rows = await db.collection('brand_models').find({}).toArray();
    const out = {};
    for (const r of rows) out[r.slot] = r.url;
    return out;
  } catch { return {}; }
}

function buildVisibility(design) {
  return {
    header: design.vis_header !== 'false',
    footer: design.vis_footer !== 'false',
  };
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
    const [settings, design, logos, brandModels] = await Promise.all([
      loadSettings(db),
      loadDesign(db),
      loadLogos(db),
      loadBrandModels(db),
    ]);
    const brand      = res.locals.brand || {};
    const visibility = buildVisibility(design);
    const copy       = {};

    if (!settings.enabled) {
      return res.render('booking/unavailable', { design, brand, settings, logos, brandModels, visibility, copy });
    }

    // ── service-slots mode: list admin-created CalendarSlot docs ──
    if (settings.mode === 'service-slots') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const slotDocs = await db.collection('calendar_slots')
        .find({ date: { $gte: todayStr } })
        .sort({ date: 1, startTime: 1 })
        .toArray();

      // Filter out full slots, restrict to a service if ?service= specified
      const requestedService = (req.query.service || '').trim().toLowerCase();
      const available = slotDocs.filter(s => {
        if ((s.currentBookings || 0) >= (s.maxBookings || 1)) return false;
        if (requestedService && s.serviceType !== requestedService) return false;
        return true;
      });

      // Group by date for display
      const svcMap = {};
      (settings.serviceTypes || []).forEach(st => { svcMap[st.slug] = st; });
      const byDate = {};
      for (const s of available) {
        if (!byDate[s.date]) byDate[s.date] = [];
        byDate[s.date].push({
          ...s,
          serviceLabel: svcMap[s.serviceType]?.label || s.serviceType,
          requiresVehicle: !!svcMap[s.serviceType]?.requiresVehicle,
        });
      }
      const days = Object.entries(byDate).map(([date, slots]) => ({
        date,
        label: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        slots,
      }));

      return res.render('booking/slots', {
        design, brand, settings, days,
        logos, brandModels, visibility, copy,
        serviceTypes: settings.serviceTypes || [],
        requestedService,
        success: req.query.success || null,
        error: req.query.error || null,
      });
    }

    // ── meeting mode (default): auto-generate slots from weekly availability ──
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
      logos, brandModels, visibility, copy,
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
    const settings = await loadSettings(db);
    if (!settings.enabled) return res.redirect('/book');
    const brand = res.locals.brand || {};

    // ── service-slots mode ──
    if (settings.mode === 'service-slots') {
      const { name, email, phone, slotId, message,
              vehicleYear, vehicleMake, vehicleModel, vehicleLength, issueDescription } = req.body;
      if (!name || !email || !slotId) return res.redirect('/book?error=missing');

      let slotObjId;
      try { slotObjId = new ObjectId(String(slotId)); }
      catch { return res.redirect('/book?error=invalid_slot'); }

      // Atomic claim: only increment if there's room
      const claim = await db.collection('calendar_slots').findOneAndUpdate(
        { _id: slotObjId, $expr: { $lt: [{ $ifNull: ['$currentBookings', 0] }, { $ifNull: ['$maxBookings', 1] }] } },
        { $inc: { currentBookings: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      const slot = claim?.value || claim; // node driver compat
      if (!slot || !slot._id) return res.redirect('/book?error=taken');

      const svcType = (settings.serviceTypes || []).find(st => st.slug === slot.serviceType);
      const startAt = new Date(`${slot.date}T${slot.startTime}:00`);
      const endAt   = new Date(`${slot.date}T${slot.endTime}:00`);

      const bookingDoc = {
        mode: 'service-slots',
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone?.trim() || '',
        message: message?.trim() || '',
        startAt, endAt,
        slotId: slot._id,
        serviceType: slot.serviceType,
        location: slot.location || null,
        status: 'pending',
        tenantDomain: req.tenant?.domain || '',
        createdAt: new Date(),
      };
      if (svcType?.requiresVehicle) {
        bookingDoc.vehicle = {
          year: (vehicleYear || '').trim(),
          make: (vehicleMake || '').trim(),
          model: (vehicleModel || '').trim(),
          length: (vehicleLength || '').trim(),
        };
        bookingDoc.issueDescription = (issueDescription || '').trim().slice(0, 1000);
      }
      await db.collection('bookings').insertOne(bookingDoc);

      const dateStr = startAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const timeStr = `${slot.startTime} – ${slot.endTime}`;
      notifyAdmin({ type: 'booking', app: 'slab', email, name, ip: req.ip,
        data: {
          'Brand': brand.name || req.tenant?.domain || '',
          'Service': svcType?.label || slot.serviceType,
          'Date': dateStr,
          'Time': timeStr,
          'Location': slot.location?.label || slot.location?.address || '',
          'Phone': phone || '',
          'Vehicle': bookingDoc.vehicle ? `${bookingDoc.vehicle.year} ${bookingDoc.vehicle.make} ${bookingDoc.vehicle.model}`.trim() : '',
          'Issue': bookingDoc.issueDescription?.slice(0, 200) || '',
        },
      }).catch(() => {});

      return res.redirect('/book?success=1');
    }

    // ── meeting mode (default, original logic below) ──
    const { name, email, phone, company, message, slotIso } = req.body;

    if (!name || !email || !slotIso) {
      return res.redirect('/book?error=missing');
    }

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
    const tenantRecord = await getSlabDb().collection('tenants').findOne({ _id: req.tenant?._id });
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
