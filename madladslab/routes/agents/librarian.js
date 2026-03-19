/**
 * LIBRARIAN — Copy Location Reference for Agents
 *
 * Returns a structured map of where public-facing copy lives across all /srv websites.
 * Each entry describes: location type (hardcoded/db/json/js), the file or model,
 * the specific field or section, and what kind of copy it is.
 *
 * Use this to pinpoint directives when an agent is tasked with changing copy.
 */

export const COPY_MAP = {

  madladslab: {
    label: "MadLadsLab (port 3000)",
    url: "madladslab.com",
    copyLocations: [
      {
        section: "Global Header / Brand Name",
        type: "hardcoded",
        file: "madladslab/views/mainContent/header.ejs",
        fields: ["brand name: 'MADLADSLAB'", "navigation labels"],
        notes: "Top-level nav across all pages"
      },
      {
        section: "Global Footer",
        type: "hardcoded",
        file: "madladslab/views/mainContent/footer.ejs",
        fields: [
          "tagline: 'Private AI assistants & smart home intelligence...'",
          "service links",
          "contact info",
          "legal links"
        ],
        notes: "Appears on all pages"
      },
      {
        section: "Home Page",
        type: "hardcoded",
        file: "madladslab/views/index.ejs",
        fields: ["hero copy", "feature sections"],
        notes: "Main landing page"
      },
      {
        section: "W2 Marketing Theme",
        type: "hardcoded",
        file: "madladslab/views/w2marketing/theme-w2.ejs",
        fields: ["all hero, services, and marketing copy"],
        notes: "Self-contained static HTML — all copy is inline"
      },
      {
        section: "Candace Wallace Theme",
        type: "hardcoded",
        file: "madladslab/views/w2marketing/theme-candace.ejs",
        fields: ["all portfolio and bio copy"],
        notes: "Self-contained static HTML — all copy is inline"
      },
      {
        section: "Political Theme",
        type: "hardcoded",
        file: "madladslab/views/w2marketing/theme-political.ejs",
        fields: ["all campaign copy"],
        notes: "Self-contained static HTML — all copy is inline"
      },
      {
        section: "Agent Presets (personality descriptions, system prompts)",
        type: "hardcoded_js",
        file: "madladslab/public/javascripts/agents-presets.js",
        fields: [
          "description per preset (e.g. 'Proactive service health watcher...')",
          "config.systemPrompt per preset",
          "config.backgroundPrompt per preset",
          "tone and style definitions"
        ],
        notes: "UI-facing preset copy; controls how agents present themselves"
      },
      {
        section: "Agents UI Labels & Error Messages",
        type: "hardcoded_js",
        file: "madladslab/public/javascripts/agents-ui.js",
        fields: ["button labels", "modal titles", "toast messages", "error strings"],
        notes: "All client-side UI text for agents interface"
      },
      {
        section: "Agents Hub Interface Copy",
        type: "hardcoded_js",
        file: "madladslab/public/javascripts/agents-hub.js",
        fields: ["hub section labels", "card text", "status messages"],
        notes: "Hub view UI copy"
      },
      {
        section: "Agent Records (dynamic)",
        type: "database",
        model: "madladslab/api/v1/models/Agent.js",
        fields: ["description", "config.systemPrompt", "config.backgroundPrompt"],
        collection: "agents",
        notes: "Per-agent copy stored in MongoDB; editable via admin"
      },
      {
        section: "GPC Training Content",
        type: "database",
        model: "madladslab/api/v1/models/gpc/TrainingModule.js",
        fields: ["title", "description", "sections[].title", "sections[].content", "quiz[].question"],
        collection: "trainingmodules",
        notes: "Restaurant training copy — fully DB-driven"
      },
      {
        section: "GPC Announcements & Communications",
        type: "database",
        model: "madladslab/api/v1/models/gpc/Communication.js",
        fields: ["title", "content"],
        collection: "communications",
        notes: "Types: announcement, update, event, discussion, celebration"
      },
      {
        section: "GPC Tasks",
        type: "database",
        model: "madladslab/api/v1/models/gpc/Task.js",
        fields: ["title", "description", "steps[].description"],
        collection: "tasks"
      },
      {
        section: "LBB Rewards Copy",
        type: "database",
        model: "madladslab/api/v1/models/lbb/Reward.js",
        fields: ["title", "description"],
        collection: "rewards",
        notes: "Seeded defaults: 'Welcome Bonus', 'Free Appetizer', '20% Off Next Visit'"
      },
      {
        section: "LBB / GPC Seed Defaults",
        type: "seed_file",
        file: "madladslab/scripts/seed-lbb-data.js",
        fields: ["location descriptions", "reward titles and descriptions"],
        notes: "Re-running seed overwrites DB copy with these defaults"
      },
      {
        section: "Blog Posts",
        type: "database",
        model: "madladslab/api/v1/models/Blog.js",
        fields: ["title", "content"],
        collection: "blogs"
      },
      {
        section: "Brand Records",
        type: "database",
        model: "madladslab/api/v1/models/Brand.js",
        fields: ["name", "tagline", "description"],
        collection: "brands"
      },
      {
        section: "Site Config",
        type: "database",
        model: "madladslab/api/v1/models/Site.js",
        fields: ["title", "description", "meta"],
        collection: "sites"
      }
    ]
  },

  ps: {
    label: "Stringborn Universe (port 3399)",
    url: "ps / stringborn",
    copyLocations: [
      {
        section: "Sales Landing Page",
        type: "hardcoded",
        file: "ps/views/index-sales.ejs",
        fields: [
          "hero: 'Forge Your Own Sci-Fi Universe'",
          "sub-hero: 'Community-Driven Universe Builder'",
          "feature cards: 'Combat Ready', 'Custom Assets', 'Vast Worlds'"
        ],
        notes: "Primary marketing copy for the game"
      },
      {
        section: "Onboarding Welcome",
        type: "hardcoded",
        file: "ps/views/onboarding/welcome.ejs",
        fields: ["welcome headline", "feature descriptions", "CTA labels"],
        notes: "First experience for new users"
      },
      {
        section: "Help & Documentation Hub",
        type: "hardcoded",
        file: "ps/views/help/documentation.ejs",
        fields: ["sidebar categories", "section headers"],
        notes: "Links to docs-tree.json for document titles/descriptions"
      },
      {
        section: "Documentation Tree (titles & descriptions)",
        type: "json_file",
        file: "ps/public/data/docs-tree.json",
        fields: ["category names", "document titles", "document descriptions"],
        notes: "Controls what appears in help sidebar; edit here to change doc labels"
      },
      {
        section: "Universe Constants & Terminology",
        type: "hardcoded_config",
        file: "ps/config/constants.js",
        fields: [
          "species names: Silicates, Lanterns, Devan, Humans",
          "String Domains: Time String, Tech String, Faith String, War String",
          "Talent Trees: Chronomancer Fork, Crystal Weaver Fork, Era Shifter Fork...",
          "Home locations: Alantir, Umbraxis, Seraphon, Sol"
        ],
        notes: "Core lore terminology — changing these affects entire universe naming"
      },
      {
        section: "Galaxy / Planet / Star / NPC Lore (seeded)",
        type: "seed_file",
        files: [
          "ps/scripts/seed-galaxies.js",
          "ps/scripts/seed-andromeda.js",
          "ps/scripts/seed-quantum-singularity.js",
          "ps/scripts/seed-planets.js",
          "ps/scripts/seed-npcs.js"
        ],
        notes: "Narrative descriptions seeded into DB — source of universe lore defaults"
      },
      {
        section: "Universe Assets (dynamic lore)",
        type: "database",
        model: "ps/models/ (Galaxy, Planet, Star, NPC, Ship)",
        fields: ["title", "description (narrative/flavor text)"],
        collection: "multiple",
        notes: "Seeded from scripts but editable via admin"
      },
      {
        section: "Patch Notes & Developer Letters",
        type: "markdown_files",
        directory: "ps/docs/",
        fields: ["CHANGELOG_LATEST.md", "PATCH_NOTES_*.md", "DEVELOPER_LETTER_*.md", "ROADMAP.md"],
        notes: "~100+ markdown files; ps/public/data/docs-tree.json indexes them"
      }
    ]
  },

  bih: {
    label: "BIH Broadcast Hub (port 3055)",
    url: "bih",
    copyLocations: [
      {
        section: "Home / Broadcast UI",
        type: "hardcoded",
        file: "bih/views/home.ejs",
        fields: [
          "'NO SIGNAL' status text",
          "'Want to broadcast? Contact Scott to request access.'",
          "button: 'GO LIVE'",
          "nav: 'Dashboard', 'Profile', 'Logout'"
        ],
        notes: "Primary user-facing copy"
      },
      {
        section: "Auth Pages",
        type: "hardcoded",
        files: ["bih/views/login.ejs", "bih/views/register.ejs"],
        fields: ["form labels", "button text", "error messages"]
      },
      {
        section: "Chat Interface",
        type: "hardcoded",
        file: "bih/views/partials/chat.ejs",
        fields: ["chat UI labels", "placeholder text"]
      },
      {
        section: "Chat Messages (dynamic)",
        type: "database",
        model: "bih/models/ChatMessage.js",
        fields: ["message"],
        collection: "chatmessages"
      },
      {
        section: "Support Tickets (dynamic)",
        type: "database",
        model: "bih/models/Ticket.js",
        fields: ["title", "description"],
        collection: "tickets"
      }
    ]
  },

  nocometalworkz: {
    label: "NoCo Metal Workz (service website)",
    url: "nocometalworkz.com",
    copyLocations: [
      {
        section: "ALL Marketing Copy",
        type: "json_file",
        file: "nocometalworkz/data/content.json",
        fields: [
          "company.name: 'NoCo Metal Workz'",
          "company.tagline: 'Steel Built. Colorado Strong.'",
          "hero.eyebrow, hero.title, hero.subtitle",
          "hero.ctaPrimary: 'Get a Free Quote'",
          "hero.ctaSecondary: 'View Our Work'",
          "stats[]: '15+ Years Experience', '800+ Projects Completed', '100% Licensed & Insured'",
          "about.title, about.body, about.credentials[]",
          "services[]: {icon, name, description} x4 (Custom Welding, Fence Installation, Metal Fabrication, Wrought Iron)",
          "contact.phone, contact.email, contact.serviceArea"
        ],
        notes: "THIS IS THE ONLY COPY FILE — all marketing copy for this site lives here. Template at views/index.ejs reads from this JSON."
      }
    ]
  },

  candaceWallace: {
    label: "Candace Wallace Portfolio",
    url: "candacewallace.com",
    copyLocations: [
      {
        section: "All Portfolio Copy",
        type: "hardcoded",
        file: "candaceWallace/views/index.ejs",
        fields: [
          "wordmark: 'Candace Wallace'",
          "subtitle / role title",
          "hero messaging",
          "all section copy"
        ],
        notes: "Single-page site — all copy is inline in the template"
      },
      {
        section: "SEO / Meta Copy",
        type: "hardcoded",
        file: "candaceWallace/views/index.ejs",
        fields: [
          "og:title: 'Candace Wallace — Marketing Strategy'",
          "og:description: 'Senior marketing strategy for brands, businesses, and causes...'"
        ]
      },
      {
        section: "MadLadsLab Candace Theme (alternate route)",
        type: "hardcoded",
        file: "madladslab/views/w2marketing/theme-candace.ejs",
        notes: "Second copy location if served through madladslab multi-tenant"
      }
    ]
  },

  w2Marketing: {
    label: "W2 Marketing Agency",
    url: "w2marketing.com",
    copyLocations: [
      {
        section: "Agency Landing Page",
        type: "hardcoded",
        file: "w2Marketing/views/index.ejs",
        fields: [
          "nav logo: 'W2'",
          "navigation labels",
          "hero copy",
          "services overview"
        ],
        notes: "Primary agency site"
      },
      {
        section: "SEO / Meta Copy",
        type: "hardcoded",
        file: "w2Marketing/views/index.ejs",
        fields: [
          "og:title: 'W2 Marketing - Social Media & Web Design | Greeley, CO'",
          "og:description: 'Social media management, website design, and content creation for local businesses in Greeley, Colorado.'"
        ]
      },
      {
        section: "MadLadsLab W2 Theme (alternate route)",
        type: "hardcoded",
        file: "madladslab/views/w2marketing/theme-w2.ejs",
        notes: "Second copy location if served through madladslab multi-tenant"
      }
    ]
  },

  greealitytv: {
    label: "GreeAlityTV — Community News",
    url: "greealitytv.com",
    copyLocations: [
      {
        section: "Home Page Hero",
        type: "hardcoded",
        file: "greealitytv/views/index.ejs",
        fields: [
          "hero: 'Greeley, Colorado'",
          "sub-hero: 'Your City. Your Neighbors. Your Hub.'",
          "body: 'From downtown to the neighborhoods — local news, community stories...'",
          "CTAs: 'Read the Feed', 'Community Votes'",
          "section headers: 'Latest Articles', 'Video Stories'"
        ],
        notes: "Primary marketing copy"
      },
      {
        section: "Articles & Posts (dynamic)",
        type: "database",
        model: "greealitytv/models/Post.js",
        fields: ["title", "excerpt", "content"],
        collection: "posts"
      },
      {
        section: "Video Stories (dynamic)",
        type: "database",
        model: "greealitytv/models/Video.js",
        fields: ["title", "description"],
        collection: "videos"
      }
    ]
  },

  acm: {
    label: "ACM Hospitality Group",
    url: "acm / hospitality",
    copyLocations: [
      {
        section: "Landing Page — All Copy",
        type: "hardcoded",
        file: "acm/views/index.ejs",
        fields: [
          "'Hospitality & Restaurant Group'",
          "'Crafting community through food, drink & atmosphere'",
          "Restaurant cards: The Nook, Heyday, Graffiti Pasta — each with location + description",
          "'Stay Connected' contact form labels"
        ],
        notes: "Single-page — all copy inline"
      }
    ]
  },

  sfg: {
    label: "SFG — Service Factory Guild",
    url: "sfg",
    copyLocations: [
      {
        section: "All Views",
        type: "hardcoded",
        files: [
          "sfg/views/index.ejs",
          "sfg/views/signups/signups.ejs",
          "sfg/views/signups/testimonials.ejs",
          "sfg/views/signups/volunteers.ejs"
        ],
        fields: ["form labels", "section headers", "CTA buttons"],
        notes: "Inline copy throughout views"
      }
    ]
  }

};

/**
 * Get copy locations for a specific site.
 * @param {string} siteKey - Key from COPY_MAP (e.g. 'madladslab', 'nocometalworkz')
 * @returns {object|null}
 */
export function getSiteCopy(siteKey) {
  return COPY_MAP[siteKey] || null;
}

/**
 * Get all locations of a specific copy type across all sites.
 * @param {'hardcoded'|'database'|'json_file'|'hardcoded_js'|'hardcoded_config'|'seed_file'|'markdown_files'} type
 * @returns {Array}
 */
export function getCopyByType(type) {
  const results = [];
  for (const [siteKey, site] of Object.entries(COPY_MAP)) {
    for (const loc of site.copyLocations) {
      if (loc.type === type) {
        results.push({ site: siteKey, siteLabel: site.label, ...loc });
      }
    }
  }
  return results;
}

/**
 * Search copy locations by section name or field content keyword.
 * @param {string} keyword
 * @returns {Array}
 */
export function searchCopy(keyword) {
  const kw = keyword.toLowerCase();
  const results = [];
  for (const [siteKey, site] of Object.entries(COPY_MAP)) {
    for (const loc of site.copyLocations) {
      const haystack = JSON.stringify(loc).toLowerCase();
      if (haystack.includes(kw)) {
        results.push({ site: siteKey, siteLabel: site.label, ...loc });
      }
    }
  }
  return results;
}

/**
 * Full reference dump — returns all sites and their copy map.
 * Useful as agent context injection.
 */
export function getFullCopyMap() {
  return COPY_MAP;
}

export default { COPY_MAP, getSiteCopy, getCopyByType, searchCopy, getFullCopyMap };
