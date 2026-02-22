// Finances / Bookkeeping Route
// Handles PDF and CSV uploads from banking & CC institutions.
// Consolidates statements into MongoDB for annual expense tracking and tax prep.
// Entities: W2 Marketing LLC, madladslab LLC, Scott's wages, oil royalties, vrbo, airbnb
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Auth guard ──────────────────────────────────────────────────────────────
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth');
}

// ── Multer – store uploads in memory (parsed server-side) ───────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    const allowed = ['.pdf', '.csv', '.xlsx', '.xls', '.ofx', '.qfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only PDF, CSV, XLSX, OFX, or QFX files are allowed'));
  }
});

// ── Mongoose schema ─────────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema({
  date:        { type: Date },
  description: { type: String },
  amount:      { type: Number },  // negative = expense, positive = income/credit
  category:    { type: String, default: 'Uncategorized' },
  entity:      {
    type: String,
    enum: ['W2 Marketing LLC', 'madladslab LLC', 'Scott Employment', 'Oil Royalties', 'VRBO', 'Airbnb', 'Personal / Home'],
    default: 'Personal / Home'
  },
  taxYear:     { type: Number },
  institution: { type: String },  // Chase, BoA, Amex, etc.
  accountType: { type: String, enum: ['Checking', 'Savings', 'Credit Card', 'Other'], default: 'Other' },
  source:      { type: String },  // original filename
  uploadedBy:  { type: String },
  uploadedAt:  { type: Date, default: Date.now },
  notes:       { type: String },
  raw:         { type: String }   // raw CSV row or PDF text fragment
}, { collection: 'finance_transactions' });

const Transaction = mongoose.models.FinanceTransaction
  || mongoose.model('FinanceTransaction', transactionSchema);

// ── Expense category list ───────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  'Advertising & Marketing',
  'Auto & Transportation',
  'Bank Fees',
  'Contractors / Labor',
  'Dues & Subscriptions',
  'Equipment & Supplies',
  'Home Office',
  'Insurance',
  'Legal & Professional',
  'Meals & Entertainment',
  'Mortgage / Rent',
  'Oil & Gas Royalties',
  'Payroll / Wages',
  'Repairs & Maintenance',
  'Short-Term Rental (VRBO/Airbnb)',
  'Software & Tech',
  'Travel',
  'Utilities',
  'Uncategorized'
];

// ── GET /finances – dashboard ───────────────────────────────────────────────
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const { year, entity, source, category } = req.query;
    const filter = {};
    if (year)     filter.taxYear  = parseInt(year);
    if (entity)   filter.entity   = entity;
    if (source)   filter.source   = source;
    if (category) filter.category = category;

    const transactions = await Transaction.find(filter).sort({ date: -1 }).limit(200);

    // Summary totals by entity
    const summary = await Transaction.aggregate([
      { $match: filter },
      { $group: {
          _id: { entity: '$entity', taxYear: '$taxYear' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
      }},
      { $sort: { '_id.taxYear': -1, '_id.entity': 1 } }
    ]);

    res.render('finances/index', {
      title: source ? `Upload: ${source}` : 'Bookkeeping',
      user: req.user,
      transactions,
      summary,
      filterYear:     year     || '',
      filterEntity:   entity   || '',
      filterSource:   source   || '',
      filterCategory: category || '',
      EXPENSE_CATEGORIES
    });
  } catch (err) {
    console.error('[finances] dashboard error:', err);
    res.status(500).render('errors/500', { title: 'Error', user: req.user });
  }
});

// ── GET /finances/upload – upload form ─────────────────────────────────────
router.get('/upload', ensureAuthenticated, (req, res) => {
  res.render('finances/upload', {
    title: 'Upload Statements',
    user: req.user,
    EXPENSE_CATEGORIES
  });
});

// ── POST /finances/upload – receive file ───────────────────────────────────
router.post('/upload', ensureAuthenticated, upload.single('statement'), async (req, res) => {
  try {
    const { institution, accountType, entity, taxYear, notes } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file received' });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    let parsed = [];

    if (ext === '.csv') {
      parsed = parseCSV(file.buffer.toString('utf8'), {
        institution, accountType, entity, taxYear: parseInt(taxYear),
        source: file.originalname, uploadedBy: req.user?.email || req.user?._id
      });
    } else {
      // PDF / OFX / XLSX – store as a raw upload record pending review
      parsed = [{
        date: new Date(),
        description: `[Uploaded: ${file.originalname}]`,
        amount: 0,
        entity,
        taxYear: parseInt(taxYear),
        institution,
        accountType,
        source: file.originalname,
        uploadedBy: req.user?.email || req.user?._id,
        notes: notes || '',
        raw: `binary:${ext} – ${file.size} bytes`
      }];
    }

    if (parsed.length > 0) {
      await Transaction.insertMany(parsed, { ordered: false });
    }

    res.json({
      success: true,
      message: `Imported ${parsed.length} record(s) from ${file.originalname}`,
      count: parsed.length,
      viewUrl: `/finances?source=${encodeURIComponent(file.originalname)}`
    });

  } catch (err) {
    console.error('[finances] upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /finances/transaction – manual entry ──────────────────────────────
router.post('/transaction', ensureAuthenticated, async (req, res) => {
  try {
    const { date, description, amount, category, entity, taxYear, institution, accountType, notes } = req.body;
    const tx = new Transaction({
      date: new Date(date),
      description,
      amount: parseFloat(amount),
      category,
      entity,
      taxYear: parseInt(taxYear),
      institution,
      accountType,
      notes,
      source: 'Manual Entry',
      uploadedBy: req.user?.email || req.user?._id
    });
    await tx.save();
    res.json({ success: true, id: tx._id });
  } catch (err) {
    console.error('[finances] manual entry error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /finances/transaction/:id – update category/entity ───────────────
router.patch('/transaction/:id', ensureAuthenticated, async (req, res) => {
  try {
    const { category, entity, notes } = req.body;
    const tx = await Transaction.findByIdAndUpdate(
      req.params.id,
      { $set: { category, entity, notes } },
      { new: true }
    );
    if (!tx) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /finances/transaction/:id ──────────────────────────────────────
router.delete('/transaction/:id', ensureAuthenticated, async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /finances/uploads – recent upload history grouped by source file ─────
router.get('/uploads', ensureAuthenticated, async (req, res) => {
  try {
    // Group by source filename + uploadedAt (rounded to minute) so each batch is one row
    const batches = await Transaction.aggregate([
      { $group: {
          _id: { source: '$source', uploadedBy: '$uploadedBy' },
          count:       { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          uploadedAt:  { $max: '$uploadedAt' },
          institution: { $first: '$institution' },
          entity:      { $first: '$entity' },
          taxYear:     { $first: '$taxYear' },
          accountType: { $first: '$accountType' },
          sampleIds:   { $push: '$_id' }
      }},
      { $sort: { uploadedAt: -1 } },
      { $limit: 50 }
    ]);
    res.render('finances/uploads', { title: 'Recent Uploads', user: req.user, batches });
  } catch (err) {
    console.error('[finances] uploads list error:', err);
    res.status(500).render('errors/500', { title: 'Error', user: req.user });
  }
});

// ── DELETE /finances/api/batch/:source – delete all tx from one upload file ──
router.delete('/api/batch/:source', ensureAuthenticated, async (req, res) => {
  try {
    const source = decodeURIComponent(req.params.source);
    const result = await Transaction.deleteMany({ source });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /finances/api/preview – parse CSV and return sample rows (no save) ─
router.post('/api/preview', ensureAuthenticated, upload.single('statement'), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No file' });
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      return res.json({ success: true, rows: [], message: 'Preview only available for CSV files' });
    }
    const parsed = parseCSV(file.buffer.toString('utf8'), {
      institution: req.body.institution || '',
      entity: req.body.entity || 'Personal / Home',
      taxYear: parseInt(req.body.taxYear) || new Date().getFullYear(),
      accountType: req.body.accountType || 'Other',
      source: file.originalname,
      uploadedBy: ''
    });
    res.json({
      success: true,
      total: parsed.length,
      rows: parsed.slice(0, 5).map(r => ({
        date: r.date,
        description: r.description,
        amount: r.amount
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /finances/api/summary – JSON summary for given year ───────────────
router.get('/api/summary', ensureAuthenticated, async (req, res) => {
  try {
    const { year } = req.query;
    const match = year ? { taxYear: parseInt(year) } : {};
    const data = await Transaction.aggregate([
      { $match: match },
      { $group: {
          _id: { entity: '$entity', category: '$category' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
      }},
      { $sort: { '_id.entity': 1, '_id.category': 1 } }
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── CSV parser – header-driven auto-detection ───────────────────────────────
// Reads the header row to find column indices for date/description/amount/debit/credit.
// Institution name is used only to resolve edge cases (e.g. Amex sign flip).
function parseCSV(text, meta) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Skip any preamble rows (some banks dump account info before the real header)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = splitCSV(lines[i]);
    const norm = cols.map(c => c.toLowerCase().trim());
    // A real header row has at least one date-ish and one amount-ish column name
    const hasDate   = norm.some(c => /date|time/.test(c));
    const hasAmount = norm.some(c => /amount|debit|credit|withdrawal|deposit|total|net/.test(c));
    if (hasDate && hasAmount) { headerIdx = i; break; }
  }

  const headerCols = splitCSV(lines[headerIdx]).map(c => c.toLowerCase().trim().replace(/[^a-z0-9 ]/g, ''));
  const rows       = lines.slice(headerIdx + 1);
  const inst       = (meta.institution || '').toLowerCase();

  // ── Column index finder ──────────────────────────────────────────────────
  function col(...candidates) {
    for (const c of candidates) {
      const i = headerCols.findIndex(h => h === c || h.includes(c));
      if (i !== -1) return i;
    }
    return -1;
  }

  const iDate   = col('transaction date', 'trans date', 'trans. date', 'date', 'datetime', 'posting date', 'posted date');
  const iDesc   = col('description', 'memo', 'payee', 'name', 'narrative', 'details', 'transaction description', 'note');
  const iAmount = col('amount', 'transaction amount', 'net amount', 'gross', 'net');
  const iDebit  = col('debit', 'withdrawal', 'debit amount', 'withdrawals');
  const iCredit = col('credit', 'deposit', 'credit amount', 'deposits');
  // Some banks have separate desc + extended desc columns
  const iDesc2  = col('extended description', 'additional info', 'memo');

  const records = [];

  for (const row of rows) {
    if (!row || row.startsWith(',,,')) continue;   // skip blank/summary rows
    const cols = splitCSV(row);
    let date, description, amount, raw = row;

    try {
      // ── Date ──────────────────────────────────────────────────────────────
      const rawDate = iDate >= 0 ? cols[iDate] : cols[0];
      date = new Date(rawDate);
      if (isNaN(date.getTime())) continue;

      // ── Description ───────────────────────────────────────────────────────
      if (iDesc >= 0) {
        description = cols[iDesc] || '';
        if (iDesc2 >= 0 && iDesc2 !== iDesc && cols[iDesc2]) {
          description += ' – ' + cols[iDesc2];
        }
      } else {
        // Guess: first non-date text column
        description = cols.find((c, i) => i !== iDate && c && !/^-?[\d.,]+$/.test(c)) || '';
      }

      // ── Amount ────────────────────────────────────────────────────────────
      const clean = s => parseFloat((s || '0').replace(/[$,\s()]/g, '') || '0');

      if (iDebit >= 0 || iCredit >= 0) {
        // Separate debit/credit columns
        const debit  = clean(cols[iDebit]);
        const credit = clean(cols[iCredit]);
        amount = credit > 0 ? credit : -debit;
      } else if (iAmount >= 0) {
        amount = clean(cols[iAmount]);
        // Amex exports charges as positive — flip sign
        if (inst.includes('amex') || inst.includes('american express')) amount *= -1;
        // Discover exports charges as positive — flip sign
        if (inst.includes('discover')) amount *= -1;
      } else {
        // Last-resort: last numeric column
        const numCols = cols.map(clean).filter(n => !isNaN(n) && n !== 0);
        amount = numCols[numCols.length - 1] ?? 0;
      }

      if (isNaN(amount)) continue;

      const cleanDesc = description.replace(/^"|"$/g, '').trim();
      records.push({
        date,
        description: cleanDesc,
        amount,
        category:    autoCategory(cleanDesc, amount),
        entity:      meta.entity      || 'Personal / Home',
        taxYear:     meta.taxYear     || new Date().getFullYear(),
        institution: meta.institution || 'Unknown',
        accountType: meta.accountType || 'Other',
        source:      meta.source,
        uploadedBy:  meta.uploadedBy,
        raw
      });
    } catch (e) {
      // skip malformed rows silently
    }
  }

  return records;
}

// ── Auto-categorizer – keyword map against transaction description ───────────
const CATEGORY_RULES = [
  // Advertising & Marketing
  { cat: 'Advertising & Marketing',   rx: /facebook\s?ad|google\s?ad|instagram\s?ad|tiktok\s?ad|meta\s?ad|youtube\s?ad|mailchimp|constant\s?contact|hubspot|hootsuite|semrush|canva|squarespace|wix|shopify/i },
  // Auto & Transportation
  { cat: 'Auto & Transportation',      rx: /shell|exxon|chevron|bp\s|mobil|sunoco|circle\s?k|casey|kwik|speedway|pilot\s?travel|loves\s?travel|autozone|o'reilly|napa\s?auto|advance\s?auto|jiffy\s?lube|valvoline|midas|firestone|discount\s?tire|uber|lyft|grab|taxi|parking|ez\s?pass|toll|dmv|car\s?wash|hertz|enterprise\s?rent|budget\s?car|avis/i },
  // Bank Fees
  { cat: 'Bank Fees',                  rx: /monthly\s?fee|service\s?fee|overdraft|nsf\s?fee|wire\s?fee|foreign\s?transaction|atm\s?fee|account\s?fee|annual\s?fee|late\s?fee|interest\s?charge|finance\s?charge/i },
  // Dues & Subscriptions
  { cat: 'Dues & Subscriptions',       rx: /netflix|hulu|disney\+|hbo|peacock|paramount|apple\s?tv|amazon\s?prime|spotify|pandora|sirius|audible|linkedin|indeed|ziprecruiter|chamber\s?of\s?commerce|association\s?dues|membership|subscription/i },
  // Equipment & Supplies
  { cat: 'Equipment & Supplies',       rx: /amazon|walmart|target|costco|sam'?s\s?club|staples|office\s?depot|office\s?max|best\s?buy|b&h\s?photo|newegg|microcenter|uline|grainger/i },
  // Home Office
  { cat: 'Home Office',                rx: /home\s?office|office\s?supply|ink\s?cartridge|paper\s?supply/i },
  // Insurance
  { cat: 'Insurance',                  rx: /state\s?farm|allstate|geico|progressive|farmers|usaa|liberty\s?mutual|travelers|nationwide|amica|insurance|insur\b/i },
  // Legal & Professional
  { cat: 'Legal & Professional',       rx: /attorney|law\s?firm|legal\s?fee|cpa|accountant|accounting|bookkeep|notary|turbo\s?tax|h&r\s?block|tax\s?prep/i },
  // Meals & Entertainment
  { cat: 'Meals & Entertainment',      rx: /restaurant|grubhub|doordash|ubereats|instacart|chipotle|mcdonald|starbucks|dunkin|subway|taco\s?bell|chick.fil|panera|domino|pizza|sushi|cafe|diner|bar\s?&|brewing|brewery|winery|concert|ticketmaster|stubhub|amc\s?theatre|cinemark|regal\s?cinema/i },
  // Mortgage / Rent
  { cat: 'Mortgage / Rent',            rx: /mortgage|home\s?loan|rent\s?payment|lease\s?payment|hoa\s?fee|homeowners\s?assoc/i },
  // Oil & Gas Royalties
  { cat: 'Oil & Gas Royalties',        rx: /royalt|mineral\s?rights|oil\s?production|gas\s?production|continental\s?resources|pioneer\s?natural|devon\s?energy|chesapeake/i },
  // Payroll / Wages
  { cat: 'Payroll / Wages',            rx: /payroll|adp\b|gusto|paychex|direct\s?deposit|wages|salary|w-?2\s?pay/i },
  // Repairs & Maintenance
  { cat: 'Repairs & Maintenance',      rx: /home\s?depot|lowe'?s|menards|ace\s?hardware|true\s?value|plumb|electric\s?repair|hvac|handyman|contractor|lawn|landscap|pest\s?control|cleaning\s?service/i },
  // Short-Term Rental
  { cat: 'Short-Term Rental (VRBO/Airbnb)', rx: /vrbo|airbnb|vacasa|booking\s?\.com\s?host|homeaway/i },
  // Software & Tech
  { cat: 'Software & Tech',            rx: /microsoft|google\s?workspace|google\s?cloud|aws\b|amazon\s?web|digitalocean|linode|cloudflare|github|gitlab|atlassian|jira|slack|zoom\s?video|dropbox|adobe|figma|notion|airtable|twilio|stripe|godaddy|namecheap|domain|hosting|vpn|antivirus|norton|mcafee/i },
  // Travel
  { cat: 'Travel',                     rx: /delta\s?air|united\s?airlines|southwest\s?air|american\s?airlines|spirit\s?air|frontier\s?air|jetblue|alaska\s?air|expedia|priceline|kayak|booking\.com|hotels\.com|marriott|hilton|hyatt|ihg|best\s?western|motel|airbnb|vrbo|uber\s?eats|rental\s?car/i },
  // Utilities
  { cat: 'Utilities',                  rx: /xcel\s?energy|excel\s?energy|comcast|xfinity|at&t|verizon|t-?mobile|spectrum|cox\s?comm|centurylink|lumen|electric|gas\s?service|water\s?service|trash\s?service|sewer|utility/i },
  // Contractors / Labor
  { cat: 'Contractors / Labor',        rx: /freelance|upwork|fiverr|1099|subcontract|labor\s?cost/i },
];

function autoCategory(desc, amount) {
  const d = (desc || '').toLowerCase();
  // Income signals — positive amounts from known sources
  if (amount > 0) {
    if (/payroll|direct\s?dep|ach\s?credit|tax\s?refund|refund|rebate/.test(d)) return 'Payroll / Wages';
    if (/royalt|mineral/.test(d)) return 'Oil & Gas Royalties';
    if (/vrbo|airbnb|vacasa/.test(d)) return 'Short-Term Rental (VRBO/Airbnb)';
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.rx.test(desc)) return rule.cat;
  }
  return 'Uncategorized';
}

// ── GET /finances/report – categorical analytics ────────────────────────────
router.get('/report', ensureAuthenticated, async (req, res) => {
  try {
    const { year, entity } = req.query;
    const match = {};
    if (year)   match.taxYear = parseInt(year);
    if (entity) match.entity  = entity;

    // All transactions for the filter
    const txns = await Transaction.find(match).sort({ date: 1 }).lean();

    // ── Category totals ──────────────────────────────────────────────────────
    const byCategory = {};
    const byMonth    = {};   // { 'YYYY-MM': { income, expense } }
    const byEntity   = {};
    const merchants  = {};   // description → { count, total }
    let totalIncome  = 0;
    let totalExpense = 0;

    for (const tx of txns) {
      const cat   = tx.category || 'Uncategorized';
      const month = tx.date ? new Date(tx.date).toISOString().slice(0, 7) : 'Unknown';
      const ent   = tx.entity || 'Unknown';
      const amt   = tx.amount || 0;

      // Category
      if (!byCategory[cat]) byCategory[cat] = { income: 0, expense: 0, count: 0 };
      if (amt >= 0) byCategory[cat].income  += amt;
      else          byCategory[cat].expense += amt;
      byCategory[cat].count++;

      // Month
      if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
      if (amt >= 0) byMonth[month].income  += amt;
      else          byMonth[month].expense += amt;

      // Entity
      if (!byEntity[ent]) byEntity[ent] = { income: 0, expense: 0, count: 0 };
      if (amt >= 0) byEntity[ent].income  += amt;
      else          byEntity[ent].expense += amt;
      byEntity[ent].count++;

      // Top merchants (expense only, first 4 words of description)
      if (amt < 0) {
        const key = (tx.description || '').split(/\s+/).slice(0, 4).join(' ').toUpperCase();
        if (key) {
          if (!merchants[key]) merchants[key] = { count: 0, total: 0 };
          merchants[key].count++;
          merchants[key].total += amt;
        }
      }

      if (amt >= 0) totalIncome  += amt;
      else          totalExpense += amt;
    }

    // Sort months chronologically
    const months = Object.keys(byMonth).sort();

    // Top 15 merchants by spend
    const topMerchants = Object.entries(merchants)
      .sort((a, b) => a[1].total - b[1].total)
      .slice(0, 15)
      .map(([name, d]) => ({ name, count: d.count, total: d.total }));

    // Categories sorted by absolute expense desc
    const categories = Object.entries(byCategory)
      .sort((a, b) => a[1].expense - b[1].expense)
      .map(([cat, d]) => ({ cat, ...d, net: d.income + d.expense }));

    res.render('finances/report', {
      title: `Report${year ? ' ' + year : ''}`,
      user: req.user,
      filterYear:   year   || '',
      filterEntity: entity || '',
      totalIncome,
      totalExpense,
      netTotal: totalIncome + totalExpense,
      txCount: txns.length,
      categories,
      byMonth, months,
      byEntity,
      topMerchants,
      YEARS: [2024, 2023, 2022, 2021],
      ENTITIES: ['W2 Marketing LLC', 'madladslab LLC', 'Scott Employment', 'Oil Royalties', 'VRBO', 'Airbnb', 'Personal / Home']
    });
  } catch (err) {
    console.error('[finances] report error:', err);
    res.status(500).render('errors/500', { title: 'Error', user: req.user });
  }
});

// Split a CSV row respecting quoted fields
function splitCSV(row) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

export default router;
