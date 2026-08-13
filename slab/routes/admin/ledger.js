/**
 * Admin — Ledger, Budgeting & P&L  (mounted at /admin/ledger)
 *
 * Surfaces (rendered as TABS on one Finance page — see views/admin/ledger/_tabs):
 *   /                       → P&L review (month or quarter) with budget variance
 *   /entries                → monthly ledger; add lines, tags, receipts, sync invoices
 *   /scan                   → AI receipt/invoice scanner → human-approved entries
 *   /budget                 → budget editor (projected revenue + % per category)
 *   /categories             → GL category (chart of accounts) manager
 *   /mileage                → mileage log (miles × rate → deductible expense)
 *   /utilities              → utilities log (recurring bills, optional receipt)
 *
 * Exports: /export(.xlsx|.csv) for P&L and /budget/export(.xlsx|.csv) for the
 * budget produce a print-ready financial spreadsheet. All export routes sit
 * behind the same `ledger` feature permission as the rest of /admin/ledger.
 *
 * Receipts are stored PRIVATELY in S3 and streamed back only through the authed
 * /…/receipt routes. All money is positive; a line's GL category type decides
 * its P&L placement.
 */
import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { uploadPrivateBuffer, getObjectStream, deleteObject } from '../../plugins/s3.js';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { callVisionLLM, callLLM } from '../../plugins/agentMcp.js';
import { extractPdfText } from '../../plugins/pdfText.js';
import { STATEMENT_FORMATS, detectStatementFormat, findStatementFormat } from '../../plugins/statementFormats.js';
import {
  GL_TYPES, PNL_TYPES, BALANCE_TYPES, GL_TYPE_LABELS, UTILITY_TYPES, DEFAULT_MILEAGE_RATE,
  seedDefaultCategoriesIfEmpty, getSettings, listCategories,
  monthKey, monthRange, monthLabel, shiftMonth, quarterOf, quarterRange,
  aggregateActuals, getActiveBudget, revenueForMonth, revenueForQuarter,
  budgetMapForRevenue, buildPnl, money, merchantKey, FIXED_BUDGET_TYPES,
  GL_CODE_BASE, GL_CODE_STEP,
} from '../../plugins/ledgerHelpers.js';
import {
  buildPnlRows, buildBudgetRows, rowsToCsv, pnlXlsxBuffer, budgetXlsxBuffer,
} from '../../plugins/ledgerExport.js';
import { computeMarketingComps } from '../../plugins/platformComps.js';

const router = express.Router();

// Receipts: small, in-memory, streamed straight to private S3.
const RECEIPT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
]);
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, RECEIPT_TYPES.has(file.mimetype)),
});

// Bank statements: PDF only, larger (multi-page), still in-memory → private S3.
const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// ── helpers ──────────────────────────────────────────────────────────────────

const flash = (res, path, kind, msg) => res.redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
const oid = (v) => { try { return new ObjectId(v); } catch { return null; } };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// Coerce an AI/string money value ("$1,234.50") to a number.
const moneyNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const parseTags = (v) => String(v || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);

// Parse a <input type=date> (or fall back to now) into a Date at local midnight.
function parseDate(v) {
  if (!v) return new Date();
  const [y, m, d] = String(v).split('-').map(Number);
  if (!y || !m || !d) return new Date(v) || new Date();
  return new Date(y, m - 1, d);
}
const dateInput = (d) => new Date(d).toISOString().slice(0, 10);

function categoryMap(categories) {
  const m = {};
  for (const c of categories) m[c._id.toString()] = c;
  return m;
}

// Distinct, sorted, non-empty tags across ledger entries (for filter + datalist).
async function distinctTags(db) {
  const t = await db.collection('ledger_entries').distinct('tags').catch(() => []);
  return (t || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// Export permission gate. The route is already behind the `ledger` feature via
// the admin middleware; this also honors a finer 'ledger_export' grant once the
// role builder can issue it. Owners and unrestricted admins always pass.
function canExport(req) {
  if (req.isOwner || req.isSuperAdmin) return true;
  const perms = req.userPermissions || [];
  if (!perms.length) return true; // unrestricted
  return perms.includes('ledger') || perms.includes('ledger_export');
}

async function streamReceipt(res, key, filename) {
  if (!key) return res.status(404).send('No receipt');
  try {
    const obj = await getObjectStream(key);
    if (obj.ContentType) res.type(obj.ContentType);
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));
    res.set('Content-Disposition', `inline; filename="${(filename || 'receipt').replace(/[^\w.\- ]+/g, '_')}"`);
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[ledger] receipt stream error:', err.message);
    res.status(404).send('Receipt not found');
  }
}

async function saveReceipt(req, folder) {
  if (!req.file || !req.file.buffer?.length) return {};
  const up = await uploadPrivateBuffer(req.file.buffer, {
    prefix: req.tenant?.s3Prefix,
    folder,
    name: req.file.originalname,
    contentType: req.file.mimetype,
  });
  return {
    receiptKey: up.key,
    receiptName: req.file.originalname,
    receiptType: req.file.mimetype,
    receiptSize: req.file.size,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// P&L REVIEW  — GET /admin/ledger  (?month=YYYY-MM  |  ?mode=quarter&year&q)
// ══════════════════════════════════════════════════════════════════════════════
async function loadPnl(db, query) {
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const mode = query.mode === 'quarter' ? 'quarter' : 'month';
  const now = new Date();

  // Comparison basis: 'prev' = the period immediately before, 'year' = the same
  // period one year ago. Drives the "vs prior" column + headline deltas.
  const compareMode = query.compare === 'year' ? 'year' : 'prev';

  let start, end, label, revenueBase, mKey, year, q;
  let cmpStart, cmpEnd, compareLabel;
  if (mode === 'quarter') {
    year = parseInt(query.year, 10) || now.getFullYear();
    q = Math.min(4, Math.max(1, parseInt(query.q, 10) || quarterOf(now)));
    ({ start, end } = quarterRange(year, q));
    label = `Q${q} ${year}`;
    if (compareMode === 'year') {
      ({ start: cmpStart, end: cmpEnd } = quarterRange(year - 1, q));
      compareLabel = `Q${q} ${year - 1}`;
    } else {
      const pq = q === 1 ? 4 : q - 1;
      const py = q === 1 ? year - 1 : year;
      ({ start: cmpStart, end: cmpEnd } = quarterRange(py, pq));
      compareLabel = `Q${pq} ${py}`;
    }
  } else {
    mKey = query.month || monthKey(now);
    ({ start, end } = monthRange(mKey));
    label = monthLabel(mKey);
    year = start.getFullYear();
    const cmpKey = compareMode === 'year' ? shiftMonth(mKey, -12) : shiftMonth(mKey, -1);
    ({ start: cmpStart, end: cmpEnd } = monthRange(cmpKey));
    compareLabel = monthRange(cmpKey).start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  const [actuals, prior, plan] = await Promise.all([
    aggregateActuals(db, start, end),
    aggregateActuals(db, cmpStart, cmpEnd),
    getActiveBudget(db, year),
  ]);
  revenueBase = mode === 'quarter' ? revenueForQuarter(plan, q) : revenueForMonth(plan, mKey);
  const periodFraction = mode === 'quarter' ? 1 / 4 : 1 / 12;
  const budget = budgetMapForRevenue(plan, revenueBase, periodFraction);
  const pnl = buildPnl(categories, actuals, budget, prior);
  return { pnl, mode, label, mKey, year, q: q || quarterOf(now), plan, compareMode, compareLabel, start, end };
}

// The transactions composing each category's actual over [start, end), keyed by
// category-id string — powers the P&L drill-down modal (review what's in a number).
async function pnlLineItemsByCategory(db, start, end) {
  const range = { date: { $gte: start, $lt: end } };
  const [entries, mileage, utilities] = await Promise.all([
    db.collection('ledger_entries').find(range).sort({ date: 1 }).toArray(),
    db.collection('mileage_log').find(range).sort({ date: 1 }).toArray(),
    db.collection('utilities_log').find(range).sort({ date: 1 }).toArray(),
  ]);
  const map = {};
  const push = (catId, item) => {
    const k = catId ? String(catId) : 'uncategorized';
    (map[k] = map[k] || []).push(item);
  };
  for (const e of entries) push(e.categoryId, {
    date: e.date, amount: e.amount || 0,
    description: e.description || e.vendor || '—',
    source: e.source || 'manual',
    receiptUrl: e.receiptKey ? `/admin/ledger/entries/${e._id}/receipt` : null,
  });
  for (const t of mileage) push(t.categoryId, {
    date: t.date, amount: t.amount || 0,
    description: `Mileage: ${t.miles || 0} mi${t.purpose ? ' · ' + t.purpose : ''}`,
    source: 'mileage', receiptUrl: null,
  });
  for (const u of utilities) push(u.categoryId, {
    date: u.date, amount: u.amount || 0,
    description: `${u.utilityType || 'Utility'}${u.provider ? ' · ' + u.provider : ''}`,
    source: 'utility',
    receiptUrl: u.receiptKey ? `/admin/ledger/utilities/${u._id}/receipt` : null,
  });
  return map;
}

router.get('/', async (req, res) => {
  const { pnl, mode, label, mKey, year, q, plan, compareMode, compareLabel, start, end } = await loadPnl(req.db, req.query);
  const now = new Date();
  const lineItems = await pnlLineItemsByCategory(req.db, start, end);

  // madladslab-only: a NON-CASH "marketing comps" memo — the list-price value of
  // premium access given away (comped lifetime tenants). Informational; never
  // posts a ledger entry, so cash P&L totals are untouched.
  let compsMemo = null;
  if (req.tenant?.db === 'slab_madladslab' || req.tenant?.meta?.subdomain === 'madladslab') {
    try { compsMemo = await computeMarketingComps(now); }
    catch (e) { console.warn('[ledger] comps memo failed:', e.message); }
  }

  res.render('admin/ledger/pnl', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'pnl',
    pnl, GL_TYPE_LABELS, money,
    lineItems,
    mode, label,
    month: mKey || monthKey(now),
    prevMonth: shiftMonth(mKey || monthKey(now), -1),
    nextMonth: shiftMonth(mKey || monthKey(now), 1),
    year, q,
    compareMode, compareLabel,
    hasPlan: !!plan,
    planName: plan?.name || null,
    canExport: canExport(req),
    compsMemo,
    success: req.query.success, error: req.query.error,
  });
});

// ── P&L export: print-friendly spreadsheet view + .xlsx + .csv ────────────────
router.get('/export', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { pnl, label, compareLabel } = await loadPnl(req.db, req.query);
  const matrix = buildPnlRows(pnl, { GL_TYPE_LABELS, compareLabel });
  res.render('admin/ledger/export-pnl', {
    user: req.adminUser,
    brandName: req.tenant?.brand?.name || 'Business',
    label, matrix, compareLabel,
    query: req.query,
  });
});

router.get('/export.xlsx', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { pnl, label, compareLabel } = await loadPnl(req.db, req.query);
  const buf = await pnlXlsxBuffer(pnl, { label, brandName: req.tenant?.brand?.name, GL_TYPE_LABELS, compareLabel });
  const fname = `PnL_${label.replace(/[^\w]+/g, '_')}.xlsx`;
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(buf);
});

router.get('/export.csv', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { pnl, label, compareLabel } = await loadPnl(req.db, req.query);
  const csv = rowsToCsv(buildPnlRows(pnl, { GL_TYPE_LABELS, compareLabel }));
  const fname = `PnL_${label.replace(/[^\w]+/g, '_')}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(csv);
});

// ══════════════════════════════════════════════════════════════════════════════
// LEDGER ENTRIES  — monthly list, add line (+tags, +receipt), delete, sync
// ══════════════════════════════════════════════════════════════════════════════
router.get('/entries', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const mKey = req.query.month || monthKey();
  const { start, end } = monthRange(mKey);
  const tag = (req.query.tag || '').trim();

  const q = { date: { $gte: start, $lt: end } };
  if (tag) q.tags = tag;

  const entries = await db.collection('ledger_entries')
    .find(q).sort({ date: -1, createdAt: -1 }).toArray();

  // Income/Expense summary is a P&L tally — balance-sheet lines (liabilities) are
  // excluded so a mortgage/loan principal payment doesn't read as an expense.
  const catMap = categoryMap(categories);
  let income = 0, expense = 0, balance = 0;
  for (const e of entries) {
    const c = catMap[String(e.categoryId)];
    if (c?.type === 'income') income += e.amount || 0;
    else if (c && BALANCE_TYPES.includes(c.type)) balance += e.amount || 0;
    else expense += e.amount || 0; // cogs/labor/fixed/expense + uncategorized
  }

  // Group statement-sourced entries into batches so the ledger can pop a modal
  // showing every line charged from the same bank statement (+ its source PDF).
  const stmtIds = [...new Set(entries
    .filter((e) => e.source === 'statement' && e.sourceId)
    .map((e) => String(e.sourceId)))];
  const statementBatches = {};
  if (stmtIds.length) {
    const objIds = stmtIds.map(oid).filter(Boolean);
    const [batchEntries, stmts] = await Promise.all([
      db.collection('ledger_entries').find({ source: 'statement', sourceId: { $in: objIds } }).sort({ date: 1 }).toArray(),
      db.collection('ledger_statements').find({ _id: { $in: objIds } }).toArray(),
    ]);
    const stmtMap = {};
    for (const s of stmts) stmtMap[String(s._id)] = s;
    for (const be of batchEntries) {
      const k = String(be.sourceId);
      const b = statementBatches[k] || (statementBatches[k] = {
        statementId: k,
        bank: stmtMap[k]?.bank || 'Statement',
        accountLast4: stmtMap[k]?.accountLast4 || '',
        periodStart: stmtMap[k]?.periodStart || null,
        periodEnd: stmtMap[k]?.periodEnd || null,
        hasPdf: !!stmtMap[k]?.receiptKey,
        total: 0,
        entries: [],
      });
      b.entries.push(be);
      b.total += be.amount || 0;
    }
  }

  res.render('admin/ledger/entries', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'entries',
    entries, categories, catMap, GL_TYPE_LABELS,
    statementBatches,
    allTags: await distinctTags(db), activeTagFilter: tag,
    month: mKey, monthLabel: monthLabel(mKey),
    prevMonth: shiftMonth(mKey, -1), nextMonth: shiftMonth(mKey, 1),
    todayInput: dateInput(new Date()),
    totals: { income, expense, net: income - expense },
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.post('/entries', receiptUpload.single('receipt'), async (req, res) => {
  const back = `/admin/ledger/entries?month=${req.body.month || monthKey()}`;
  try {
    const categoryId = oid(req.body.categoryId);
    const amount = num(req.body.amount);
    if (!categoryId) return flash(res, back, 'error', 'Pick a category');
    if (amount <= 0) return flash(res, back, 'error', 'Amount must be greater than zero');

    const receipt = await saveReceipt(req, 'receipts');
    const now = new Date();
    await req.db.collection('ledger_entries').insertOne({
      date: parseDate(req.body.date),
      categoryId,
      amount,
      description: (req.body.description || '').trim().slice(0, 300),
      vendor: (req.body.vendor || '').trim().slice(0, 160),
      tags: parseTags(req.body.tags),
      source: 'manual',
      ...receipt,
      note: (req.body.note || '').trim().slice(0, 2000),
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, back, 'success', 'Entry added');
  } catch (err) {
    console.error('[ledger] add entry error:', err);
    flash(res, back, 'error', 'Could not add entry');
  }
});

router.post('/entries/:id/delete', async (req, res) => {
  const back = `/admin/ledger/entries?month=${req.body.month || monthKey()}`;
  try {
    await req.db.collection('ledger_entries').deleteOne({ _id: oid(req.params.id) });
    flash(res, back, 'success', 'Entry deleted');
  } catch {
    flash(res, back, 'error', 'Delete failed');
  }
});

// Un-charge a statement-sourced entry: delete the ledger entry AND return its
// statement line to private/unposted so it can be re-reviewed. Keeps the
// statement doc consistent (no dangling posted line pointing at a gone entry).
router.post('/entries/:id/uncharge', async (req, res) => {
  const back = `/admin/ledger/entries?month=${req.body.month || monthKey()}`;
  try {
    const db = req.db;
    const e = await db.collection('ledger_entries').findOne({ _id: oid(req.params.id) });
    if (!e) return flash(res, back, 'error', 'Entry not found');
    if (e.source === 'statement' && e.sourceId) {
      await db.collection('ledger_statements').updateOne(
        { _id: e.sourceId, 'lineItems.lid': e.sourceLine },
        { $set: { 'lineItems.$.posted': false, 'lineItems.$.entryId': null, 'lineItems.$.disposition': 'private', 'lineItems.$.categoryId': null, status: 'pending', updatedAt: new Date() } },
      );
    }
    await db.collection('ledger_entries').deleteOne({ _id: e._id });
    flash(res, back, 'success', 'Removed from ledger — the statement line is private again and can be re-reviewed');
  } catch (err) {
    console.error('[ledger] uncharge error:', err);
    flash(res, back, 'error', 'Could not remove entry');
  }
});

// Record a change to a posted entry in the per-period adjustments log (audit
// trail: who changed what, when). Best-effort — never blocks the edit.
async function logAdjustment(db, { entry, field, from, to, delta, user }) {
  try {
    await db.collection('ledger_adjustments').insertOne({
      entryId: entry._id,
      period: monthKey(entry.date || new Date()),
      field,
      from: from == null ? '' : String(from).slice(0, 120),
      to: to == null ? '' : String(to).slice(0, 120),
      delta: (typeof delta === 'number') ? delta : null,
      entryDesc: (entry.description || entry.vendor || '').slice(0, 160),
      amount: entry.amount || 0,
      by: user?.displayName || 'admin',
      byId: user?._id || null,
      at: new Date(),
    });
  } catch (e) { /* audit is best-effort */ }
}

// Recategorize a posted ledger entry — move a GL line to a different account
// without deleting/re-posting it. Logged to the adjustments audit trail.
router.post('/entries/:id/recategorize', async (req, res) => {
  const back = req.body.back || `/admin/ledger/entries?month=${req.body.month || monthKey()}`;
  try {
    const db = req.db;
    const catId = oid(req.body.categoryId);
    if (!catId) return flash(res, back, 'error', 'Pick an account');
    const [entry, cat] = await Promise.all([
      db.collection('ledger_entries').findOne({ _id: oid(req.params.id) }),
      db.collection('gl_categories').findOne({ _id: catId }),
    ]);
    if (!entry) return flash(res, back, 'error', 'Entry not found');
    if (!cat) return flash(res, back, 'error', 'Unknown account');
    if (String(entry.categoryId) === String(catId)) return flash(res, back, 'success', 'No change');
    const oldCat = await db.collection('gl_categories').findOne({ _id: entry.categoryId }).catch(() => null);
    await db.collection('ledger_entries').updateOne(
      { _id: entry._id }, { $set: { categoryId: catId, updatedAt: new Date() } },
    );
    await logAdjustment(db, { entry, field: 'category', from: oldCat?.name || '(uncategorized)', to: cat.name, user: req.adminUser });
    flash(res, back, 'success', `Moved to ${cat.name}`);
  } catch (err) {
    console.error('[ledger] recategorize error:', err);
    flash(res, back, 'error', 'Could not change the account');
  }
});

// Adjust the business allocation % of a posted entry (add or subtract). The entry
// amount is recomputed from its full base (allocationOf, or the current amount at
// 100%); the remainder stays private. Logged to the adjustments audit trail.
router.post('/entries/:id/adjust-allocation', async (req, res) => {
  const back = req.body.back || `/admin/ledger/adjustments?month=${req.body.month || monthKey()}`;
  try {
    const db = req.db;
    const entry = await db.collection('ledger_entries').findOne({ _id: oid(req.params.id) });
    if (!entry) return flash(res, back, 'error', 'Entry not found');
    const base = Number(entry.allocationOf) || Number(entry.amount) || 0;
    const oldPct = Number(entry.allocationPct) || 100;
    const newPct = Math.min(100, Math.max(0, num(req.body.pct)));
    if (!(base > 0)) return flash(res, back, 'error', 'No base amount to allocate');
    if (Math.abs(newPct - oldPct) < 0.001) return flash(res, back, 'success', 'No change');
    const newAmount = Math.round(base * (newPct / 100) * 100) / 100;
    await db.collection('ledger_entries').updateOne({ _id: entry._id }, {
      $set: { amount: newAmount, allocationPct: newPct, allocationOf: base, updatedAt: new Date() },
    });
    await logAdjustment(db, {
      entry, field: 'allocation', from: `${oldPct}%`, to: `${newPct}%`, delta: Math.round((newPct - oldPct) * 100) / 100, user: req.adminUser,
    });
    flash(res, back, 'success', `Allocation ${newPct}% → ${money(newAmount)} (of ${money(base)}).`);
  } catch (err) {
    console.error('[ledger] adjust-allocation error:', err);
    flash(res, back, 'error', 'Could not adjust allocation');
  }
});

// Other slab tenants this user may transfer costs INTO. Owner/superadmin only —
// this writes into another tenant's books, so it's gated hard.
async function accessibleTenants(req) {
  if (!(req.isSuperAdmin || req.isOwner)) return [];
  try {
    const tens = await getSlabDb().collection('tenants')
      .find({}, { projection: { db: 1, dbHost: 1, domain: 1, 'brand.name': 1 } }).toArray();
    const curDb = req.tenant?.db;
    return tens
      .filter((t) => t.db && t.db !== curDb)
      .map((t) => ({ db: t.db, dbHost: t.dbHost || 'atlas', name: t.brand?.name || t.domain || t.db }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('[ledger] accessibleTenants error:', e.message);
    return [];
  }
}

// Transfer a cost to another slab tenant's books (owner/superadmin). MOVES the
// entry: creates the expense in the target tenant under a "Transferred In
// (Intercompany)" account and removes it here, so the cost lands on THEIR P&L and
// isn't double-counted. The move is recorded in this tenant's change log.
router.post('/entries/:id/transfer', async (req, res) => {
  const back = req.body.back || `/admin/ledger/entries?month=${req.body.month || monthKey()}`;
  try {
    if (!(req.isSuperAdmin || req.isOwner)) return flash(res, back, 'error', 'Not permitted to transfer across tenants');
    const db = req.db;
    const entry = await db.collection('ledger_entries').findOne({ _id: oid(req.params.id) });
    if (!entry) return flash(res, back, 'error', 'Entry not found');
    const tenants = await accessibleTenants(req);
    const target = tenants.find((t) => t.db === String(req.body.targetDb || ''));
    if (!target) return flash(res, back, 'error', 'Pick a tenant you have access to');
    if (!(entry.amount > 0)) return flash(res, back, 'error', 'Nothing to transfer');

    const tdb = getTenantDb(target.db, target.dbHost);
    // Find-or-create the intercompany inbound account in the target's chart.
    const catCol = tdb.collection('gl_categories');
    let cat = await catCol.findOne({ type: 'expense', name: 'Transferred In (Intercompany)' });
    if (!cat) {
      const ins = await catCol.insertOne({ name: 'Transferred In (Intercompany)', type: 'expense', group: 'Intercompany', code: '6900', archived: false, sort: 999, createdAt: new Date(), updatedAt: new Date() });
      cat = { _id: ins.insertedId };
    }
    const now = new Date();
    const originBrand = req.tenant?.brand?.name || req.tenant?.db || 'origin';
    await tdb.collection('ledger_entries').insertOne({
      date: entry.date || now,
      categoryId: cat._id,
      amount: entry.amount,
      description: `${entry.description || entry.vendor || 'Cost'} (from ${originBrand})`.slice(0, 300),
      vendor: entry.vendor || '',
      tags: ['transfer-in'],
      source: 'transfer',
      transferFrom: { db: req.tenant?.db || null, brand: originBrand, entryId: String(entry._id) },
      createdAt: now, updatedAt: now, createdBy: req.adminUser?.displayName || 'admin',
    });
    // Audit the move here, then remove the cost from this tenant's books.
    await logAdjustment(db, { entry, field: 'transfer', from: originBrand, to: target.name, user: req.adminUser });
    await db.collection('ledger_entries').deleteOne({ _id: entry._id });
    flash(res, back, 'success', `Transferred ${money(entry.amount)} to ${target.name}'s expenses. Removed here and logged in the change log.`);
  } catch (err) {
    console.error('[ledger] transfer error:', err);
    flash(res, back, 'error', `Could not transfer: ${err.message}`);
  }
});

// ── Adjustments (per period) — review posted lines, tune allocation %, audit ──
router.get('/adjustments', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const mKey = req.query.month || monthKey();
  const { start, end } = monthRange(mKey);
  const [entries, adjustments, transferTenants] = await Promise.all([
    db.collection('ledger_entries').find({ date: { $gte: start, $lt: end } }).sort({ date: 1, createdAt: 1 }).toArray(),
    db.collection('ledger_adjustments').find({ period: mKey }).sort({ at: -1 }).limit(200).toArray(),
    accessibleTenants(req),
  ]);
  res.render('admin/ledger/adjustments', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'adjustments',
    entries, categories, catMap: categoryMap(categories), GL_TYPE_LABELS, money,
    adjustments, transferTenants,
    month: mKey, monthLabel: monthLabel(mKey),
    prevMonth: shiftMonth(mKey, -1), nextMonth: shiftMonth(mKey, 1),
    success: req.query.success, error: req.query.error,
  });
});

router.get('/entries/:id/receipt', async (req, res) => {
  const e = await req.db.collection('ledger_entries').findOne({ _id: oid(req.params.id) });
  return streamReceipt(res, e?.receiptKey, e?.receiptName);
});

// The receipt cross-referenced to this entry as audit proof (distinct from
// receiptKey, which is the file attached when the entry itself was created).
router.get('/entries/:id/receipt-ref', async (req, res) => {
  const e = await req.db.collection('ledger_entries').findOne({ _id: oid(req.params.id) });
  return streamReceipt(res, e?.receiptRef?.key, e?.receiptRef?.name);
});

router.post('/entries/sync-invoices', async (req, res) => {
  const mKey = req.body.month || monthKey();
  const back = `/admin/ledger/entries?month=${mKey}`;
  try {
    const db = req.db;
    const { start, end } = monthRange(mKey);
    const settings = await getSettings(db);
    const categories = await listCategories(db);
    const incomeCat = (settings.defaultIncomeCategoryId
      && categories.find((c) => c._id.toString() === String(settings.defaultIncomeCategoryId)))
      || categories.find((c) => c.type === 'income');
    if (!incomeCat) return flash(res, back, 'error', 'Create an income category first');

    const paid = await db.collection('invoices').find({ status: 'paid' }).toArray();
    let added = 0;
    for (const inv of paid) {
      const paidAt = inv.payments?.[0]?.paidAt || inv.updatedAt || inv.createdAt;
      const when = paidAt ? new Date(paidAt) : null;
      if (!when || when < start || when >= end) continue;
      const exists = await db.collection('ledger_entries').findOne({ source: 'invoice', sourceId: inv._id });
      if (exists) continue;
      const now = new Date();
      await db.collection('ledger_entries').insertOne({
        date: when, categoryId: incomeCat._id, amount: inv.amount || 0,
        description: `Invoice ${inv.invoiceNumber || ''}`.trim(),
        vendor: inv.clientName || '', tags: [],
        source: 'invoice', sourceId: inv._id,
        createdAt: now, updatedAt: now, createdBy: 'invoice-sync',
      });
      added++;
    }
    flash(res, back, 'success', added ? `Synced ${added} paid invoice${added === 1 ? '' : 's'}` : 'No new paid invoices to sync');
  } catch (err) {
    console.error('[ledger] invoice sync error:', err);
    flash(res, back, 'error', 'Invoice sync failed');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AI RECEIPT / INVOICE SCANNER  — extract → PENDING → human approve → entry
// ══════════════════════════════════════════════════════════════════════════════
const EXTRACT_PROMPT = `You are a bookkeeping data-extraction assistant. Read this receipt or invoice image and extract its fields.
Return ONLY a single JSON object, no prose, no markdown fences, exactly these keys:
{"doc_type":"receipt|invoice","vendor":"merchant or biller name","date":"YYYY-MM-DD","total":0,"tax":0,"currency":"USD","invoice_number":"","category":"best-guess expense category","type":"expense|income","summary":"one short line describing the purchase"}
Rules: total and tax are plain numbers (no currency symbols). If a field is unreadable use "" (or 0 for numbers). date must be YYYY-MM-DD. Output JSON only.`;

function parseExtraction(raw) {
  const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* fall through */ }
  // lenient: single→double quotes, strip trailing commas
  try { return JSON.parse(m[0].replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

// Run the vision model over an uploaded image; returns a normalized draft.
async function extractReceiptData(buffer, mimetype) {
  const isImage = /^image\//.test(mimetype || '') && !/heic/i.test(mimetype || '');
  if (!isImage) {
    return { needsManual: true, reason: mimetype === 'application/pdf' ? 'PDF stored — enter fields by hand (vision reads images).' : 'Unsupported for AI — enter fields by hand.' };
  }
  let raw = '';
  try {
    raw = await callVisionLLM(buffer, EXTRACT_PROMPT, 120000);
  } catch (err) {
    return { needsManual: true, reason: 'AI unavailable — enter fields by hand.', rawText: String(err.message || err).slice(0, 300) };
  }
  const p = parseExtraction(raw);
  if (!p) return { needsManual: true, reason: 'Could not read the document — enter fields by hand.', rawText: raw.slice(0, 800) };
  return {
    needsManual: false,
    docType: /invoice/i.test(p.doc_type) ? 'invoice' : 'receipt',
    vendor: String(p.vendor || '').slice(0, 160),
    date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : '',
    total: moneyNum(p.total),
    tax: moneyNum(p.tax),
    currency: String(p.currency || 'USD').slice(0, 8),
    invoiceNumber: String(p.invoice_number || '').slice(0, 60),
    categoryGuess: String(p.category || '').slice(0, 80),
    suggestedType: /income/i.test(p.type) ? 'income' : 'expense',
    summary: String(p.summary || '').slice(0, 300),
    rawText: raw.slice(0, 1200),
  };
}

// ── Receipt ↔ transaction cross-reference ────────────────────────────────────
// A receipt is DOCUMENTATION, not a transaction. The bank statement is the book
// of record, so an approved receipt normally cross-references the statement line
// (or the ledger entry that line already posted) and files itself there as audit
// proof — it does NOT create a second ledger row, which would double-count the
// spend. Posting a receipt as its own ledger entry is the rare cash /
// out-of-pocket path and has to be chosen explicitly.
//
// A receipt that matches nothing simply stays in the pending queue — it never
// posts on its own. Uploading the statement it belongs to makes it matchable.
const MATCH_WINDOW_DAYS = 21;

const dayGap = (a, b) => (a && b ? Math.abs(new Date(a) - new Date(b)) / 86400000 : null);

// 1 = to the penny, 0 = outside tolerance (2% of the receipt total, min $1).
function amountScore(receiptTotal, lineAmount) {
  const diff = Math.abs(receiptTotal - lineAmount);
  if (diff < 0.005) return 1;
  const tol = Math.max(1, receiptTotal * 0.02);
  return diff > tol ? 0 : 1 - diff / tol;
}

// Fuzzy merchant agreement via the same normalization the vendor rules learn on.
function vendorScore(a, b) {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const wa = new Set(ka.split(' '));
  const wb = kb.split(' ');
  const hits = wb.filter((w) => wa.has(w)).length;
  return hits ? hits / Math.max(wa.size, wb.length) : 0;
}

// Rank the transactions this receipt could belong to: every statement line
// (posted or still in review) plus non-statement ledger entries. Amount is the
// strong signal, date proximity next, merchant text last. Statement-sourced
// entries are reached through their line — matching the line stamps both.
async function findReceiptMatches(db, scan, limit = 6) {
  const total = moneyNum(scan.total);
  if (!(total > 0)) return [];
  const vendorText = [scan.vendor, scan.summary].filter(Boolean).join(' ');
  const out = [];
  const consider = (cand) => {
    const amt = amountScore(total, cand.amount);
    if (!amt) return;
    const gap = dayGap(scan.date, cand.date);
    if (gap != null && gap > MATCH_WINDOW_DAYS) return;
    const dscore = gap == null ? 0.3 : 1 - gap / MATCH_WINDOW_DAYS;
    out.push({
      ...cand,
      exact: amt === 1,
      score: amt * 0.6 + dscore * 0.25 + vendorScore(vendorText, cand.description) * 0.15,
    });
  };

  const [stmts, entries] = await Promise.all([
    db.collection('ledger_statements')
      .find({ status: { $in: ['pending', 'posted'] } }).sort({ createdAt: -1 }).limit(24).toArray(),
    db.collection('ledger_entries')
      .find({ source: { $ne: 'statement' }, receiptRef: { $exists: false } })
      .sort({ date: -1 }).limit(400).toArray(),
  ]);

  for (const s of stmts) {
    for (const l of s.lineItems || []) {
      if (l.receiptRef?.scanId) continue; // already documented by another receipt
      consider({
        ref: `stmt:${s._id}:${l.lid}`,
        kind: 'line',
        date: l.date ? parseDate(l.date) : (s.periodEnd || null),
        amount: Math.abs(moneyNum(l.amount)),
        description: l.description || '',
        posted: !!l.posted,
        context: `${s.bank || 'Statement'}${s.accountLast4 ? ` ••••${s.accountLast4}` : ''}`,
      });
    }
  }
  for (const e of entries) {
    consider({
      ref: `entry:${e._id}`,
      kind: 'entry',
      date: e.date,
      amount: Math.abs(moneyNum(e.amount)),
      description: e.description || e.vendor || '',
      posted: true,
      context: 'Ledger entry',
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// The audit stamp a matched receipt leaves on the line/entry it documents.
const receiptRefOf = (scan, req) => ({
  scanId: scan._id,
  key: scan.receiptKey || null,
  name: scan.receiptName || null,
  type: scan.receiptType || null,
  vendor: scan.vendor || '',
  total: moneyNum(scan.total) || 0,
  matchedAt: new Date(),
  matchedBy: req.adminUser?.displayName || 'admin',
});

router.get('/scan', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const [categories, pending, recent] = await Promise.all([
    listCategories(db),
    db.collection('ledger_scans').find({ status: 'pending' }).sort({ createdAt: -1 }).toArray(),
    db.collection('ledger_scans').find({ status: { $in: ['matched', 'approved', 'rejected'] } }).sort({ reviewedAt: -1 }).limit(15).toArray(),
  ]);
  // Candidate transactions per pending receipt — the default resolution is a
  // cross-reference, so the queue leads with what each receipt likely documents.
  const matches = {};
  for (const s of pending) {
    matches[String(s._id)] = await findReceiptMatches(db, s).catch(() => []);
  }
  res.render('admin/ledger/scan', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'scan',
    categories, catMap: categoryMap(categories),
    pending, recent, matches,
    allTags: await distinctTags(db),
    todayInput: dateInput(new Date()),
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.post('/scan', receiptUpload.single('receipt'), async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    if (!req.file?.buffer?.length) return flash(res, back, 'error', 'Choose a receipt or invoice file');
    const receipt = await saveReceipt(req, 'scans');
    const extracted = await extractReceiptData(req.file.buffer, req.file.mimetype);
    const now = new Date();
    await req.db.collection('ledger_scans').insertOne({
      status: 'pending',
      ...receipt,
      docType: extracted.docType || 'receipt',
      vendor: extracted.vendor || '',
      date: extracted.date ? parseDate(extracted.date) : null,
      total: extracted.total || 0,
      tax: extracted.tax || 0,
      currency: extracted.currency || 'USD',
      invoiceNumber: extracted.invoiceNumber || '',
      categoryGuess: extracted.categoryGuess || '',
      suggestedType: extracted.suggestedType || 'expense',
      summary: extracted.summary || '',
      lineItems: [],
      rawText: extracted.rawText || '',
      needsManual: !!extracted.needsManual,
      aiNote: extracted.reason || '',
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, back, 'success', extracted.needsManual
      ? 'Uploaded — the AI couldn\u2019t auto-read it, so fill the fields and approve.'
      : 'Scanned! Review the extracted details below, then approve.');
  } catch (err) {
    console.error('[ledger] scan error:', err);
    flash(res, back, 'error', 'Scan failed — try again or add the entry manually.');
  }
});

// Cross-reference a receipt onto the transaction it documents. Nothing posts —
// the statement line (and, if it already posted, its ledger entry) simply gains
// the receipt as proof. This is the normal way a receipt is resolved.
router.post('/scan/:id/match', async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    const db = req.db;
    const scan = await db.collection('ledger_scans').findOne({ _id: oid(req.params.id) });
    if (!scan || scan.status !== 'pending') return flash(res, back, 'error', 'Scan not found or already handled');

    const ref = String(req.body.ref || '').trim();
    const mStmt = /^stmt:([a-f\d]{24}):([\w-]+)$/i.exec(ref);
    const mEntry = /^entry:([a-f\d]{24})$/i.exec(ref);
    if (!mStmt && !mEntry) return flash(res, back, 'error', 'Pick a transaction to cross-reference this receipt to');

    const now = new Date();
    const rr = receiptRefOf(scan, req);
    let label = '';

    if (mStmt) {
      const stmtId = oid(mStmt[1]);
      const stmt = await db.collection('ledger_statements').findOne({ _id: stmtId });
      const line = (stmt?.lineItems || []).find((l) => l.lid === mStmt[2]);
      if (!line) return flash(res, back, 'error', 'That statement line no longer exists');
      await db.collection('ledger_statements').updateOne(
        { _id: stmtId, 'lineItems.lid': line.lid },
        { $set: { 'lineItems.$.receiptRef': rr, updatedAt: now } },
      );
      // Already on the books → stamp the entry too, so the ledger carries the proof.
      if (line.entryId) {
        await db.collection('ledger_entries').updateOne({ _id: line.entryId }, { $set: { receiptRef: rr, updatedAt: now } });
      }
      // The line's own categorization teaches us how this receipt's merchant is charged.
      if (line.categoryId) {
        await learnVendor(db, { description: scan.vendor || scan.summary, categoryId: line.categoryId, disposition: line.disposition, allocPct: line.allocPct });
      }
      label = `${(line.description || 'statement line').slice(0, 80)} · ${money(line.amount)}`;
    } else {
      const entryId = oid(mEntry[1]);
      const entry = await db.collection('ledger_entries').findOne({ _id: entryId });
      if (!entry) return flash(res, back, 'error', 'That ledger entry no longer exists');
      await db.collection('ledger_entries').updateOne({ _id: entryId }, { $set: { receiptRef: rr, updatedAt: now } });
      if (entry.categoryId) {
        await learnVendor(db, { description: scan.vendor || scan.summary, categoryId: entry.categoryId, disposition: 'business' });
      }
      label = `${(entry.description || entry.vendor || 'ledger entry').slice(0, 80)} · ${money(entry.amount)}`;
    }

    await db.collection('ledger_scans').updateOne({ _id: scan._id }, {
      $set: {
        status: 'matched', matchRef: ref, matchLabel: label,
        reviewedAt: now, reviewedBy: req.adminUser?.displayName || 'admin', updatedAt: now,
      },
    });
    flash(res, back, 'success', `Cross-referenced to ${label} — filed as proof, nothing posted to the ledger.`);
  } catch (err) {
    console.error('[ledger] scan match error:', err);
    flash(res, back, 'error', 'Could not cross-reference this receipt');
  }
});

// Undo a cross-reference: pull the proof off the line/entry, receipt back to pending.
router.post('/scan/:id/unmatch', async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    const db = req.db;
    const scan = await db.collection('ledger_scans').findOne({ _id: oid(req.params.id) });
    if (!scan || scan.status !== 'matched') return flash(res, back, 'error', 'That receipt is not cross-referenced');
    const now = new Date();
    const mStmt = /^stmt:([a-f\d]{24}):([\w-]+)$/i.exec(scan.matchRef || '');
    const mEntry = /^entry:([a-f\d]{24})$/i.exec(scan.matchRef || '');
    if (mStmt) {
      const stmtId = oid(mStmt[1]);
      const stmt = await db.collection('ledger_statements').findOne({ _id: stmtId });
      const line = (stmt?.lineItems || []).find((l) => l.lid === mStmt[2]);
      await db.collection('ledger_statements').updateOne(
        { _id: stmtId, 'lineItems.lid': mStmt[2] },
        { $unset: { 'lineItems.$.receiptRef': '' }, $set: { updatedAt: now } },
      );
      if (line?.entryId) {
        await db.collection('ledger_entries').updateOne({ _id: line.entryId }, { $unset: { receiptRef: '' }, $set: { updatedAt: now } });
      }
    } else if (mEntry) {
      await db.collection('ledger_entries').updateOne({ _id: oid(mEntry[1]) }, { $unset: { receiptRef: '' }, $set: { updatedAt: now } });
    }
    await db.collection('ledger_scans').updateOne({ _id: scan._id }, {
      $set: { status: 'pending', updatedAt: now },
      $unset: { matchRef: '', matchLabel: '', reviewedAt: '', reviewedBy: '' },
    });
    flash(res, back, 'success', 'Cross-reference removed — the receipt is back in the pending queue');
  } catch (err) {
    console.error('[ledger] scan unmatch error:', err);
    flash(res, back, 'error', 'Could not undo the cross-reference');
  }
});

// RARE path: post a receipt as its own ledger entry. Only correct when the spend
// never hits a bank statement (cash / personal out-of-pocket) — otherwise the
// statement will post the same transaction again and it double-counts.
router.post('/scan/:id/approve', async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    const db = req.db;
    const scan = await db.collection('ledger_scans').findOne({ _id: oid(req.params.id) });
    if (!scan || scan.status !== 'pending') return flash(res, back, 'error', 'Scan not found or already handled');

    const categoryId = oid(req.body.categoryId);
    const amount = num(req.body.amount);
    if (!categoryId) return flash(res, back, 'error', 'Pick a GL category to approve into');
    if (amount <= 0) return flash(res, back, 'error', 'Amount must be greater than zero');

    // Double-count guard: if this receipt lines up with a transaction we already
    // know about, posting it as a second entry is almost always a mistake.
    if (req.body.force !== '1') {
      const dupes = await findReceiptMatches(db, { ...scan, total: amount, date: parseDate(req.body.date) }, 1);
      if (dupes.length && dupes[0].exact) {
        return flash(res, back, 'error', `This receipt matches “${dupes[0].description.slice(0, 60)}” already on record — cross-reference it instead, or tick "post anyway" to force a separate entry.`);
      }
    }

    const now = new Date();
    const entry = {
      date: parseDate(req.body.date),
      categoryId,
      amount,
      description: (req.body.description || scan.summary || '').trim().slice(0, 300),
      vendor: (req.body.vendor || scan.vendor || '').trim().slice(0, 160),
      tags: parseTags(req.body.tags),
      source: 'scan',
      postedFromReceipt: true, // flags this row as a receipt that became a ledger item
      sourceId: scan._id,
      receiptKey: scan.receiptKey || null,
      receiptName: scan.receiptName || null,
      receiptType: scan.receiptType || null,
      receiptSize: scan.receiptSize || null,
      note: (req.body.note || '').trim().slice(0, 2000),
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    };
    const ins = await db.collection('ledger_entries').insertOne(entry);
    await db.collection('ledger_scans').updateOne({ _id: scan._id }, {
      $set: { status: 'approved', entryId: ins.insertedId, reviewedAt: now, reviewedBy: req.adminUser?.displayName || 'admin', updatedAt: now },
    });
    // Learn this vendor → category so statement/receipt reviews pre-fill it.
    await learnVendor(db, { description: entry.vendor || entry.description, categoryId, disposition: 'business' });
    flash(res, back, 'success', 'Posted as its own ledger entry — watch for the same charge on your next statement.');
  } catch (err) {
    console.error('[ledger] scan approve error:', err);
    flash(res, back, 'error', 'Could not approve this scan');
  }
});

router.post('/scan/:id/reject', async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    await req.db.collection('ledger_scans').updateOne(
      { _id: oid(req.params.id), status: 'pending' },
      { $set: { status: 'rejected', reviewedAt: new Date(), reviewedBy: req.adminUser?.displayName || 'admin', updatedAt: new Date() } },
    );
    flash(res, back, 'success', 'Scan rejected');
  } catch {
    flash(res, back, 'error', 'Could not reject');
  }
});

router.post('/scan/:id/delete', async (req, res) => {
  const back = '/admin/ledger/scan';
  try {
    await req.db.collection('ledger_scans').deleteOne({ _id: oid(req.params.id) });
    flash(res, back, 'success', 'Scan deleted');
  } catch {
    flash(res, back, 'error', 'Delete failed');
  }
});

router.get('/scan/:id/receipt', async (req, res) => {
  const s = await req.db.collection('ledger_scans').findOne({ _id: oid(req.params.id) });
  return streamReceipt(res, s?.receiptKey, s?.receiptName);
});

// ══════════════════════════════════════════════════════════════════════════════
// STATEMENT SCANNER  — multi-line bank statement (e.g. Wells Fargo PDF)
//
// A statement PDF is read to text, then every transaction line is extracted into
// a PENDING statement doc. NOTHING posts automatically: a human reviews each line
// and assigns the business purchases to a GL account. Any line left UNASSIGNED is
// treated as PRIVATE — it is never charged to the business ledger. Only lines a
// person explicitly maps to an account become ledger_entries.
//
// This surface deliberately never touches invoices — a future finance agent that
// helps categorize lines must not gain visibility into invoicing/AR.
// ══════════════════════════════════════════════════════════════════════════════
const STATEMENT_PROMPT = `You are a bank-statement data-extraction assistant. You are given the raw text of a bank or credit-card statement (often Wells Fargo). Extract EVERY posted transaction line.
Return ONLY a single JSON object, no prose, no markdown fences, exactly these keys:
{"bank":"issuing bank name","account_last4":"last 4 digits of the account if shown else \\"\\"","period_start":"YYYY-MM-DD","period_end":"YYYY-MM-DD","lines":[{"date":"YYYY-MM-DD","description":"merchant / memo text","amount":0,"direction":"debit|credit"}]}
Rules:
- amount is a plain positive number (no currency symbols, no minus sign).
- direction is "debit" for money OUT (purchases, withdrawals, fees, card payments) and "credit" for money IN (deposits, refunds, incoming transfers).
- If a line shows only MM/DD, use the statement period to fill the year, producing YYYY-MM-DD.
- Skip running-balance rows, subtotals, headers, and summary boxes — only real transactions.
- If nothing can be read, return {"bank":"","account_last4":"","period_start":"","period_end":"","lines":[]}.
Output JSON only.`;

const STMT_TEXT_CAP = 120000; // chars fed to the model; only very long statements truncate

function parseStatementJson(raw) {
  const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* fall through */ }
  try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

// Deterministic BLOCK parser over the PDF text. Real bank statements (verified on
// Wells Fargo Everyday Checking) lay each transaction out as a multi-line block:
//   6/8  Purchase authorized on 06/04 Safeway Fuel2918 Greeley CO   ← date + memo
//   S356155310664747 Card 0231                                      ← card-ref noise
//      12.50                                                        ← amount, own line
// A single-line-only parser catches only the handful of rows that keep date+amount
// together and DROPS the rest — which is why a 60-transaction statement returned
// ~16. So we parse blocks instead:
//   • a block STARTS at a line beginning with a M/D date whose remainder has words
//     (a date line without words is a "Beginning/Ending balance" summary → skip);
//   • its amount is the FIRST money token in the block — on the date line's tail
//     OR the first following non-date line — which is the transaction, not the
//     running "Ending daily balance" that trails it (fixes the $781-vs-$242 bug);
//   • money tokens require cents (\.\d{2}) so reference numbers are ignored.
// Direction is guessed from the memo (Zelle/transfer-from/deposit/etc. = credit,
// everything else = debit) and is freely editable in review.
const STMT_CREDIT_RE = /zelle from|\bfrom amazon\b|money transfer authorized on .*\bfrom\b|stripe transfer|\bmobile deposit\b|\bdeposit\b|refund|reversal|interest (paid|payment)|\bach credit\b/i;

function fallbackParseLines(text, year) {
  const yr = year || new Date().getFullYear();
  const lines = String(text || '').split(/\r?\n/);
  const dateStart = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.*)$/;
  const moneyRe = /-?\$?[\d,]+\.\d{2}/g;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(dateStart);
    if (!m) { i++; continue; }
    const [, mm, dd, yy, rest] = m;
    if (!/[A-Za-z]/.test(rest)) { i++; continue; } // date line, no words → balance summary row
    let tokens = rest.match(moneyRe) || [];
    let j = i + 1;
    while (!tokens.length && j < lines.length && !dateStart.test(lines[j])) {
      const t = lines[j].match(moneyRe);
      if (t) { tokens = t; break; }
      j++;
    }
    if (tokens.length) {
      const n = moneyNum(tokens[0]); // first money token = the transaction amount
      if (n) {
        let y = yr;
        if (yy) y = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
        const date = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const description = rest.replace(moneyRe, '').trim().replace(/\s{2,}/g, ' ').slice(0, 200);
        out.push({
          date,
          description,
          amount: Math.abs(n),
          direction: STMT_CREDIT_RE.test(description) ? 'credit' : 'debit',
        });
      }
    }
    i++;
  }
  return out;
}

function normalizeLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines.map((l, i) => {
    const amount = moneyNum(l.amount);
    return {
      lid: `L${i}`,
      date: (l.date && /^\d{4}-\d{2}-\d{2}$/.test(l.date)) ? l.date : '',
      description: String(l.description || '').trim().slice(0, 200),
      amount: Math.abs(amount),
      direction: /credit/i.test(l.direction) ? 'credit' : 'debit',
      disposition: 'private', // default: unassigned lines are private, never posted
      categoryId: null,
      allocPct: null, // set when disposition==='allocate' — % of amount charged to business
      autoSuggested: false, // true when a learned vendor rule pre-filled this line
      tags: [],
      entryId: null,
      posted: false,
    };
  }).filter((l) => l.amount > 0 || l.description);
}

// Read a statement PDF → { bank, accountLast4, periodStart, periodEnd, lines[], ... }
async function extractStatement(buffer) {
  let text = '';
  let pages = 0;
  try {
    const out = await extractPdfText(buffer);
    text = out.text;
    pages = out.pages;
  } catch (err) {
    return { needsManual: true, aiNote: 'Could not read the PDF (encrypted or scanned image). Re-upload a text PDF.', rawText: '', lineItems: [] };
  }
  if (!text.trim()) {
    return { needsManual: true, aiNote: 'This PDF has no extractable text (likely a scanned image).', rawText: '', lineItems: [] };
  }
  const truncated = text.length > STMT_TEXT_CAP;
  const feed = text.slice(0, STMT_TEXT_CAP);

  let parsed = null;
  try {
    const raw = await callLLM(
      [{ role: 'user', content: `Statement text (pages: ${pages}${truncated ? ', truncated' : ''}):\n\n${feed}` }],
      STATEMENT_PROMPT,
      120000,
      { maxTokens: 12000, temperature: 0 },
    );
    parsed = parseStatementJson(raw);
  } catch (err) {
    console.error('[ledger] statement LLM error:', err.message);
  }

  // Extract by BOTH methods and take the union. The house model tends to
  // under-extract long statements (returns only some rows), while the
  // deterministic parser catches every dated line — merging means we no longer
  // keep a thin partial and silently drop the rest. Dedupe on date+amount+memo.
  const yr = parsed?.period_end ? parseInt(parsed.period_end.slice(0, 4), 10) : undefined;
  const llmLines = normalizeLines(parsed?.lines);
  const textLines = normalizeLines(fallbackParseLines(text, yr));
  // The deterministic block parser handles real statement layouts well; when it
  // produces a solid result it's authoritative (avoids weaker-model noise). Only
  // when it comes up short do we union in the LLM's lines to fill gaps.
  const key = (l) => `${l.date}|${l.amount.toFixed(2)}|${(l.description || '').slice(0, 16).toLowerCase()}`;
  const deterministicWins = textLines.length >= Math.max(5, llmLines.length);
  const sources = deterministicWins ? [textLines] : [textLines, llmLines];
  const seen = new Set();
  const merged = [];
  for (const l of sources.flat()) {
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(l);
  }
  // Re-key lids sequentially so the review form has stable, unique ids.
  let lines = merged.map((l, i) => ({ ...l, lid: `L${i}` }));

  let aiNote = '';
  if (!lines.length) {
    aiNote = 'Could not auto-extract any lines. Add them by hand below, or try re-uploading a text PDF.';
  } else {
    const notes = [];
    if (truncated) notes.push('This statement is long and was truncated for the AI — verify nothing is missing near the end.');
    notes.push('Amounts are read from the transaction column (not the running balance); still, verify each amount and the debit/credit direction. You can edit any line or add missing ones below.');
    aiNote = notes.join(' ');
  }

  // Recognize the bank's statement format (platform-curated registry). `keyed`
  // means we have a validated mapping for this bank; a non-keyed / unrecognized
  // statement is flagged in review so it can be pushed to a ticket for keying.
  const fmt = detectStatementFormat(text);
  const bankGuess = String(parsed?.bank || fmt?.label || '').slice(0, 80);

  return {
    needsManual: !lines.length,
    bank: bankGuess,
    accountLast4: String(parsed?.account_last4 || '').replace(/\D/g, '').slice(-4),
    periodStart: (parsed?.period_start && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_start)) ? parseDate(parsed.period_start) : null,
    periodEnd: (parsed?.period_end && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_end)) ? parseDate(parsed.period_end) : null,
    lineItems: lines,
    formatKey: fmt?.key || '',
    formatLabel: fmt?.label || '',
    keyed: !!(fmt && fmt.keyed),
    aiNote,
    rawText: text.slice(0, 4000),
    pages,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LEARNED CATEGORIZATION  — remember how a merchant is usually charged so future
// statement/receipt reviews pre-fill it. Rules live in `ledger_vendor_rules`
// keyed by a normalized merchant signature, with per-category hit counts.
// ══════════════════════════════════════════════════════════════════════════════
async function learnVendor(db, { description, categoryId, disposition, allocPct }) {
  const key = merchantKey(description);
  if (!key || !categoryId) return;
  const ck = String(categoryId);
  const set = { disposition: (disposition === 'allocate' ? 'allocate' : 'business'), updatedAt: new Date() };
  if (disposition === 'allocate' && allocPct) set.allocPct = Number(allocPct);
  try {
    await db.collection('ledger_vendor_rules').updateOne(
      { _id: key },
      { $inc: { hits: 1, [`counts.${ck}`]: 1 }, $set: set },
      { upsert: true },
    );
  } catch (e) { /* learning is best-effort */ }
}

// Load rules into a lookup: merchantKey → { categoryId (most-charged), disposition, allocPct }.
async function loadVendorRules(db) {
  const rules = await db.collection('ledger_vendor_rules').find({}).toArray().catch(() => []);
  const map = {};
  for (const r of rules) {
    let best = null, bestN = 0;
    for (const [cid, n] of Object.entries(r.counts || {})) if (n > bestN) { bestN = n; best = cid; }
    if (best) map[r._id] = { categoryId: best, disposition: r.disposition || 'business', allocPct: r.allocPct || null };
  }
  return map;
}

// Pre-fill still-private lines from learned rules; flags them autoSuggested so the
// review can highlight them. Never overrides a line already assigned.
function applyVendorRules(lineItems, rules) {
  return (lineItems || []).map((l) => {
    if (l.disposition === 'business' || l.disposition === 'allocate') return l;
    const r = rules[merchantKey(l.description)];
    if (!r) return l;
    return {
      ...l,
      disposition: r.disposition === 'allocate' ? 'allocate' : 'business',
      categoryId: r.categoryId,
      allocPct: r.disposition === 'allocate' ? (r.allocPct || null) : null,
      autoSuggested: true,
    };
  });
}

// ── Statement list + uploader + pending review ────────────────────────────────
router.get('/statements', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const [categories, pending, recent, trashed] = await Promise.all([
    listCategories(db),
    db.collection('ledger_statements').find({ status: 'pending' }).sort({ createdAt: -1 }).toArray(),
    db.collection('ledger_statements').find({ status: { $in: ['posted', 'archived'] } }).sort({ reviewedAt: -1 }).limit(10).toArray(),
    db.collection('ledger_statements_trash').find({}).sort({ trashedAt: -1 }).limit(25).toArray(),
  ]);
  res.render('admin/ledger/statements', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'statements',
    categories, catMap: categoryMap(categories),
    pending, recent, trashed,
    statementFormats: STATEMENT_FORMATS,
    allTags: await distinctTags(db),
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.post('/statements', statementUpload.single('statement'), async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    if (!req.file?.buffer?.length) return flash(res, back, 'error', 'Choose a statement PDF');
    const receipt = await saveReceipt(req, 'statements');
    const ex = await extractStatement(req.file.buffer);
    // Pre-fill lines from what we've learned about these merchants before.
    const rules = await loadVendorRules(req.db);
    const lineItems = applyVendorRules(ex.lineItems || [], rules);
    const autoCount = lineItems.filter((l) => l.autoSuggested).length;
    const now = new Date();
    await req.db.collection('ledger_statements').insertOne({
      status: 'pending',
      ...receipt,
      bank: ex.bank || '',
      accountLast4: ex.accountLast4 || '',
      periodStart: ex.periodStart || null,
      periodEnd: ex.periodEnd || null,
      lineItems,
      lineCount: lineItems.length,
      rawText: ex.rawText || '',
      pages: ex.pages || 0,
      needsManual: !!ex.needsManual,
      formatKey: ex.formatKey || '',
      formatLabel: ex.formatLabel || '',
      keyed: !!ex.keyed,
      formatTicketNumber: null,
      aiNote: ex.aiNote || '',
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, back, 'success', lineItems.length
      ? `Read ${lineItems.length} line${lineItems.length === 1 ? '' : 's'}${autoCount ? ` · ${autoCount} auto-marked from what you've charged before (highlighted)` : ''}. Assign the business purchases below — unassigned lines stay private.`
      : 'Uploaded, but no lines auto-read. Open it below to add lines by hand.');
  } catch (err) {
    console.error('[ledger] statement scan error:', err);
    flash(res, back, 'error', 'Statement scan failed — try again.');
  }
});

// Fold a review-form submission into a statement's lineItems: edit each unposted
// line's fields (date/description/amount/direction + disposition/category),
// honor per-line deletion (del_<lid>=1), and append any manually-added lines
// (newdate[]/newdesc[]/newamt[]/newdir[]/newdisp[]/newcat[]). Posted lines are
// locked. Returns the rebuilt lineItems array.
function applyStatementLineForm(stmt, body) {
  const dateOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const clampPct = (v) => Math.min(100, Math.max(0, num(v)));
  const normDisp = (v) => (v === 'business' || v === 'allocate') ? v : 'private';
  const edited = (stmt.lineItems || []).map((l) => {
    if (l.posted) return l;
    // If the review form wasn't rendered for this line, keep it as stored.
    if (body[`disp_${l.lid}`] == null && body[`amt_${l.lid}`] == null) return l;
    const disp = normDisp(body[`disp_${l.lid}`]);
    return {
      ...l,
      date: body[`date_${l.lid}`] != null ? dateOk(body[`date_${l.lid}`]) : l.date,
      description: body[`desc_${l.lid}`] != null ? String(body[`desc_${l.lid}`]).trim().slice(0, 200) : l.description,
      amount: body[`amt_${l.lid}`] != null ? Math.abs(moneyNum(body[`amt_${l.lid}`])) : l.amount,
      direction: /credit/i.test(body[`dir_${l.lid}`] || l.direction) ? 'credit' : 'debit',
      disposition: disp,
      categoryId: (disp === 'business' || disp === 'allocate') ? oid(body[`cat_${l.lid}`]) : null,
      allocPct: disp === 'allocate' ? clampPct(body[`pct_${l.lid}`]) : null,
      tags: parseTags(body[`tags_${l.lid}`]),
    };
  });
  // Drop lines the reviewer explicitly deleted (never a posted line).
  const kept = edited.filter((l) => l.posted || body[`del_${l.lid}`] !== '1');

  // Append manually-added lines.
  const arr = (v) => (v == null ? [] : [].concat(v));
  const nd = arr(body.newdate); const ndesc = arr(body.newdesc); const namt = arr(body.newamt);
  const ndir = arr(body.newdir); const ndisp = arr(body.newdisp); const ncat = arr(body.newcat); const npct = arr(body.newpct);
  let maxIdx = kept.reduce((mx, l) => { const m = /^L(\d+)$/.exec(l.lid || ''); return m ? Math.max(mx, +m[1]) : mx; }, -1);
  for (let i = 0; i < namt.length; i++) {
    const amount = Math.abs(moneyNum(namt[i]));
    const description = String(ndesc[i] || '').trim().slice(0, 200);
    if (!amount && !description) continue; // skip empty add-rows
    const disp = normDisp(ndisp[i]);
    kept.push({
      lid: `L${++maxIdx}`,
      date: dateOk(nd[i]),
      description,
      amount,
      direction: /credit/i.test(ndir[i]) ? 'credit' : 'debit',
      disposition: disp,
      categoryId: (disp === 'business' || disp === 'allocate') ? oid(ncat[i]) : null,
      allocPct: disp === 'allocate' ? clampPct(npct[i]) : null,
      tags: [],
      entryId: null,
      posted: false,
    });
  }
  return kept;
}

// Save the review — edits, deletions and manual additions — without posting.
router.post('/statements/:id/review', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const stmt = await db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
    if (!stmt || stmt.status !== 'pending') return flash(res, back, 'error', 'Statement not found or already handled');
    const lines = applyStatementLineForm(stmt, req.body);
    await db.collection('ledger_statements').updateOne(
      { _id: stmt._id },
      { $set: { lineItems: lines, lineCount: lines.length, updatedAt: new Date() } },
    );
    flash(res, back, 'success', 'Review saved');
  } catch (err) {
    console.error('[ledger] statement review error:', err);
    flash(res, back, 'error', 'Could not save review');
  }
});

// Post every business-assigned, not-yet-posted line to the ledger. Private lines
// are left untouched — they never reach the books.
router.post('/statements/:id/post', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const stmt = await db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
    if (!stmt || stmt.status !== 'pending') return flash(res, back, 'error', 'Statement not found or already handled');

    const now = new Date();
    // Apply the current review form (edits, deletions, additions) before posting —
    // one click both saves the review and posts the business lines.
    const lines = applyStatementLineForm(stmt, req.body);
    const isBusiness = (l) => l.disposition === 'business' || l.disposition === 'allocate';
    let posted = 0, skipped = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.posted) continue;
      if (!isBusiness(l) || !l.categoryId || !(l.amount > 0)) { skipped++; continue; }

      // Full amount for 'business'; a percentage of it for 'allocate' (the rest
      // stays private — e.g. $2000 mortgage, 50% → $1000 posts to Rent).
      let postAmount = l.amount;
      let description = (l.description || '').slice(0, 300);
      if (l.disposition === 'allocate') {
        const pct = Number(l.allocPct) || 0;
        if (!(pct > 0)) { skipped++; continue; }
        postAmount = Math.round(l.amount * (pct / 100) * 100) / 100;
        if (!(postAmount > 0)) { skipped++; continue; }
        description = `${l.description || ''} (${pct}% of ${money(l.amount)})`.trim().slice(0, 300);
      }

      const entry = {
        date: l.date ? parseDate(l.date) : (stmt.periodEnd || now),
        categoryId: oid(l.categoryId) || l.categoryId,
        amount: postAmount,
        description,
        vendor: (l.description || '').slice(0, 160),
        tags: Array.isArray(l.tags) ? l.tags : [],
        source: 'statement',
        sourceId: stmt._id,
        sourceLine: l.lid,
        direction: l.direction,
        ...(l.disposition === 'allocate' ? { allocationPct: Number(l.allocPct) || 0, allocationOf: l.amount } : {}),
        receiptKey: stmt.receiptKey || null,
        receiptName: stmt.receiptName || null,
        receiptType: stmt.receiptType || null,
        // A receipt cross-referenced during review follows the line onto the books.
        ...(l.receiptRef ? { receiptRef: l.receiptRef } : {}),
        createdAt: now, updatedAt: now,
        createdBy: req.adminUser?.displayName || 'admin',
      };
      const ins = await db.collection('ledger_entries').insertOne(entry);
      lines[i] = { ...l, posted: true, entryId: ins.insertedId };
      posted++;
      // Learn this merchant → category so future statements pre-fill it.
      await learnVendor(db, { description: l.description, categoryId: l.categoryId, disposition: l.disposition, allocPct: l.allocPct });
    }
    // Do NOT auto-close — keep the statement open so you can come back and post
    // more items (posted lines stay locked). Mark it done explicitly when finished.
    const remaining = lines.filter((l) => !l.posted).length;
    await db.collection('ledger_statements').updateOne({ _id: stmt._id }, {
      $set: { lineItems: lines, lineCount: lines.length, updatedAt: now },
    });
    flash(res, back, 'success', posted
      ? `Posted ${posted} line${posted === 1 ? '' : 's'}${skipped ? ` · ${skipped} left private` : ''}. ${remaining} line${remaining === 1 ? '' : 's'} still open — post more anytime, or click “Done reviewing” when finished.`
      : 'No business-assigned lines to post — assign a GL account first.');
  } catch (err) {
    console.error('[ledger] statement post error:', err);
    flash(res, back, 'error', 'Could not post statement lines');
  }
});

// Mark a statement done reviewing → moves it to "Recently handled" (posted lines
// stay on the ledger; remaining lines stay private). Reversible via reopen.
router.post('/statements/:id/done', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    await req.db.collection('ledger_statements').updateOne(
      { _id: oid(req.params.id), status: 'pending' },
      { $set: { status: 'posted', reviewedAt: new Date(), reviewedBy: req.adminUser?.displayName || 'admin', updatedAt: new Date() } },
    );
    flash(res, back, 'success', 'Marked done — reopen it anytime to post more.');
  } catch {
    flash(res, back, 'error', 'Could not mark done');
  }
});

// Reopen a handled/archived statement back into review to post more items.
router.post('/statements/:id/reopen', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    await req.db.collection('ledger_statements').updateOne(
      { _id: oid(req.params.id), status: { $in: ['posted', 'archived'] } },
      { $set: { status: 'pending', updatedAt: new Date() } },
    );
    flash(res, back, 'success', 'Reopened for review — find more items to post below.');
  } catch {
    flash(res, back, 'error', 'Could not reopen');
  }
});

router.post('/statements/:id/archive', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    await req.db.collection('ledger_statements').updateOne(
      { _id: oid(req.params.id), status: 'pending' },
      { $set: { status: 'archived', reviewedAt: new Date(), reviewedBy: req.adminUser?.displayName || 'admin', updatedAt: new Date() } },
    );
    flash(res, back, 'success', 'Statement archived (private — nothing posted)');
  } catch {
    flash(res, back, 'error', 'Could not archive');
  }
});

// Soft-delete: move the whole statement doc into a trash collection AND pull the
// ledger entries it posted back out of the books (stashing them on the trash doc)
// so deleting a statement fully undoes what it charged — recoverably. The private
// S3 PDF is left in place (restore brings the same receiptKey back); it's only
// released on permanent purge.
router.post('/statements/:id/delete', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const stmt = await db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
    if (!stmt) return flash(res, back, 'error', 'Statement not found');
    // The entries this statement posted to the ledger — remove them too.
    const postedEntries = await db.collection('ledger_entries')
      .find({ source: 'statement', sourceId: stmt._id }).toArray();
    await db.collection('ledger_statements_trash').insertOne({
      ...stmt,
      trashedAt: new Date(),
      trashedBy: req.adminUser?.displayName || 'admin',
      prevStatus: stmt.status || 'pending',
      trashedEntries: postedEntries, // stashed so restore can re-post them
    });
    if (postedEntries.length) {
      await db.collection('ledger_entries').deleteMany({ source: 'statement', sourceId: stmt._id });
    }
    await db.collection('ledger_statements').deleteOne({ _id: stmt._id });
    flash(res, back, 'success', postedEntries.length
      ? `Moved to Trash — also pulled ${postedEntries.length} posted line${postedEntries.length === 1 ? '' : 's'} off the ledger. Restore below to bring it all back.`
      : 'Moved to Trash — restore it below if that was a mistake.');
  } catch (err) {
    console.error('[ledger] statement trash error:', err);
    flash(res, back, 'error', 'Delete failed');
  }
});

// Restore a trashed statement back to the active list (its prior status) and
// re-post any ledger entries that were pulled when it was trashed.
router.post('/statements/:id/restore', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const t = await db.collection('ledger_statements_trash').findOne({ _id: oid(req.params.id) });
    if (!t) return flash(res, back, 'error', 'Trashed statement not found');
    const { trashedAt, trashedBy, prevStatus, trashedEntries, ...doc } = t;
    doc.status = prevStatus || 'pending';
    doc.updatedAt = new Date();
    await db.collection('ledger_statements').insertOne(doc);
    let restoredEntries = 0;
    if (Array.isArray(trashedEntries) && trashedEntries.length) {
      try {
        const r = await db.collection('ledger_entries').insertMany(trashedEntries, { ordered: false });
        restoredEntries = r.insertedCount || trashedEntries.length;
      } catch (e) { /* dup _id from a partial prior restore — best-effort */ }
    }
    await db.collection('ledger_statements_trash').deleteOne({ _id: t._id });
    flash(res, back, 'success', restoredEntries
      ? `Statement restored — ${restoredEntries} ledger line${restoredEntries === 1 ? '' : 's'} re-posted.`
      : 'Statement restored');
  } catch (err) {
    console.error('[ledger] statement restore error:', err);
    flash(res, back, 'error', 'Restore failed');
  }
});

// Restore a trashed statement FOR RE-REVIEW: sweep every ledger entry tied to it
// off the books (orphans included), reset its lines to unposted, and bring it back
// as pending so it can be corrected and re-posted. This is the "clean the ledger
// and let me retry" path — distinct from Restore, which re-posts exactly as it was.
router.post('/statements/:id/retry', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const t = await db.collection('ledger_statements_trash').findOne({ _id: oid(req.params.id) });
    if (!t) return flash(res, back, 'error', 'Trashed statement not found');
    const { trashedAt, trashedBy, prevStatus, trashedEntries, ...doc } = t;
    // Pull any ledger entries tied to this statement (stashed or lingering orphans).
    const swept = await db.collection('ledger_entries').deleteMany({ source: 'statement', sourceId: doc._id });
    // Reset every line to unposted/reviewable — keep the amounts/categories so prior
    // review survives, but let them be edited and re-posted.
    doc.lineItems = (doc.lineItems || []).map((l) => ({ ...l, posted: false, entryId: null }));
    doc.status = 'pending';
    doc.lineCount = doc.lineItems.length;
    doc.updatedAt = new Date();
    await db.collection('ledger_statements').insertOne(doc);
    await db.collection('ledger_statements_trash').deleteOne({ _id: t._id });
    flash(res, back, 'success', swept.deletedCount
      ? `Back in review — cleared ${swept.deletedCount} line${swept.deletedCount === 1 ? '' : 's'} off the ledger. Fix the amounts and post again.`
      : 'Back in review — fix the lines and post again.');
  } catch (err) {
    console.error('[ledger] statement retry error:', err);
    flash(res, back, 'error', 'Could not restore for retry');
  }
});

// Permanently remove a trashed statement (release its private PDF) and sweep any
// ledger entries still tied to it (covers statements trashed before entry-stashing
// existed, whose posted lines may still be lingering on the books).
router.post('/statements/:id/purge', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const id = oid(req.params.id);
    const t = await db.collection('ledger_statements_trash').findOne({ _id: id });
    if (t?.receiptKey) { try { await deleteObject(t.receiptKey); } catch (e) { /* best-effort */ } }
    const swept = await db.collection('ledger_entries').deleteMany({ source: 'statement', sourceId: id });
    await db.collection('ledger_statements_trash').deleteOne({ _id: id });
    flash(res, back, 'success', swept.deletedCount
      ? `Permanently deleted — also removed ${swept.deletedCount} lingering ledger line${swept.deletedCount === 1 ? '' : 's'}.`
      : 'Statement permanently deleted');
  } catch (err) {
    console.error('[ledger] statement purge error:', err);
    flash(res, back, 'error', 'Could not permanently delete');
  }
});

// Manually correct the detected bank/issuer on a statement (auto-detect can
// misfire — e.g. a PayPal doc that names Wells Fargo as its funding source).
// Pick a registry format, or 'other' with a free-text bank name.
router.post('/statements/:id/set-format', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const stmt = await db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
    if (!stmt) return flash(res, back, 'error', 'Statement not found');
    const key = String(req.body.formatKey || '');
    const fmt = key ? findStatementFormat(key) : null;
    const bank = fmt ? fmt.label : (String(req.body.bank || '').trim().slice(0, 80) || stmt.bank || '');
    await db.collection('ledger_statements').updateOne({ _id: stmt._id }, {
      $set: {
        formatKey: fmt ? fmt.key : '',
        formatLabel: fmt ? fmt.label : '',
        keyed: !!(fmt && fmt.keyed),
        bank,
        formatOverridden: true,
        updatedAt: new Date(),
      },
    });
    flash(res, back, 'success', fmt ? `Bank set to ${fmt.label}.` : `Marked as ${bank || 'unrecognized'}.`);
  } catch (err) {
    console.error('[ledger] set-format error:', err);
    flash(res, back, 'error', 'Could not update the bank');
  }
});

// File a support ticket to get an unrecognized / not-yet-keyed statement format
// keyed into the platform registry. One ticket per statement (idempotent on
// formatTicketNumber). Mirrors the ticket schema in routes/ticketApi.js.
router.post('/statements/:id/request-format', async (req, res) => {
  const back = '/admin/ledger/statements';
  try {
    const db = req.db;
    const stmt = await db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
    if (!stmt) return flash(res, back, 'error', 'Statement not found');
    if (stmt.formatTicketNumber) return flash(res, back, 'success', `Already requested — ticket ${stmt.formatTicketNumber}.`);

    const counter = await db.collection('ticket_counter').findOneAndUpdate(
      { _id: 'ticket_seq' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
    );
    const seq = counter.seq || counter.value?.seq || 1;
    const ticketNumber = `T-${String(seq).padStart(6, '0')}`;

    const bank = stmt.bank || 'Unknown bank';
    const now = new Date();
    await db.collection('tickets').insertOne({
      ticketNumber,
      subject: `Statement format keying: ${bank}`,
      description: [
        `A statement was uploaded whose bank format is ${stmt.formatKey ? 'recognized but not yet keyed' : 'not recognized'}.`,
        `Detected bank: ${bank}${stmt.accountLast4 ? ` (••••${stmt.accountLast4})` : ''}.`,
        `Format key: ${stmt.formatKey || '(none)'} · lines read: ${stmt.lineCount || 0} · pages: ${stmt.pages || 0}.`,
        `Please validate this bank's column layout and key it into the platform statement-format registry (plugins/statementFormats.js).`,
      ].join('\n'),
      category: 'statement-format',
      priority: 'medium',
      status: 'open',
      submittedBy: {
        type: 'admin',
        userId: req.adminUser?._id || null,
        email: req.adminUser?.email || '',
        displayName: req.adminUser?.displayName || 'admin',
        clientId: null,
      },
      escalated: false, escalatedAt: null, escalatedBy: null, escalationNotes: null,
      tenantDomain: req.tenant?.domain || '',
      tenantDbName: req.tenant?.db || '',
      tenantBrandName: req.tenant?.brand?.name || '',
      attachments: [],
      debugData: { statementId: String(stmt._id), formatKey: stmt.formatKey || '', bank },
      replies: [], assignedTo: null,
      createdAt: now, updatedAt: now, resolvedAt: null,
    });
    await db.collection('ledger_statements').updateOne(
      { _id: stmt._id }, { $set: { formatTicketNumber: ticketNumber, updatedAt: now } },
    );
    flash(res, back, 'success', `Thanks — filed ticket ${ticketNumber} to get ${bank} keyed. You can still review this statement manually now.`);
  } catch (err) {
    console.error('[ledger] request-format error:', err);
    flash(res, back, 'error', 'Could not file the format request');
  }
});

router.get('/statements/:id/file', async (req, res) => {
  const s = await req.db.collection('ledger_statements').findOne({ _id: oid(req.params.id) });
  return streamReceipt(res, s?.receiptKey, s?.receiptName);
});

// ══════════════════════════════════════════════════════════════════════════════
// GL CATEGORIES  — chart of accounts manager
// ══════════════════════════════════════════════════════════════════════════════
router.get('/categories', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db, { includeArchived: true });
  const byType = {};
  for (const t of GL_TYPES) byType[t] = [];
  for (const c of categories) if (byType[c.type]) byType[c.type].push(c);
  res.render('admin/ledger/categories', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'categories',
    categories, byType, GL_TYPES, GL_TYPE_LABELS,
    success: req.query.success, error: req.query.error,
  });
});

// Next sequential GL code within a type's band: highest existing code for that
// type + STEP, or the band's base if none yet.
async function nextGlCode(db, type) {
  const base = GL_CODE_BASE[type] || 6000;
  const cats = await db.collection('gl_categories').find({ type }).toArray();
  let max = 0;
  for (const c of cats) {
    const n = parseInt(String(c.code || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max > 0 ? max + GL_CODE_STEP : base);
}

router.post('/categories', async (req, res) => {
  const back = '/admin/ledger/categories';
  try {
    const name = (req.body.name || '').trim().slice(0, 120);
    const type = GL_TYPES.includes(req.body.type) ? req.body.type : null;
    if (!name || !type) return flash(res, back, 'error', 'Name and type are required');
    const now = new Date();
    const count = await req.db.collection('gl_categories').countDocuments({ type });
    // Auto-assign the next sequential code in this type's band when none is given.
    const code = (req.body.code || '').trim().slice(0, 20) || await nextGlCode(req.db, type);
    await req.db.collection('gl_categories').insertOne({
      name, type,
      group: (req.body.group || '').trim().slice(0, 80) || GL_TYPE_LABELS[type],
      code,
      archived: false, sort: count,
      createdAt: now, updatedAt: now,
    });
    flash(res, back, 'success', `Category added (${code})`);
  } catch (err) {
    console.error('[ledger] add category error:', err);
    flash(res, back, 'error', 'Could not add category');
  }
});

// Renumber every category so codes are sequential within each type's band
// (base, base+10, base+20 …), ordered by current code then sort/name.
router.post('/categories/resequence', async (req, res) => {
  const back = '/admin/ledger/categories';
  try {
    const db = req.db;
    const cats = await db.collection('gl_categories').find({}).toArray();
    const byType = {};
    for (const c of cats) (byType[c.type] = byType[c.type] || []).push(c);
    const codeNum = (c) => { const n = parseInt(String(c.code || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : Infinity; };
    let changed = 0;
    for (const type of Object.keys(byType)) {
      const base = GL_CODE_BASE[type] || 6000;
      const list = byType[type].sort((a, b) => (codeNum(a) - codeNum(b)) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name)));
      let code = base;
      for (let i = 0; i < list.length; i++) {
        const want = String(code);
        if (String(list[i].code || '') !== want || list[i].sort !== i) {
          await db.collection('gl_categories').updateOne({ _id: list[i]._id }, { $set: { code: want, sort: i, updatedAt: new Date() } });
          changed++;
        }
        code += GL_CODE_STEP;
      }
    }
    flash(res, back, 'success', changed ? `Renumbered — ${changed} categor${changed === 1 ? 'y' : 'ies'} updated.` : 'Already sequential.');
  } catch (err) {
    console.error('[ledger] resequence error:', err);
    flash(res, back, 'error', 'Could not renumber');
  }
});

router.post('/categories/:id', async (req, res) => {
  const back = '/admin/ledger/categories';
  try {
    const set = { updatedAt: new Date() };
    if (req.body.name != null) set.name = (req.body.name || '').trim().slice(0, 120);
    if (GL_TYPES.includes(req.body.type)) set.type = req.body.type;
    if (req.body.group != null) set.group = (req.body.group || '').trim().slice(0, 80);
    if (req.body.code != null) set.code = (req.body.code || '').trim().slice(0, 20);
    if (req.body.archived != null) set.archived = req.body.archived === '1' || req.body.archived === 'true';
    await req.db.collection('gl_categories').updateOne({ _id: oid(req.params.id) }, { $set: set });
    flash(res, back, 'success', 'Category updated');
  } catch (err) {
    console.error('[ledger] update category error:', err);
    flash(res, back, 'error', 'Update failed');
  }
});

router.post('/categories/:id/delete', async (req, res) => {
  const back = '/admin/ledger/categories';
  try {
    const id = oid(req.params.id);
    const used = await Promise.all([
      req.db.collection('ledger_entries').countDocuments({ categoryId: id }),
      req.db.collection('mileage_log').countDocuments({ categoryId: id }),
      req.db.collection('utilities_log').countDocuments({ categoryId: id }),
    ]);
    if (used.some((n) => n > 0)) {
      await req.db.collection('gl_categories').updateOne({ _id: id }, { $set: { archived: true, updatedAt: new Date() } });
      return flash(res, back, 'success', 'Category is in use — archived instead of deleted');
    }
    await req.db.collection('gl_categories').deleteOne({ _id: id });
    flash(res, back, 'success', 'Category deleted');
  } catch {
    flash(res, back, 'error', 'Delete failed');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MILEAGE LOG
// ══════════════════════════════════════════════════════════════════════════════
router.get('/mileage', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const settings = await getSettings(db);
  const mKey = req.query.month || monthKey();
  const { start, end } = monthRange(mKey);
  const trips = await db.collection('mileage_log')
    .find({ date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 }).toArray();
  const totalMiles = trips.reduce((s, t) => s + (t.miles || 0), 0);
  const totalAmount = trips.reduce((s, t) => s + (t.amount || 0), 0);
  const expenseCats = categories.filter((c) => c.type === 'expense');
  res.render('admin/ledger/mileage', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'mileage',
    trips, categories: expenseCats, catMap: categoryMap(categories),
    month: mKey, monthLabel: monthLabel(mKey),
    prevMonth: shiftMonth(mKey, -1), nextMonth: shiftMonth(mKey, 1),
    todayInput: dateInput(new Date()),
    defaultRate: settings.mileageRate || DEFAULT_MILEAGE_RATE,
    totals: { miles: totalMiles, amount: totalAmount },
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.post('/mileage', async (req, res) => {
  const back = `/admin/ledger/mileage?month=${req.body.month || monthKey()}`;
  try {
    const miles = num(req.body.miles);
    const rate = num(req.body.rate) || DEFAULT_MILEAGE_RATE;
    const categoryId = oid(req.body.categoryId);
    if (miles <= 0) return flash(res, back, 'error', 'Miles must be greater than zero');
    if (!categoryId) return flash(res, back, 'error', 'Pick an expense category');
    const now = new Date();
    await req.db.collection('mileage_log').insertOne({
      date: parseDate(req.body.date),
      purpose: (req.body.purpose || '').trim().slice(0, 200),
      fromLoc: (req.body.fromLoc || '').trim().slice(0, 160),
      toLoc: (req.body.toLoc || '').trim().slice(0, 160),
      miles, rate,
      amount: Math.round(miles * rate * 100) / 100,
      vehicle: (req.body.vehicle || '').trim().slice(0, 80),
      categoryId,
      note: (req.body.note || '').trim().slice(0, 1000),
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, back, 'success', 'Trip logged');
  } catch (err) {
    console.error('[ledger] add mileage error:', err);
    flash(res, back, 'error', 'Could not log trip');
  }
});

router.post('/mileage/:id/delete', async (req, res) => {
  const back = `/admin/ledger/mileage?month=${req.body.month || monthKey()}`;
  try {
    await req.db.collection('mileage_log').deleteOne({ _id: oid(req.params.id) });
    flash(res, back, 'success', 'Trip deleted');
  } catch {
    flash(res, back, 'error', 'Delete failed');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES LOG
// ══════════════════════════════════════════════════════════════════════════════
router.get('/utilities', async (req, res) => {
  const db = req.db;
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const mKey = req.query.month || monthKey();
  const { start, end } = monthRange(mKey);
  const bills = await db.collection('utilities_log')
    .find({ date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 }).toArray();
  const total = bills.reduce((s, b) => s + (b.amount || 0), 0);
  const expenseCats = categories.filter((c) => ['labor', 'fixed', 'expense'].includes(c.type));
  res.render('admin/ledger/utilities', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'utilities',
    bills, categories: expenseCats, catMap: categoryMap(categories),
    utilityTypes: UTILITY_TYPES,
    month: mKey, monthLabel: monthLabel(mKey),
    prevMonth: shiftMonth(mKey, -1), nextMonth: shiftMonth(mKey, 1),
    todayInput: dateInput(new Date()),
    totals: { amount: total },
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.post('/utilities', receiptUpload.single('receipt'), async (req, res) => {
  const back = `/admin/ledger/utilities?month=${req.body.month || monthKey()}`;
  try {
    const billTotal = num(req.body.amount);
    const categoryId = oid(req.body.categoryId);
    if (billTotal <= 0) return flash(res, back, 'error', 'Amount must be greater than zero');
    if (!categoryId) return flash(res, back, 'error', 'Pick an expense category');
    // "My share %": the building bill may be split with other companies — record
    // only your portion as the expense. Blank/100 = you pay the whole bill.
    const sharePct = Math.min(100, Math.max(0, num(req.body.sharePct)));
    const applyShare = sharePct > 0 && sharePct < 100;
    const amount = applyShare ? Math.round(billTotal * (sharePct / 100) * 100) / 100 : billTotal;
    const receipt = await saveReceipt(req, 'utility-bills');
    const now = new Date();
    await req.db.collection('utilities_log').insertOne({
      date: parseDate(req.body.date),
      utilityType: (req.body.utilityType || 'Other').trim().slice(0, 40),
      provider: (req.body.provider || '').trim().slice(0, 160),
      periodStart: req.body.periodStart ? parseDate(req.body.periodStart) : null,
      periodEnd: req.body.periodEnd ? parseDate(req.body.periodEnd) : null,
      amount,
      ...(applyShare ? { billTotal, sharePct } : {}),
      categoryId,
      ...receipt,
      note: (req.body.note || '').trim().slice(0, 1000),
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, back, 'success', applyShare
      ? `Bill logged — your ${sharePct}% share (${money(amount)}) of ${money(billTotal)}.`
      : 'Bill logged');
  } catch (err) {
    console.error('[ledger] add utility error:', err);
    flash(res, back, 'error', 'Could not log bill');
  }
});

router.post('/utilities/:id/delete', async (req, res) => {
  const back = `/admin/ledger/utilities?month=${req.body.month || monthKey()}`;
  try {
    await req.db.collection('utilities_log').deleteOne({ _id: oid(req.params.id) });
    flash(res, back, 'success', 'Bill deleted');
  } catch {
    flash(res, back, 'error', 'Delete failed');
  }
});

router.get('/utilities/:id/receipt', async (req, res) => {
  const b = await req.db.collection('utilities_log').findOne({ _id: oid(req.params.id) });
  return streamReceipt(res, b?.receiptKey, b?.receiptName);
});

// ══════════════════════════════════════════════════════════════════════════════
// BUDGET EDITOR  — projected revenue + % per category  (+ export)
// ══════════════════════════════════════════════════════════════════════════════
async function loadBudget(db, query) {
  await seedDefaultCategoriesIfEmpty(db);
  const categories = await listCategories(db);
  const year = parseInt(query.year, 10) || new Date().getFullYear();
  const plan = await getActiveBudget(db, year);
  return { categories, year, plan };
}

router.get('/budget', async (req, res) => {
  const { categories, year, plan } = await loadBudget(req.db, req.query);
  const pctByCat = {};
  const amtByCat = {};
  for (const line of plan?.lines || []) {
    if (line.amount != null) amtByCat[String(line.categoryId)] = line.amount;
    else pctByCat[String(line.categoryId)] = line.pct;
  }
  // Budget is a P&L plan — only income-statement types are budgeted (liabilities
  // are balance-sheet and excluded).
  const byType = {};
  for (const t of PNL_TYPES) byType[t] = [];
  for (const c of categories) if (byType[c.type]) byType[c.type].push(c);
  res.render('admin/ledger/budget', {
    user: req.adminUser,
    page: 'ledger', activeTab: 'budget',
    categories, byType, GL_TYPES: PNL_TYPES, GL_TYPE_LABELS, FIXED_BUDGET_TYPES,
    year,
    plan: plan || null,
    pctByCat, amtByCat,
    projectedRevenue: plan?.projectedRevenue || 0,
    quarters: plan?.quarters || [0, 0, 0, 0],
    planName: plan?.name || `${year} Plan`,
    canExport: canExport(req),
    money,
    success: req.query.success, error: req.query.error,
  });
});

router.get('/budget/export', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { categories, year, plan } = await loadBudget(req.db, req.query);
  const matrix = buildBudgetRows(plan, categories, { GL_TYPE_LABELS });
  res.render('admin/ledger/export-budget', {
    user: req.adminUser,
    brandName: req.tenant?.brand?.name || 'Business',
    year, planName: plan?.name || `${year} Plan`,
    projectedRevenue: plan?.projectedRevenue || 0,
    matrix,
  });
});

router.get('/budget/export.xlsx', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { categories, year, plan } = await loadBudget(req.db, req.query);
  const buf = await budgetXlsxBuffer(plan, categories, { year, brandName: req.tenant?.brand?.name, GL_TYPE_LABELS });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Budget_${year}.xlsx"`);
  res.send(buf);
});

router.get('/budget/export.csv', async (req, res) => {
  if (!canExport(req)) return res.status(403).send('Not permitted to export');
  const { categories, year, plan } = await loadBudget(req.db, req.query);
  const csv = rowsToCsv(buildBudgetRows(plan, categories, { GL_TYPE_LABELS }));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="Budget_${year}.csv"`);
  res.send(csv);
});

router.post('/budget', async (req, res) => {
  const year = parseInt(req.body.year, 10) || new Date().getFullYear();
  const back = `/admin/ledger/budget?year=${year}`;
  try {
    const db = req.db;
    const categories = await listCategories(db);
    const lines = [];
    for (const c of categories) {
      // Fixed/labor categories are budgeted as a fixed annual $ amount; everything
      // else as a % of projected revenue.
      if (FIXED_BUDGET_TYPES.includes(c.type)) {
        const amount = num(req.body[`amt_${c._id}`]);
        if (amount > 0) lines.push({ categoryId: c._id, amount });
      } else {
        const pct = num(req.body[`pct_${c._id}`]);
        if (pct > 0) lines.push({ categoryId: c._id, pct });
      }
    }
    const quarters = [0, 1, 2, 3].map((i) => num(req.body[`q${i + 1}`]));
    const now = new Date();
    await db.collection('ledger_budgets').updateOne(
      { year, active: true },
      {
        $set: {
          name: (req.body.name || `${year} Plan`).trim().slice(0, 120),
          year,
          projectedRevenue: num(req.body.projectedRevenue),
          quarters, lines, active: true, updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    flash(res, back, 'success', 'Budget saved');
  } catch (err) {
    console.error('[ledger] save budget error:', err);
    flash(res, back, 'error', 'Could not save budget');
  }
});

// ── settings (mileage rate + default income category for invoice sync) ────────
router.post('/settings', async (req, res) => {
  const back = req.body.back || '/admin/ledger/mileage';
  try {
    const set = { updatedAt: new Date() };
    if (req.body.mileageRate != null) set.mileageRate = num(req.body.mileageRate) || DEFAULT_MILEAGE_RATE;
    if (req.body.defaultIncomeCategoryId != null) set.defaultIncomeCategoryId = req.body.defaultIncomeCategoryId || null;
    await req.db.collection('ledger_settings').updateOne(
      { _id: 'settings' }, { $set: set }, { upsert: true },
    );
    flash(res, back, 'success', 'Settings saved');
  } catch {
    flash(res, back, 'error', 'Could not save settings');
  }
});

export default router;
