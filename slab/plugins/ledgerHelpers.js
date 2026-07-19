/**
 * Ledger helpers — the shared math + data shaping behind the Finance ledger.
 *
 * The ledger is a small double-entry-lite system layered on top of the existing
 * bookkeeping/invoicing surface. Three sub-ledgers feed one P&L:
 *
 *   • ledger_entries   — manual income/expense lines + synced paid invoices +
 *                        ad-hoc receipts.
 *   • mileage_log      — business mileage, valued at a per-mile rate.
 *   • utilities_log    — recurring utility bills (electric, internet, …).
 *
 * Every line references a GL category (gl_categories) whose `type`
 * (income | cogs | expense) determines where it lands on the P&L. Budgets are a
 * SEPARATE plan (ledger_budgets): a projected revenue figure plus a percentage
 * per category, so the P&L can show actual-vs-budget variance without the plan
 * ever touching the actuals.
 *
 * Reporting reads from all three sub-ledgers through aggregateActuals() so each
 * one stays a plain, independently-editable CRUD surface — there is no dual
 * write to keep in sync.
 */

// IRS business standard mileage rate ($/mile), 2025. Tenant-overridable in
// ledger_settings; per-entry rate always wins over both.
export const DEFAULT_MILEAGE_RATE = 0.70;

// P&L (income-statement) types, in P&L order. 'labor' and 'fixed' are expense
// classes that sit BELOW gross profit alongside operating expense:
//   Revenue − COGS = Gross Profit;  Gross − Labor − Fixed − Operating = Net.
export const PNL_TYPES = ['income', 'cogs', 'labor', 'fixed', 'expense'];
// Expense-like classes subtracted from gross to reach net (order = P&L order).
export const EXPENSE_TYPES = ['labor', 'fixed', 'expense'];
// Balance-sheet types — NOT part of the P&L. Liabilities live in the 2xxx–3xxx
// code range (e.g. a mortgage/loan principal payment reduces a liability rather
// than being an expense). They're assignable and shown in the accounts manager,
// but excluded from P&L math and budgets.
export const BALANCE_TYPES = ['liability'];
// Every GL type (accounts manager + category pickers). P&L types first, then
// balance-sheet types.
export const GL_TYPES = [...PNL_TYPES, ...BALANCE_TYPES];
export const GL_TYPE_LABELS = {
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  labor: 'Labor',
  fixed: 'Fixed Costs',
  expense: 'Operating Expense',
  liability: 'Liability',
};

// Starting GL code for each type. Codes run sequentially in steps of 10 within
// each type's band (standard chart-of-accounts numbering).
export const GL_CODE_BASE = {
  liability: 2000,
  income: 4000,
  cogs: 5000,
  labor: 5500,
  fixed: 5800,
  expense: 6000,
};
export const GL_CODE_STEP = 10;

// Common utility presets — free text is still allowed, these just seed the picker.
export const UTILITY_TYPES = ['Electric', 'Gas', 'Water', 'Internet', 'Phone', 'Trash', 'Sewer', 'Other'];

// A sensible starter chart of accounts, seeded once on first visit if the tenant
// has none. Users are expected to edit/extend this to fit their business.
export const DEFAULT_CATEGORIES = [
  { name: 'Sales',                  type: 'income',  group: 'Revenue',            code: '4000' },
  { name: 'Service Revenue',        type: 'income',  group: 'Revenue',            code: '4010' },
  { name: 'Materials',              type: 'cogs',    group: 'Cost of Goods Sold', code: '5000' },
  { name: 'Subcontractors',         type: 'cogs',    group: 'Cost of Goods Sold', code: '5010' },
  { name: 'Management Salary',      type: 'labor',   group: 'Labor',              code: '5500' },
  { name: 'Payroll & Employer Taxes (W-2)', type: 'labor', group: 'Labor',       code: '5510' },
  { name: 'Mortgage',               type: 'fixed',   group: 'Fixed Costs',        code: '5800' },
  { name: 'Rent',                   type: 'fixed',   group: 'Fixed Costs',        code: '5810' },
  { name: 'Utilities',              type: 'expense', group: 'Facilities',         code: '6010' },
  { name: 'Software & Subscriptions', type: 'expense', group: 'Operating',        code: '6100' },
  { name: 'Marketing & Advertising', type: 'expense', group: 'Operating',         code: '6200' },
  { name: 'Mileage & Vehicle',      type: 'expense', group: 'Operating',          code: '6300' },
  { name: 'Office Supplies',        type: 'expense', group: 'Operating',          code: '6400' },
  { name: 'Professional Fees',      type: 'expense', group: 'Operating',          code: '6500' },
  { name: 'Bank & Merchant Fees',   type: 'expense', group: 'Operating',          code: '6600' },
  // Liabilities (balance sheet, 2xxx–3xxx) — not on the P&L.
  { name: 'Credit Card Payable',    type: 'liability', group: 'Liabilities',      code: '2000' },
  { name: 'Loan Payable',           type: 'liability', group: 'Liabilities',      code: '2100' },
  { name: 'Mortgage Payable',       type: 'liability', group: 'Liabilities',      code: '2200' },
  { name: 'Sales Tax Payable',      type: 'liability', group: 'Liabilities',      code: '2300' },
];

/** Seed the default chart of accounts the first time a tenant opens the ledger. */
export async function seedDefaultCategoriesIfEmpty(db) {
  const count = await db.collection('gl_categories').countDocuments();
  if (count > 0) return false;
  const now = new Date();
  await db.collection('gl_categories').insertMany(
    DEFAULT_CATEGORIES.map((c, i) => ({
      ...c, archived: false, sort: i, createdAt: now, updatedAt: now,
    })),
  );
  return true;
}

/** Tenant ledger settings (mileage rate, default income category for invoice sync). */
export async function getSettings(db) {
  const doc = await db.collection('ledger_settings').findOne({ _id: 'settings' });
  return {
    mileageRate: DEFAULT_MILEAGE_RATE,
    defaultIncomeCategoryId: null,
    ...(doc || {}),
  };
}

/** Load active (non-archived) categories, ordered for display. */
export async function listCategories(db, { includeArchived = false } = {}) {
  const q = includeArchived ? {} : { archived: { $ne: true } };
  return db.collection('gl_categories').find(q)
    .sort({ type: 1, sort: 1, name: 1 }).toArray();
}

// ── Period math ──────────────────────────────────────────────────────────────

/** 'YYYY-MM' key for a date (defaults to now). */
export function monthKey(d = new Date()) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** [start, end) Date range for a 'YYYY-MM' key. */
export function monthRange(key) {
  const [y, m] = String(key).split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/** Human label for a 'YYYY-MM' key, e.g. "March 2026". */
export function monthLabel(key) {
  return monthRange(key).start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Previous / next month keys (for prev/next navigation). */
export function shiftMonth(key, delta) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

/** 1–4 for the quarter containing a date. */
export function quarterOf(d = new Date()) {
  return Math.floor(new Date(d).getMonth() / 3) + 1;
}

/** [start, end) Date range for a given year + quarter (1–4). */
export function quarterRange(year, q) {
  const startMonth = (q - 1) * 3;
  return { start: new Date(year, startMonth, 1), end: new Date(year, startMonth + 3, 1) };
}

// ── Actuals ──────────────────────────────────────────────────────────────────

/**
 * Sum every sub-ledger over [start, end), grouped by GL category.
 * Returns a plain map: { categoryIdString: amount }. Uncategorized lines land
 * under the 'uncategorized' key.
 */
export async function aggregateActuals(db, start, end) {
  const match = { date: { $gte: start, $lt: end } };
  const groupByCat = [
    { $match: match },
    { $group: { _id: '$categoryId', total: { $sum: '$amount' } } },
  ];

  const [entries, mileage, utilities] = await Promise.all([
    db.collection('ledger_entries').aggregate(groupByCat).toArray(),
    db.collection('mileage_log').aggregate(groupByCat).toArray(),
    db.collection('utilities_log').aggregate(groupByCat).toArray(),
  ]);

  const map = {};
  for (const row of [...entries, ...mileage, ...utilities]) {
    const k = row._id ? row._id.toString() : 'uncategorized';
    map[k] = (map[k] || 0) + (row.total || 0);
  }
  return map;
}

// ── Budgets ──────────────────────────────────────────────────────────────────

/** The active budget plan for a year (or the most recent active plan). */
export async function getActiveBudget(db, year = new Date().getFullYear()) {
  return (await db.collection('ledger_budgets').findOne({ year, active: true }))
    || (await db.collection('ledger_budgets').findOne({ active: true }, { sort: { year: -1 } }));
}

/** Projected revenue attributable to a single month under a plan. */
export function revenueForMonth(plan, key) {
  if (!plan) return 0;
  const [, m] = String(key).split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  if (hasQuarterlyRevenue(plan)) return (Number(plan.quarters[q - 1]) || 0) / 3;
  return (Number(plan.projectedRevenue) || 0) / 12;
}

/** Projected revenue for a whole quarter under a plan. */
export function revenueForQuarter(plan, q) {
  if (!plan) return 0;
  if (hasQuarterlyRevenue(plan)) return Number(plan.quarters[q - 1]) || 0;
  return (Number(plan.projectedRevenue) || 0) / 4;
}

function hasQuarterlyRevenue(plan) {
  return Array.isArray(plan?.quarters) && plan.quarters.length === 4
    && plan.quarters.some((v) => Number(v) > 0);
}

// Category types whose budget is a FIXED DOLLAR amount (annual), not a % of
// revenue — fixed costs and salaried labor don't scale with sales.
export const FIXED_BUDGET_TYPES = ['labor', 'fixed'];

/**
 * Budget amounts per category for a given projected-revenue base. A plan line is
 * either { categoryId, pct } (variable — pct% of the per-period revenue base) or
 * { categoryId, amount } (fixed — an ANNUAL dollar figure, spread across the
 * period via periodFraction: 1/12 for a month, 1/4 for a quarter, 1 for a year).
 * Returns { categoryIdString: amount }.
 */
export function budgetMapForRevenue(plan, revenueBase, periodFraction = 1) {
  const map = {};
  if (!plan) return map;
  for (const line of plan.lines || []) {
    if (line.amount != null) {
      map[String(line.categoryId)] = (Number(line.amount) || 0) * periodFraction;
    } else {
      const pct = Number(line.pct) || 0;
      map[String(line.categoryId)] = (Number(revenueBase) || 0) * (pct / 100);
    }
  }
  return map;
}

// ── P&L assembly ─────────────────────────────────────────────────────────────

/**
 * Percent change from a → b, as a signed number, or null when there's no
 * meaningful base (prior is 0). Used for "% vs budget" and "% vs prior period".
 */
export function pctChange(base, value) {
  const b = Number(base) || 0;
  if (b === 0) return null; // no base → caller renders "—" / "new"
  return ((Number(value) || 0) - b) / b * 100;
}

/**
 * Fold categories + an actuals map + a budget map (+ an optional prior-period
 * actuals map) into a grouped P&L:
 *   { sections: { income:[], cogs:[], expense:[] },
 *     totals:   { income:{actual,budget,prev,budgetPct,prevPct}, … },
 *     gross:    { actual, budget, prev, budgetPct, prevPct },
 *     net:      { … } }
 * Each line is { category, actual, budget, variance, prev, budgetPct, prevPct }.
 *   • variance  — actual − budget, signed (income: + is good; expense: − is good).
 *   • budgetPct — actual as a % of budget (attainment), null when no budget.
 *   • prev      — the same category's actual in the comparison period.
 *   • prevPct   — % change actual vs prev, null when prev is 0.
 */
export function buildPnl(categories, actuals = {}, budget = {}, prior = {}) {
  const sections = {};
  const totals = {};
  for (const t of PNL_TYPES) { sections[t] = []; totals[t] = { actual: 0, budget: 0, prev: 0 }; }

  for (const c of categories) {
    if (!sections[c.type]) continue;
    const id = c._id.toString();
    const actual = actuals[id] || 0;
    const budgeted = budget[id] || 0;
    const prev = prior[id] || 0;
    sections[c.type].push({
      category: c, actual, budget: budgeted, variance: actual - budgeted, prev,
      budgetPct: budgeted ? (actual / budgeted) * 100 : null,
      prevPct: pctChange(prev, actual),
    });
    totals[c.type].actual += actual;
    totals[c.type].budget += budgeted;
    totals[c.type].prev += prev;
  }

  for (const t of Object.values(totals)) {
    t.budgetPct = t.budget ? (t.actual / t.budget) * 100 : null;
    t.prevPct = pctChange(t.prev, t.actual);
  }

  const gross = {
    actual: totals.income.actual - totals.cogs.actual,
    budget: totals.income.budget - totals.cogs.budget,
    prev: totals.income.prev - totals.cogs.prev,
  };
  gross.budgetPct = gross.budget ? (gross.actual / gross.budget) * 100 : null;
  gross.prevPct = pctChange(gross.prev, gross.actual);
  // Net = Gross less every expense class (labor, fixed, operating).
  const sumExp = (k) => EXPENSE_TYPES.reduce((s, t) => s + totals[t][k], 0);
  const net = {
    actual: gross.actual - sumExp('actual'),
    budget: gross.budget - sumExp('budget'),
    prev: gross.prev - sumExp('prev'),
  };
  net.budgetPct = net.budget ? (net.actual / net.budget) * 100 : null;
  net.prevPct = pctChange(net.prev, net.actual);
  return { sections, totals, gross, net };
}

/**
 * Normalize a messy bank/receipt description into a stable "merchant key" so we
 * can learn how a merchant is usually categorized. Strips bank boilerplate
 * ("Purchase authorized on MM/DD", card refs, long digit runs, punctuation) and
 * keeps the first couple of significant words. Same merchant → same key.
 *   "Purchase authorized on 06/04 Safeway Fuel2918 Greeley CO S35… Card 0231" → "safeway fuel"
 *   "Recurring Payment authorized on 06/23 Anthropic* Claude"                  → "anthropic claude"
 * Returns '' when nothing meaningful remains.
 */
export function merchantKey(desc) {
  let s = String(desc || '').toLowerCase();
  s = s
    .replace(/\b(purchase|recurring payment|money transfer|online transfer|mobile deposit|paypal purchase|paypal inst xfer|ach xfer|zelle (from|to))\b/g, ' ')
    .replace(/\bauthorized on \d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\bon \d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\bcard\s*\d+/g, ' ')
    .replace(/\bref\s*#?\s*\w+/g, ' ')
    .replace(/\b[a-z]?\d{6,}\b/g, ' ') // card ref codes / long numeric ids
    .replace(/\b\d{2,}\b/g, ' ')       // stray numbers
    .replace(/[^a-z ]+/g, ' ')          // punctuation & digits glued to words
    .replace(/\s+/g, ' ')
    .trim();
  const stop = new Set(['the', 'inc', 'llc', 'co', 'com', 'st', 'of', 'and']);
  const words = s.split(' ').filter((w) => w.length > 1 && !stop.has(w));
  return words.slice(0, 2).join(' ').slice(0, 40);
}

/** Uniform 2-dp money string. */
export function money(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
