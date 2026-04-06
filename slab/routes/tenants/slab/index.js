/**
 * Slab tenant — custom routes
 * Mounted at /custom (gated to slab.madladslab.com only)
 *
 * Views resolve from: views/tenants/slab/<template>.ejs
 * Fallback:           views/<template>.ejs  (shared)
 *
 * Sub-routers:
 *   /custom/superadmin  → superadmin-only custom features
 */
import { Router } from 'express';
import { tenantRender } from '../viewHelper.js';
import superadminRouter from './superadmin/index.js';

const router = Router();

// ── Sub-routers ──────────────────────────────────────────────────────────────
router.use('/superadmin', superadminRouter);

// ── Custom routes ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  tenantRender(req, res, 'home', {
    title: 'Slab Custom Home',
  });
});

export default router;
