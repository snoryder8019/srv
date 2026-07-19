/**
 * plugins/platformComps.js — madladslab-only "marketing comps" memo.
 *
 * A comped account is a superadmin-granted premium (lifetime) tenant with NO
 * processor payment on file — i.e. free premium access given away. That giveaway
 * has a marketing value even though no cash changes hands, so the madladslab P&L
 * surfaces it as a NON-CASH memo (it never posts a ledger entry — cash books stay
 * clean; see the "separate comps report" decision).
 *
 * Valuation: base monthly list price × the number of months the account has been
 * comped (min 1). Custom pipe — only the madladslab house tenant's P&L calls this.
 */
import { getSlabDb } from './mongo.js';
import { BASE_MONTHLY } from '../config/pricing.js';

const HOUSE_DB = 'slab_madladslab';

/** Whole calendar months between two dates (min 0). */
function monthsBetween(from, to) {
  const f = new Date(from), t = new Date(to);
  let m = (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth());
  if (t.getDate() < f.getDate()) m -= 1;        // not a full month yet
  return Math.max(0, m);
}

/**
 * Compute the current marketing-comps memo across all comped tenants.
 * @returns {Promise<{count:number, monthlyRate:number, totalValue:number, lines:Array}>}
 */
export async function computeMarketingComps(now = new Date()) {
  const slab = getSlabDb();
  // Comped = lifetime plan (superadmin-assign only) with no real payment, and not
  // the house tenant itself (you don't comp your own books).
  const tenants = await slab.collection('tenants').find(
    {
      'meta.plan': 'lifetime',
      'meta.stripeSessionId': { $in: [null, undefined] },
      'meta.paypalCaptureId': { $in: [null, undefined] },
      db: { $ne: HOUSE_DB },
    },
    { projection: { domain: 1, 'brand.name': 1, 'meta.plan': 1, 'meta.activatedAt': 1, createdAt: 1 } },
  ).toArray();

  const rate = BASE_MONTHLY;
  const lines = tenants.map((t) => {
    const since = t.meta?.activatedAt || t.createdAt || now;
    const months = Math.max(1, monthsBetween(since, now));
    return {
      domain: t.domain,
      name: t.brand?.name || t.domain,
      plan: t.meta?.plan,
      since,
      months,
      value: +(rate * months).toFixed(2),
    };
  }).sort((a, b) => b.value - a.value);

  const totalValue = +lines.reduce((s, l) => s + l.value, 0).toFixed(2);
  return { count: lines.length, monthlyRate: rate, totalValue, lines };
}
