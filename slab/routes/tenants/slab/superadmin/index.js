/**
 * Slab tenant — custom superadmin routes
 * Mounted at /custom/superadmin (gated to slab tenant + superadmin auth)
 *
 * These extend the core /superadmin routes with slab-specific features.
 * Views: views/tenants/slab/superadmin/
 */
import { Router } from 'express';
import { requireSuperAdmin } from '../../../../middleware/superadmin.js';
import { tenantRender } from '../../viewHelper.js';

const router = Router();

router.use(requireSuperAdmin);

// Example: GET /custom/superadmin → slab-specific superadmin dashboard
router.get('/', (req, res) => {
  tenantRender(req, res, 'superadmin/dashboard', {
    title: 'Slab Superadmin — Custom',
  });
});

export default router;
