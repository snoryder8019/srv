'use strict';

/**
 * lib/onboarding.js — games-native onboarding (independent of slab's tenant flow).
 *
 * Games is its own product, not a slab tenant — so it gets its own lightweight
 * onboarding: send a branded account welcome on signup, record the outcome to
 * the shared comms ledger (slab.comms_log), and stamp a funnel summary onto the
 * user doc so /admin/onboarding can show where each player sits in the funnel.
 *
 * Every send is tracked. A failed welcome is loud and visible — never silent.
 */

const mailer = require('./mailer');
const { logComms } = require('/srv/slab/plugins/comms-log.cjs');

/**
 * Stamp a compact funnel summary onto the games user doc. Best-effort.
 */
async function _stampFunnel(db, userId, patch) {
  try {
    const { ObjectId } = require('mongodb');
    const _id = (userId instanceof ObjectId) ? userId : new ObjectId(String(userId));
    const set = {};
    for (const [k, v] of Object.entries(patch)) set[`funnel.${k}`] = v;
    set['funnel.updatedAt'] = new Date();
    await db.collection('users').updateOne({ _id }, { $set: set });
  } catch (e) {
    console.error('[onboarding] funnel stamp failed:', e.message);
  }
}

/**
 * Send (or resend) the account welcome and record the result everywhere.
 * Returns { ok, error }.
 */
async function _deliverWelcome(db, user, { source = '', resend = false } = {}) {
  const to = user.email;
  const name = user.firstName || user.displayName || '';
  const base = {
    app: 'games', type: 'welcome', channel: 'email',
    to, userId: user._id, name, subject: 'Welcome to MadLadsLab Games',
    stage: 'welcome', meta: { source, resend },
  };

  if (!to) {
    await logComms({ ...base, status: 'skipped', error: 'user has no email' });
    return { ok: false, error: 'no email' };
  }

  try {
    await mailer.sendAccountWelcome({ to, name });
    await logComms({ ...base, status: 'sent' });
    await _stampFunnel(db, user._id, {
      stage: 'welcomed',
      welcome: { status: 'sent', at: new Date(), error: null },
      source: source || (user.funnel && user.funnel.source) || '',
    });
    return { ok: true, error: null };
  } catch (e) {
    await logComms({ ...base, status: 'failed', error: e.message });
    await _stampFunnel(db, user._id, {
      stage: 'welcome_failed',
      welcome: { status: 'failed', at: new Date(), error: String(e.message).slice(0, 300) },
      source: source || (user.funnel && user.funnel.source) || '',
    });
    return { ok: false, error: e.message };
  }
}

/**
 * Call once, right after a new games user is inserted. Fire-and-forget safe —
 * never throws, never blocks the login redirect.
 *
 * @param {Db}     db
 * @param {object} user   — the freshly inserted user doc (must have _id, email)
 * @param {object} [opts]
 * @param {string} [opts.method] — 'Google SSO' | 'Google OAuth' | 'gateway' | …
 * @param {string} [opts.ip]
 */
function onUserCreated(db, user, { method = '', ip = '' } = {}) {
  // mark the entry point immediately so the funnel reflects signup even if the
  // welcome send is slow or fails
  _stampFunnel(db, user._id, { stage: 'signed_up', source: method, signedUpAt: new Date(), ip: ip || '' })
    .catch(() => {});
  // welcome send runs async; outcome lands in comms_log + funnel
  _deliverWelcome(db, user, { source: method }).catch((e) =>
    console.error('[onboarding] welcome delivery threw:', e.message));
}

/**
 * Admin-triggered resend. Awaitable — returns the delivery result.
 */
async function resendWelcome(db, user) {
  return _deliverWelcome(db, user, { source: 'admin_resend', resend: true });
}

module.exports = { onUserCreated, resendWelcome };
