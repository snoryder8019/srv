/**
 * plugins/platformLedger.js
 *
 * Routes MadLadsLab's OWN platform revenue into the house tenant's Ledger.
 *
 * When a Slab subscriber pays to go live (Stripe or PayPal — see
 * routes/onboarding.js `/start/stripe-return` and `/start/paypal-return`), the
 * charge lands in MadLadsLab's platform payment accounts. That money is income
 * for the house business, so we post it as an income line in the `madladslab`
 * tenant's ledger (db: slab_madladslab) where it shows up on the P&L against the
 * budget — exactly like invoice-sync does for a normal tenant.
 *
 * Best-effort and idempotent: keyed by the processor transaction id so a
 * re-visited return URL (or a future webhook) never double-posts, and any
 * failure (e.g. the gpu tenant cluster tunnel being down) is swallowed so it
 * can never break payment activation.
 */
import { getSlabDb, getTenantDb } from './mongo.js';
import { seedDefaultCategoriesIfEmpty } from './ledgerHelpers.js';

// House tenant that owns the platform books.
const HOUSE_DB = 'slab_madladslab';
const HOUSE_SUBDOMAIN = 'madladslab';

// Dedicated income account so platform MRR is distinct from client Sales (4000).
const SUB_CATEGORY = { name: 'Platform Subscriptions', type: 'income', group: 'Revenue', code: '4020' };

/** Resolve the house tenant's database on its physical cluster. */
async function houseDb() {
  const slab = getSlabDb();
  const t = await slab.collection('tenants').findOne(
    { $or: [{ db: HOUSE_DB }, { 'meta.subdomain': HOUSE_SUBDOMAIN }] },
    { projection: { db: 1, dbHost: 1 } },
  );
  return getTenantDb(t?.db || HOUSE_DB, t?.dbHost);
}

/** Find (or create) the "Platform Subscriptions" income category; returns its _id. */
async function subscriptionCategoryId(db) {
  await seedDefaultCategoriesIfEmpty(db);
  const col = db.collection('gl_categories');
  const existing = await col.findOne({ type: 'income', $or: [{ code: SUB_CATEGORY.code }, { name: SUB_CATEGORY.name }] });
  if (existing) return existing._id;
  const now = new Date();
  const sort = await col.countDocuments({ type: 'income' });
  const ins = await col.insertOne({ ...SUB_CATEGORY, archived: false, sort, createdAt: now, updatedAt: now });
  return ins.insertedId;
}

/**
 * Post a paid Slab subscription into the madladslab ledger as income.
 *
 * @param {object} p
 * @param {'stripe'|'paypal'} p.processor
 * @param {string} p.txnId              — Stripe session id / PayPal capture id (idempotency key)
 * @param {number} p.amount             — dollars actually charged (>0)
 * @param {string} [p.plan]             — plan key (monthly|quarterly|annual|lifetime)
 * @param {string} [p.subscriberDomain] — the tenant that paid
 * @param {string} [p.subscriberEmail]
 * @param {Date|string} [p.paidAt]
 * @returns {Promise<{ok:boolean, inserted?:boolean, reason?:string}>}
 */
export async function recordPlatformSubscriptionRevenue({
  processor, txnId, amount, plan, subscriberDomain, subscriberEmail, paidAt,
}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'zero-amount' };
  if (!txnId) return { ok: false, reason: 'no-txn' };

  try {
    const db = await houseDb();
    const categoryId = await subscriptionCategoryId(db);
    const now = new Date();
    const when = paidAt ? new Date(paidAt) : now;

    const res = await db.collection('ledger_entries').updateOne(
      { source: 'platform-subscription', txnId: String(txnId) },
      {
        $setOnInsert: {
          date: when,
          categoryId,
          amount: amt,
          description: `Slab subscription — ${plan || 'monthly'}${subscriberDomain ? ` (${subscriberDomain})` : ''}`,
          vendor: subscriberDomain || subscriberEmail || 'Slab subscriber',
          tags: ['slab-subscription', String(plan || 'monthly'), String(processor || 'card')],
          source: 'platform-subscription',
          sourceId: String(txnId),
          txnId: String(txnId),
          processor: processor || null,
          planKey: plan || null,
          subscriberDomain: subscriberDomain || null,
          subscriberEmail: subscriberEmail || null,
          createdAt: now,
          createdBy: 'subscription-sync',
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );

    if (res.upsertedId) {
      console.log(`[platformLedger] Posted $${amt.toFixed(2)} ${plan || ''} subscription (${subscriberDomain || subscriberEmail || '?'}) to madladslab ledger`);
    }
    return { ok: true, inserted: !!res.upsertedId };
  } catch (err) {
    console.error('[platformLedger] Could not post subscription revenue:', err.message);
    return { ok: false, reason: err.message };
  }
}
