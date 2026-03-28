/**
 * Slab — Brand Context Builder
 * Assembles tenant brand info + design settings into a prompt-ready string
 * for all LLM agent system prompts across the platform.
 */

/**
 * Build a brand context block from the tenant's brand object.
 * Inject this into every agent system prompt so the LLM knows
 * who the business is without any hardcoded values.
 *
 * @param {object} brand   - req.tenant.brand  (name, location, businessType, etc.)
 * @param {object} [design] - optional design settings (agent_name, colors, fonts)
 * @returns {string} prompt-ready brand context block
 */
export function buildBrandContext(brand = {}, design = {}) {
  const lines = ['--- BRAND CONTEXT ---'];

  if (brand.name)         lines.push(`Business Name: ${brand.name}`);
  if (brand.businessType) lines.push(`Business Type: ${brand.businessType}`);
  if (brand.industry)     lines.push(`Industry: ${brand.industry}`);
  if (brand.tagline)      lines.push(`Tagline: ${brand.tagline}`);
  if (brand.description)  lines.push(`Description: ${brand.description}`);
  if (brand.location)     lines.push(`Location: ${brand.location}`);
  if (brand.serviceArea)  lines.push(`Service Area: ${brand.serviceArea}`);
  if (brand.phone)        lines.push(`Phone: ${brand.phone}`);
  if (brand.email)        lines.push(`Email: ${brand.email}`);
  if (brand.ownerName)    lines.push(`Owner/Contact: ${brand.ownerName}`);

  // Services list
  if (brand.services && brand.services.length) {
    lines.push(`Services Offered: ${brand.services.join(', ')}`);
  }

  // Pricing notes (e.g. "Web design $1500-5000, SEO $500-1500/mo")
  if (brand.pricingNotes) lines.push(`Pricing Guide: ${brand.pricingNotes}`);

  // Target audience
  if (brand.targetAudience) lines.push(`Target Audience: ${brand.targetAudience}`);

  // Brand voice / tone
  if (brand.brandVoice) lines.push(`Brand Voice: ${brand.brandVoice}`);

  // Social links
  if (brand.socialLinks && Object.keys(brand.socialLinks).length) {
    const socials = Object.entries(brand.socialLinks)
      .filter(([, url]) => url)
      .map(([platform, url]) => `${platform}: ${url}`)
      .join(', ');
    if (socials) lines.push(`Social Media: ${socials}`);
  }

  // Design tokens (if provided)
  if (design.agent_name && design.agent_name !== 'Assistant') {
    lines.push(`Agent Name: ${design.agent_name}`);
  }

  // Color palette
  const colorKeys = ['color_primary', 'color_primary_deep', 'color_primary_mid', 'color_accent', 'color_accent_light', 'color_bg'];
  const colors = colorKeys.filter(k => design[k]).map(k => `${k.replace('color_', '')}: ${design[k]}`);
  if (colors.length) lines.push(`Color Palette: ${colors.join(', ')}`);

  // Fonts
  if (design.font_heading) lines.push(`Heading Font: ${design.font_heading}`);
  if (design.font_body) lines.push(`Body Font: ${design.font_body}`);

  // Layouts
  if (design.landing_layout) lines.push(`Landing Layout: ${design.landing_layout}`);
  if (design.portfolio_layout) lines.push(`Portfolio Layout: ${design.portfolio_layout}`);
  if (design.blog_layout) lines.push(`Blog Layout: ${design.blog_layout}`);

  lines.push('--- END BRAND CONTEXT ---');

  return lines.join('\n');
}

/**
 * Convenience: load design settings from DB and build full context.
 * Use in route handlers where you have req.tenant and req.db.
 *
 * @param {object} tenant - req.tenant
 * @param {object} db     - req.db (tenant database)
 * @param {object} [designDefaults] - fallback design defaults
 * @returns {Promise<string>} brand context string
 */
export async function loadBrandContext(tenant, db, designDefaults = {}) {
  const brand = tenant?.brand || {};

  // Load design settings
  let design = { ...designDefaults };
  try {
    const rawDesign = await db.collection('design').find({}).toArray();
    for (const item of rawDesign) design[item.key] = item.value;
  } catch { /* non-fatal */ }

  return buildBrandContext(brand, design);
}
