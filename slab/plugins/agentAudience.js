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
 *   public       — unauthed site visitor. NO mutating departments. A concierge
 *                  that answers questions from brand context. (Lead capture is
 *                  handled separately by the deterministic captureContact form
 *                  flow, not by an agent department — see plugins/chat.js.)
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
  // design-family: theme/typography/visibility are the split of the old
  // catch-all 'design' department; all keep the same 'design' feature gate.
  design: 'design', theme: 'design', typography: 'design', visibility: 'design',
  asset: 'assets', social: 'social', print: 'print-studio',
  email: 'email-marketing', invoice: 'bookkeeping', outreach: 'clients',
  research: 'clients', onboarding: 'onboarding',
  // Social package departments (all gated by the 'social' feature).
  social_batch: 'social', carousel: 'social', story: 'social',
  social_insights: 'social', social_score: 'social', autopilot: 'social',
};

// Public visitors get a concierge, not a control panel. 'assist' = plain
// brand-aware Q&A is the ONLY agent department a public ✦ session may route to.
// Lead capture is NOT an agent department: it's handled deterministically by the
// captureContact form flow (plugins/chat.js) which writes to `inquiries` — more
// reliable than LLM extraction, and it keeps mutating tools off the public
// allow-list entirely (an unmapped department here would fall back to the copy
// writer in runDepartment, so we keep this list to non-mutating routes only).
export const PUBLIC_DEPARTMENTS = ['assist'];

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

// Deep, specific prompt pools keyed by the VIEW MODULE the ✦ modal is scoped to
// (agentLauncher's data-agent-scope / path map). Each pool is intentionally big
// and varied so the chips feel like they come from the agent in front of you and
// recycling (↻) surfaces genuinely different, non-generic ideas. Brand context
// (services/name/location) is threaded in to make them concrete.
function moduleSuggestions(module, brand = {}) {
  const s = brand.services || [];
  const s0 = s[0] || 'your top service';
  const s1 = s[1] || 'a key service';
  const biz = brand.name || 'the business';
  const loc = brand.location || 'your area';
  const M = {
    dashboard: [
      'What should I focus on today?', 'Summarize this week — wins and what slipped',
      'What’s overdue or needs attention?', 'Give me 3 quick wins for the business',
      'Where are we vs our goals this month?', 'What’s the single highest-leverage thing to do now?',
    ],
    bookkeeping: [
      'Break down this month’s budget vs actual', 'Which expense categories are over budget?',
      'Where can we realistically cut costs this month?', 'How are we tracking against projected revenue?',
      'Summarize our P&L and what stands out', 'What’s driving our net profit up or down?',
      'Flag any category with no spend that should have some', `Draft an invoice for ${s0}`,
    ],
    // Every chip here must be ONE writable post — the Blog agent's only tool is
    // write_blog_post, so asks like "5 title ideas" or "outline a content
    // calendar" silently came back as a full article instead. Chips also name a
    // real customer-facing SUBJECT: "write a local-SEO post targeting Greeley"
    // read as a post ABOUT SEO and produced "Optimize Your Lawn for Local SEO
    // Success in Greeley" — say the topic, let the post be locally targeted.
    blog: [
      `Write a 700-word how-to on ${s0}`,
      `Write a post about ${s0} for ${loc} customers`,
      `Compare ${s0} vs ${s1} as a buyer’s guide`,
      `Write a seasonal tips post about ${s0}`,
      `Answer the question customers most often ask about ${s0}`,
      `Write a post on common ${s0} mistakes and how to avoid them`,
      `Write a beginner’s guide to ${s1}`,
    ],
    social: [
      `Draft a week of posts about ${s0}`, 'Write a promo post with a strong CTA',
      'Turn our latest blog into 3 social posts', `Design an Instagram carousel about ${s0}`,
      'Write 5 captions in our brand voice', 'Plan a launch-day posting sequence',
      `Write a post welcoming new ${loc} customers`,
    ],
    'email-marketing': [
      'Draft this month’s newsletter', 'Write a 3-email welcome sequence',
      'A/B two subject lines for our next promo', 'Write a re-engagement email for cold leads',
      `Turn our ${s0} offer into a campaign`, 'Draft a follow-up sequence after a quote',
      'Write a win-back email with an incentive',
    ],
    design: [
      'Switch to a modern, high-contrast palette', 'Make the hero bolder and more editorial',
      `Suggest a font pairing that fits ${biz}`, 'Tighten spacing and rhythm site-wide',
      'Refresh the accent colors to feel premium', 'Audit the homepage for mobile readability',
      'Toggle the blog section on the homepage',
    ],
    copy: [
      'Refresh the homepage hero copy', 'Sharpen our value proposition in one line',
      'Rewrite the About blurb in our voice', 'Punch up the primary CTA text',
      `Write benefit-led copy for ${s0}`, 'Cut the fluff from our services section',
    ],
    layout: [
      'Reorder the homepage sections for impact', 'Toggle which sections show on the homepage',
      'Suggest the best section order for conversions', 'Add a testimonials section to the home',
    ],
    pages: [
      `Create a landing page for ${s0}`, 'Build a services overview page',
      'Draft an About page in our voice', `Create a lead-capture page for ${s1}`,
      'Add an FAQ section to a service page', `Write a comparison page: ${s0} vs ${s1}`,
    ],
    clients: [
      'Research a prospective client', 'Write a warm follow-up to a client',
      `Draft outreach to ${loc} businesses`, 'Summarize open inquiries and next steps',
      'Write a proposal intro for a new lead', 'Draft a check-in email for a quiet client',
    ],
    assets: [
      `Design an Instagram post for ${biz}`, `Generate a hero image for ${s0}`,
      'Create a promo graphic in our colors', 'Design a story background for a sale',
      `Make a thumbnail for a post about ${s0}`,
    ],
    onboarding: [
      'Build a client intake form', `Draft onboarding questions for ${s0}`,
      'Create a welcome checklist for new clients', 'Write a kickoff email template',
    ],
    'print-studio': [
      'Draft a flyer for a seasonal offer', `Write a one-page sell sheet for ${s0}`,
      'Design a postcard for a local promo', 'Write a rack-card blurb in our voice',
    ],
  };
  return M[module] || [];
}

function productivitySuggestions(brand = {}, allowed = []) {
  // No specific view in focus → a broad mix drawn from the deep module pools the
  // audience can actually act on (mapped dept → module).
  const deptToModule = {
    blog: 'blog', copy: 'copy', page: 'pages', design: 'design', asset: 'assets',
    social: 'social', email: 'email-marketing', invoice: 'bookkeeping',
    outreach: 'clients', research: 'clients', print: 'print-studio', onboarding: 'onboarding',
  };
  const pool = [];
  const seenMod = new Set();
  for (const dept of allowed) {
    const mod = deptToModule[dept];
    if (!mod || seenMod.has(mod)) continue;
    seenMod.add(mod);
    // Take a couple from each so the broad mix stays varied but not huge.
    pool.push(...moduleSuggestions(mod, brand).slice(0, 2));
  }
  return pool.length ? pool : ['What should I focus on today?', 'Give me 3 quick wins for the business'];
}

const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

/**
 * Shuffled slice of suggestions for the audience, scoped to the active view when a
 * `module` is given — so the chips come from the agent focus and recycle to fresh,
 * specific ideas rather than generic filler.
 */
export function suggestionsFor(audience, brand = {}, ctx = {}, n = 4, module = null) {
  if (audience === 'public') return shuffle(publicSuggestions(brand)).slice(0, n);
  if (module) {
    const scoped = moduleSuggestions(module, brand);
    if (scoped.length) return shuffle(scoped).slice(0, n);
  }
  return shuffle(productivitySuggestions(brand, departmentsForAudience(audience, ctx))).slice(0, n);
}
