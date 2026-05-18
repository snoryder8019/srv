/**
 * Slab — Superadmin / Scott's Gateway
 *
 * Private family-coordination cockpit for the two superadmins.
 * Mounted at /superadmin/scottsGateway by routes/superadmin.js.
 *
 *   GET  /                           landing
 *   GET  /mission-control            TV display (subscribes to SSE)
 *   GET  /remote/:id                 phone remote
 *   POST /api/state                  remote → broadcast state to TV
 *   GET  /api/stream                 SSE event stream (mission-control listens)
 *   GET  /api/aggregate              cross-tenant aggregate (calendar/bills/tasks)
 *   POST /api/agent                  ollama agent over aggregated context
 *   GET  /calendarConsoldate         consolidated calendar pane
 *   GET  /tasksBillsIncome           tasks / bills / income pane
 *
 * The two operators (Scott + wife) are gated by the existing
 * SUPERADMIN_EMAILS list in middleware/superadmin.js. Wife's email
 * still needs to be added there before she can log in.
 */

import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { callLLM, webSearch, generateSdImage } from '../../plugins/agentMcp.js';
import { config } from '../../config/config.js';
import { isSuperAdminEmail } from '../../middleware/superadmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// ── TV-pairing ──────────────────────────────────────────────────────────────
// A logged-in operator generates a short-lived pair code on their phone, the
// TV opens the QR URL, server sets a long-lived `slab_tv` JWT scoped to the
// mission-control view, redirects to it.
const TV_PAIR_TTL_MS = 5 * 60 * 1000;       // 5 min to scan
const TV_COOKIE_TTL_MS = 30 * 24 * 3600 * 1000;  // 30 days on the TV
const TV_COOKIE = 'slab_tv';

async function ensurePairIndex() {
  try {
    await getSlabDb().collection('gateway_tv_pairs').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0 }
    );
  } catch {}
}
ensurePairIndex();

/**
 * TV-initiated pair flow:
 *   1. TV (no auth) POSTs /api/pair/request → server returns { code, qrUrl }
 *   2. TV renders QR; starts polling /api/pair/poll/:code
 *   3. Phone (logged in) scans QR → opens /tv/:code → server marks code authorized
 *   4. TV's next poll receives `Set-Cookie: slab_tv=...` and a redirect signal
 *
 * The legacy redeem URL `/tv/:code` is preserved — it's what the phone hits.
 */
export async function redeemTvPair(req, res) {
  // Phone hits this after scanning. Must be authenticated as superadmin.
  const token = req.cookies?.slab_token;
  let operator = null;
  if (token) {
    try {
      const d = jwt.verify(token, config.JWT_SECRET);
      if (isSuperAdminEmail(d.email)) operator = d.email;
    } catch {}
  }
  if (!operator) {
    // Phone isn't logged in — send them to login then back here
    return res.redirect('/superadmin/login?next=' + encodeURIComponent(req.originalUrl));
  }
  const code = String(req.params.code || '');
  if (!/^[a-z0-9]{8,64}$/i.test(code)) return res.status(400).send('bad pair code');
  const slab = getSlabDb();
  const updated = await slab.collection('gateway_tv_pairs').findOneAndUpdate(
    { code, authorizedAt: { $exists: false } },
    { $set: { authorizedAt: new Date(), authorizedBy: operator } },
    { returnDocument: 'after' }
  );
  const pair = updated?.value || updated;
  if (!pair) {
    return res.status(410).send('Pair code unknown or already used. Reload the TV to get a new one.');
  }
  if (pair.expiresAt && pair.expiresAt < new Date()) {
    return res.status(410).send('Pair code expired. Reload the TV to get a new one.');
  }
  res.set('Content-Type', 'text/html').send(`<!doctype html><meta name=viewport content="width=device-width">
    <style>body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
    .ok{background:#0f1f15;border:1px solid #34d399;color:#86efac;padding:24px 32px;border-radius:14px;max-width:340px}
    h2{font-size:18px;margin-bottom:8px;color:#34d399}p{font-size:13px;line-height:1.5;color:#a3a3a3}</style>
    <div class=ok><h2>✓ TV paired</h2><p>The TV is logging in now. You can close this tab.</p></div>`);
}

/**
 * Auth gate for /mission-control — never redirects.
 * If TV cookie or superadmin cookie is valid, attaches the session and proceeds.
 * If neither, sets req.unpaired = true so the page can show the pair QR.
 */
export function tvOrSuper(req, res, next) {
  const tv = req.cookies?.[TV_COOKIE];
  if (tv) {
    try {
      const d = jwt.verify(tv, config.JWT_SECRET);
      if (d.scope === 'scottsGateway-mission-control') {
        req.tvSession = d;
        return next();
      }
    } catch {}
  }
  const token = req.cookies?.slab_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (isSuperAdminEmail(decoded.email)) {
        req.superAdmin = decoded;
        return next();
      }
    } catch {}
  }
  req.unpaired = true;
  next();
}

/** Mission-control entrypoint — renders either pair-QR or the dashboard. */
export async function missionControlHandler(req, res) {
  if (req.unpaired) {
    return res.render('superadmin/scottsGateway/pair', {});
  }
  const state = await getState();
  const operator = req.tvSession ? `tv:${req.tvSession.email}` : req.superAdmin.email;
  res.render('superadmin/scottsGateway/mission-control', {
    user: req.superAdmin || { email: req.tvSession?.email },
    operator,
    state,
  });
}

// ── Family + tenant→person mapping ───────────────────────────────────────────
// This is the family-facing lens: the aggregator still pulls from every
// tenant, but we surface "who owns it" instead of "which tenant".
const FAMILY = ['Scott', 'Candace', 'Violet', 'Odin'];
// Tenants that explicitly belong to Candace. Everything else is Scott's
// (madladslab, slab, opstrain, bih, ps, triple-twenty, etc).
// "Family" is reserved for household items (gateway_tasks who=Family) — it
// should never appear on a tenant-sourced invoice.
const CANDACE_TENANTS = ['w2marketing', 'w2'];
function ownerForTenant(t) {
  if (!t) return 'Scott';
  const sub = (t.meta?.subdomain || t.domain || '').toLowerCase();
  for (const key of CANDACE_TENANTS) if (sub.includes(key)) return 'Candace';
  return 'Scott';
}
// Only these tenants drive the family calendar's "who's working" + bookings.
// Other tenants (opstrain, bih, ps, etc.) are SaaS portals — their booking
// settings are not personal work schedules.
const WORK_SCHEDULE_TENANTS = ['madladslab', 'w2marketing', 'w2'];
function isWorkScheduleTenant(t) {
  const sub = (t.meta?.subdomain || t.domain || '').toLowerCase();
  return WORK_SCHEDULE_TENANTS.some(k => sub.includes(k));
}

// ── Hard gate: only the family operators ─────────────────────────────────────
// requireSuperAdmin already runs upstream in superadmin.js; we add an extra
// allowlist check so the route is truly closed even if SUPERADMIN_EMAILS grows.
const GATEWAY_OPERATORS = (process.env.SCOTTS_GATEWAY_OPERATORS ||
  'snoryder8019@gmail.com,scott@madladslab.com')
  .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

router.use((req, res, next) => {
  // TV sessions (read-only paths forwarded from superadmin.js) skip the
  // operator-email check — pair code already proves they were authorized.
  if (req.tvSession) {
    res.locals.gatewayOperator = `tv:${req.tvSession.email}`;
    return next();
  }
  const email = (req.superAdmin?.email || '').toLowerCase();
  if (!GATEWAY_OPERATORS.includes(email)) {
    return res.status(403).send('scottsGateway: operator not on the allowlist');
  }
  res.locals.gatewayOperator = email;
  next();
});

// Active design iteration — never cache Gateway pages or APIs in the browser.
// Avoids needing a hard-refresh after every EJS/CSS tweak.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ── In-memory SSE bus ────────────────────────────────────────────────────────
// Remote → mission-control fan-out. Single Node process, no Redis needed.
const sseClients = new Set();
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { /* socket gone */ }
  }
}

// Last-known state lives in slab DB so a fresh TV connection can hydrate.
async function getState() {
  const slab = getSlabDb();
  const doc = await slab.collection('gateway_state').findOne({ _id: 'singleton' });
  return doc?.state || { view: 'overview', updatedBy: null, updatedAt: null, custom: {} };
}
async function setState(patch, who) {
  const slab = getSlabDb();
  const next = { ...(await getState()), ...patch, updatedBy: who, updatedAt: new Date() };
  await slab.collection('gateway_state').updateOne(
    { _id: 'singleton' },
    { $set: { state: next } },
    { upsert: true }
  );
  return next;
}

/**
 * Expand a recurrence rule into occurrence dates within [start, end].
 * Supports: { freq: 'daily'|'weekly'|'biweekly'|'monthly'|'yearly', interval, until, count }
 * Falls back to a single occurrence when no rule given.
 */
function expandRecurrence(firstWhen, rule, start, end) {
  if (!firstWhen) return [];
  const first = new Date(firstWhen);
  if (!rule || !rule.freq || rule.freq === 'none') {
    return (first >= start && first <= end) ? [first] : (first > end ? [] : [first]);
  }
  const interval = Math.max(1, parseInt(rule.interval) || 1);
  const until = rule.until ? new Date(rule.until) : null;
  const cap = Math.min(parseInt(rule.count) || 200, 200);
  const horizon = until && until < end ? until : end;
  const out = [];
  const cursor = new Date(first);
  while (cursor <= horizon && out.length < cap) {
    if (cursor >= start) out.push(new Date(cursor));
    switch (rule.freq) {
      case 'daily':    cursor.setDate(cursor.getDate() + interval); break;
      case 'weekly':   cursor.setDate(cursor.getDate() + 7 * interval); break;
      case 'biweekly': cursor.setDate(cursor.getDate() + 14 * interval); break;
      case 'monthly':  cursor.setMonth(cursor.getMonth() + interval); break;
      case 'yearly':   cursor.setFullYear(cursor.getFullYear() + interval); break;
      default: return out.length ? out : [first];
    }
  }
  return out;
}

// Tenants can have multiple docs pointing at one `db` (e.g. a primary
// subdomain plus a custom-domain alias). Iterating raw `tenants` would
// double-count every row from that DB. Dedupe by `db`, preferring docs that
// aren't flagged as aliases.
async function loadPrimaryTenants(slab) {
  const all = await slab.collection('tenants')
    .find({}, { projection: { db: 1, domain: 1, brand: 1, meta: 1 } })
    .toArray();
  const byDb = new Map();
  for (const t of all) {
    if (!t.db) continue;
    const isAlias = t.meta?.isPrimaryAlias === false;
    const existing = byDb.get(t.db);
    if (!existing) { byDb.set(t.db, t); continue; }
    // Replace only if existing is an alias and this one isn't.
    if (existing.meta?.isPrimaryAlias === false && !isAlias) byDb.set(t.db, t);
  }
  return [...byDb.values()];
}

// ── Cross-tenant aggregation ─────────────────────────────────────────────────
// Pulls upcoming events / bookings / invoices / meetings / workschedule from
// every tenant. Family-facing: each row is tagged with the family member who
// owns the originating tenant.
async function aggregateAcrossTenants({ days = 30, includePaid = false } = {}) {
  const slab = getSlabDb();
  const tenants = await loadPrimaryTenants(slab);

  const horizonStart = new Date(); horizonStart.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(horizonStart.getTime() + days * 86400000);

  const buckets = { calendar: [], bookings: [], invoices: [], bills: [], meetings: [], workdays: [] };

  await Promise.all(tenants.map(async (t) => {
    if (!t.db) return;
    const who = ownerForTenant(t);
    const brandName = t.brand?.name || t.domain || 'Tenant';
    // Normalized key for CSS class targeting (e.g. "madladslab", "w2marketing")
    const sub = (t.meta?.subdomain || t.domain || '').toLowerCase().split('.')[0];
    const brandKey = sub.replace(/[^a-z0-9]/g, '');
    const tag = {
      tenantDb: t.db,
      domain: t.domain,
      brand: brandName,
      brandKey,
      who,
    };
    try {
      const tdb = getTenantDb(t.db);
      const [events, bookings, invoicesRaw, meetings, bookingSettings] = await Promise.all([
        tdb.collection('events').find({
          $or: [
            { startsAt: { $gte: horizonStart, $lte: horizonEnd } },
            { date:     { $gte: horizonStart, $lte: horizonEnd } },
          ],
        }, { projection: { title: 1, startsAt: 1, date: 1, location: 1, kind: 1 } })
          .limit(50).toArray().catch(() => []),
        tdb.collection('bookings').find({
          startAt: { $gte: horizonStart, $lte: horizonEnd },
          status: { $nin: ['cancelled'] },
        }, { projection: { name: 1, email: 1, service: 1, startAt: 1, endAt: 1, status: 1 } })
          .limit(80).toArray().catch(() => []),
        tdb.collection('invoices').find({
          status: { $in: includePaid
            ? ['unpaid', 'sent', 'overdue', 'draft', 'paid']
            : ['unpaid', 'sent', 'overdue', 'draft'] },
        }, { projection: { clientName: 1, clientId: 1, total: 1, amount: 1, status: 1, dueDate: 1, createdAt: 1, paidAt: 1 } })
          .limit(120).toArray().catch(() => []),
        tdb.collection('meetings').find({
          status: { $in: ['scheduled', 'active'] },
        }, { projection: {
          title: 1, scheduledAt: 1, durationMinutes: 1, status: 1,
          participants: 1, notes: 1, assets: 1, tags: 1, consent: 1,
          createdBy: 1, createdAt: 1, expiresAt: 1, token: 1,
        } }).limit(20).toArray().catch(() => []),
        tdb.collection('booking_settings').findOne({ key: 'config' }).catch(() => null),
      ]);

      // Join invoices ↔ clients to fill in missing names
      const needIds = invoicesRaw
        .filter(i => !i.clientName && i.clientId)
        .map(i => { try { return new ObjectId(String(i.clientId)); } catch { return null; } })
        .filter(Boolean);
      let clientById = new Map();
      if (needIds.length) {
        const clients = await tdb.collection('clients')
          .find({ _id: { $in: needIds } }, { projection: { name: 1, company: 1, email: 1 } })
          .toArray().catch(() => []);
        clientById = new Map(clients.map(c => [String(c._id), c]));
      }
      const invoices = invoicesRaw.map(i => {
        const out = { ...i, _id: String(i._id) };
        if (!i.clientName) {
          const c = clientById.get(String(i.clientId));
          out.clientName = c ? (c.company || c.name || c.email) : null;
          if (!out.clientName) out.clientHint = i.clientId ? `clientId=${i.clientId}` : 'no clientId';
        }
        return out;
      });

      // Expand workschedule into workdays — only for primary tenants whose
      // booking settings represent personal availability (Scott via madladslab,
      // Candace via w2marketing). SaaS-portal tenants' availability is ignored.
      const avail = isWorkScheduleTenant(t) ? bookingSettings?.value?.availability : null;
      if (avail) {
        // Pin the cursor to noon UTC so the calendar-day reading is stable
        // across viewer timezones (the server itself runs UTC). Iterating at
        // noon keeps every day on the intended weekday in MST/PDT/CDT/EST etc.
        const cur = new Date(horizonStart); cur.setUTCHours(12, 0, 0, 0);
        const stop = new Date(horizonEnd);  stop.setUTCHours(12, 0, 0, 0);
        while (cur <= stop) {
          const dow = cur.getUTCDay();
          const slot = avail[dow] || avail[String(dow)];
          if (slot?.enabled) {
            buckets.workdays.push({
              ...tag,
              date: new Date(cur),
              start: slot.start || '09:00',
              end: slot.end || '17:00',
              label: `${who} work · ${slot.start || '09:00'}–${slot.end || '17:00'}`,
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      events.forEach(e => buckets.calendar.push({ ...tag, ...e }));
      // Bookings drive "who's working" / appointments — only count primary
      // tenants. Other tenants' bookings are SaaS noise.
      if (isWorkScheduleTenant(t)) {
        bookings.forEach(b => buckets.bookings.push({ ...tag, ...b }));
      }
      invoices.forEach(i => buckets.invoices.push({ ...tag, ...i }));
      meetings.forEach(m => buckets.meetings.push({
        ...tag, ...m,
        // Computed convenience fields for the UI
        participantCount: Array.isArray(m.participants) ? m.participants.length : 0,
        notesCount:       Array.isArray(m.notes) ? m.notes.length : 0,
        assetsCount:      Array.isArray(m.assets) ? m.assets.length : 0,
        clientTagCount:   m.tags?.clients?.length || 0,
        userTagCount:     m.tags?.users?.length || 0,
        recording:        !!m.consent?.recordingNotice,
        transcribing:     !!m.consent?.transcriptionDisclaimer,
        joinUrl:          m.token ? `https://${t.domain}/meeting/${m.token}` : null,
      }));
    } catch (err) {
      // Tenant DB may not have those collections — skip silently.
    }
  }));

  // Household items from gateway_tasks: bills go to .bills, dated events go
  // to .calendar (so things the agent/remote add show up on the month grid).
  try {
    const familyDocs = await getSlabDb().collection('gateway_tasks')
      .find({ archived: { $ne: true } })
      .toArray();
    for (const d of familyDocs) {
      if (d.kind === 'bill') {
        if (!includePaid && d.completed) continue;
        const amount = Number(d.amount) || 0;
        const bizPct = Number(d.businessSharePct) || 0;
        buckets.bills.push({
          who: d.who || 'Family',
          label: d.text,
          amount,
          status: d.completed ? 'paid' : 'unpaid',
          dueDate: d.when || null,
          location: d.location || '',
          note: d.note || '',
          familyBillId: String(d._id),
          category: d.category || null,
          businessSharePct: bizPct,
          businessExpense: +(amount * bizPct / 100).toFixed(2),
          personalExpense: +(amount * (100 - bizPct) / 100).toFixed(2),
        });
      } else if (d.when && ['event', 'appointment', 'reminder'].includes(d.kind || 'task')) {
        // Expand recurrence (or just the single date) onto the calendar stream.
        const occurrences = expandRecurrence(d.when, d.recurrence, horizonStart, horizonEnd);
        for (const at of occurrences) {
          buckets.calendar.push({
            tenantDb: null, domain: null, brand: 'Family', brandKey: 'family',
            who: d.who || 'Family',
            title: d.text + (d.recurrence?.freq && d.recurrence.freq !== 'none' ? ` ↻` : ''),
            startsAt: at,
            location: d.location || '',
            kind: d.kind,
            familyTaskId: String(d._id),
            recurring: !!(d.recurrence?.freq && d.recurrence.freq !== 'none'),
          });
        }
      }
    }
  } catch {}

  const ts = (d) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);
  buckets.calendar.sort((a, b) => ts(a.startsAt || a.date) - ts(b.startsAt || b.date));
  buckets.bookings.sort((a, b) => ts(a.startAt) - ts(b.startAt));
  buckets.invoices.sort((a, b) => ts(a.dueDate) - ts(b.dueDate));
  buckets.bills.sort((a, b) => ts(a.dueDate) - ts(b.dueDate));
  buckets.meetings.sort((a, b) => ts(a.scheduledAt) - ts(b.scheduledAt));
  buckets.workdays.sort((a, b) => ts(a.date) - ts(b.date));

  // Separate monthly totals: money IN (invoices) vs money OUT (household bills)
  const monthKey = (d) => {
    if (!d) return 'undated';
    const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`;
  };
  const monthly = {};
  function bucketRow(k) {
    if (!monthly[k]) monthly[k] = {
      month: k,
      invoiceCount: 0, invoiceTotal: 0, invoiceUnpaidCount: 0, invoiceUnpaidTotal: 0,
      billCount: 0,    billTotal: 0,    billUnpaidCount: 0,    billUnpaidTotal: 0,
    };
    return monthly[k];
  }
  for (const inv of buckets.invoices) {
    const k = monthKey(inv.dueDate); inv.month = k;
    const row = bucketRow(k);
    const amt = Number(inv.total || inv.amount || 0);
    row.invoiceCount++; row.invoiceTotal += amt;
    if (inv.status !== 'paid') { row.invoiceUnpaidCount++; row.invoiceUnpaidTotal += amt; }
  }
  for (const b of buckets.bills) {
    const k = monthKey(b.dueDate); b.month = k;
    const row = bucketRow(k);
    const amt = Number(b.amount || 0);
    row.billCount++; row.billTotal += amt;
    if (b.status !== 'paid') { row.billUnpaidCount++; row.billUnpaidTotal += amt; }
  }

  return {
    horizonDays: days,
    includePaid,
    tenantCount: tenants.length,
    family: FAMILY,
    counts: {
      calendar: buckets.calendar.length,
      bookings: buckets.bookings.length,
      invoices: buckets.invoices.length,
      bills: buckets.bills.length,
      meetings: buckets.meetings.length,
      workdays: buckets.workdays.length,
    },
    monthly: Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month)),
    ...buckets,
  };
}

// ── Page routes ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const state = await getState();
  res.render('superadmin/scottsGateway/index', {
    user: req.superAdmin,
    operator: res.locals.gatewayOperator,
    state,
  });
});

router.get('/mission-control', async (req, res) => {
  const state = await getState();
  res.render('superadmin/scottsGateway/mission-control', {
    user: req.superAdmin,
    operator: res.locals.gatewayOperator,
    state,
  });
});

router.get('/remote/:id', async (req, res) => {
  const state = await getState();
  res.render('superadmin/scottsGateway/remote', {
    user: req.superAdmin,
    operator: res.locals.gatewayOperator,
    remoteId: req.params.id,
    state,
  });
});

router.get('/calendarConsoldate', async (req, res) => {
  const view = ['day', 'week', 'month'].includes(req.query.view) ? req.query.view : 'month';
  const days = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const data = await aggregateAcrossTenants({ days });
  res.render('superadmin/scottsGateway/calendarConsoldate/index', {
    user: req.superAdmin, operator: res.locals.gatewayOperator, data, view,
  });
});

router.get('/tasksBillsIncome', async (req, res) => {
  const data = await aggregateAcrossTenants({ days: 60 });
  res.render('superadmin/scottsGateway/tasksBillsIncome/index', {
    user: req.superAdmin, operator: res.locals.gatewayOperator, data,
  });
});

// ── API: SSE stream — mission-control subscribes ────────────────────────────
router.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);

  // Send current state on connect.
  getState().then(s => res.write(`event: state\ndata: ${JSON.stringify(s)}\n\n`)).catch(() => {});

  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

// ── API: remote → push a state update ───────────────────────────────────────
/** Wipe the TV state back to defaults (view=overview, clear message + custom). */
router.post('/api/state/reset', async (req, res) => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const next = await setState({
    view: 'overview',
    message: '',
    custom: {
      billsMonth: monthKey,
      billsIncludePaid: false,
      calMode: 'month',
      agentReply: '',
      photoMsg: '',
    },
  }, res.locals.gatewayOperator);
  broadcast('state', next);
  res.json({ ok: true, state: next });
});

router.post('/api/state', async (req, res) => {
  const allowedViews = [
    'overview', 'calendar', 'calendar-day', 'calendar-week', 'calendar-month',
    'bills', 'tasks', 'meetings', 'agent', 'photo',
  ];
  const patch = {};
  if (req.body.view && allowedViews.includes(req.body.view)) patch.view = req.body.view;
  if (req.body.custom && typeof req.body.custom === 'object') patch.custom = req.body.custom;
  if (req.body.message) patch.message = String(req.body.message).slice(0, 500);

  const next = await setState(patch, res.locals.gatewayOperator);
  broadcast('state', next);
  res.json({ ok: true, state: next });
});

// ── API: cross-tenant aggregate (JSON) ──────────────────────────────────────
router.get('/api/aggregate', async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 60));
  const includePaid = req.query.paid === '1' || req.query.includePaid === '1';
  try {
    const data = await aggregateAcrossTenants({ days, includePaid });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Family tasks (persistent, multi-device) ──────────────────────────────────
async function loadTasks() {
  // Tasks view is for actual tasks — bills live in the Money view, not here.
  const docs = await getSlabDb().collection('gateway_tasks')
    .find({ archived: { $ne: true }, kind: { $ne: 'bill' } })
    .sort({ completed: 1, when: 1, createdAt: -1 })
    .limit(80).toArray();
  return docs.map(d => ({
    id: String(d._id),
    text: d.text,
    who: d.who,
    when: d.when || null,
    location: d.location || '',
    kind: d.kind || 'task',
    note: d.note || '',
    completed: !!d.completed,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
  }));
}
async function broadcastTasks(stateAlso = false) {
  const tasks = await loadTasks();
  if (stateAlso) {
    const next = await setState({ custom: { ...(await getState()).custom, tasks } }, 'system');
    broadcast('state', next);
  } else {
    broadcast('tasks', { tasks });
  }
  return tasks;
}

router.get('/api/tasks', async (req, res) => {
  res.json({ ok: true, tasks: await loadTasks() });
});
router.post('/api/tasks', async (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 280);
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  const allowedWho = [...FAMILY, 'Family'];
  const allowedKind = ['task', 'event', 'reminder', 'bill', 'appointment'];
  const allowedFreq = ['none','daily','weekly','biweekly','monthly','yearly'];
  const rec = b.recurrence || {};
  const recurrence = allowedFreq.includes(rec.freq) && rec.freq !== 'none' ? {
    freq: rec.freq,
    interval: Math.max(1, parseInt(rec.interval) || 1),
    until: rec.until ? new Date(rec.until) : null,
    count: rec.count ? Math.min(200, parseInt(rec.count)) : null,
  } : null;
  const allowedCategory = ['utility', 'rent', 'mortgage', 'insurance', 'subscription', 'loan', 'other'];
  const kind = allowedKind.includes(b.kind) ? b.kind : 'task';
  const doc = {
    text,
    who: allowedWho.includes(b.who) ? b.who : 'Family',
    kind,
    when: b.when ? new Date(b.when) : null,
    location: String(b.location || '').slice(0, 160),
    note: String(b.note || '').slice(0, 400),
    amount: Number(b.amount) || null,
    recurrence,
    completed: false,
    createdBy: res.locals.gatewayOperator,
    createdAt: new Date(),
  };
  if (kind === 'bill') {
    doc.category = allowedCategory.includes(b.category) ? b.category : null;
    const pct = Number(b.businessSharePct);
    doc.businessSharePct = (Number.isFinite(pct) && pct >= 0 && pct <= 100) ? pct : 0;
  }
  await getSlabDb().collection('gateway_tasks').insertOne(doc);
  const tasks = await broadcastTasks();
  res.json({ ok: true, tasks });
});
router.post('/api/tasks/:id/complete', async (req, res) => {
  try {
    await getSlabDb().collection('gateway_tasks').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { completed: !!req.body.completed, completedAt: new Date() } }
    );
    res.json({ ok: true, tasks: await broadcastTasks() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/api/tasks/:id', async (req, res) => {
  try {
    await getSlabDb().collection('gateway_tasks').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true, tasks: await broadcastTasks() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// Outcome on a task (review checklist) — attended / canceled / missed / pushback
router.post('/api/tasks/:id/outcome', async (req, res) => {
  const allowed = ['attended', 'canceled', 'missed', 'pushback'];
  const outcome = String(req.body.outcome || '');
  if (!allowed.includes(outcome)) return res.status(400).json({ ok: false, error: 'bad outcome' });
  try {
    const update = { outcome, outcomeAt: new Date(), outcomeBy: res.locals.gatewayOperator };
    // 'pushback' optionally moves the task forward — accept a new `when`
    if (outcome === 'pushback' && req.body.newWhen) update.when = new Date(req.body.newWhen);
    await getSlabDb().collection('gateway_tasks').updateOne(
      { _id: new ObjectId(req.params.id) }, { $set: update }
    );
    res.json({ ok: true, tasks: await broadcastTasks() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Review endpoint — returns two arrays:
//   items:    past unreviewed items (last 30d, when < now, no outcome yet)
//   upcoming: future items (when >= now) so the remote can edit/delete them
router.get('/api/review/pending', async (req, res) => {
  try {
    const now = new Date();
    const slab = getSlabDb();
    const cutoff = new Date(Date.now() - 30 * 86400000);

    const [past, upcoming] = await Promise.all([
      slab.collection('gateway_tasks').find({
        kind: { $in: ['event', 'appointment', 'reminder'] },
        when: { $lt: now, $gte: cutoff },
        outcome: { $exists: false },
        archived: { $ne: true },
      }).sort({ when: -1 }).limit(40).toArray(),
      slab.collection('gateway_tasks').find({
        kind: { $in: ['event', 'appointment', 'reminder', 'task'] },
        when: { $gte: now },
        completed: { $ne: true },
        archived: { $ne: true },
      }).sort({ when: 1 }).limit(60).toArray(),
    ]);

    const shape = (d) => ({
      id: String(d._id), text: d.text, kind: d.kind, when: d.when, who: d.who,
      location: d.location || '', note: d.note || '',
      amount: d.amount || null,
      recurring: !!(d.recurrence?.freq && d.recurrence.freq !== 'none'),
    });
    res.json({ ok: true, items: past.map(shape), upcoming: upcoming.map(shape) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Edit an existing task — text / when / who / location / note / amount / kind
router.patch('/api/tasks/:id', async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (typeof b.text === 'string') update.text = b.text.trim().slice(0, 280);
  if (typeof b.who === 'string' && [...FAMILY, 'Family'].includes(b.who)) update.who = b.who;
  if (typeof b.kind === 'string' && ['task','event','reminder','bill','appointment'].includes(b.kind)) update.kind = b.kind;
  if (b.when !== undefined) update.when = b.when ? new Date(b.when) : null;
  if (typeof b.location === 'string') update.location = b.location.slice(0, 160);
  if (typeof b.note === 'string') update.note = b.note.slice(0, 400);
  if (b.amount !== undefined) update.amount = Number(b.amount) || null;
  if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'no editable fields' });
  update.updatedAt = new Date();
  update.updatedBy = res.locals.gatewayOperator;
  try {
    const r = await getSlabDb().collection('gateway_tasks').updateOne(
      { _id: new ObjectId(req.params.id) }, { $set: update }
    );
    if (!r.matchedCount) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, tasks: await broadcastTasks() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post('/api/tasks/clear-completed', async (req, res) => {
  await getSlabDb().collection('gateway_tasks').deleteMany({ completed: true });
  res.json({ ok: true, tasks: await broadcastTasks() });
});

// ── Public TV-pair endpoints (no auth — TV is unauthenticated by definition) ─
/** TV requests a pair code; returns the QR URL the phone should scan. */
export async function publicPairRequest(req, res) {
  const code = crypto.randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + TV_PAIR_TTL_MS);
  await getSlabDb().collection('gateway_tv_pairs').insertOne({
    code, createdAt: new Date(), expiresAt,
  });
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const url = `${proto}://${host}/superadmin/scottsGateway/tv/${code}`;
  res.json({ ok: true, code, url, expiresAt, ttlMs: TV_PAIR_TTL_MS });
}

/** TV polls this with the code; once a phone authorizes, server issues + sets cookie. */
export async function publicPairPoll(req, res) {
  const code = String(req.params.code || '');
  if (!/^[a-z0-9]{8,64}$/i.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });
  const slab = getSlabDb();
  const doc = await slab.collection('gateway_tv_pairs').findOne({ code });
  if (!doc) return res.json({ ok: true, status: 'expired' });
  if (doc.expiresAt && doc.expiresAt < new Date()) {
    await slab.collection('gateway_tv_pairs').deleteOne({ code });
    return res.json({ ok: true, status: 'expired' });
  }
  if (!doc.authorizedAt) return res.json({ ok: true, status: 'pending' });

  // Authorized → issue the long-lived TV cookie, delete the pair record
  await slab.collection('gateway_tv_pairs').deleteOne({ code });
  const token = jwt.sign(
    { email: doc.authorizedBy, role: 'tv', scope: 'scottsGateway-mission-control' },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie(TV_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: TV_COOKIE_TTL_MS,
    ...(config.NODE_ENV === 'production' ? { domain: '.madladslab.com' } : {}),
  });
  res.json({ ok: true, status: 'authorized', authorizedBy: doc.authorizedBy });
}

// ── Greeley local events — UNC, downtown, Visit Greeley ─────────────────────
// Configurable list of ICS/RSS sources lives in slab.gateway_config.localEventSources.
// Cached 1h in-memory. Sources can be edited via /api/local-events/sources.
const DEFAULT_SOURCES = [
  // These are best-guess public feed URLs — admin can override via the sources API.
  // ICS feeds usually live at /events.ics, /calendar.ics, or behind an "Add to calendar" link.
  { id: 'unc',            label: 'UNC Bears',            kind: 'ics', url: 'https://events.unco.edu/calendar.ics' },
  { id: 'visit-greeley',  label: 'Visit Greeley',        kind: 'ics', url: 'https://visitgreeley.org/events/?ical=1' },
  { id: 'downtown-dda',   label: 'Greeley Downtown DDA', kind: 'ics', url: 'https://greeleydowntown.com/events/?ical=1' },
];
let LOCAL_CACHE = { at: 0, events: [], errors: [] };
const LOCAL_TTL_MS = 60 * 60 * 1000;

async function loadSources() {
  const slab = getSlabDb();
  const doc = await slab.collection('gateway_config').findOne({ key: 'localEventSources' });
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : DEFAULT_SOURCES;
}

function parseIcsDate(s) {
  if (!s) return null;
  // 20260615T180000Z or 20260615T180000 or 20260615
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}${s.endsWith('Z') ? 'Z' : ''}`);
}
function unfoldIcs(text) {
  // RFC5545: continuation lines start with space/tab
  return text.replace(/\r\n[ \t]/g, '');
}
function parseIcs(text) {
  text = unfoldIcs(text);
  const events = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const get = (k) => {
      const m = body.match(new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.+)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    const dtend = get('DTEND');
    const location = get('LOCATION');
    const url = get('URL');
    const description = get('DESCRIPTION');
    const start = parseIcsDate(dtstart);
    if (!summary || !start) continue;
    // Try to pull an image URL out of the DESCRIPTION (common patterns)
    const imgMatch = description?.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)(?:\?\S*)?/i);
    events.push({
      title: summary,
      start,
      end: parseIcsDate(dtend),
      location,
      url,
      image: imgMatch?.[0] || null,
    });
  }
  return events;
}
function parseRss(text) {
  // Minimal RSS/Atom item extraction (no XML parser dep)
  const events = [];
  const items = text.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  for (const item of items) {
    const pick = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : null;
    };
    const title = pick('title');
    const date = pick('pubDate') || pick('published') || pick('updated');
    const link = pick('link');
    const desc = pick('description') || pick('summary') || '';
    const imgMatch = desc.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)(?:\?\S*)?/i);
    const start = date ? new Date(date) : null;
    if (!title || !start || isNaN(+start)) continue;
    events.push({ title, start, end: null, location: null, url: link, image: imgMatch?.[0] || null });
  }
  return events;
}

async function fetchLocalEvents(force = false) {
  if (!force && Date.now() - LOCAL_CACHE.at < LOCAL_TTL_MS) return LOCAL_CACHE;
  const sources = await loadSources();
  const errors = [];
  const all = [];
  await Promise.all(sources.map(async (src) => {
    try {
      const r = await fetch(src.url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'sLab-Gateway/1.0' },
      });
      if (!r.ok) { errors.push({ src: src.id, err: `HTTP ${r.status}` }); return; }
      const body = await r.text();
      const items = (src.kind === 'rss') ? parseRss(body) : parseIcs(body);
      items.forEach(e => all.push({ ...e, source: src.label, sourceId: src.id }));
    } catch (e) {
      errors.push({ src: src.id, err: e.message });
    }
  }));
  const now = new Date();
  const horizon = new Date(Date.now() + 60 * 86400000);
  const filtered = all
    .filter(e => e.start >= now && e.start <= horizon)
    .sort((a, b) => a.start - b.start)
    .slice(0, 100);
  LOCAL_CACHE = { at: Date.now(), events: filtered, errors };
  return LOCAL_CACHE;
}

router.get('/api/local-events', async (req, res) => {
  try {
    const data = await fetchLocalEvents(req.query.force === '1');
    res.json({ ok: true, ...data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
router.get('/api/local-events/sources', async (req, res) => {
  res.json({ ok: true, sources: await loadSources() });
});
router.post('/api/local-events/sources', async (req, res) => {
  const sources = Array.isArray(req.body.sources) ? req.body.sources.slice(0, 20) : null;
  if (!sources) return res.status(400).json({ ok: false, error: 'sources[] required' });
  await getSlabDb().collection('gateway_config').updateOne(
    { key: 'localEventSources' }, { $set: { value: sources, updatedAt: new Date() } },
    { upsert: true }
  );
  LOCAL_CACHE = { at: 0, events: [], errors: [] };
  res.json({ ok: true });
});

// ── Weather + river-flow + (winter) snow feeds ──────────────────────────────
// Greeley CO + a curated set of USGS stream gauges. Cached 30 min.
const GREELEY = { lat: 40.4233, lon: -104.7091, label: 'Greeley, CO' };
const SUMMIT  = { lat: 39.4817, lon: -106.0384, label: 'Summit County, CO' };

// USGS instantaneous-values gauges (cfs) — all verified live as of build.
const GAUGES = [
  { id: '06754000', label: 'South Platte · Kersey',           river: 'platte' },
  { id: '06752280', label: 'Cache la Poudre · Timnath',       river: 'poudre' },
  { id: '06741510', label: 'Big Thompson · Loveland',         river: 'thompson' },
  { id: '09058000', label: 'Colorado · near Kremmling (Upper C)', river: 'upperC' },
  { id: '07091200', label: 'Arkansas · Nathrop (Browns)',     river: 'arkansas' },
];

function isWinterMonth(d = new Date()) {
  const m = d.getMonth(); // 0=Jan
  return m === 10 || m === 11 || m === 0 || m === 1 || m === 2 || m === 3; // Nov–Apr
}

let FEED_CACHE = { at: 0, data: null };
const FEED_TTL_MS = 30 * 60 * 1000;

async function fetchOpenMeteo(loc, opts = {}) {
  const params = new URLSearchParams({
    latitude: String(loc.lat), longitude: String(loc.lon),
    current: 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,sunrise,sunset',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch',
    timezone: 'America/Denver',
    forecast_days: String(opts.days || 10),
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  return r.json();
}

async function fetchUsgsFlows() {
  const sites = GAUGES.map(g => g.id).join(',');
  const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060,00065&format=json&siteStatus=active`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`usgs ${r.status}`);
  const j = await r.json();
  const out = {};
  for (const series of (j.value?.timeSeries || [])) {
    const siteId = series.sourceInfo?.siteCode?.[0]?.value;
    const paramCd = series.variable?.variableCode?.[0]?.value;
    const latest = series.values?.[0]?.value?.slice(-1)[0];
    if (!siteId || !latest) continue;
    out[siteId] ||= {};
    if (paramCd === '00060') out[siteId].cfs = Number(latest.value);
    if (paramCd === '00065') out[siteId].feet = Number(latest.value);
    out[siteId].at = latest.dateTime;
  }
  return GAUGES.map(g => ({ ...g, ...(out[g.id] || {}) }));
}

// Weather-code → short label (Open-Meteo WMO codes)
const WMO = {
  0:['Clear','☀️'], 1:['Mostly clear','🌤️'], 2:['Partly cloudy','⛅'], 3:['Overcast','☁️'],
  45:['Fog','🌫️'], 48:['Rime fog','🌫️'],
  51:['Light drizzle','🌦️'], 53:['Drizzle','🌦️'], 55:['Heavy drizzle','🌧️'],
  61:['Light rain','🌧️'], 63:['Rain','🌧️'], 65:['Heavy rain','🌧️'],
  71:['Light snow','🌨️'], 73:['Snow','🌨️'], 75:['Heavy snow','❄️'],
  77:['Snow grains','❄️'],
  80:['Showers','🌦️'], 81:['Heavy showers','🌧️'], 82:['Violent showers','⛈️'],
  85:['Light snow showers','🌨️'], 86:['Snow showers','❄️'],
  95:['Thunderstorm','⛈️'], 96:['T-storm w/ hail','⛈️'], 99:['T-storm w/ hail','⛈️'],
};
function wmoLabel(c) { return WMO[c] || ['—','·']; }

async function loadFeeds(force = false) {
  if (!force && FEED_CACHE.data && Date.now() - FEED_CACHE.at < FEED_TTL_MS) return FEED_CACHE.data;
  const winter = isWinterMonth();
  const errors = [];
  let weather = null, summit = null, flows = [];
  try { weather = await fetchOpenMeteo(GREELEY, { days: 10 }); } catch (e) { errors.push({ src:'weather', err:e.message }); }
  if (winter) {
    try { summit = await fetchOpenMeteo(SUMMIT, { days: 10 }); } catch (e) { errors.push({ src:'summit', err:e.message }); }
  } else {
    try { flows = await fetchUsgsFlows(); } catch (e) { errors.push({ src:'usgs', err:e.message }); }
  }
  // Normalize weather for the UI: current + daily array
  let normalized = null;
  if (weather) {
    const [labelNow, iconNow] = wmoLabel(weather.current?.weather_code);
    normalized = {
      place: GREELEY.label,
      now: {
        tempF: weather.current?.temperature_2m,
        wind:  weather.current?.wind_speed_10m,
        humidity: weather.current?.relative_humidity_2m,
        label: labelNow, icon: iconNow,
      },
      daily: (weather.daily?.time || []).map((t, i) => {
        const [lbl, ic] = wmoLabel(weather.daily.weather_code[i]);
        return {
          date: t,
          hi: weather.daily.temperature_2m_max[i],
          lo: weather.daily.temperature_2m_min[i],
          precipIn: weather.daily.precipitation_sum[i],
          snowIn: weather.daily.snowfall_sum?.[i] ?? null,
          label: lbl, icon: ic,
        };
      }),
    };
  }
  let snow = null;
  if (winter && summit) {
    snow = {
      place: SUMMIT.label,
      daily: (summit.daily?.time || []).map((t, i) => ({
        date: t,
        hi: summit.daily.temperature_2m_max[i],
        lo: summit.daily.temperature_2m_min[i],
        snowIn: summit.daily.snowfall_sum?.[i] ?? 0,
        label: wmoLabel(summit.daily.weather_code[i])[0],
        icon:  wmoLabel(summit.daily.weather_code[i])[1],
      })),
    };
  }
  FEED_CACHE = {
    at: Date.now(),
    data: { weather: normalized, flows, snow, winter, errors, fetchedAt: new Date().toISOString() },
  };
  return FEED_CACHE.data;
}

// ── Mission-control assets: pull every image any tenant has tagged in the
// "mission-control" folder. Admins tag via the existing tenant /admin/assets
// folder selector — no per-tenant UI change needed.
const ASSET_FOLDER = 'mission-control';
let ASSET_CACHE = { at: 0, items: [] };
const ASSET_TTL_MS = 5 * 60 * 1000;
async function loadMissionControlAssets(force = false) {
  if (!force && Date.now() - ASSET_CACHE.at < ASSET_TTL_MS) return ASSET_CACHE.items;
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({}, { projection: { db: 1, domain: 1, brand: 1, meta: 1 } })
    .toArray();
  const out = [];
  await Promise.all(tenants.map(async (t) => {
    if (!t.db) return;
    try {
      const tdb = getTenantDb(t.db);
      const docs = await tdb.collection('assets').find({
        $or: [{ folders: ASSET_FOLDER }, { folder: ASSET_FOLDER }],
        publicUrl: { $exists: true, $ne: '' },
      }, { projection: { title: 1, publicUrl: 1, mimeType: 1, fileType: 1, uploadedAt: 1 } })
        .sort({ uploadedAt: -1 }).limit(40).toArray().catch(() => []);
      for (const d of docs) {
        if (d.fileType && d.fileType !== 'image') continue;
        out.push({
          id: String(d._id),
          title: d.title || '',
          url: d.publicUrl,
          who: ownerForTenant(t),
          brand: t.brand?.name || t.domain,
          uploadedAt: d.uploadedAt,
        });
      }
    } catch {}
  }));
  out.sort((a, b) => new Date(b.uploadedAt||0) - new Date(a.uploadedAt||0));
  ASSET_CACHE = { at: Date.now(), items: out.slice(0, 60) };
  return ASSET_CACHE.items;
}
router.get('/api/assets/mission-control', async (req, res) => {
  try { res.json({ ok: true, items: await loadMissionControlAssets(req.query.force === '1') }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Interests / headlines / sports — Google News RSS per stored topic ──
const DEFAULT_INTERESTS = [
  { id: 'denver-news',  topic: 'Denver Colorado news',     label: 'Denver News' },
  { id: 'broncos',      topic: 'Denver Broncos',           label: 'Broncos' },
  { id: 'avalanche',    topic: 'Colorado Avalanche NHL',   label: 'Avalanche' },
  { id: 'nuggets',      topic: 'Denver Nuggets NBA',       label: 'Nuggets' },
];
let INTERESTS_CACHE = { at: 0, items: [] };
const INTERESTS_TTL_MS = 30 * 60 * 1000;
async function loadInterestTopics() {
  const doc = await getSlabDb().collection('gateway_config').findOne({ key: 'interests' });
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : DEFAULT_INTERESTS;
}
async function fetchInterestHeadlines(force = false) {
  if (!force && Date.now() - INTERESTS_CACHE.at < INTERESTS_TTL_MS) return INTERESTS_CACHE;
  const topics = await loadInterestTopics();
  const errors = [];
  const items = [];
  await Promise.all(topics.map(async (src) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(src.topic)}&hl=en-US&gl=US&ceid=US:en`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sLab-Gateway/1.0' } });
      if (!r.ok) { errors.push({ src: src.id, err: 'HTTP ' + r.status }); return; }
      const body = await r.text();
      const parsed = parseRss(body).slice(0, 6);
      parsed.forEach(p => items.push({ ...p, source: src.label, sourceId: src.id, topic: src.topic }));
    } catch (e) { errors.push({ src: src.id, err: e.message }); }
  }));
  items.sort((a, b) => new Date(b.start) - new Date(a.start));
  INTERESTS_CACHE = { at: Date.now(), items: items.slice(0, 60), errors, fetchedAt: new Date().toISOString() };
  return INTERESTS_CACHE;
}
router.get('/api/interests', async (req, res) => {
  try { res.json({ ok: true, ...await fetchInterestHeadlines(req.query.force === '1'), topics: await loadInterestTopics() }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
router.post('/api/interests', async (req, res) => {
  const topic = String(req.body.topic || '').trim().slice(0, 120);
  const label = String(req.body.label || topic).trim().slice(0, 40);
  if (!topic) return res.status(400).json({ ok: false, error: 'topic required' });
  const id = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const current = await loadInterestTopics();
  const next = [...current.filter(t => t.id !== id), { id, topic, label }];
  await getSlabDb().collection('gateway_config').updateOne(
    { key: 'interests' }, { $set: { value: next, updatedAt: new Date() } }, { upsert: true }
  );
  INTERESTS_CACHE = { at: 0, items: [] };
  res.json({ ok: true, topics: next });
});
router.delete('/api/interests/:id', async (req, res) => {
  const current = await loadInterestTopics();
  const next = current.filter(t => t.id !== req.params.id);
  await getSlabDb().collection('gateway_config').updateOne(
    { key: 'interests' }, { $set: { value: next, updatedAt: new Date() } }, { upsert: true }
  );
  INTERESTS_CACHE = { at: 0, items: [] };
  res.json({ ok: true, topics: next });
});

// ── Finance history: 13 months of income (invoices) vs household bills
// Used by the rotating money-panel charts on the overview.
let FINANCE_CACHE = { at: 0, data: null };
const FINANCE_TTL_MS = 10 * 60 * 1000;
async function loadFinanceHistory(months = 13) {
  if (FINANCE_CACHE.data && Date.now() - FINANCE_CACHE.at < FINANCE_TTL_MS) return FINANCE_CACHE.data;
  const slab = getSlabDb();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const tenants = await loadPrimaryTenants(slab);

  const monthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; };

  // Seed empty months so the chart always has 13 bars
  const buckets = {};
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets[monthKey(d)] = { month: monthKey(d), income: 0, incomeCount: 0, bills: 0, billsCount: 0, paid: 0, paidCount: 0 };
  }

  await Promise.all(tenants.map(async (t) => {
    if (!t.db) return;
    try {
      const tdb = getTenantDb(t.db);
      const invs = await tdb.collection('invoices').find({
        $or: [{ dueDate: { $gte: start } }, { createdAt: { $gte: start } }, { paidAt: { $gte: start } }],
      }, { projection: { total: 1, amount: 1, status: 1, dueDate: 1, createdAt: 1, paidAt: 1 } })
        .limit(2000).toArray().catch(() => []);
      for (const inv of invs) {
        const refDate = inv.dueDate || inv.createdAt;
        if (!refDate) continue;
        const k = monthKey(refDate); if (!buckets[k]) continue;
        const amt = Number(inv.total || inv.amount || 0);
        buckets[k].income += amt; buckets[k].incomeCount++;
        if (inv.status === 'paid') {
          const pk = monthKey(inv.paidAt || refDate);
          if (buckets[pk]) { buckets[pk].paid += amt; buckets[pk].paidCount++; }
        }
      }
    } catch {}
  }));

  // Household bills from gateway_tasks (kind=bill)
  try {
    const bills = await slab.collection('gateway_tasks')
      .find({ kind: 'bill', archived: { $ne: true } }).toArray();
    for (const b of bills) {
      const refDate = b.when || b.createdAt;
      if (!refDate) continue;
      const k = monthKey(refDate); if (!buckets[k]) continue;
      const amt = Number(b.amount) || 0;
      buckets[k].bills += amt; buckets[k].billsCount++;
    }
  } catch {}

  const series = Object.values(buckets).sort((a, b) => a.month.localeCompare(b.month));
  FINANCE_CACHE = { at: Date.now(), data: { series, monthsBack: months, fetchedAt: new Date().toISOString() } };
  return FINANCE_CACHE.data;
}
router.get('/api/finance/history', async (req, res) => {
  try { res.json({ ok: true, ...await loadFinanceHistory(parseInt(req.query.months) || 13) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/feeds', async (req, res) => {
  try {
    const data = await loadFeeds(req.query.force === '1');
    res.json({ ok: true, ...data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── API: agent — ollama over the aggregated context ─────────────────────────
router.post('/api/agent', async (req, res) => {
  const prompt = String(req.body.prompt || '').slice(0, 4000);
  const searchOn = req.body.search !== false;
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });
  try {
    // Pass 1: classify intent — does the user want us to ACT (create a task/event/bill),
    // or just ANSWER a question?
    const nowIso = new Date().toISOString();
    const action = await classifyAgentAction(prompt, nowIso);

    const performed = [];
    if (action?.action === 'create_task' && action.text) {
      const allowedWho = [...FAMILY, 'Family'];
      const allowedKind = ['task', 'event', 'reminder', 'bill', 'appointment'];
      const doc = {
        text: String(action.text).slice(0, 280),
        who: allowedWho.includes(action.who) ? action.who : 'Family',
        kind: allowedKind.includes(action.kind) ? action.kind : 'task',
        when: action.when ? new Date(action.when) : null,
        location: String(action.location || '').slice(0, 160),
        note: String(action.note || '').slice(0, 400),
        amount: Number(action.amount) || null,
        completed: false,
        createdBy: `agent:${res.locals.gatewayOperator}`,
        createdAt: new Date(),
      };
      const r = await getSlabDb().collection('gateway_tasks').insertOne(doc);
      await broadcastTasks();
      performed.push({ kind: 'created', id: String(r.insertedId), doc });
    }

    // Pass 2: produce a human reply (with context + web search) — also tells the
    // user what was done, if anything.
    const ctx = await aggregateAcrossTenants({ days: 45 });
    let webResults = [];
    if (searchOn) {
      try { const r = await webSearch(prompt.slice(0, 180)); webResults = (r?.results || r || []).slice(0, 5); }
      catch {}
    }
    const system =
      `You are Wallace, the Ryder-household ops agent. Members: Scott + Candace (parents/operators) + kids Violet + Odin. ` +
      `Scott runs the madladslab/sLab tenants; Candace runs w2marketing. ` +
      `You have read-only context across all tenants (calendar, bookings, invoices, meetings, workdays, monthly money), ` +
      `and you can CREATE entries (tasks/events/bills/reminders/appointments) — when the user asks you to add something, ` +
      `it has already been created before this reply runs. Confirm what you did in plain language. ` +
      `Refer to people by first name. Be terse. Surface conflicts and money implications.`;
    const ctxSummary = JSON.stringify({
      now: nowIso,
      family: ctx.family,
      counts: ctx.counts,
      calendar: ctx.calendar.slice(0, 20),
      bookings: ctx.bookings.slice(0, 20),
      invoices: ctx.invoices.slice(0, 20),
      meetings: ctx.meetings.slice(0, 10),
      workdays: ctx.workdays.slice(0, 14),
      monthly: ctx.monthly,
      webResults,
      performed,
    });
    const reply = await callLLM(
      [{ role: 'user', content: `Context:\n${ctxSummary}\n\nUser said: ${prompt}` }],
      system,
      60000
    );
    res.json({ ok: true, reply, performed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Ask the LLM to classify whether the prompt is an action request and extract
 * structured fields. Returns null if it's not an action.
 */
async function classifyAgentAction(prompt, nowIso) {
  const sys = `You parse natural-language requests into family-calendar actions. ` +
    `If the user is asking you to ADD a task, event, bill, reminder, or appointment, ` +
    `respond with ONLY a JSON object — no prose, no markdown — shaped like: ` +
    `{"action":"create_task","text":"<short label>","who":"Scott|Candace|Violet|Odin|Family",` +
    `"kind":"task|event|bill|reminder|appointment","when":"<ISO datetime or null>",` +
    `"location":"<optional>","note":"<optional>","amount":<number or null>}. ` +
    `If the request is NOT an action (it's a question / chat), respond with EXACTLY: {"action":"none"}. ` +
    `Today is ${nowIso}. Interpret relative dates ("next Tuesday", "Friday at 3") against that. ` +
    `Dentist/doctor/haircut = appointment. Rent/utility/subscription = bill.`;
  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], sys, 30000);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (parsed.action === 'create_task' && parsed.text) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ── Topic background images (Stable Diffusion v1.5 via ollama.madladslab) ──
// Each mission-control section/card gets a tasteful, low-opacity background
// generated once and cached to /srv/slab/public/images/scotts-gateway/{slug}.png.
// Regeneration is on-demand (POST .../regenerate); first-load warms the cache
// serially in the background.
const TOPIC_IMG_DIR = path.resolve(__dirname, '../../public/images/scotts-gateway');
const TOPIC_IMG_PUBLIC = '/images/scotts-gateway';
const TOPIC_NEG = 'text, words, letters, numbers, watermark, logo, signature, ' +
  'blurry, low quality, deformed, ugly, oversaturated, harsh, busy, cluttered, faces';
const TOPIC_PROMPTS = {
  'weather-now':    'minimalist Colorado prairie horizon at dawn, soft warm light, painterly, abstract, dark muted background, atmospheric mood',
  'weather-3day':   'three suns arcing over Colorado plains, painterly abstract weather forecast, soft golds and blues, dark muted background',
  'weather-10day':  'long panoramic horizon time-lapse, abstract painterly weather patterns over open Colorado prairie, muted dusk palette, dark background',
  'river-flows':    'painterly abstract river flowing through Colorado prairie at twilight, soft teal and gold reflections, minimalist, dark muted background',
  'snow':           'soft falling snow over distant Colorado mountains, painterly abstract, cool muted blues and grays, dark background, peaceful',
  'flows':          'painterly abstract river current and rocks, soft teal water, minimalist, dark muted background',
  'interests':      'abstract painterly news collage, soft warm tones, dark background, minimal, no text',
  'review':         'abstract painterly reflective lake at dawn, soft muted gold, contemplative, dark background',
  'agent':          'abstract glowing neural-network filaments, painterly, soft gold and teal threads, dark muted background, futuristic minimalism',
  'overview':       'abstract painterly mission-control dashboard, soft dark gold and teal glow, minimalist, dark background',
  'calendar':       'painterly abstract vintage planner pages and soft clock face, muted warm gold tones, dark background, family aesthetic',
  'bills':          'painterly abstract bookkeeping ledger and coins, soft muted greens and reds, dark background, minimal',
  'money-in':       'painterly abstract glowing green currency drifting, soft muted greens, dark background, minimal',
  'money-out':      'painterly abstract household bills and envelopes on a wooden desk, soft muted reds, dark background',
  'tasks':          'painterly abstract checklist on weathered paper, muted earth tones, dark background, soft and minimal',
  'meetings':       'painterly abstract silhouettes of figures gathered around a table, soft warm amber light, dark background',
  'local':          'painterly Greeley Colorado downtown at dusk, glowing streetlamps and brick storefronts, painterly abstract, dark muted warm background',
  'local-events':   'painterly Greeley Colorado downtown at dusk, glowing streetlamps and brick storefronts, painterly abstract, dark muted warm background',
  'photo':          'painterly abstract gilded photo frame on a dark wall, soft muted gold, family aesthetic, dark background',
};

const TOPIC_STATE = {}; // slug -> { generating, error, generatedAt }
for (const slug of Object.keys(TOPIC_PROMPTS)) TOPIC_STATE[slug] = { generating: false, error: null, generatedAt: null };

async function topicImagePath(slug) { return path.join(TOPIC_IMG_DIR, `${slug}.png`); }
async function topicImageExists(slug) {
  try { const s = await fs.stat(await topicImagePath(slug)); return s.size > 0; } catch { return false; }
}
async function ensureTopicImageDir() {
  try { await fs.mkdir(TOPIC_IMG_DIR, { recursive: true }); } catch {}
}
async function generateTopicImage(slug, { force = false } = {}) {
  const prompt = TOPIC_PROMPTS[slug];
  if (!prompt) throw new Error('unknown topic: ' + slug);
  if (!force && await topicImageExists(slug)) return { slug, cached: true };
  if (TOPIC_STATE[slug].generating) return { slug, queued: true };
  TOPIC_STATE[slug].generating = true;
  TOPIC_STATE[slug].error = null;
  try {
    await ensureTopicImageDir();
    const buf = await generateSdImage(prompt, TOPIC_NEG, '512x512');
    await fs.writeFile(await topicImagePath(slug), buf);
    TOPIC_STATE[slug].generatedAt = new Date().toISOString();
    return { slug, generated: true };
  } catch (err) {
    TOPIC_STATE[slug].error = err.message;
    throw err;
  } finally {
    TOPIC_STATE[slug].generating = false;
  }
}

// Sequential background warm — SD is slow (15–45s/image) and we don't want to
// hammer it. Fires at module load only for slugs missing from disk.
let TOPIC_WARM_STARTED = false;
async function warmTopicImages() {
  if (TOPIC_WARM_STARTED) return;
  TOPIC_WARM_STARTED = true;
  await ensureTopicImageDir();
  for (const slug of Object.keys(TOPIC_PROMPTS)) {
    if (await topicImageExists(slug)) continue;
    try { await generateTopicImage(slug); }
    catch (err) { /* keep going, error stored in TOPIC_STATE */ }
  }
}
// Kick off after a short delay so the server can finish booting first
setTimeout(() => { warmTopicImages().catch(() => {}); }, 5000);

router.get('/api/topic-images', async (req, res) => {
  const items = await Promise.all(Object.keys(TOPIC_PROMPTS).map(async (slug) => ({
    slug,
    url: (await topicImageExists(slug)) ? `${TOPIC_IMG_PUBLIC}/${slug}.png?v=${Date.parse(TOPIC_STATE[slug].generatedAt || '') || ''}` : null,
    ready: await topicImageExists(slug),
    generating: TOPIC_STATE[slug].generating,
    error: TOPIC_STATE[slug].error,
    generatedAt: TOPIC_STATE[slug].generatedAt,
  })));
  res.json({ ok: true, items });
});
router.post('/api/topic-image/:slug/regenerate', async (req, res) => {
  const { slug } = req.params;
  if (!TOPIC_PROMPTS[slug]) return res.status(404).json({ ok: false, error: 'unknown topic' });
  // Fire-and-forget so the remote button returns instantly
  generateTopicImage(slug, { force: true }).catch(() => {});
  res.json({ ok: true, slug, queued: true });
});
router.post('/api/topic-images/regenerate-all', async (req, res) => {
  (async () => {
    for (const slug of Object.keys(TOPIC_PROMPTS)) {
      try { await generateTopicImage(slug, { force: true }); } catch {}
    }
  })();
  res.json({ ok: true, queued: Object.keys(TOPIC_PROMPTS).length });
});

export default router;
