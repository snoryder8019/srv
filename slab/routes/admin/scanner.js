/**
 * Slab — Admin Scanner Routes
 * Mounted at /admin/scanner in admin.js
 *
 * Scanner findings are NOT tickets. They live in `scan_results` and are
 * surfaced to tenants as "under review by the dev team" until the
 * superadmin marks them fixed.
 *
 * GET  /              → Scanner dashboard (last results + dev review status)
 * POST /run           → Start a scan (returns JSON progress/results)
 * GET  /results/:id   → View a specific scan result
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { runScan } from '../../plugins/scanner.js';

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
    const allModules = ['contrast', 'modals', 'modules', 'redundancy', 'security', 'routes', 'admin'];
    const scanModules = (modules && modules.length > 0) ? modules : allModules;

    const result = await runScan({
      tenant: req.tenant,
      adminCookie,
      modules: scanModules,
      pages: scanPages,
      db: req.db,
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

// (removed: /to-tickets — scanner findings stay in scan_results,
//  not tickets. Devs work them in the superadmin scan-reports portal.)

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
