/**
 * Slab — Owner email hydration
 *
 * A tenant's OWNER email (billing + notification contact) is stored once, in
 * `tenant.meta.ownerEmail`. Every place that emails the owner — invoices,
 * booking alerts, onboarding, activity-log actors, the superadmin views — reads
 * that field LIVE at send time. So "hydrate globally" is a single write here
 * plus a tenant-cache bust; there is no second copy to keep in sync.
 *
 * This intentionally does NOT touch the owner's LOGIN identity (their user
 * account `email`, which is OAuth-keyed) — changing how someone signs in is a
 * separate, identity-sensitive operation.
 */

import { getSlabDb } from './mongo.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { logActivity } from './activityLog.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Set / hydrate a tenant's owner (billing + contact) email everywhere.
 * @param {object} tenant  - tenant doc or req.tenant (needs _id + domain fields)
 * @param {string} newEmail
 * @param {{ actor?: {email?:string, role?:string} }} [opts]
 * @returns {Promise<{ok:boolean, error?:string, oldEmail?:string|null, newEmail?:string, unchanged?:boolean}>}
 */
export async function setOwnerEmail(tenant, newEmail, { actor } = {}) {
  const email = String(newEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!tenant?._id) return { ok: false, error: 'Tenant not resolved.' };

  const slab = getSlabDb();
  const oldEmail = tenant.meta?.ownerEmail || null;
  if (oldEmail === email) return { ok: true, oldEmail, newEmail: email, unchanged: true };

  const result = await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    { $set: { 'meta.ownerEmail': email, updatedAt: new Date() } },
  );
  if (!result.matchedCount) return { ok: false, error: 'Tenant document not found.' };

  // Refresh the cached tenant doc under every hostname it may be keyed by, so
  // live reads (booking, contact, invoices) immediately see the new address.
  for (const d of [tenant.wildcardDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) {
    if (d) bustTenantCache(d);
  }

  await logActivity({
    category: 'settings',
    action: 'owner_email_changed',
    tenantDomain: tenant.domain || tenant.wildcardDomain,
    tenantId: tenant._id,
    actor: actor || null,
    details: { from: oldEmail, to: email },
  }).catch(() => {});

  return { ok: true, oldEmail, newEmail: email };
}
