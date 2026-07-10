/**
 * Slab — Agent audience policy (who may drive which tooling)
 * ─────────────────────────────────────────────────────────────────────────────
 * The ✦ launcher is universal — it appears for public visitors, collaborators,
 * and admins alike. What it may DO is not universal. This module is the single
 * gate that decides, per audience, which agent departments/tools are reachable.
 * routeMessage/runDepartment (agentRouter.js) MUST call assertDepartmentAllowed()
 * after routing so a visitor can never reach a site-mutating or finance tool.
 *
 * Three tiers:
 *   public       — unauthed site visitor. NO mutating departments. A concierge:
 *                  answers questions from brand context, and may capture an
 *                  inquiry (the one safe, intended write — same as a contact form).
 *   collaborator — authed admin with an explicit permissions list. Allowed
 *                  departments = those whose backing feature they can see
 *                  (reuses featureRegistry.canSeeFeature — one source of truth).
 *   admin        — owner or unrestricted admin. All departments.
 */

import { canSeeFeature, featureByKey } from './featureRegistry.js';

export const AUDIENCES = ['public', 'collaborator', 'admin'];

// Each mutating department maps to the admin feature that governs it, so
// collaborator gating reuses the existing permission model rather than inventing
// a parallel one. (copy + section live under the "design" feature; research +
// outreach under "clients".)
export const DEPARTMENT_FEATURE = {
  blog: 'blog', copy: 'design', section: 'design', page: 'pages',
  design: 'design', asset: 'assets', social: 'social', print: 'print-studio',
  email: 'email-marketing', invoice: 'bookkeeping', outreach: 'clients',
  research: 'clients', onboarding: 'onboarding',
};

// Public visitors get a concierge, not a control panel. These are the ONLY
// server actions a public ✦ session may take. 'assist' = plain brand-aware Q&A;
// 'inquiry' = capture a lead into the inquiries collection (safe, intended).
export const PUBLIC_DEPARTMENTS = ['assist', 'inquiry'];

/** Classify a viewer into an audience tier. */
export function resolveAudience(user, ctx = {}) {
  if (!user) return 'public';
  if (ctx.isSuperAdmin || ctx.isOwner) return 'admin';
  const perms = Array.isArray(ctx.userPermissions) ? ctx.userPermissions : [];
  // Empty perms on an authed admin = unrestricted (see featureRegistry).
  if (user.isAdmin && perms.length === 0) return 'admin';
  return 'collaborator';
}

/** The set of departments this audience may route to. */
export function departmentsForAudience(audience, ctx = {}) {
  if (audience === 'public') return [...PUBLIC_DEPARTMENTS];
  if (audience === 'admin') return Object.keys(DEPARTMENT_FEATURE);
  // collaborator — intersect with features they can actually see.
  return Object.entries(DEPARTMENT_FEATURE)
    .filter(([, featKey]) => {
      const f = featureByKey(featKey);
      return f ? canSeeFeature(f, ctx) : false;
    })
    .map(([dept]) => dept);
}

/** Throws if the audience may not use the routed department. Callers catch this
 *  and degrade gracefully (public → concierge reply; collaborator → explain). */
export function assertDepartmentAllowed(audience, department, ctx = {}) {
  // Navigation is always safe (it only ever links within what the viewer can see).
  if (department === 'navigate') return true;
  const allowed = departmentsForAudience(audience, ctx);
  if (!allowed.includes(department)) {
    const err = new Error(`Department "${department}" not permitted for audience "${audience}".`);
    err.code = 'AGENT_FORBIDDEN';
    err.audience = audience;
    err.department = department;
    throw err;
  }
  return true;
}

// ── Audience-scoped suggestion pools ─────────────────────────────────────────
// Public gets marketing/concierge prompts (drive inquiry, showcase services).
// Authed tiers get productivity prompts, filtered to what they can actually do.

function publicSuggestions(brand = {}) {
  const services = brand.services || [];
  const out = [
    `What services does ${brand.name || 'this business'} offer?`,
    'Can I get a quote?',
    'How do I get in touch?',
  ];
  if (services[0]) out.push(`Tell me about ${services[0]}`);
  if (brand.location) out.push(`Do you serve ${brand.location}?`);
  return out;
}

function productivitySuggestions(brand = {}, allowed = []) {
  const services = brand.services || [];
  const biz = brand.name || 'the business';
  const byDept = {
    blog: [`Write a blog post about ${services[0] || 'your top service'}`],
    copy: ['Refresh the homepage hero copy'],
    page: [`Create a landing page for ${services[1] || 'a key service'}`],
    design: ['Switch to a modern color palette', 'Toggle the blog section on the homepage'],
    asset: [`Design an Instagram post for ${biz}`],
    social: ['Draft a social post announcing a promotion'],
    email: ["Draft this month's newsletter"],
    invoice: [`Draft an invoice for ${services[0] || 'a project'}`],
    outreach: ['Write a follow-up email to a client'],
    research: ['Research a prospective client'],
    print: ['Draft a flyer for a seasonal offer'],
    onboarding: ['Build a client intake form'],
  };
  const pool = [];
  for (const dept of allowed) if (byDept[dept]) pool.push(...byDept[dept]);
  return pool.length ? pool : ['What would you like to work on?'];
}

/** Return a shuffled slice of suggestions appropriate to the audience. */
export function suggestionsFor(audience, brand = {}, ctx = {}, n = 4) {
  const pool = audience === 'public'
    ? publicSuggestions(brand)
    : productivitySuggestions(brand, departmentsForAudience(audience, ctx));
  return pool.sort(() => Math.random() - 0.5).slice(0, n);
}
