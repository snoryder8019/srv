/**
 * Slab — Admin Scanner Routes
 * Mounted at /admin/scanner in admin.js
 *
 * GET  /              → Scanner dashboard (last results + run controls)
 * POST /run           → Start a scan (returns JSON progress/results)
 * GET  /results/:id   → View a specific scan result
 * POST /to-tickets    → Convert findings to tickets
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { runScan, findingsToTickets } from '../../plugins/scanner.js';

const router = express.Router();

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const results = await db.collection('scan_results')
      .find({})
      .sort({ 'summary.scannedAt': -1 })
      .limit(10)
      .toArray();

    res.render('admin/scanner', {
      user: req.adminUser,
      results,
    });
  } catch (err) {
    console.error('[scanner] dashboard error:', err);
    res.render('admin/scanner', { user: req.adminUser, results: [] });
  }
});

// ── Run scan ────────────────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
  try {
    const db = req.db;
    const { modules, pages } = req.body;

    // Extract admin cookie for authed scanning
    const adminCookie = req.cookies?.slab_token || '';

    // Default pages to scan — public + admin
    const defaultPages = ['/', '/admin/login', '/admin'];
    const scanPages = (pages && pages.length > 0) ? pages : defaultPages;

    // Default modules — all
    const allModules = ['contrast', 'modals', 'modules', 'redundancy', 'security', 'routes'];
    const scanModules = (modules && modules.length > 0) ? modules : allModules;

    const result = await runScan({
      tenant: req.tenant,
      adminCookie,
      modules: scanModules,
      pages: scanPages,
    });

    // Save result to DB
    const doc = {
      ...result,
      runBy: req.adminUser?.email || 'unknown',
      createdAt: new Date(),
    };
    const inserted = await db.collection('scan_results').insertOne(doc);

    res.json({
      ok: true,
      scanId: inserted.insertedId,
      summary: result.summary,
      findings: result.findings,
    });
  } catch (err) {
    console.error('[scanner] run error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── View result ─────────────────────────────────────────────────────────────
router.get('/results/:id', async (req, res) => {
  try {
    const db = req.db;
    const result = await db.collection('scan_results').findOne({ _id: new ObjectId(req.params.id) });
    if (!result) return res.status(404).json({ error: 'Scan result not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Convert findings to tickets ─────────────────────────────────────────────
router.post('/to-tickets', async (req, res) => {
  try {
    const db = req.db;
    const { scanId } = req.body;

    if (!scanId) return res.status(400).json({ error: 'scanId required' });

    const result = await db.collection('scan_results').findOne({ _id: new ObjectId(scanId) });
    if (!result) return res.status(404).json({ error: 'Scan result not found' });

    const tickets = await findingsToTickets(db, result.findings, req.tenant);

    // Mark scan as ticketed
    await db.collection('scan_results').updateOne(
      { _id: result._id },
      { $set: { ticketed: true, ticketCount: tickets.length, ticketedAt: new Date() } },
    );

    res.json({ ok: true, ticketCount: tickets.length });
  } catch (err) {
    console.error('[scanner] to-tickets error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── JSON export for email reports ───────────────────────────────────────────
router.get('/latest-json', async (req, res) => {
  try {
    const db = req.db;
    const result = await db.collection('scan_results')
      .find({})
      .sort({ 'summary.scannedAt': -1 })
      .limit(1)
      .toArray();

    res.json(result[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
