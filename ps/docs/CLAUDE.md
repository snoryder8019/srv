# Claude AI Context - Stringborn Universe

**Last Updated:** November 1, 2025
**Current Version:** v8.0.1 (3D Galactic Map Rebuild)
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
230cf3e - 2025-11-01 - v8.0.1 - 3D Galactic Map Rebuild & Connection System ⭐ LIVE PRODUCTION
6383b8f - 2025-10-30 - patch 5.0.1 (Scott)
baf236f - 2025-10-28 - patchit (Scott)
e5fcbbf - 2025-10-28 - works push (Scott) ⭐ MASSIVE 3D UPDATE
d075496 - 2025-10-27 - utd (Scott)
```

### Today's Session Additions (Nov 1, 2025)

**v8.0.1 - 3D Galactic Map Rebuild & Connection System (LIVE PRODUCTION):**
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

**Last Session:** Nov 1, 2025 - 3D Galactic Map Rebuild (LIVE PRODUCTION)
**Type:** Extended session with context continuation
**Key Achievements:**
- Complete rebuild of galaxy drill-down rendering from scratch
- Implemented comprehensive color-coded label system
- Fixed critical star visibility bug that prevented rendering
- Laid groundwork for connection visualization system
- 98 files changed in live production environment
- Created detailed session documentation (5 notes)

**Status:**
- ✅ Stars now visible and persistent in galaxy view
- ✅ Labels working (purple/white/yellow)
- ✅ Camera clipping resolved
- ⏳ Connection visualization infrastructure in place (pending data population)
- ⏳ Git push ready (awaiting SSH/PAT authentication setup)

**Previous Session:** Oct 31, 2025 - Mobile Documentation Modals
**Achievements:**
- Mobile-responsive documentation modal system
- JavaScript link interceptor for better mobile UX
- Verified all cron jobs running correctly

**Next Priorities:**
- Debug connection rendering (data population issue)
- Set up GitHub authentication (SSH key or PAT)
- Test raycasting in galaxy view
- Performance monitoring in production
- Further universe expansion

---

## 🔧 Troubleshooting Quick Reference

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

---

## 🔒 SECURITY: Environment Variables & Git Best Practices

### ⚠️ CRITICAL: Never Commit Secrets to Git

**ALL sensitive credentials MUST be stored in `.env` files, which are gitignored.**

### Environment Variable Security
```bash
# ✅ CORRECT: Secrets in .env (gitignored)
/srv/ps/.env              # Production secrets
/srv/game-state/.env      # Game state service secrets
/srv/madladslab/.env      # Lab service secrets

# ❌ WRONG: Secrets in ANY of these
- README files
- Documentation files
- Configuration examples
- Code comments
- Commit messages
```

### What Must Go in .env Files
```bash
# API Keys & Secrets
GGLAPI=your_google_api_key
GGLSEC=your_google_oauth_secret
GGLCID=your_google_client_id
NEWS_API_KEY=your_news_api_key

# Database Credentials
DB_URL=mongodb+srv://username:password@cluster.mongodb.net
DB_NAME=database_name
MON_USER=username
MON_PASS=password

# Authentication Secrets
SESHSEC=your_session_secret
JWT_SECRET=your_jwt_secret

# Email Credentials
GMAIL_USER=your_email@gmail.com
GMAIL_PASS=your_app_password
```

### Documentation Example Format (Safe)
When writing examples in documentation, ALWAYS use placeholders:

```bash
# ✅ SAFE - Use placeholders
GGLAPI=your_google_api_key_here
DB_URL=your_mongodb_connection_string_here

# ❌ DANGEROUS - Never include real values
GGLAPI=AIzaSyD...  # NEVER DO THIS
```

### GitHub Push Protection

**GitHub will block pushes containing secrets.** If you encounter:
```
remote: error: GH013: Repository rule violations found
remote: - Push cannot contain secrets
```

**Resolution Steps:**
1. Remove secrets from affected files
2. Replace with placeholders (e.g., `your_api_key_here`)
3. Rewrite git history using `git filter-branch`
4. Force push cleaned history
5. **ROTATE ALL EXPOSED CREDENTIALS** (critical!)

### Git History Cleanup (If Secrets Were Committed)

```bash
# 1. Create cleanup script
cat > /tmp/fix_secrets.sh << 'SCRIPT'
#!/bin/bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --tree-filter '
for file in path/to/file1.md path/to/file2.md; do
  if [ -f "$file" ]; then
    sed -i "s/SECRET_VALUE/placeholder_here/g" "$file"
  fi
done
' --prune-empty -- --all
SCRIPT

# 2. Run cleanup
chmod +x /tmp/fix_secrets.sh
/tmp/fix_secrets.sh

# 3. Clean up refs
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now

# 4. Force push (WARNING: Rewrites history!)
git push --force origin main
```

### Post-Exposure Protocol

**If secrets were exposed in git history (even after cleanup):**

1. **Immediately rotate credentials:**
   - Generate new Google OAuth credentials
   - Create new MongoDB user/password
   - Generate new session secrets
   - Create new API keys
   - Update all .env files

2. **Verify .gitignore includes:**
   ```
   .env
   .env.*
   *.pem
   *.key
   credentials.json
   secrets/
   ```

3. **Test before committing:**
   ```bash
   # Check what will be committed
   git status
   git diff --staged

   # Verify no secrets in staged files
   git diff --staged | grep -i "password\|secret\|api.*key"
   ```

### SSH Key Management (GitHub)

**Generate GitHub-specific SSH key:**
```bash
# Generate key (done on Nov 2, 2025)
ssh-keygen -t ed25519 -C "github-key-$(whoami)@$(hostname)" -f ~/.ssh/id_ed25519_github

# Configure SSH to use GitHub-specific key
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF

# Set permissions
chmod 600 ~/.ssh/config

# Add GitHub's host key
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts

# Test connection
ssh -T git@github.com

# Update remote to use SSH
git remote set-url origin git@github.com:username/repo.git
```

**Key Benefits:**
- Isolated from other SSH access
- No password prompts on push/pull
- More secure than HTTPS with stored credentials

### Pre-Commit Checklist

Before every commit:
- [ ] Verify `.env` is gitignored
- [ ] Check no secrets in staged files
- [ ] Confirm documentation uses placeholders only
- [ ] Review `git diff --staged` for sensitive data
- [ ] Test SSH connection if pushing

---

## 🎨 3D Visualization Reference (NEW - Nov 1, 2025)

### Color Scheme
| Object | Orb Color | Label Color | Size (Universe) | Size (Galaxy) |
|--------|-----------|-------------|-----------------|---------------|
| Galaxy | Purple (#bb88ff) | Purple (#8A4FFF) | 50 units | 100 units (0.3 opacity) |
| Anomaly | Magenta (#ff00ff) | White | 40 units | 60 units |
| Star | Yellow (#ffff00) | Yellow (#FFFF00) | N/A | 500 units |

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
*Last major update: November 1, 2025 - v8.0.1 (Live Production Rebuild)*
