/**
 * Slab — Activity Log
 * Writes structured activity events to slab.activity_logs for superadmin visibility.
 * Categories: registration, settings, payment, admin_action
 */

import { getSlabDb } from './mongo.js';

/**
 * Log an activity event to the platform registry.
 * @param {object} opts
 * @param {'registration'|'settings'|'payment'|'admin_action'} opts.category
 * @param {string} opts.action   - e.g. 'signup', 'settings_saved', 'activated'
 * @param {string} opts.tenantDomain
 * @param {import('mongodb').ObjectId} [opts.tenantId]
 * @param {'success'|'failed'|'partial'} [opts.status='success']
 * @param {{ email?: string, role?: string }} [opts.actor]
 * @param {object} [opts.details]  - action-specific payload
 * @param {string} [opts.error]
 * @param {string} [opts.ip]
 */
export async function logActivity({
  category,
  action,
  tenantDomain,
  tenantId,
  status = 'success',
  actor,
  details,
  error,
  ip,
}) {
  try {
    const slab = getSlabDb();
    await slab.collection('activity_logs').insertOne({
      category,
      action,
      tenantDomain: tenantDomain || null,
      tenantId: tenantId || null,
      status,
      actor: actor || null,
      details: details || {},
      error: error || null,
      ip: ip || null,
      timestamp: new Date(),
    });
  } catch (err) {
    // Never let logging break the actual operation
    console.error('[activityLog] Write failed:', err.message);
  }
}

/**
 * Fetch recent activity logs, optionally filtered by tenant domain, category,
 * or status.
 * @param {{ tenantDomain?: string, category?: string, status?: string, limit?: number }} opts
 */
export async function getActivityLogs({ tenantDomain, category, status, limit = 50 } = {}) {
  const slab = getSlabDb();
  const query = {};
  if (tenantDomain) query.tenantDomain = tenantDomain;
  if (category) query.category = category;
  if (status) query.status = status;
  return slab.collection('activity_logs')
    .find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Signup funnel + error snapshot for the superadmin overview.
 *
 * Reads the `registration` category of activity_logs, which the onboarding
 * flow now stamps at every stage: `signup_attempt` (the click), `signup`
 * (success), `signup_rejected` (validation bounce), `signup_failed` (crash).
 *
 * @param {{ recentErrors?: number }} [opts]
 */
export async function getSignupFunnel({ recentErrors = 15 } = {}) {
  const slab = getSlabDb();
  const logs = slab.collection('activity_logs');
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000);
  const since7d = new Date(now - 7 * 24 * 3600 * 1000);

  const countWindow = (action, since) =>
    logs.countDocuments({ category: 'registration', action, timestamp: { $gte: since } }).catch(() => 0);

  const [
    attempts24h, success24h, rejected24h, failed24h,
    attempts7d, success7d, rejected7d, failed7d,
    recent,
  ] = await Promise.all([
    countWindow('signup_attempt', since24h),
    countWindow('signup', since24h),
    countWindow('signup_rejected', since24h),
    countWindow('signup_failed', since24h),
    countWindow('signup_attempt', since7d),
    countWindow('signup', since7d),
    countWindow('signup_rejected', since7d),
    countWindow('signup_failed', since7d),
    logs.find({ category: 'registration', action: { $in: ['signup_failed', 'signup_rejected'] } })
      .sort({ timestamp: -1 }).limit(recentErrors).toArray().catch(() => []),
  ]);

  const rate = (ok, att) => (att > 0 ? Math.round((ok / att) * 100) : null);

  return {
    day: {
      attempts: attempts24h, success: success24h, rejected: rejected24h, failed: failed24h,
      conversion: rate(success24h, attempts24h),
    },
    week: {
      attempts: attempts7d, success: success7d, rejected: rejected7d, failed: failed7d,
      conversion: rate(success7d, attempts7d),
    },
    recentErrors: recent,
  };
}
