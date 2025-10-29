# Claude AI Context - Stringborn Universe

**Last Updated:** October 28, 2025
**Current Version:** v0.5.0 (3D Universe) + v0.4.5 (Documentation System)
**Purpose:** Efficient context loading for AI assistance sessions

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
baf236f - 2025-10-28 - patchit (Scott)
e5fcbbf - 2025-10-28 - works push (Scott) ⭐ MASSIVE 3D UPDATE
d075496 - 2025-10-27 - utd (Scott)
865e5a7 - 2025-10-26 - 0.4 (Scott)
3199225 - 2025-10-25 - nice push (Scott)
```

### Today's Session Additions (Oct 28, 2025)
**v0.4.5 - Documentation & Automation:**
1. ✅ Documentation system with `/help/documentation` viewer
2. ✅ Automated doc tree generation (cron daily 3 AM)
3. ✅ Patch notes updater system (cron daily 3:30 AM)
4. ✅ Created comprehensive patch notes for v0.4.5 and v0.5.0
5. ✅ Menu integration with featured documentation card
6. ✅ Admin API for cron job management

**Files Added Today:**
- `scripts/generate-docs-tree.js` - Doc tree generator
- `scripts/update-patch-notes.js` - Patch notes automation
- `plugins/cron/index.js` - Cron job manager (2 jobs scheduled)
- `views/help/documentation.ejs` - Doc viewer UI
- `docs/PATCH_NOTES_v0.4.5.md` - Today's update notes
- `docs/PATCH_NOTES_v0.5.0.md` - 3D universe context
- `docs/PATCH_NOTES_INDEX.md` - Auto-generated index
- `zMDREADME/DOCUMENTATION_SYSTEM.md` - System guide
- `zMDREADME/CLAUDE.md` - This file

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

### 3. Patch Notes Automation (Today)
- Git commit analyzer
- Automatic index and changelog generation
- Daily cron updates at 3:30 AM

---

## 📋 Common Commands

```bash
# Server
tmux attach -t ps_session
lsof -i :3399

# Database
mongosh projectStringborne

# Documentation
node scripts/generate-docs-tree.js
node scripts/update-patch-notes.js

# Cron API
curl http://localhost:3399/admin/api/cron/status
```

---

## 🎯 Current State

**Server:** ✅ Running on port 3399
**Database:** ✅ Connected
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

**Last Session:** Oct 28, 2025 - Documentation & Patch Notes
**Next Priorities:** Search functionality, VR support planning

---

*Efficient context for AI collaboration - keep updated after major sessions*
