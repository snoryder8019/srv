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
 * Fetch recent activity logs, optionally filtered by tenant domain.
 * @param {{ tenantDomain?: string, limit?: number }} opts
 */
export async function getActivityLogs({ tenantDomain, limit = 50 } = {}) {
  const slab = getSlabDb();
  const query = tenantDomain ? { tenantDomain } : {};
  return slab.collection('activity_logs')
    .find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}
