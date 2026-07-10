/**
 * Feature Registry — single source of truth for admin navigation + gating.
 *
 * Every admin feature is declared once here. Three consumers read from it:
 *   1. The sidebar (views/admin/partials/sidebar.ejs) renders its nav from this list.
 *   2. The tenant "Users & Permissions" page builds its permission checkboxes here.
 *   3. The superadmin "Feature Visibility" board toggles `experimental` features
 *      on/off platform-wide.
 *
 * Two orthogonal axes gate a feature (enforced in middleware/permissions.js):
 *
 *   1. Release STAGE (superadmin-chosen, per feature, at /superadmin/features):
 *        experimental → hidden until the TENANT opts in at /admin/labs; badged
 *                       "experimental" once enabled.
 *        beta         → visible to all tenants, badged "beta".
 *        visible      → visible to all tenants, no badge (GA).
 *        off          → hidden from all tenants.
 *      `experimental:true` in a FEATURES entry only sets the DEFAULT stage; the
 *      superadmin override in the platform_features collection wins. Superadmins
 *      always see every feature regardless of stage.
 *
 *   2. Per-tenant ACCESS (who inside a tenant can use a feature it already has):
 *      • perm:true      → the tenant owner + unrestricted admins always have it;
 *        a non-owner admin sees it only if their `permissions` array includes the
 *        feature key — UNLESS that array is empty, which means "unrestricted"
 *        (full access). Empty = full access, the safe default, so enabling this
 *        never silently locks out an existing admin.
 *      • adminOnly:true → sensitive tools (users, settings): owner + unrestricted
 *        admins only; a restricted admin/collaborator is kept out entirely.
 */

// Sidebar section order.
export const NAV_SECTIONS = ['Overview', 'Content', 'Clients & CRM', 'Meetings', 'Marketing', 'Finance', 'Admin'];

export const FEATURES = [
  // ── Overview ──────────────────────────────────────────────────────────────
  { key: 'dashboard', section: 'Overview', label: 'Dashboard', url: '/admin', page: 'dashboard', icon: '&#9638;' },

  // ── Content ───────────────────────────────────────────────────────────────
  { key: 'pages',     section: 'Content', label: 'Pages',         url: '/admin/pages',            page: 'pages',     icon: '&#9723;', perm: true },
  { key: 'blog',      section: 'Content', label: 'Blog',          url: '/admin/blog',             page: 'blog',      icon: '&#9997;', perm: true },
  { key: 'portfolio', section: 'Content', label: 'Portfolio',     url: '/admin/portfolio',        page: 'portfolio', icon: '&#9672;', perm: true },
  { key: 'design',    section: 'Content', label: 'Design & Copy', url: '/admin/design',           page: 'design',    icon: '&#9681;', perm: true },
  { key: 'assets',    section: 'Content', label: 'Assets',        url: '/admin/assets',           page: 'assets',    icon: '&#9636;', perm: true },
  // Account Resources stays a real (permission-gated, routable) feature but is
  // reached from within Assets — it doesn't get its own sidebar slot.
  { key: 'resources', section: 'Content', label: 'Account Resources', url: '/admin/assets/resources', page: 'resources', icon: '&#9707;', perm: true, hideNav: true },

  // ── Clients & CRM ─────────────────────────────────────────────────────────
  { key: 'inquiries',  section: 'Clients & CRM', label: 'Inquiries',     url: '/admin/inquiries',  page: 'inquiries',  icon: '&#9671;', perm: true },
  { key: 'clients',    section: 'Clients & CRM', label: 'Clients',       url: '/admin/clients',    page: 'clients',    icon: '&#9673;', perm: true },
  { key: 'onboarding', section: 'Clients & CRM', label: 'Onboarding',    url: '/admin/onboarding', page: 'onboarding', icon: '&#9638;', perm: true },
  { key: 'tickets',    section: 'Clients & CRM', label: 'Help Requests', url: '/admin/tickets',    page: 'tickets',    icon: '&#9888;', perm: true },

  // ── Meetings ──────────────────────────────────────────────────────────────
  { key: 'meetings', section: 'Meetings', label: 'Meetings', url: '/admin/meetings',         page: 'meetings', icon: '&#9707;', perm: true },
  { key: 'booking',  section: 'Meetings', label: 'Booking',  url: '/admin/meetings/booking', page: 'booking',  icon: '&#128197;', perm: true },
  { key: 'notes',    section: 'Meetings', label: 'Notes',    url: '/admin/notes',            page: 'notes',    icon: '&#127897;', perm: true },

  // ── Marketing ─────────────────────────────────────────────────────────────
  // QR Codes & Card is the only base tool here; the rest are advanced.
  { key: 'email-marketing', section: 'Marketing', label: 'Email Marketing', url: '/admin/email-marketing', page: 'email-marketing', icon: '@', perm: true, advanced: true },
  { key: 'social', section: 'Marketing', label: 'Social Media', url: '/admin/social', page: 'social', icon: '&#128227;', perm: true, advanced: true },
  { key: 'live-studio', section: 'Marketing', label: 'Live Studio', url: '/admin/social/live', page: 'live-studio', icon: '&#128308;', perm: true, experimental: true, advanced: true },
  { key: 'qr-codes', section: 'Marketing', label: 'QR Codes & Card', url: '/admin/qr-codes', page: 'qr-codes', icon: '&#9635;', perm: true },
  { key: 'print-studio', section: 'Marketing', label: 'Print Studio', url: '/admin/print-studio', page: 'print-studio', icon: '&#128424;', perm: true, advanced: true },

  // ── Finance (all advanced) ─────────────────────────────────────────────────
  { key: 'bookkeeping', section: 'Finance', label: 'Bookkeeping', url: '/admin/bookkeeping', page: 'bookkeeping', icon: '$', perm: true, advanced: true },
  { key: 'calculators', section: 'Finance', label: 'Calculators', url: '/admin/calculators', page: 'calculators', icon: '&#129518;', perm: true, advanced: true },
  { key: 'analytics',   section: 'Finance', label: 'Analytics',   url: '/admin/analytics',   page: 'analytics',   icon: '&#128202;', perm: true, advanced: true },

  // ── Admin (management surface) ──────────────────────────────────────────────
  // `adminOnly` — sensitive tools reserved for the owner + unrestricted admins.
  // A restricted admin/collaborator (one with an explicit permissions list) is
  // kept out of these even though they aren't individually permission-gated, so
  // e.g. a Blog-only collaborator can't reach API keys or user management.
  { key: 'users',    section: 'Admin', label: 'Users & Permissions', url: '/admin/users',    page: 'users',    icon: '&#9672;', adminOnly: true },
  { key: 'settings', section: 'Admin', label: 'Settings & Keys',     url: '/admin/settings', page: 'settings', icon: '&#9881;', adminOnly: true },
  { key: 'docs',     section: 'Admin', label: 'Docs & Guides',       url: '/admin/docs',     page: 'docs',     icon: '&#9776;' },
  { key: 'chat', section: 'Admin', label: 'Chat Control', url: '/admin/chat', page: 'chat', icon: '&#128172;', adminOnly: true, experimental: true, advanced: true },
];

/** Look up a single feature by its key. */
export function featureByKey(key) {
  return FEATURES.find((f) => f.key === key) || null;
}

/** Permission-gated features only — used to build the Users page checkboxes. */
export function permissionCatalog() {
  return FEATURES.filter((f) => f.perm).map((f) => ({
    key: f.key,
    label: f.label,
    section: f.section,
    experimental: !!f.experimental,
  }));
}

/** Valid permission keys (for validating a submitted permissions form). */
export function permissionKeys() {
  return FEATURES.filter((f) => f.perm).map((f) => f.key);
}

/** Experimental features by their default stage (pre-override). */
export function experimentalFeatures() {
  return FEATURES.filter((f) => f.experimental);
}

/** Features whose effective stage matches, given the superadmin overrides. */
export function featuresInStage(stage, stages = {}) {
  return FEATURES.filter((f) => resolveStage(f, stages) === stage);
}

/**
 * Match the best (longest-prefix) feature for an admin-relative request path,
 * e.g. '/social/live/control' → the live-studio feature, '/assets/resources'
 * → resources (not assets). Returns null for uncatalogued/utility routes.
 */
export function matchFeatureByPath(adminPath) {
  let best = null;
  let bestLen = -1;
  for (const f of FEATURES) {
    const rel = (f.url.replace(/^\/admin/, '') || '/').split('?')[0];
    if (rel === '/' || rel === '') continue; // dashboard root — never gated
    if (adminPath === rel || adminPath.startsWith(rel + '/')) {
      if (rel.length > bestLen) { best = f; bestLen = rel.length; }
    }
  }
  return best;
}

// ── Release stages ──────────────────────────────────────────────────────────
// The superadmin chooses a stage per feature at /superadmin/features. Audience:
//   experimental → hidden until the TENANT opts in (per workspace, at /admin/labs);
//                  shown with an "experimental" badge once enabled.
//   beta         → visible to all tenants, shown with a "beta" badge.
//   visible      → visible to all tenants, no badge (general availability).
//   off          → hidden from all tenants.
// Superadmins always see every feature regardless of stage (to manage/preview).
export const STAGES = ['experimental', 'beta', 'visible', 'off'];
export const STAGE_LABELS = {
  experimental: 'Experimental',
  beta: 'Beta',
  visible: 'Visible',
  off: 'Off',
};

/** A feature's default stage before any superadmin override. */
export function defaultStage(f) {
  return f.experimental ? 'experimental' : 'visible';
}

/** Resolve a feature's effective stage from the superadmin overrides map. */
export function resolveStage(f, stages = {}) {
  const s = stages && stages[f.key];
  return STAGES.includes(s) ? s : defaultStage(f);
}

/** Menu badge for a resolved stage ('beta' | 'experimental' | null). */
export function stageBadge(stage) {
  return stage === 'beta' || stage === 'experimental' ? stage : null;
}

/**
 * Can the current viewer see/reach a feature?
 * ctx: {
 *   isSuperAdmin, isOwner,
 *   userPermissions: string[],
 *   featureStages: {key: stage},   // superadmin overrides
 *   tenantOptIns:   {key: bool},   // this tenant's experimental opt-ins
 * }
 */
export function canSeeFeature(f, ctx = {}) {
  // Superadmin sees everything, at every stage.
  if (ctx.isSuperAdmin) return true;

  // Stage gating — does this tenant get the feature at all?
  const stage = resolveStage(f, ctx.featureStages);
  if (stage === 'off') return false;
  if (stage === 'experimental') {
    const optedIn = !!(ctx.tenantOptIns && ctx.tenantOptIns[f.key] === true);
    if (!optedIn) return false;
  }
  // beta + visible (+ opted-in experimental) → available to the tenant.

  // Management surface (adminOnly): owner bypasses; an unrestricted admin
  // (empty perms) keeps it, but a restricted admin/collaborator (explicit perms
  // list) is kept out — these tools aren't grantable per-feature.
  if (f.adminOnly && !ctx.isOwner) {
    const perms = Array.isArray(ctx.userPermissions) ? ctx.userPermissions : [];
    if (perms.length > 0) return false;
  }
  // Permission-gated: owner bypasses; empty perms = unrestricted.
  if (f.perm && !ctx.isOwner) {
    const perms = Array.isArray(ctx.userPermissions) ? ctx.userPermissions : [];
    if (perms.length > 0 && !perms.includes(f.key)) return false;
  }
  return true;
}
