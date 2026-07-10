/**
 * Slab — Superadmin Panel (re-export shim)
 *
 * This 2,827-line single file was split into a shared helper module + focused
 * feature routers under ./superadmin/ (pub, dashboard, tenants, ollama, ops,
 * tickets, users, crossapp, announcements, gftv, monitoring) via an
 * extract-and-shim refactor. This shim preserves the original import path
 * (`./routes/superadmin.js`, mounted at /superadmin) so nothing upstream changed.
 *
 * SECURITY: the requireSuperAdmin gate ordering is reproduced in ./superadmin/
 * index.js — public routes mount before the gate, all protected routers after.
 * Verified at split time: body byte-identical, route table 153/153, and the
 * auth-gate ordering asserted (public < gate < every protected router).
 *
 * The pre-split original is preserved as superadmin.js.prerefactor-* and in git.
 */
export { default } from './superadmin/index.js';
