/**
 * Slab — Platform pricing (single source of truth)
 *
 * Base plan is $39.95/mo. Quarterly billing is 8% off, Annual is 10% off.
 * All amounts here are the CHARGED TOTAL for the access window (`days`), matching
 * the platform's "pay to unlock N days" model (PayPal + Stripe both one-time).
 *
 * Lifetime is NOT publicly offered — it is superadmin-assign only. It is priced
 * high ($2,500) as a failsafe so an accidental exposure/activation can't hand out
 * forever-access for a token amount.
 *
 * Consumed by routes/onboarding.js (checkout) and routes/delegates.js (commission).
 * Change prices HERE — do not re-hardcode amounts elsewhere.
 */

export const BASE_MONTHLY = 39.95;

// Fractional discount off the straight monthly-times-N price.
export const DISCOUNTS = { quarterly: 0.08, annual: 0.10 };

// Free-trial length (days). "Try for free → then pay → then add domain."
export const TRIAL_DAYS = 14;

const round2 = (n) => +n.toFixed(2);

const quarterlyTotal = round2(BASE_MONTHLY * 3 * (1 - DISCOUNTS.quarterly));   // 110.26
const annualTotal    = round2(BASE_MONTHLY * 12 * (1 - DISCOUNTS.annual));     // 431.46
const LIFETIME_PRICE = 2500;                                                   // superadmin-only failsafe

/**
 * Platform plans.
 *   amount   — charged total per billing cycle, as a fixed-2 string (checkout wants strings)
 *   days     — access window granted per cycle; null = no expiry (lifetime)
 *   monthly  — monthly-equivalent gross (used for delegate commission math)
 *   public   — true if shown on the public go-live pricing cards
 *   interval — Stripe recurring interval for subscription checkout:
 *              { unit: 'month'|'year', count: N }. Absent = non-recurring
 *              (trial has no card; lifetime is a one-time superadmin grant).
 *              Quarterly bills as every-3-months so the discounted amount recurs.
 */
export const PLANS = {
  monthly: {
    label: 'Monthly', amount: BASE_MONTHLY.toFixed(2), days: 30,
    monthly: BASE_MONTHLY, public: true,
    interval: { unit: 'month', count: 1 },
  },
  quarterly: {
    label: 'Quarterly', amount: quarterlyTotal.toFixed(2), days: 90,
    monthly: round2(quarterlyTotal / 3), public: true, discount: DISCOUNTS.quarterly,
    interval: { unit: 'month', count: 3 },
  },
  annual: {
    label: 'Annual', amount: annualTotal.toFixed(2), days: 365,
    monthly: round2(annualTotal / 12), public: true, discount: DISCOUNTS.annual,
    interval: { unit: 'year', count: 1 },
  },
  trial: {
    label: 'Free Trial', amount: '0.00', days: TRIAL_DAYS,
    monthly: 0, public: true, trial: true,
  },
  lifetime: {
    label: 'Lifetime', amount: LIFETIME_PRICE.toFixed(2), days: null,
    monthly: 0, public: false, // superadmin-assign only — never a public card
  },
};

// Days after expiry before a lapsed subscription is enforced (read-only).
// Covers Stripe's retry window for a failed charge so a transient decline
// doesn't restrict a paying tenant.
export const BILLING_GRACE_DAYS = 3;

// Sales-delegate commission schedule — % of NET tenant revenue (after owner tax).
// Year 1 = 40%, Year 2 = 20%, Year 3+ = 10% lifetime royalty while subscribed.
export const COMMISSION = { 1: 0.40, 2: 0.20, default: 0.10 };
