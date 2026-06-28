/**
 * comms-log.cjs — central per-user communications & funnel ledger
 *
 * One place that records EVERY outbound notification attempt across all the
 * MadLadsLab apps (games, opsTrain, graffiti-tv, greealitytv, acm, slab…) so
 * we can see, per user, where they are in the funnel and whether a welcome /
 * confirmation / alert actually sent or silently died.
 *
 * Writes to slab.comms_log. Same Mongo cluster every app already talks to;
 * the only requirement is DB_URL in the calling process env (falls back to
 * /srv/slab/.env, same as notify.cjs).
 *
 * Usage (CJS):  const { logComms, funnelFor } = require('/srv/slab/plugins/comms-log.cjs');
 * Usage (ESM):  const require = createRequire(import.meta.url);
 *               const { logComms } = require('./comms-log.cjs');
 *
 * logComms NEVER throws to the caller — a tracking failure must not break the
 * thing being tracked. Failures are logged loudly to stderr.
 */
'use strict';

const { MongoClient } = require('mongodb');

if (!process.env.DB_URL) {
  try { require('dotenv').config({ path: '/srv/slab/.env', override: false }); } catch {}
}

const SLAB_DB_NAME = process.env.SLAB_DB || 'slab';
const COLL = 'comms_log';

let _client = null;
let _db = null;

async function getSlabDb() {
  if (_db) return _db;
  const url = process.env.DB_URL || process.env.MONGO_URI;
  if (!url) throw new Error('DB_URL not set — cannot write to comms_log');
  _client = new MongoClient(url);
  await _client.connect();
  _db = _client.db(SLAB_DB_NAME);
  return _db;
}

/**
 * Record one communication attempt.
 *
 * @param {object} o
 * @param {string} o.app       — source app ('games', 'slab', 'opstrain'…)
 * @param {string} o.type      — message type ('welcome'|'signup_alert'|'confirmation'|'newsletter'|'invite'|…)
 * @param {string} [o.channel] — 'email' (default) | 'notify' | 'sms' | 'push'
 * @param {string} [o.to]      — recipient email/handle
 * @param {*}      [o.userId]  — the user's _id in the app's own DB (string or ObjectId)
 * @param {string} [o.name]
 * @param {string} [o.subject]
 * @param {string} o.status    — 'sent' | 'failed' | 'skipped'
 * @param {string} [o.error]   — failure reason (when status !== 'sent')
 * @param {string} [o.stage]   — funnel stage this attempt belongs to ('signed_up'|'welcome'|'verified'|'active'…)
 * @param {object} [o.meta]
 * @returns {Promise<string|null>} inserted id, or null on tracking failure
 */
async function logComms({
  app = 'platform', type = 'unknown', channel = 'email',
  to = '', userId = null, name = '', subject = '',
  status = 'sent', error = null, stage = '', meta = {},
} = {}) {
  const doc = {
    app, type, channel,
    to: to || '',
    userId: userId == null ? null : String(userId),
    name: name || '',
    subject: subject || '',
    status,
    error: error ? String(error).slice(0, 500) : null,
    stage: stage || '',
    meta: meta || {},
    createdAt: new Date(),
  };

  // Loud on anything that isn't a clean send — this is the whole point.
  if (status === 'failed') {
    console.error(`[comms] FAILED ${app}/${type} -> ${to || '(no recipient)'} :: ${doc.error || 'unknown error'}`);
  } else if (status === 'skipped') {
    console.warn(`[comms] SKIPPED ${app}/${type} -> ${to || '(no recipient)'} :: ${doc.error || 'no transport / preconditions unmet'}`);
  }

  try {
    const db = await getSlabDb();
    const r = await db.collection(COLL).insertOne(doc);
    return r.insertedId ? String(r.insertedId) : null;
  } catch (e) {
    console.error('[comms] ledger write failed:', e.message);
    return null;
  }
}

/**
 * Wrap an email-send promise so success/failure is recorded automatically.
 * Re-throws nothing — returns { ok, id, error }.
 *
 * @param {Promise} sendPromise — the in-flight nodemailer send (or any promise)
 * @param {object}  entry       — same shape as logComms (minus status/error)
 */
async function track(sendPromise, entry) {
  try {
    await sendPromise;
    const id = await logComms({ ...entry, status: 'sent' });
    return { ok: true, id, error: null };
  } catch (e) {
    const id = await logComms({ ...entry, status: 'failed', error: e && e.message });
    return { ok: false, id, error: e && e.message };
  }
}

/**
 * Compact funnel/delivery summary for one user, derived from the ledger.
 * Matches on userId OR email (case-insensitive).
 *
 * @param {object} q
 * @param {string} [q.email]
 * @param {*}      [q.userId]
 * @param {string} [q.app]   — restrict to one app
 * @returns {Promise<{attempts:number, lastAt:Date|null, byType:object, hasFailure:boolean, stage:string, events:Array}>}
 */
async function funnelFor({ email = '', userId = null, app = '' } = {}) {
  const empty = { attempts: 0, lastAt: null, byType: {}, hasFailure: false, stage: 'unknown', events: [] };
  const or = [];
  if (email) or.push({ to: new RegExp('^' + escapeRe(email) + '$', 'i') });
  if (userId != null) or.push({ userId: String(userId) });
  if (!or.length) return empty;

  try {
    const db = await getSlabDb();
    const filter = { $or: or };
    if (app) filter.app = app;
    const events = await db.collection(COLL).find(filter).sort({ createdAt: 1 }).limit(100).toArray();
    if (!events.length) return empty;

    const byType = {};
    let hasFailure = false;
    for (const e of events) {
      const prev = byType[e.type];
      // last write wins per type — newest status is the live state
      byType[e.type] = { status: e.status, at: e.createdAt, error: e.error };
      if (e.status === 'failed' && (!prev || prev.status !== 'sent')) hasFailure = true;
    }
    // a type that ultimately sent is not a failure
    for (const t of Object.keys(byType)) if (byType[t].status === 'sent') { /* clears below */ }
    hasFailure = Object.values(byType).some(v => v.status === 'failed');

    const last = events[events.length - 1];
    const stage = deriveStage(byType, last);
    return { attempts: events.length, lastAt: last.createdAt, byType, hasFailure, stage, events };
  } catch (e) {
    console.error('[comms] funnelFor failed:', e.message);
    return empty;
  }
}

function deriveStage(byType, last) {
  if (byType.welcome && byType.welcome.status === 'sent') return 'welcomed';
  if (byType.welcome && byType.welcome.status === 'failed') return 'welcome_failed';
  if (byType.signup_alert) return 'signed_up';
  return last ? last.stage || 'signed_up' : 'unknown';
}

/** Recent ledger entries for the superadmin console. */
async function recentComms({ app = '', status = '', type = '', limit = 100 } = {}) {
  try {
    const db = await getSlabDb();
    const filter = {};
    if (app) filter.app = app;
    if (status) filter.status = status;
    if (type) filter.type = type;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    return await db.collection(COLL).find(filter).sort({ createdAt: -1 }).limit(lim).toArray();
  } catch (e) {
    console.error('[comms] recentComms failed:', e.message);
    return [];
  }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { logComms, track, funnelFor, recentComms, getSlabDb, COLL };
