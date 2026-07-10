/**
 * Labs — tenant opt-in for experimental-stage features.
 *
 * The superadmin marks a feature "experimental" at /superadmin/features. It then
 * stays hidden for a tenant until an owner/unrestricted admin opts in here, which
 * writes a per-tenant `feature_optins` doc. Opted-in features appear in the
 * sidebar badged "exp".
 *
 * res.locals.optInFeatures (experimental-stage features) and req.tenantOptIns are
 * populated by middleware/permissions.js.
 */
import express from 'express';

const router = express.Router();

// Opting into a tenant-wide beta is an owner / unrestricted-admin decision — a
// restricted collaborator (explicit permissions list) can't flip features on.
function requireUnrestrictedAdmin(req, res, next) {
  if (req.isSuperAdmin || req.isOwner) return next();
  if ((req.userPermissions || []).length === 0) return next();
  return res.redirect('/admin?error=' + encodeURIComponent('Only the workspace owner can manage Labs features.'));
}

router.use(requireUnrestrictedAdmin);

router.get('/', (req, res) => {
  res.render('admin/labs', {
    user: req.adminUser,
    page: 'labs',
    optInFeatures: res.locals.optInFeatures || [],
    tenantOptIns: req.tenantOptIns || {},
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

router.post('/toggle', async (req, res) => {
  const { key } = req.body;
  const enabled = req.body.enabled === 'true' || req.body.enabled === 'on' || req.body.enabled === true;

  // Only features currently in the experimental stage can be opted into.
  const allowed = (res.locals.optInFeatures || []).some((f) => f.key === key);
  if (!allowed) return res.redirect('/admin/labs?error=' + encodeURIComponent('That feature is not available to opt into.'));

  try {
    await req.db.collection('feature_optins').updateOne(
      { key },
      {
        $set: { key, enabled, updatedAt: new Date(), updatedBy: req.adminUser?.email || '' },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    res.redirect('/admin/labs?success=' + encodeURIComponent(`${enabled ? 'Enabled' : 'Disabled'} for your workspace.`));
  } catch (err) {
    console.error('[admin/labs/toggle] error:', err);
    res.redirect('/admin/labs?error=' + encodeURIComponent('Could not update. Try again.'));
  }
});

export default router;
