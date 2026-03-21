# W2 Marketing

Official website and admin platform for **W2 Marketing** — a digital marketing agency in Greeley, Colorado. Built and maintained by MadLads Lab.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 22, ESM (`"type": "module"`) |
| Framework | Express 4 + EJS |
| Database | MongoDB (shared `madLadsLab` cluster) |
| Auth | Google OAuth 2.0 → JWT (httpOnly cookie) |
| Storage | Linode Object Storage (S3-compatible) |
| AI | Ollama `qwen2.5:7b` + Brave Search API |
| Session | express-session + connect-mongo |
| Dev | nodemon |

## Quick Start

```bash
# Attach to the running tmux session
tmux attach -t 5

# Start dev server (if not running)
npx nodemon bin/www.js

# Kill stale port if EADDRINUSE
fuser -k 3601/tcp
```

**URL:** `http://localhost:3601` (proxied to domain via Apache)

## Directory Structure

```
w2Marketing/
├── app.js                        # Express app — middleware, routes, error handler
├── bin/www.js                    # Entry point
├── config/
│   └── config.js                 # All env vars with defaults
├── plugins/
│   ├── agentMcp.js               # AI agent MCP module (tools, LLM, web search)
│   ├── mongo.js                  # MongoDB connection
│   ├── passport.js               # Google OAuth 2.0 strategy
│   ├── reviews.js                # Google Places reviews (24h cache)
│   └── s3.js                     # Linode Object Storage client
├── middleware/
│   ├── jwtAuth.js                # requireAdmin — JWT cookie verification
│   └── upload.js                 # multer-s3 image upload handlers
├── routes/
│   ├── index.js                  # Public site (/, /blog, /blog/:slug, /:slug)
│   ├── auth.js                   # /auth/google, /auth/google/callback, /auth/logout
│   ├── admin.js                  # Admin router + dashboard GET
│   └── admin/
│       ├── masterAgent.js        # Master AI agent + MCP HTTP endpoint
│       ├── copy.js               # Site copy + copy agent
│       ├── blog.js               # Blog posts + blog agent
│       ├── sections.js           # Landing page sections + section agent
│       ├── design.js             # Design tokens + visibility + agent settings
│       ├── portfolio.js          # Portfolio items + image upload
│       ├── clients.js            # Client records
│       └── pages.js              # Custom dynamic pages
└── views/
    ├── index.ejs                 # Public landing page (theme-driven)
    ├── blog/                     # Blog listing + single post
    ├── page.ejs                  # Dynamic custom page renderer
    └── admin/
        ├── dashboard.ejs         # Dashboard + master agent chat
        ├── login.ejs             # Google OAuth login screen
        ├── partials/             # head.ejs, sidebar.ejs
        ├── blog/                 # Blog list + form (+ blog agent)
        ├── copy/                 # Site copy editor (+ copy agent)
        ├── design/               # Design & settings (+ agent config)
        ├── sections/             # Sections editor (+ section agent)
        ├── portfolio/            # Portfolio items
        ├── clients/              # Client records
        └── pages/                # Custom pages
```

## Admin Panel

Access at `/admin/login`. Requires a Google account with `isW2Admin: true` in the `users` collection.

### Modules

| Module | URL | Purpose |
|---|---|---|
| Dashboard | `/admin` | Stats overview + master AI agent |
| Site Copy | `/admin/copy` | Edit all landing page text |
| Design & Settings | `/admin/design` | Colors, fonts, visibility, agent name |
| Sections | `/admin/sections` | Manage landing page sections |
| Blog | `/admin/blog` | Blog post CRUD |
| Portfolio | `/admin/portfolio` | Portfolio items + images |
| Clients | `/admin/clients` | Client records |
| Pages | `/admin/pages` | Dynamic custom pages |

### Granting Admin Access

```js
db.users.updateOne(
  { email: "user@example.com" },
  { $set: { isW2Admin: true } }
)
```

## AI Agents

Five AI agents powered by `qwen2.5:7b` via Ollama. All use a **search-first, inject-context, single-call** pattern (no tool-calling loops).

### Master Agent (Dashboard)

The central orchestrator accessible from the admin dashboard. Uses a **two-step flow**:

1. **Research step** (`POST /admin/master-agent/research`) — classifies the request and performs one Brave web search. Returns immediately so the dashboard can show `🔍 Searched: {query}` while content is being generated.
2. **Generate step** (`POST /admin/master-agent`) — receives the research context, runs the appropriate MCP tool, and returns the result with `suggestions[]` — three contextual follow-up prompt chips shown in the dashboard.

Results can be applied three ways:
- **Apply Now** — writes directly to the database via `POST /admin/master-agent/execute`
- **Open in Editor** — relays via `sessionStorage('w2_agent_fill')` to the target editor for review
- **Follow-up chips** — contextual suggestions replace the quick-prompt row after each response

**Departments:** `blog` · `copy` · `section` · `page`

### Copy Agent
Fills site copy fields (hero, services, about, contact) with AI-generated marketing copy.

**Endpoint:** `POST /admin/copy/agent`

### Blog Agent
Writes full blog posts (title, excerpt, HTML content, category, tags) with live Brave web search for current information.

**Endpoint:** `POST /admin/blog/agent`

### Section Agent
Generates content for custom landing page sections (text, split, CTA, cards, FAQ templates).

**Endpoint:** `POST /admin/sections/agent`

### Page Agent
Writes content pages (HTML body + SEO), landing pages (block layout), or data-list pages (title + SEO). For landing pages returns `suggestedBlocks[]` which auto-populates the block builder.

**Endpoint:** `POST /admin/pages/agent`

### MCP HTTP Endpoint
All agent tools are exposed as a standard MCP server usable by Claude Desktop or Claude Code.

```
GET  /admin/master-agent/mcp   → server info + tool list
POST /admin/master-agent/mcp   → JSON-RPC 2.0 (initialize, tools/list, tools/call)
```

Available tools: `web_search`, `fetch_url`, `fill_site_copy`, `write_blog_post`, `fill_section`, `write_page`

**To use with Claude Code**, add to your MCP config:
```json
{
  "mcpServers": {
    "w2marketing": {
      "url": "https://yourdomain.com/admin/master-agent/mcp",
      "headers": { "Cookie": "w2_token=<your-jwt>" }
    }
  }
}
```

## Pages

Custom pages live at `/{slug}` and support three types:

| Type | Description |
|---|---|
| **Content** | Free-form HTML editor — articles, policies, info pages |
| **Data List** | Auto-paginated card grid pulling from Blog or Portfolio. Navigate with `?p=2`, `?p=3`, etc. |
| **Landing Page** | Visual block builder — add, reorder, and edit blocks of different templates |

### Landing Page Blocks

| Block | Fields |
|---|---|
| `hero` | heading, subheading, cta_text, cta_link |
| `text` | heading, subheading, body (HTML) |
| `split` | heading, body, cta_text, cta_link + image |
| `cta` | heading, subtext, btn_text, btn_link |
| `cards` | heading, subtext, up to 4 cards (title + body each) |
| `faq` | heading, up to 5 Q&A pairs (accordion on frontend) |

### Indexing Options (per page)

| Field | Values |
|---|---|
| `robotsMeta` | `index,follow` / `noindex,follow` / `index,nofollow` / `noindex,nofollow` |
| `sitemapPriority` | 0.0–1.0 (default 0.5) |
| `sitemapChangefreq` | always / hourly / daily / weekly / monthly / yearly / never |
| `canonicalUrl` | Override canonical URL (leave blank for default) |
| `ogImage` | Open Graph image URL for social sharing |

### Sitemap

Auto-generated at `/sitemap.xml` — includes all published pages and blog posts with their priority and change frequency settings.

### Page Agent

`POST /admin/pages/agent` — accessible from the page editor via "✦ Page Agent" panel.
- **Content pages**: generates HTML body + SEO fields
- **Landing pages**: generates suggested block layout (auto-populates the block builder)
- **Data-list pages**: generates title and SEO fields only

Also available as MCP tool `write_page` at `/admin/master-agent/mcp`.

## Custom Sections

Admin-created landing page sections that render between the Contact section and Footer. Five templates:

| Template | Layout |
|---|---|
| `text` | Full-width heading + body copy |
| `split` | Text left, image right with optional CTA button |
| `cta` | Bold call-to-action banner with optional background image |
| `cards` | Heading + up to 4 feature cards with optional images |
| `faq` | Expandable Q&A accordion |

Managed at `/admin/sections`. Visible sections render automatically on the public home page in creation order.

## Design System

The public site theme is fully driven by the `w2_design` MongoDB collection, editable at `/admin/design`.

**Color tokens:** `color_primary`, `color_primary_deep`, `color_primary_mid`, `color_accent`, `color_accent_light`, `color_bg`

**Font tokens:** `font_heading`, `font_body` (Google Fonts)

**Visibility flags:** `vis_hero`, `vis_services`, `vis_portfolio`, `vis_about`, `vis_process`, `vis_reviews`, `vis_contact`, `vis_blog`

**Agent settings:** `agent_name`, `agent_greeting`

## MongoDB Collections

All collections live in the shared `madLadsLab` database.

| Collection | Description |
|---|---|
| `w2_copy` | Site copy — key/value pairs |
| `w2_design` | Design tokens, visibility flags, agent settings |
| `w2_blog` | Blog posts |
| `w2_portfolio` | Portfolio items |
| `w2_clients` | Client records |
| `w2_pages` | Dynamic custom pages |
| `w2_section_media` | Hardcoded section image URLs |
| `w2_custom_sections` | Admin-created landing page sections |
| `w2_invoices` | Invoices (open count shown on dashboard) |
| `w2_reviews_cache` | Google Places review cache (24h TTL) |
| `w2_sessions` | OAuth session store |

## File Storage

Images and files are stored in **Linode Object Storage** (S3-compatible).

- **Bucket:** `madladslab`
- **Prefix:** `w2marketing/`
- **Public URL pattern:** `https://madladslab.us-ord-1.linodeobjects.com/w2marketing/<subdir>/<filename>`
- **Subdirs:** `portfolio/`, `clients/`, `sections/`

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `3601`) |
| `NODE_ENV` | `production` or `development` |
| `DOMAIN` | Full domain URL (e.g. `https://w2marketing.biz`) |
| `DB_URL` | MongoDB connection string |
| `DB_NAME` | Database name (`madLadsLab`) |
| `GGLCID` | Google OAuth client ID |
| `GGLSEC` | Google OAuth client secret |
| `JWT_SECRET` | JWT signing secret |
| `SESHSEC` | Session secret |
| `LINODE_ACCESS` | Linode Object Storage access key |
| `LINODE_SECRET` | Linode Object Storage secret key |
| `LINODE_BUCKET` | Bucket name (`madladslab`) |
| `LINODE_URL` | Storage endpoint (`https://us-ord-1.linodeobjects.com`) |
| `LINODE_REGION` | Region (`us-ord-1`) |
| `GOOGLE_PLACES_KEY` | Google Places API key (optional — for reviews) |
| `GOOGLE_PLACE_ID` | Google Place ID for W2 Marketing (optional) |
| `SEARCH_API_KEY` | Brave Search API key (required for AI agents) |

## Auth Flow

1. User visits `/admin/*` → `requireAdmin` middleware checks `w2_token` httpOnly cookie
2. No valid token → redirect to `/admin/login`
3. "Sign in with Google" → `/auth/google` → Google OAuth → `/auth/google/callback`
4. Callback: looks up email in `users` collection, checks `isW2Admin: true`
5. Authorized → JWT issued as `w2_token` httpOnly cookie (8h) → redirect to `/admin`
6. Unauthorized → redirect to `/admin/login?error=unauthorized`

## Apache VirtualHost

```apache
<VirtualHost *:443>
    ServerName w2marketing.biz
    ProxyPass / http://localhost:3601/
    ProxyPassReverse / http://localhost:3601/
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # SSL config here
</VirtualHost>
```

Add to Google Cloud Console **Authorized redirect URIs**:
```
https://w2marketing.biz/auth/google/callback
```
