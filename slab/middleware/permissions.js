/**
 * Feature access middleware.
 *
 * loadUserAccess       — resolves (a) the admin's per-tenant access context
 *                        (permissions / ownership), (b) the superadmin-chosen
 *                        release stage of every feature, and (c) this tenant's
 *                        experimental opt-ins; then exposes them on req +
 *                        res.locals and precomputes the gated sidebar nav.
 * enforceFeatureAccess — a single soft guard mounted across the admin router
 *                        that blocks direct-URL access to a feature the viewer
 *                        can't see (wrong stage, not opted in, or permission-
 *                        restricted).
 *
 * See plugins/featureRegistry.js for the stage machine + access rules.
 */
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../plugins/mongo.js';
import {
  canSeeFeature, matchFeatureByPath, resolveStage, stageBadge, permissionKeys,
  FEATURES, NAV_SECTIONS,
} from '../plugins/featureRegistry.js';

const VALID_PERMS = new Set(permissionKeys());

// The tenant-facing "Labs" opt-in page — surfaced in the sidebar only when the
// tenant actually has experimental features it could opt into.
const LABS_ITEM = { key: 'labs', section: 'Admin', label: 'Labs', url: '/admin/labs', page: 'labs', icon: '&#9666;', adminOnly: true, advanced: true };

// Build the sidebar nav groups the current viewer is allowed to see, tagging
// each item with its stage badge ('beta' | 'experimental' | null).
function buildNavGroups(ctx, showLabs) {
  const withBadges = (list) => list.map((f) => ({
    ...f,
    _badge: stageBadge(resolveStage(f, ctx.featureStages)),
  }));

  return NAV_SECTIONS.map((section) => {
    // `hideNav` features (e.g. Account Resources) are routable + permission-gated
    // but never get their own sidebar slot.
    let items = FEATURES.filter((f) => f.section === section && !f.hideNav && canSeeFeature(f, ctx));
    // Inject the Labs link into the Admin section when relevant + permitted.
    if (section === 'Admin' && showLabs && canSeeFeature(LABS_ITEM, ctx)) {
      items = [...items, LABS_ITEM];
    }
    return { section, items: withBadges(items) };
  }).filter((g) => g.items.length > 0);
}

const EMPTY = { userPermissions: [], isOwner: false, featureStages: {}, tenantOptIns: {} };

function applyDefaults(req, res) {
  req.userPermissions = EMPTY.userPermissions;
  req.isOwner = EMPTY.isOwner;
  req.featureStages = EMPTY.featureStages;
  req.tenantOptIns = EMPTY.tenantOptIns;
  res.locals.userPermissions = EMPTY.userPermissions;
  res.locals.isOwner = EMPTY.isOwner;
  res.locals.featureStages = EMPTY.featureStages;
  res.locals.tenantOptIns = EMPTY.tenantOptIns;
}

export async function loadUserAccess(req, res, next) {
  applyDefaults(req, res);

  // Public admin routes (login/register) have no authenticated user — skip.
  if (!req.adminUser?.id) return next();

  // Current admin's live permission set + ownership (read fresh from DB rather
  // than the JWT, which doesn't carry permissions and can be stale on isOwner).
  try {
    if (req.db) {
      const me = await req.db.collection('users').findOne(
        { _id: new ObjectId(req.adminUser.id) },
        { projection: { permissions: 1, isOwner: 1, role: 1 } },
      );
      // Sanitize to known feature keys. A user carrying only legacy/unknown
      // permission strings collapses to [] → "unrestricted", never locked out.
      const stored = Array.isArray(me?.permissions) ? me.permissions : [];
      req.userPermissions = stored.filter((p) => VALID_PERMS.has(p));
      req.isOwner = !!me?.isOwner;
    }
  } catch { /* keep defaults */ }

  // Superadmin-chosen release stage per feature (platform-wide, slab registry).
  const stages = {};
  try {
    const slab = getSlabDb();
    const rows = await slab.collection('platform_features').find({}).toArray();
    for (const r of rows) if (r.stage) stages[r.key] = r.stage;
  } catch { /* no overrides → registry defaults apply */ }

  // This tenant's experimental opt-ins (tenant-local, set at /admin/labs).
  const optIns = {};
  try {
    if (req.db) {
      const rows = await req.db.collection('feature_optins').find({}).toArray();
      for (const r of rows) optIns[r.key] = r.enabled === true;
    }
  } catch { /* none → experimental features stay hidden for this tenant */ }

  req.featureStages = stages;
  req.tenantOptIns = optIns;
  res.locals.userPermissions = req.userPermissions;
  res.locals.isOwner = req.isOwner;
  res.locals.featureStages = stages;
  res.locals.tenantOptIns = optIns;

  const ctx = {
    isSuperAdmin: !!req.isSuperAdmin,
    isOwner: req.isOwner,
    userPermissions: req.userPermissions,
    featureStages: stages,
    tenantOptIns: optIns,
  };

  // Experimental-stage features this tenant could opt into → drives the Labs
  // page + whether the Labs nav item appears.
  const optInFeatures = FEATURES.filter((f) => resolveStage(f, stages) === 'experimental');
  res.locals.optInFeatures = optInFeatures;

  // Precompute the gated sidebar nav so the view stays presentational.
  res.locals.navGroups = buildNavGroups(ctx, optInFeatures.length > 0);
  next();
}

export function enforceFeatureAccess(req, res, next) {
  const f = matchFeatureByPath(req.path);
  if (!f) return next(); // uncatalogued / utility route — always allowed

  const ctx = {
    isSuperAdmin: !!req.isSuperAdmin,
    isOwner: !!req.isOwner,
    userPermissions: req.userPermissions || [],
    featureStages: req.featureStages || {},
    tenantOptIns: req.tenantOptIns || {},
  };
  if (canSeeFeature(f, ctx)) return next();
  return deny(req, res, f);
}

function deny(req, res, f) {
  const dest = req.get('Sec-Fetch-Dest');
  const wantsJson = req.xhr
    || (dest && !['document', 'iframe', 'frame'].includes(dest))
    || (req.get('Accept') || '').includes('application/json');
  const msg = `You don't have access to ${f.label}.`;
  if (wantsJson) return res.status(403).json({ ok: false, error: msg });
  return res.redirect('/admin?error=' + encodeURIComponent(msg));
}
