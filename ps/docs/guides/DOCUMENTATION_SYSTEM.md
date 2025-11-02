# Documentation System Implementation

## Overview

A comprehensive documentation browsing system with automatic tree generation and scheduled updates via cron jobs.

## Features

### 1. Documentation Tree Generator

**Location:** `/srv/ps/scripts/generate-docs-tree.js`

**Purpose:** Scans the `zMDREADME` directory and generates a structured JSON tree with categories, metadata, and file information.

**Output:** `/srv/ps/public/data/docs-tree.json`

**Categories:**
- Getting Started
- Quick References
- Systems & Features
- Meta

**Metadata Extracted:**
- File name
- Title (from first # heading)
- Description (first paragraph)
- Last modified timestamp
- File size
- Category

**Manual Execution:**
```bash
node scripts/generate-docs-tree.js
```

---

### 2. Documentation Viewer

**Route:** `/help/documentation`

**View:** `/srv/ps/views/help/documentation.ejs`

**Features:**
- Sidebar navigation with categorized documents
- Markdown rendering using marked.js
- Syntax highlighting using highlight.js
- Responsive design with game-themed styling
- Welcome screen with quick start links
- Document statistics display

**URL Patterns:**
```
/help/documentation                    # Welcome screen
/help/documentation?doc=README         # View specific document
```

**Styling:**
- Dark theme matching game aesthetic
- Purple/cyan color scheme
- Smooth transitions and hover effects
- Mobile-responsive layout

---

### 3. Cron Job System

**Location:** `/srv/ps/plugins/cron/index.js`

**Purpose:** Manages scheduled tasks for the application.

**Current Jobs:**

#### Documentation Tree Update
- **Schedule:** `0 3 * * *` (Daily at 3:00 AM)
- **Timezone:** America/New_York
- **Action:** Regenerates documentation tree from zMDREADME directory
- **Startup:** Also runs once on application startup

**Initialization:**
```javascript
import { initializeCronJobs } from './plugins/cron/index.js';
initializeCronJobs();
```

**Functions:**
- `initializeCronJobs()` - Start all scheduled jobs
- `stopAllJobs()` - Stop all running jobs
- `getJobsStatus()` - Get status of all jobs
- `triggerJob(jobName)` - Manually trigger a job

---

### 4. Menu Integration

**Location:** `/srv/ps/views/menu-enhanced.ejs`

**Added Card:**
```html
<a href="/help/documentation" class="menu-card featured">
  <div class="card-glow"></div>
  <div class="menu-card-icon">📚</div>
  <h3>Documentation</h3>
  <p>Complete system guides, API references, and technical documentation</p>
  <div class="card-badge">Docs</div>
</a>
```

**Section:** Updates & Information

---

### 5. Admin API Endpoints

**Base Path:** `/admin/api/cron`

#### Get Cron Jobs Status
```
GET /admin/api/cron/status
```

**Response:**
```json
{
  "success": true,
  "jobs": [
    {
      "name": "Documentation Tree Update",
      "schedule": "0 3 * * *",
      "description": "Updates documentation tree daily at 3:00 AM",
      "running": true
    }
  ]
}
```

#### Manually Trigger Job
```
POST /admin/api/cron/trigger/:jobName
```

**Example:**
```bash
curl -X POST http://localhost:3399/admin/api/cron/trigger/Documentation%20Tree%20Update
```

**Response:**
```json
{
  "success": true,
  "message": "Job \"Documentation Tree Update\" triggered successfully"
}
```

---

## File Structure

```
/srv/ps/
├── scripts/
│   └── generate-docs-tree.js          # Tree generator script
├── plugins/
│   └── cron/
│       └── index.js                    # Cron job manager
├── routes/
│   ├── index.js                        # Documentation route added
│   └── admin/
│       └── index.js                    # Cron API endpoints
├── views/
│   └── help/
│       └── documentation.ejs           # Documentation viewer
├── public/
│   └── data/
│       └── docs-tree.json              # Generated tree (auto-updated)
└── zMDREADME/                          # Documentation source files
    ├── README.md
    ├── PROJECT_OVERVIEW.md
    ├── ASSET_BUILDER_COMPLETE.md
    ├── GALACTIC_MAP_COMPLETE.md
    ├── TESTER_SYSTEM_COMPLETE.md
    └── ... (12+ markdown files)
```

---

## How It Works

### Initial Setup (On Server Start)
1. `app.js` imports and calls `initializeCronJobs()`
2. Cron plugin registers scheduled tasks
3. Documentation tree is generated immediately
4. Cron job is scheduled for daily updates

### User Access
1. User navigates to `/help/documentation` from menu
2. Route handler loads docs-tree.json
3. If no specific doc requested, shows welcome screen
4. If doc requested via query param, renders markdown content
5. Sidebar shows categorized navigation

### Automated Updates
1. Every day at 3:00 AM, cron job triggers
2. `generate-docs-tree.js` scans zMDREADME directory
3. Extracts metadata from each .md file
4. Generates categorized JSON tree
5. Writes to `public/data/docs-tree.json`
6. Next page load shows updated documentation

### Manual Updates
1. Admin can trigger via API endpoint
2. Can also run script directly: `node scripts/generate-docs-tree.js`
3. Useful after adding/updating documentation files

---

## Adding New Documentation

1. Create markdown file in `/srv/ps/zMDREADME/`
2. Use clear naming convention (e.g., `FEATURE_NAME.md`)
3. Start with a level 1 heading (`#`) for title
4. Add description in first paragraph
5. Update `CATEGORY_MAP` in `generate-docs-tree.js` if needed
6. Run `node scripts/generate-docs-tree.js` to update index
7. Or wait for nightly cron job

**Example:**
```markdown
# New Feature Documentation

This is a comprehensive guide to the new feature system.

## Overview
...
```

---

## Customization

### Adding New Categories

Edit `/srv/ps/scripts/generate-docs-tree.js`:

```javascript
const CATEGORY_MAP = {
  'YOUR_FILE_NAME': 'New Category Name',
  // ...
};

const CATEGORY_ORDER = [
  'Getting Started',
  'New Category Name',  // Add here
  'Quick References',
  // ...
];
```

### Changing Cron Schedule

Edit `/srv/ps/plugins/cron/index.js`:

```javascript
// Change from daily at 3 AM
const docsUpdateJob = cron.schedule('0 3 * * *', async () => {

// To every hour
const docsUpdateJob = cron.schedule('0 * * * *', async () => {

// To every 6 hours
const docsUpdateJob = cron.schedule('0 */6 * * *', async () => {
```

**Cron Expression Format:**
```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └─ day of week (0-7)
│ │ │ │ └─── month (1-12)
│ │ │ └───── day of month (1-31)
│ │ └─────── hour (0-23)
│ └───────── minute (0-59)
└─────────── second (optional, 0-59)
```

### Styling Documentation Viewer

Edit `/srv/ps/views/help/documentation.ejs` styles section:

- Change color scheme by modifying CSS variables
- Adjust layout with grid-template-columns
- Customize markdown rendering styles in `.docs-body`

---

## Dependencies

**NPM Packages:**
- `node-cron` - Task scheduling

**Client-side Libraries (CDN):**
- `marked` - Markdown parsing
- `highlight.js` - Code syntax highlighting

---

## Monitoring

### Check Cron Status
```bash
# Via API
curl http://localhost:3399/admin/api/cron/status

# Check console logs
tmux attach -t ps_session
```

### View Generated Tree
```bash
cat /srv/ps/public/data/docs-tree.json
```

### Test Documentation Viewer
```
http://localhost:3399/help/documentation
http://localhost:3399/help/documentation?doc=README
```

---

## Troubleshooting

### Documentation Not Showing
1. Check if docs-tree.json exists: `ls -la /srv/ps/public/data/`
2. Run generator manually: `node scripts/generate-docs-tree.js`
3. Check for errors in browser console

### Cron Not Running
1. Check server logs for initialization message
2. Verify app.js imports and calls `initializeCronJobs()`
3. Check job status via admin API

### Markdown Not Rendering
1. Verify marked.js is loaded (check browser console)
2. Check for special characters that need escaping
3. Test markdown syntax in online editor first

---

## Future Enhancements

Potential improvements:
- Search functionality across all docs
- Table of contents generation for long documents
- Version history tracking
- Documentation contribution workflow
- PDF export functionality
- Dark/light theme toggle
- Code snippet copy buttons
- Documentation commenting system
- Cross-reference link validation
- Multi-language support

---

## Implementation Date

**Created:** October 28, 2025
**Version:** 1.0

---

## Related Files

- [Main README](README.md) - Documentation index
- [Project Overview](PROJECT_OVERVIEW.md) - Complete project guide
- [Tester Quick Reference](TESTER_QUICK_REFERENCE.md) - Testing guide

---

**Questions or issues?** Use the in-game bug ticket system or contact the development team.
