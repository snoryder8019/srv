# Claude AI Context - Stringborn Universe

**Last Updated:** November 5, 2025 (Zone Template Critical Fix)
**Current Version:** v0.8.7 (Critical Zone Template EJS Syntax Error)
**Purpose:** Efficient context loading for AI assistance sessions

---

## ⚠️ CRITICAL: SERVICE MANAGEMENT

### TMUX Session Management (MUST USE - Multiple Services on VM!)
**IMPORTANT:** This VM runs multiple services. NEVER use `killall node` or similar commands that kill ALL processes!

```bash
# List all running tmux sessions
tmux ls

# Available sessions (as of Oct 30, 2025):
# - ps (port 3399)           - Main Stringborn Universe service
# - game-state (port 3500)   - Game state service
# - madladslab (port 3000)   - Main lab service
# - acm, nocometalworkz, sfg, sna, twww, w2portal, madThree (other services)

# Attach to PS service
tmux attach -t ps

# Kill ONLY the PS service (safe way)
tmux kill-session -t ps

# Restart ONLY the PS service
tmux kill-session -t ps
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"

# Restart ALL services (use start script)
/srv/start-all-services.sh

# Check if PS is running
lsof -ti:3399

# View PS logs in real-time
tmux attach -t ps    # Press Ctrl+B then D to detach

# Kill specific process by port (safer than killall)
lsof -ti:3399 | xargs kill -9
```

### Service Restart Protocol
1. **Preferred:** Restart specific tmux session
2. **Emergency:** Use `/srv/start-all-services.sh` to restart all
3. **NEVER:** Use `killall node` (affects other services!)

---

## 🎯 Project Quick Context

**Stringborn Universe** is a community-driven sci-fi MMO universe platform with:
- Express.js backend (ES Modules) on port 3399
- MongoDB database: `projectStringborne`
- Real-time Socket.IO multiplayer
- Full 3D universe with Three.js rendering
- Community asset creation and democratic voting system
- Persistent universe state with coordinate systems

**Server Location:** `/srv/ps/`
**Active Session:** `tmux attach -t ps_session`
**Database:** MongoDB running on default port

---

## 📊 Latest Changes Since Last Documentation

### Recent Commits (Last 5)
```
[Current] - 2025-11-05 - v0.8.7 - Critical Zone Template EJS Syntax Error ⭐ LIVE PRODUCTION
f6ec015 - 2025-11-05 - socket location stable
b3517f1 - 2025-11-05 - Refactor: Socket.IO player coordinates and galactic level standardization
ac723ba - 2025-11-05 - v0.8.6 - Infrastructure & Documentation Organization
c965686 - 2025-11-05 - commit 8.0.6
```

### Today's Session Additions (Nov 5, 2025)

**v0.8.7 - Critical Zone Template EJS Syntax Error (CRITICAL BUG FIX):**
1. ✅ Fixed zone.ejs line 166: Changed `<%= %>` to `<%- %>` for characterData JSON
2. ✅ Added Socket.IO client library to zone.ejs head section
3. ✅ Implemented proper script loading order with defer attribute
4. ✅ Created comprehensive patch notes (PATCH_NOTES_v0.8.7.md)
5. ✅ Updated CHANGELOG_LATEST.md with commit details
6. ✅ Updated PATCH_NOTES_INDEX.md with v0.8.7 entry

**Critical Bug Fixed:**
- **Issue:** Zone pages at `/universe/zone/:zoneId` failed to load
- **Error:** `SyntaxError: expected property name, got '&'` in browser console
- **Root Cause:** EJS `<%= %>` HTML-escapes JSON, turning `&` into `&amp;`
- **Solution:** Changed to `<%- %>` which outputs raw, unescaped content
- **Impact:** All zone interior pages now load correctly

**Key Technical Lesson:**
When embedding JSON in EJS templates, ALWAYS use `<%-` (unescaped) not `<%=` (HTML-escaped). HTML escaping breaks JSON parsing.

**Files Modified:**
- `views/universe/zone.ejs` - Critical fix on line 166, Socket.IO integration, script loading
- `docs/PATCH_NOTES_v0.8.7.md` - New comprehensive patch notes
- `docs/CHANGELOG_LATEST.md` - Updated with v0.8.7 commit
- `docs/PATCH_NOTES_INDEX.md` - Added v0.8.7 entry
- `docs/CLAUDE.md` - Session summary and version update

**Testing Verified:**
- `/universe/zone/690a8ea829c03e47b2000138` - Loads successfully
- Zone data properly initialized in browser window
- Character data correctly parsed
- No JSON syntax errors in console

**Database Changes:** None (template-only fix)

### Previous Session (Nov 3, 2025)

**v0.8.5 - Terminal Interface Overhaul (MAJOR FEATURE RELEASE):**
1. ✅ Created three terminal-themed overlays: Character, Inventory, Profile
2. ✅ Implemented color-coded themes (Blue/Cyan/Purple) matching The Tome's green aesthetic
3. ✅ Added split-view inventory layout (Equipment/Fittings/Locations + Items grid)
4. ✅ Implemented unified terminal CSS framework for all overlays
5. ✅ Fixed critical import map syntax error (JavaScript in JSON block)
6. ✅ Fixed navigateWithConfirmation function definition timing issue
7. ✅ Added early script loading pattern for onclick handler availability
8. ✅ Integrated terminal overlays with Navigation Hub menu
9. ✅ Implemented lazy data loading with client-side caching
10. ✅ Added terminal-authentic UI elements (prompts, cursors, monospace fonts)

**Key Technical Changes:**
- **Terminal Overlay System:** Single CSS framework with color-coded themes
- **Character Terminal:** Blue (#0066ff) with Overview/Attributes/Skills/Bio tabs
- **Inventory Terminal:** Cyan (#00ffff) with Backpack/Ship/Storehouse tabs + split-view
- **Profile Terminal:** Purple (#8a4fff) with Account/Characters/Achievements/Statistics tabs
- **Early Script Loading:** Global window functions defined before DOM for onclick access
- **Function Pattern:** `window.functionName = function() {}` for global availability
- **Lazy Loading:** Data fetched only on first overlay open, cached in memory
- **2 files changed:** galactic-map-3d.ejs (1500+ lines), patch-notes.ejs (documentation)

**Files Modified:**
- `views/universe/galactic-map-3d.ejs` - Complete terminal overlay system implementation
- `views/help/patch-notes.ejs` - Comprehensive v0.8.5 documentation
- `api/v1/universe/index.js` - Added /tome-data endpoint for overlay data fetching

**Critical Bug Fixes:**
- Import Map Error: Moved JavaScript out of JSON importmap block
- Function Timing: Moved navigateWithConfirmation to early script block
- Navigation Confirmation: Fixed dialog display and ESC key handling
- Tome Click Handler: Fixed window.openTomeOverlay availability

### Previous Session (Nov 3, 2025)

**v0.8.3 - Orbital Trail Visualization (LIVE PRODUCTION - Session 2):**
1. ✅ Added white orbital trail rings behind planets in galaxy view
2. ✅ Implemented tapered opacity gradient (bright at planet → transparent at star)
3. ✅ Trail follows planet's past path (90-degree arc / quarter orbit)
4. ✅ Dynamic trail animation updates every frame as planets orbit
5. ✅ Trails anchored to parent star with proper inclination support
6. ✅ Additive blending for bright white glow effect
7. ✅ 64-segment smooth curves with vertex color gradients
8. ✅ Removed experimental haze systems (sprites not rendering in pipeline)

**Key Technical Changes:**
- **Trail System:** LineBasicMaterial with vertexColors and AdditiveBlending
- **Trail Animation:** Real-time position updates in animate() loop (lines 2530-2546)
- **Trail Creation:** Generated during planet initialization (lines 3695-3747)
- **Trail Length:** π/2 radians (90° arc) behind each planet
- **Visual Effect:** White "pen stripe" comet tails showing orbital history
- **1 file changed:** galactic-map-3d.js - orbital trail rendering and animation

**Previous Session (Earlier Nov 2, 2025):**

**v0.8.2 - Cinematic Animations & Interaction Fix (LIVE PRODUCTION - Session 1):**
1. ✅ Implemented cinematic zoom-in animation when clicking galaxy in galactic view (750ms)
2. ✅ Added dramatic star expansion animation from galaxy center (750ms quartic ease-in)
3. ✅ Implemented zoom-out animation with proper directional vector to galactic view
4. ✅ Fixed camera orbit drift during star expansion (locked camera orientation)
5. ✅ Fixed camera offset/jump at end of animations
6. ✅ Galaxy labels now stick to galaxy orbs during physics movement (parent-child groups)
7. ✅ Disabled raycasting on all label sprites to fix click-through issues
8. ✅ Fixed star/galaxy/anomaly userData for proper raycasting in galaxy interior view
9. ✅ All zoom animations use snappy 750ms quartic ease-in timing
10. ✅ Saved camera states for proper zoom vector orientation

**Key Technical Changes:**
- **Animation System:** 3-stage zoom sequence (galactic→galaxy zoom, star expansion, galaxy→galactic zoom-out)
- **Camera Management:** Saved galaxy position in galactic space for proper zoom vectors
- **Label System:** THREE.Group hierarchy for galaxies (mesh + label as children)
- **Raycasting Fix:** `label.raycast = () => {}` to make labels non-interactive
- **UserData Fix:** Added `userData.id` and `userData.type` to all galaxy interior objects
- **1 file changed:** galactic-map-3d.js - comprehensive animation and interaction overhaul

### Previous Session (Nov 1, 2025)

**v0.8.1 - 3D Galactic Map Rebuild & Connection System (LIVE PRODUCTION):**
1. ✅ Complete rebuild of galaxy drill-down rendering system
2. ✅ Fixed star visibility in galaxy view (stars now persist)
3. ✅ Implemented color-coded label system (purple galaxies, white anomalies, yellow stars)
4. ✅ Increased galaxy orb size from 25 to 50 units for better visibility
5. ✅ Increased anomaly orb size from 15 to 40 units
6. ✅ Added parent galaxy as semi-transparent orb in galaxy view
7. ✅ Integrated anomalies into galaxy drill-down view
8. ✅ Removed camera clipping issues (near: -500k, far: 500k)
9. ✅ Connection system infrastructure (API endpoint, data structures)
10. ✅ Fixed multiple bugs (duplicate variables, class exports, star vanishing)

**Key Technical Changes:**
- **Star Rendering:** Minimal approach - simple spheres added to assetsGroup
- **Camera Configuration:** Expanded frustum planes to prevent clipping
- **Label System:** Canvas-based text sprites with color coding
- **Connection System:** physicsService.getConnections(), activeConnections storage
- **98 files changed:** 6,633 insertions, 1,527 deletions

**Files Modified:**
- `public/javascripts/galactic-map-3d.js` - Complete rebuild of galaxy view
- `views/universe/galactic-map-3d.ejs` - Version updates & connection loading
- `api/v1/routes/galactic-state.js` - Added connections to API response
- `services/physics-service.js` - Connection getter & storage
- Created 5 comprehensive session notes in `docs/session-notes/`

### Previous Session (Oct 31, 2025)

**v0.5.3 - Mobile Documentation Modals & Cron Verification:**
1. ✅ Implemented mobile-responsive documentation modal/lightbox system
2. ✅ Added JavaScript interceptor for doc links on mobile devices (≤768px)
3. ✅ Created dynamic modal with proper styling matching app theme
4. ✅ Integrated markdown rendering and syntax highlighting in modal
5. ✅ Added smooth animations and transitions for modal open/close
6. ✅ Verified cron jobs are running correctly (docs tree, patch notes, activity tokens)
7. ✅ Improved mobile UX - docs now open in overlay instead of navigation

### Previous Session (Oct 30, 2025)

**v0.5.2 - Daily MOTD System & Cookie Consent:**
1. ✅ Created MOTD database model with Mongoose
2. ✅ Built RESTful API endpoints for MOTD management
3. ✅ Designed terminal-aesthetic lightbox modal component
4. ✅ Implemented 24-hour localStorage tracking
5. ✅ Integrated lightbox into menu and galactic map pages
6. ✅ Created admin interface at `/admin/motd` for MOTD management
7. ✅ Added initial MOTD creation script
8. ✅ Implemented cookie consent banner for landing page with localStorage tracking

**v0.5.1 - Simulation Speed & Anomaly Positioning:**
1. ✅ Repositioned anomalies in universe (not at origin anymore)
2. ✅ Sped up physics simulation (2x faster)
3. ✅ Optimized GameStateMonitor tick rate (40 updates/sec)
4. ✅ Updated galactic map physics timestep
5. ✅ Reset test universe with new anomaly/galaxy positions
6. ✅ Added TMUX service management to CLAUDE.md

**Key Changes Made:**
- **Anomaly Position:** Moved from (0,0,0) to (-800, 600, -400) for visual diversity
- **Galaxy Position:** Moved from (500, 300, 200) to (1200, -500, 800) for clear separation
- **Physics Service:** Tick rate 100ms → 50ms (20 ticks/sec)
- **GameStateMonitor:** Tick rate 50ms → 25ms (40 updates/sec)
- **Galactic Map Physics:** timestep 1/60 → 1/30 (2x speed)

**Files Modified/Created Today:**

*Mobile Documentation Modals (v0.5.3 - Oct 31, 2025):*
- `views/help/documentation.ejs` - Added mobile modal system with JavaScript interceptor

*MOTD System & Cookie Consent (v0.5.2 - Oct 30, 2025):*
- `api/v1/models/MOTD.js` - Mongoose model for MOTD
- `api/v1/routes/motd.js` - RESTful API endpoints
- `api/v1/index.js` - Registered MOTD router
- `views/partials/daily-motd-lightbox.ejs` - Lightbox component
- `views/partials/cookie-consent.ejs` - Cookie consent banner
- `views/menu-enhanced.ejs` - Integrated MOTD lightbox
- `views/universe/galactic-map-3d.ejs` - Integrated MOTD lightbox
- `views/index-sales.ejs` - Added cookie consent banner
- `views/admin/motd-manager.ejs` - Admin management interface
- `routes/admin/index.js` - Added MOTD manager route
- `scripts/create-initial-motd-direct.js` - Initial MOTD creation script

*Simulation Speed (v0.5.1):*
- `scripts/seed-test-universe.js` - Updated anomaly/galaxy coordinates
- `services/physics-service.js` - Doubled simulation speed (100ms → 50ms)
- `public/javascripts/GameStateMonitor.js` - Doubled update rate (50ms → 25ms)
- `public/javascripts/galactic-map-3d.js` - Doubled physics timestep (1/60 → 1/30)
- `zMDREADME/CLAUDE.md` - Added TMUX management, documented changes

### Previous Session (Oct 28, 2025)
**v0.4.5 - Documentation & Automation:**
1. ✅ Documentation system with `/help/documentation` viewer
2. ✅ Automated doc tree generation (cron daily 3 AM)
3. ✅ Patch notes updater system (cron daily 3:30 AM)
4. ✅ Created comprehensive patch notes for v0.4.5 and v0.5.0
5. ✅ Menu integration with featured documentation card
6. ✅ Admin API for cron job management

---

## 🏗️ Core Architecture (Stable Foundation)

### Directory Structure
```
/srv/ps/
├── api/v1/                    # RESTful API endpoints
├── routes/                    # View routes (EJS pages)
├── views/                     # EJS templates
├── public/                    # Static assets
│   └── data/                  # Generated JSON (docs-tree, etc.)
├── plugins/                   # Core integrations
│   └── cron/                  # Cron jobs (NEW)
├── middlewares/               # Express middleware
├── services/                  # Business logic
├── scripts/                   # Utility scripts (60+)
├── docs/                      # Technical documentation
├── zMDREADME/                 # User-facing documentation
├── app.js                     # Express app setup
└── package.json               # Dependencies
```

### Tech Stack
**Backend:** Node.js v18+, Express.js, MongoDB, Socket.IO, node-cron
**Frontend:** EJS, Three.js, Vanilla JS, CSS3
**Infrastructure:** Linode VPS, MongoDB, Tmux

---

## 🗄️ Database Schema

### Key Collections
- `users` - User accounts with auth
- `characters` - Player characters with 3D locations
- `assets` - Universe objects (planets, stars, galaxies, ships)
  - Contains 3D coordinates: galactic, scene, system, orbital
  - Parent hierarchy (planet→star→galaxy)
- `spriteAtlases` - Community sprite packs (NEW v0.5.0)
- `userAnalytics` - Action tracking
- `motds` - Daily message broadcasts (NEW v0.5.2)

---

## 🚀 Recent Major Systems

### 1. Daily MOTD System (v0.5.2 - Oct 30)
**Purpose:** Communicate updates and calls-to-action to users daily

**Components:**
- **Database Model:** Mongoose schema with priority, dates, and status
- **API Endpoints:** Full CRUD at `/api/v1/motd/*`
  - `GET /current` - Fetch active MOTD for lightbox
  - `GET /list` - Admin: list all MOTDs
  - `POST /create` - Admin: create new MOTD
  - `PUT /:id` - Admin: update MOTD
  - `DELETE /:id` - Admin: delete MOTD
- **Lightbox Component:** Terminal-aesthetic modal with:
  - Welcome message (customizable)
  - Main update message
  - Call-to-action with link
  - 24-hour localStorage tracking (shows once per day)
  - "Don't show again today" checkbox
- **Admin Interface:** Full management UI at `/admin/motd`
  - Create/delete MOTDs
  - Set priority, active status, date ranges
  - Preview and edit existing messages

**Integration Points:**
- Menu page (`/menu`)
- Galactic map (`/universe/galactic-map-3d`)
- Any authenticated page via partial include

**Usage:**
```bash
# Create initial MOTD
node scripts/create-initial-motd-direct.js

# Access admin panel
https://yoursite.com/admin/motd
```

### 2. 3D Universe (v0.5.0 - 26,533 lines)
- Full Three.js implementation for galactic and system maps
- Ship combat system with real-time physics
- Sprite atlas system for community content
- 40+ utility scripts for universe management
- 20+ documentation guides

### 3. Documentation System (v0.4.5 - Today)
- Documentation hub at `/help/documentation`
- Automated tree generation via cron
- Markdown viewer with syntax highlighting
- 14 files indexed in 5 categories

### 4. Patch Notes Automation (Oct 28)
- Git commit analyzer
- Automatic index and changelog generation
- Daily cron updates at 3:30 AM

### 5. Physics Simulation System (v0.5.1 - Oct 30)
**Server-Side Physics (physics-service.js):**
- Tick rate: 50ms (20 ticks/second) - 2x faster than before
- Gravity calculations within 200 unit radius
- Character movement and navigation
- Destination arrival checking

**Client-Side State (GameStateMonitor.js):**
- Update rate: 25ms (40 updates/second) - 2x faster
- Real-time player position tracking
- Socket.IO synchronization
- Velocity-based interpolation

**3D Galactic Physics (galactic-map-3d.js):**
- Physics timestep: 1/30 (2x faster orbital mechanics)
- Gravitational constants for anomalies and galaxies
- Force visualization with arrows
- Orbital dynamics and capture mechanics

**Universe Seeding:**
- Test universe script creates minimal viable universe
- Anomaly placed at strategic position (not origin)
- Galaxy positioned for clear visual separation
- 1 star system with 5 diverse planets (barren, garden, desert, gas giant, ice)

---

## 📋 Common Commands

```bash
# ===== SERVICE MANAGEMENT =====
# View PS service logs
tmux attach -t ps

# Restart PS service only
tmux kill-session -t ps
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"

# Restart all services
/srv/start-all-services.sh

# Check if PS is running
lsof -ti:3399

# ===== DATABASE =====
# Connect to MongoDB (remote Atlas)
# Connection string in .env: DB_URL
mongosh "mongodb+srv://..."

# Quick asset count
cd /srv/ps && node -e "require('dotenv').config(); const {MongoClient} = require('mongodb'); const client = new MongoClient(process.env.DB_URL); client.connect().then(() => client.db(process.env.DB_NAME).collection('assets').countDocuments()).then(count => {console.log('Assets:', count); process.exit(0);});"

# ===== UNIVERSE SEEDING =====
# Reset test universe (1 anomaly, 1 galaxy, 5 planets)
node scripts/seed-test-universe.js

# Full universe rebuild
node scripts/rebuild-universe.js

# ===== DOCUMENTATION =====
node scripts/generate-docs-tree.js
node scripts/update-patch-notes.js

# ===== CRON JOBS =====
curl http://localhost:3399/admin/api/cron/status
curl http://localhost:3399/admin/api/cron/list

# ===== SIMULATION MONITORING =====
# Current settings (as of Oct 30, 2025):
# - Physics Service: 50ms tick (20/sec)
# - GameStateMonitor: 25ms tick (40/sec)
# - Galactic Physics: 1/30 timestep

# ===== MOTD SYSTEM =====
# Create initial MOTD
node scripts/create-initial-motd-direct.js

# Access admin panel
# https://yoursite.com/admin/motd

# API endpoints
curl http://localhost:3399/api/v1/motd/current
curl http://localhost:3399/api/v1/motd/list  # Admin only
```

---

## 🎯 Current State (Oct 30, 2025)

**Server:** ✅ Running on port 3399 (tmux session: ps)
**Database:** ✅ MongoDB Atlas (projectStringborne)
**Assets Count:** ~79 assets
**Test Universe:** ✅ Active (1 anomaly, 1 galaxy, 1 star, 5 planets)

**Simulation Speed:**
- Physics Service: 20 ticks/sec (50ms) - 2x faster
- GameStateMonitor: 40 updates/sec (25ms) - 2x faster
- Galactic Physics: 1/30 timestep - 2x faster

**Universe Layout:**
- Anomaly: "The Nexus Singularity" at (-800, 600, -400)
- Galaxy: "Elysium Cluster" at (1200, -500, 800)
- Star: "Sol Prime" at (1239.0, -536.4, 798.0)

**Services Running:**
- ps (3399) - Stringborn Universe
- game-state (3500) - Game State Service
- 8 other services on ports 3000-3007

**Cron Jobs:** 2 active (docs 3 AM, patch notes 3:30 AM)
**Documentation:** 14 files indexed
**Patch Notes:** 4 versions documented

---

## 💡 AI Assistant Guidelines

### Starting a Session
1. Read this file for current state
2. Check `docs/RECENT_CHANGES.md` for latest commits
3. Review `PROJECT_OVERVIEW.md` for system details

### Project Philosophy
- Community-driven content creation
- Democratic voting on submissions
- Persistent universe state
- Real-time multiplayer
- Terminal aesthetic (purple/cyan, monospace)

### Code Standards
- ES Modules (`import/export`)
- Async/await preferred
- EJS templates for views
- Error handling with try-catch

---

## 🔄 Update Protocol

**Update this file when:**
- Major features added (3+ files)
- Architecture changes
- Database schema updates
- New cron jobs added

**Update sections:**
- Latest Changes
- Files Added/Modified
- Current State
- Common Commands

---

## 📝 Session Notes

**Last Session:** Nov 3, 2025 - v0.8.6 Session Wrap & Documentation (MAINTENANCE RELEASE)
**Type:** Documentation and session cleanup
**Key Achievements:**
- ✅ Updated patch notes to v0.8.6 with streamlined maintenance content
- ✅ Moved v0.8.5 detailed implementation notes to Previous Versions archive
- ✅ Added collapsible historical version tracking system
- ✅ Updated CLAUDE.md with comprehensive session summary
- ✅ Prepared for server restart with version bump

**Technical Details:**
- **Patch Notes Structure:** Current release + collapsible historical versions
- **Version Archive:** v0.8.5 (Terminal Interface Overhaul), v0.4.0 (Foundation Arc)
- **Documentation Updates:** CLAUDE.md reflects latest terminal overlay system
- **2 files modified:** patch-notes.ejs (restructuring), CLAUDE.md (session summary)

**Status:**
- ✅ Patch notes restructured and archived
- ✅ CLAUDE.md updated with v0.8.6 info
- ⏳ Server restart pending

**Previous Session:** Nov 3, 2025 - v0.8.5 Terminal Interface Overhaul (MAJOR RELEASE)
**Type:** Major feature implementation - Terminal overlay system
**Key Achievements:**
- ✅ Created three color-coded terminal overlays (Character/Inventory/Profile)
- ✅ Implemented unified terminal CSS framework
- ✅ Added split-view inventory layout with depth (Backpack>Equipment, Ship>Fittings, Storehouse>Locations)
- ✅ Fixed critical import map syntax error (JavaScript in JSON block)
- ✅ Fixed navigateWithConfirmation function timing issue
- ✅ Integrated terminal overlays with Navigation Hub
- ✅ Implemented lazy data loading with caching

**Technical Details:**
- **Terminal Themes:** Blue (#0066ff), Cyan (#00ffff), Purple (#8a4fff), Green (#00ff00)
- **Function Pattern:** Early script loading with global window functions
- **Split-View Layout:** Left panel (Equipment/Fittings/Locations) + Right panel (Items grid)
- **1 file changed (major):** galactic-map-3d.ejs (1500+ lines of terminal overlay code)

**Status:**
- ✅ All terminal overlays working beautifully
- ✅ Navigation Hub fully integrated
- ✅ Early script loading pattern established
- ✅ Critical bugs fixed and documented

**Next Priorities:**
- System Map Overlays: Port terminal overlay system to system-map-3d.ejs
- Equipment System: Full equip/unequip functionality
- Ship Fittings: Complete ship module fitting system
- Storehouse Network: Hub-based storage with location management
- Profile Expansion: Character list, achievements, statistics tracking
- Header Integration: Update header.ejs to use terminal overlay functions

---

## 🔧 Troubleshooting Quick Reference

**⚠️ CRITICAL: EJS Template Line Number Debugging**

When debugging errors in EJS files with inline `<script>` blocks (like `galactic-map-3d.ejs`, `system-map-3d.ejs`):

**THE PROBLEM:**
- Browser console shows error at line 5354
- But the file only has 4738 lines
- **THIS IS NOT A CACHING ISSUE!**

**THE CAUSE:**
EJS templates with inline `<script>` blocks create one continuous HTML document. Line numbers in browser console refer to the **RENDERED HTML OUTPUT** (the complete EJS-generated page), NOT separate JavaScript files or cached versions.

**Example:**
```
views/universe/galactic-map-3d.ejs structure:
Line 1-100:    HTML header, styles
Line 101-200:  <script> block 1 (inline JavaScript)
Line 201-1000: HTML body, more inline <script> blocks
Line 1001-end: More inline JavaScript

Browser sees this as ONE file with 5000+ lines!
```

**DEBUGGING STEPS:**
1. **DO NOT assume it's browser cache** - Hard refresh will NOT fix this
2. **Find the actual error location:**
   - Browser shows: `galactic-map-3d:5354`
   - This is line 5354 in the RENDERED HTML
   - View page source (Ctrl+U) and navigate to that line
   - Find which `<script>` block contains the error
   - Calculate offset from the script block start
3. **Look for syntax issues:**
   - EJS expressions like `<%= user && user._id %>` inside JavaScript
   - EJS HTML-escapes operators: `&&` becomes `&amp;&amp;`, breaking syntax
   - Use separate EJS logic: `<% if (user) { %><%= user._id %><% } %>`

**WHAT NOT TO DO:**
- ❌ Add cache-busting query parameters (`?nocache=123`)
- ❌ Clear browser cache repeatedly
- ❌ Use hard refresh (Ctrl+Shift+R)
- ❌ Change cache-control headers
- ❌ Try private browsing mode

**WHAT TO DO:**
- ✅ Read browser console error carefully for actual syntax issue
- ✅ View page source to see rendered HTML at reported line
- ✅ Check for EJS expression syntax errors in JavaScript blocks
- ✅ Use external JavaScript files when possible (avoid inline `<script>`)
- ✅ Test in fresh session if needed, but don't blame cache

**Critical Quote from User:**
> "CACHE HAS NEVER BEEN THE PROBLEM NO MATTER HOW MANY TIMES YOU SUUGGEST IT..IT ALWAYS A js ERROR"

> "the line descrepancies are ejs...not cache"

**Service Won't Start:**
```bash
# Check if port is in use
lsof -ti:3399

# Kill and restart
tmux kill-session -t ps
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"
```

**Database Connection Issues:**
```bash
# Test connection
cd /srv/ps && node -e "require('dotenv').config(); console.log('DB_URL:', process.env.DB_URL.substring(0, 30) + '...');"

# Check .env file exists
ls -la /srv/ps/.env
```

**Simulation Running Slow:**
- Current settings are 2x faster (as of Oct 30)
- Physics: 50ms tick, Monitor: 25ms tick, Galactic: 1/30 timestep
- To slow down, increase tick values in respective files

**Multiple Services Affected:**
- ALWAYS use tmux sessions, never killall
- Check `tmux ls` before killing processes
- Use `/srv/start-all-services.sh` for full restart

**⚠️ CRITICAL: Browser Cache vs Server Code Updates**

When you update JavaScript files (`galactic-map-3d.js`, `GameStateMonitor.js`, etc.) on the server, the browser may still be running OLD CACHED VERSIONS of those files. This is a REAL browser caching issue (unlike the EJS line number issue above which is NOT cache).

**THE PROBLEM:**
- Server code is updated and restarted
- Browser console shows old code still running
- New features/logs don't appear
- Socket.IO receives data but JavaScript doesn't process it correctly

**HOW TO DETECT:**
1. Check file timestamp in URL: `galactic-map-3d.js?v=8.0.1&t=1762220883177`
2. Look for missing console logs that you just added to the code
3. Features that should work according to server logs don't work in browser
4. `window.galacticMap` or other globals have old method signatures

**SOLUTIONS (in order of effectiveness):**

1. **Hard Refresh (Most Common Fix):**
   ```
   Chrome/Firefox/Edge: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
   Safari: Cmd+Option+R
   ```
   - Forces browser to bypass cache and re-download all assets
   - Do this 2-3 times if issue persists
   - Must be done on the SPECIFIC PAGE with issues

2. **Clear Browser Cache (Nuclear Option):**
   ```
   Chrome: Ctrl+Shift+Delete → "Cached images and files" → Clear
   Firefox: Ctrl+Shift+Delete → "Cache" → Clear
   Safari: Cmd+Option+E
   ```
   - Clears ALL cached files for ALL websites
   - Overkill but guaranteed to work

3. **Disable Cache in DevTools (Development Only):**
   ```
   1. Open DevTools (F12)
   2. Network tab
   3. Check "Disable cache" checkbox
   4. Keep DevTools OPEN while browsing
   ```
   - Only works while DevTools is open
   - Good for active development sessions

4. **Version Busting (Server-Side Solution):**
   ```javascript
   // In EJS template
   <script src="/javascripts/galactic-map-3d.js?v=<%= VERSION %>"></script>

   // VERSION should change on every deploy
   // Example: ?v=8.0.6&t=<%= Date.now() %>
   ```
   - Forces browser to treat it as a new file
   - Already implemented in most PS templates

5. **Service Worker Issues (Advanced):**
   ```javascript
   // Check if service worker is caching
   navigator.serviceWorker.getRegistrations().then(registrations => {
     console.log('Active service workers:', registrations.length);
     registrations.forEach(sw => sw.unregister());
   });
   ```
   - Service workers can cache aggressively
   - Rare on PS but possible

**WHEN TO SUSPECT BROWSER CACHE:**
- ✅ Server logs show character positions being broadcast
- ✅ Network tab shows galacticPhysicsUpdate events
- ❌ Browser console shows NO character-related logs
- ❌ Console logs from updated code don't appear
- ❌ Old variable names/functions still referenced in errors

**VERIFICATION STEPS:**
1. Open browser DevTools → Network tab
2. Filter for `.js` files
3. Check "Size" column - should show file size, not "(from cache)"
4. If shows "(disk cache)" or "(memory cache)", do hard refresh
5. After hard refresh, should show actual file size (KB)

**USER QUOTE:**
> "the line descrepancies are ejs...not cache"

This refers to EJS LINE NUMBERS (see section above). JavaScript file caching is a SEPARATE, REAL browser issue that requires hard refresh to fix.

---

## 🔒 SECURITY RULES

**CRITICAL:** All secrets go in `.env` files (gitignored). NEVER in docs/code/commits.

**GitHub SSH Setup (Nov 2, 2025):**
- Key: `~/.ssh/id_ed25519_github`
- Config: `~/.ssh/config` (GitHub-specific, isolated)
- Remote uses SSH: `git@github.com:snoryder8019/srv.git`

**If GitHub blocks push (secret detected):**
1. Replace with placeholders in docs (`your_api_key_here`)
2. Run git filter-branch to clean history
3. Force push
4. Rotate all exposed credentials

---

## 🎨 3D Visualization Reference (Updated - Nov 2, 2025)

### Color Scheme
| Object | Orb Color | Label Color | Size (Universe) | Size (Galaxy) | Trail |
|--------|-----------|-------------|-----------------|---------------|-------|
| Galaxy | Purple (#bb88ff) | Purple (#8A4FFF) | 50 units | 100 units (0.3 opacity) | None |
| Anomaly | Magenta (#ff00ff) | White | 40 units | 60 units | None |
| Star | Yellow (#ffff00) | Yellow (#FFFF00) | N/A | 500 units | None |
| Planet | Varies | None | N/A | 6-80 units | White (#FFFFFF) |

### Orbital Trail System (NEW - Nov 2, 2025)
- **Color:** Pure white (#FFFFFF) with additive blending
- **Length:** 90° arc (π/2 radians) behind planet
- **Segments:** 64 smooth curve points
- **Opacity Gradient:** 1.0 (at planet) → 0.0 (at star)
- **Line Width:** 3 pixels
- **Animation:** Real-time position updates every frame
- **Visual Effect:** Bright "pen stripe" comet tail showing orbital history

### Connection States (Infrastructure Ready)
- **Green (0x00ff00):** Stable connection (3+ days)
- **Red-Orange (0xff4400):** Breaking (<1 day to break)
- **Blue Dashed (0x0088ff):** Forming (<0.5 days old)

### Camera Configuration
```javascript
// Orthographic camera with massive frustum to prevent clipping
frustumSize: 20000
near: -500000  // Negative to prevent front clipping
far: 500000    // 1 million unit range total
```

### Debugging Commands
```bash
# Test galactic-state API (includes connections)
curl http://localhost:3399/api/v1/state/galactic-state | python3 -m json.tool

# Check connection count
curl -s http://localhost:3399/api/v1/state/galactic-state | grep -o '"connections":\[.*\]' | wc -c

# View physics service logs
tmux attach -t ps
# Look for: "🔗 Connection update: X anomalies, Y galaxies"
```

---

*Efficient context for AI collaboration - keep updated after major sessions*
*Last major update: November 1, 2025 - v0.8.1 (Live Production Rebuild)*
