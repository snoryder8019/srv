/**
 * MadLadsLab tenant — custom superadmin routes
 * Mounted at /custom/superadmin (gated to madladslab tenant + superadmin auth)
 *
 * These extend the core /superadmin routes with madladslab-specific features.
 * Views: views/tenants/madladslab/superadmin/
 */
import { Router } from 'express';
import { requireSuperAdmin } from '../../../../middleware/superadmin.js';
import { tenantRender } from '../../viewHelper.js';

const router = Router();

router.use(requireSuperAdmin);

// Example: GET /custom/superadmin → madladslab-specific superadmin dashboard
router.get('/', (req, res) => {
  tenantRender(req, res, 'superadmin/dashboard', {
    title: 'MadLadsLab Superadmin — Custom',
  });
});

export default router;
