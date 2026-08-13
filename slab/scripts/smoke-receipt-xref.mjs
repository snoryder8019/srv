/**
 * Smoke test for receipt ↔ transaction cross-referencing (/admin/ledger/scan).
 *
 * A receipt is documentation, not a transaction: the normal resolution is to
 * cross-reference it onto the statement line it documents (no ledger row), and
 * posting it as its own entry is the rare cash path guarded against
 * double-counting. This drives all three paths against the real routes.
 *
 * Seeds a throwaway statement + scan, exercises match / unmatch / post, then
 * deletes everything it created. Never touches pre-existing ledger data.
 */
import http from 'node:http';
import { ObjectId } from 'mongodb';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const HOST = 'madladslab.madladslab.com';
const PORT = 3602;
const AMT = 42.73; // deliberately odd so it can't collide with real data

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`); };
const bad = (n, e) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n      \x1b[31m${e}\x1b[0m`); };
async function check(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function req(path, { method = 'GET', form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : null;
    const headers = { Host: HOST };
    if (data) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const flashOf = (res) => {
  const m = /[?&](success|error)=([^&]*)/.exec(res.headers.location || '');
  return m ? { kind: m[1], msg: decodeURIComponent(m[2]) } : { kind: null, msg: '' };
};

const run = async () => {
  await connectDB();
  const tenant = await getSlabDb().collection('tenants').findOne({ domain: HOST });
  if (!tenant) throw new Error(`tenant ${HOST} not found`);
  const db = getTenantDb(tenant.db, tenant.dbHost);
  const owner = await db.collection('users').findOne({ isAdmin: true });
  if (!owner) throw new Error('admin user missing');

  const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, tenant.db, '24h');
  const ex = await req('/admin?token=' + token);
  const m = /(?:^|,\s*)slab_token=([^;]+)/.exec(ex.headers['set-cookie'] || '');
  if (!m) throw new Error('no session cookie issued');
  const cookie = `slab_token=${m[1]}`;

  const category = await db.collection('gl_categories').findOne({ type: 'expense', archived: { $ne: true } });
  if (!category) throw new Error('no expense category to post into');

  // ── seed ───────────────────────────────────────────────────────────────────
  const when = new Date(); when.setDate(when.getDate() - 3);
  const stmtId = new ObjectId();
  const scanId = new ObjectId();
  await db.collection('ledger_statements').insertOne({
    _id: stmtId, status: 'pending', bank: 'SMOKE TEST BANK', accountLast4: '0000',
    periodStart: when, periodEnd: new Date(),
    lineItems: [{
      lid: 'L0', date: when.toISOString().slice(0, 10),
      description: 'Purchase authorized on 07/17 Zzyzx Smoke Supply Denver CO',
      amount: AMT, direction: 'debit', disposition: 'private',
      categoryId: null, allocPct: null, autoSuggested: false, tags: [], entryId: null, posted: false,
    }],
    lineCount: 1, createdAt: new Date(), updatedAt: new Date(), createdBy: 'smoke',
  });
  await db.collection('ledger_scans').insertOne({
    _id: scanId, status: 'pending', docType: 'receipt',
    vendor: 'Zzyzx Smoke Supply', date: when, total: AMT, tax: 0, currency: 'USD',
    summary: 'Smoke test receipt', categoryGuess: '', suggestedType: 'expense',
    receiptKey: null, receiptName: 'smoke.jpg', receiptType: 'image/jpeg',
    lineItems: [], needsManual: false, createdAt: new Date(), updatedAt: new Date(), createdBy: 'smoke',
  });

  const entryCount = () => db.collection('ledger_entries').countDocuments({});
  const before = await entryCount();
  const ref = `stmt:${stmtId}:L0`;

  try {
    console.log('\n\x1b[1mReceipt cross-reference\x1b[0m');

    await check('Scan queue offers the matching statement line', async () => {
      const r = await req('/admin/ledger/scan', { cookie });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.body.includes(ref), 'seeded statement line was not offered as a candidate');
      assert(/Cross-reference &amp; file|Cross-reference &amp; file|Cross-reference/.test(r.body), 'no cross-reference action rendered');
      return 'candidate surfaced';
    });

    await check('Matching files the receipt WITHOUT creating a ledger entry', async () => {
      const r = await req(`/admin/ledger/scan/${scanId}/match`, { method: 'POST', cookie, form: { ref } });
      const f = flashOf(r);
      assert(f.kind === 'success', `flash: ${f.kind} ${f.msg}`);
      const stmt = await db.collection('ledger_statements').findOne({ _id: stmtId });
      assert(stmt.lineItems[0].receiptRef?.scanId, 'line has no receiptRef');
      const scan = await db.collection('ledger_scans').findOne({ _id: scanId });
      assert(scan.status === 'matched', `scan status ${scan.status}`);
      assert(scan.matchRef === ref, 'matchRef not stored');
      assert(await entryCount() === before, 'a ledger entry was created — receipts must not post on match');
      return `line stamped, ledger unchanged (${before} entries)`;
    });

    await check('Matched receipt is no longer offered to other receipts', async () => {
      const r = await req('/admin/ledger/scan', { cookie });
      assert(!r.body.includes(ref), 'already-documented line still offered');
      return 'candidate withdrawn';
    });

    await check('Posting is blocked while an exact match exists', async () => {
      // put the receipt back in the queue first
      await req(`/admin/ledger/scan/${scanId}/unmatch`, { method: 'POST', cookie });
      const r = await req(`/admin/ledger/scan/${scanId}/approve`, {
        method: 'POST', cookie,
        form: { date: when.toISOString().slice(0, 10), amount: AMT, categoryId: String(category._id), description: 'smoke' },
      });
      const f = flashOf(r);
      assert(f.kind === 'error', `expected a double-count refusal, got ${f.kind}: ${f.msg}`);
      assert(await entryCount() === before, 'entry created despite the guard');
      return f.msg.slice(0, 58) + '…';
    });

    await check('Unmatch returns the line and the receipt to clean state', async () => {
      const stmt = await db.collection('ledger_statements').findOne({ _id: stmtId });
      assert(!stmt.lineItems[0].receiptRef, 'receiptRef not cleared from the line');
      const scan = await db.collection('ledger_scans').findOne({ _id: scanId });
      assert(scan.status === 'pending' && !scan.matchRef, `scan status ${scan.status}`);
      return 'both sides reset';
    });

    await check('Forced post creates one entry, flagged as receipt-sourced', async () => {
      const r = await req(`/admin/ledger/scan/${scanId}/approve`, {
        method: 'POST', cookie,
        form: { date: when.toISOString().slice(0, 10), amount: AMT, categoryId: String(category._id), description: 'smoke', force: '1' },
      });
      const f = flashOf(r);
      assert(f.kind === 'success', `flash: ${f.kind} ${f.msg}`);
      const e = await db.collection('ledger_entries').findOne({ source: 'scan', sourceId: scanId });
      assert(e, 'no ledger entry created');
      assert(e.postedFromReceipt === true, 'entry not flagged postedFromReceipt');
      assert(await entryCount() === before + 1, 'wrong number of entries created');
      return 'flagged receipt → entry';
    });

    await check('A posted statement line carries its receipt onto the ledger', async () => {
      // fresh receipt + line, matched while still in review, then posted
      const scan2 = new ObjectId();
      await db.collection('ledger_scans').insertOne({
        _id: scan2, status: 'pending', docType: 'receipt', vendor: 'Zzyzx Smoke Supply',
        date: when, total: AMT, receiptKey: 'smoke/key.jpg', receiptName: 'smoke2.jpg',
        receiptType: 'image/jpeg', createdAt: new Date(), updatedAt: new Date(),
      });
      await db.collection('ledger_statements').updateOne({ _id: stmtId }, { $unset: { 'lineItems.0.receiptRef': '' } });
      const r1 = await req(`/admin/ledger/scan/${scan2}/match`, { method: 'POST', cookie, form: { ref } });
      assert(flashOf(r1).kind === 'success', 'match failed');
      const r2 = await req(`/admin/ledger/statements/${stmtId}/post`, {
        method: 'POST', cookie,
        form: { [`disp_L0`]: 'business', [`cat_L0`]: String(category._id), [`amt_L0`]: AMT, [`date_L0`]: when.toISOString().slice(0, 10), [`desc_L0`]: 'Zzyzx Smoke Supply', [`dir_L0`]: 'debit' },
      });
      assert(flashOf(r2).kind === 'success', `post failed: ${flashOf(r2).msg}`);
      const e = await db.collection('ledger_entries').findOne({ source: 'statement', sourceId: stmtId });
      assert(e, 'statement line did not post');
      assert(e.receiptRef?.key === 'smoke/key.jpg', 'receipt did not follow the line onto the ledger');
      await db.collection('ledger_scans').deleteOne({ _id: scan2 });
      return 'proof followed the line';
    });
  } finally {
    await db.collection('ledger_scans').deleteOne({ _id: scanId });
    await db.collection('ledger_statements').deleteOne({ _id: stmtId });
    await db.collection('ledger_entries').deleteMany({ $or: [{ sourceId: scanId }, { sourceId: stmtId }] });
    const after = await entryCount();
    console.log(`\n  \x1b[2mcleanup: ledger back to ${after} entries (started at ${before})\x1b[0m`);
    if (after !== before) console.log('  \x1b[31m! leftover entries — inspect manually\x1b[0m');
  }

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
