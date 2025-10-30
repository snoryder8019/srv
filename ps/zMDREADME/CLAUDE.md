# Claude AI Context - Stringborn Universe

**Last Updated:** October 30, 2025
**Current Version:** v0.5.1 (Simulation Speed + Anomaly Positioning)
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
6383b8f - 2025-10-30 - patch 5.0.1 (Scott)
baf236f - 2025-10-28 - patchit (Scott)
e5fcbbf - 2025-10-28 - works push (Scott) ⭐ MASSIVE 3D UPDATE
d075496 - 2025-10-27 - utd (Scott)
865e5a7 - 2025-10-26 - 0.4 (Scott)
```

### Today's Session Additions (Oct 30, 2025)
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

**Files Modified Today:**
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

---

## 🚀 Recent Major Systems

### 1. 3D Universe (v0.5.0 - 26,533 lines)
- Full Three.js implementation for galactic and system maps
- Ship combat system with real-time physics
- Sprite atlas system for community content
- 40+ utility scripts for universe management
- 20+ documentation guides

### 2. Documentation System (v0.4.5 - Today)
- Documentation hub at `/help/documentation`
- Automated tree generation via cron
- Markdown viewer with syntax highlighting
- 14 files indexed in 5 categories

### 3. Patch Notes Automation (Oct 28)
- Git commit analyzer
- Automatic index and changelog generation
- Daily cron updates at 3:30 AM

### 4. Physics Simulation System (v0.5.1 - Oct 30)
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

**Last Session:** Oct 30, 2025 - Simulation Speed & Anomaly Positioning
**Key Achievements:**
- 2x faster simulation across all systems
- Repositioned anomalies for better visual distribution
- Added comprehensive TMUX service management
- Updated CLAUDE.md with complete context

**Next Priorities:**
- Further universe expansion (more galaxies/anomalies)
- Search functionality for documentation
- VR support planning
- Performance monitoring dashboard

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

*Efficient context for AI collaboration - keep updated after major sessions*
*Last major update: October 30, 2025 - v0.5.1*
