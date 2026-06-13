# Documentation Cleanup Plan
**Created:** November 3, 2025
**Status:** In Progress

## Issues Identified

### 1. Too Many Root-Level Files (54 markdown files)
Many implementation/fix/migration docs should be moved to subdirectories.

### 2. Redundant/Overlapping Documentation
- Multiple "3D_*" files that could be consolidated
- Multiple "GALACTIC_MAP_*" files covering similar topics
- Multiple "TESTER_TOOLBAR_*" files (fixes/updates)
- Socket-related files (SOCKET_CONNECTION_FIX.md, SOCKET_TROUBLESHOOTING.md)

### 3. Legacy Files That Should Be Archived
Files from old sessions and completed implementations that are now historical:
- SESSION_COMPLETION_REPORT.md
- SCATTER_QUICK_START.md
- SCATTER_REPULSION_SYSTEM.md
- GIT_PUSH_SETUP_GUIDE.md (completed)
- LINODE_SETUP_COMPLETE.md (completed)

### 4. Files That Should Be Organized Into Subdirectories

**Implementation Guides (→ /docs/guides/):**
- 3D_GALACTIC_MAP_IMPLEMENTATION.md
- 3D_GALACTIC_MAP_MIGRATION.md
- 3D_MAP_CAMERA_CONTROLS.md
- 3D_MAP_IMPROVEMENTS.md
- 3D_PHYSICS_SYSTEM.md
- 3D_STATE_MANAGER_INTEGRATION.md
- STATE_MANAGER_3D_INTEGRATION.md
- LIVE_UNIVERSE_INTEGRATION.md
- SPRITE_CREATOR_IMPLEMENTATION.md
- PERSISTENT_UNIVERSE_COORDINATES.md

**System Documentation (→ /docs/systems/):**
- ACTIVITY_TOKEN_SYSTEM.md
- COORDINATE_SYSTEM.md
- MAP_HIERARCHY_SYSTEM.md
- NAVIGATION_HIERARCHY.md
- UNIVERSE_REBUILD_COMPLETE.md

**Quick References (→ /docs/reference/):**
- QUICK_START_TELEPORT.md
- SPRITE_ATLAS_SPEC.md

**Architecture (→ /docs/architecture/):**
- BUILDER_ARCHITECTURE.md

**Summaries (→ /docs/summaries/):**
- ADMIN_TESTER_ENHANCEMENTS.md

**Bug Fixes/Patches (→ /docs/archive/fixes/):**
- ASSET_COORDINATES_FIX.md
- CHARACTER_SYNC_FIX.md
- GALACTIC_MAP_PERSISTENCE_FIX.md
- GAME_STATE_SYNC_FIX.md
- ORBITCONTROLS_FIX.md
- SOCKET_CONNECTION_FIX.md
- TESTER_TOOLBAR_SOCKET_FIX.md
- UI_LAYERING_FIX.md
- SYNC_INDICATOR_MOVED.md
- TESTER_TOOLBAR_SYNC.md
- TESTER_TOOLBAR_TERMINAL_THEME.md

**Archive (→ /docs/archive/):**
- ASSET_BUILDER_MIGRATION.md
- ASSET_SCALE_SYSTEM.md
- GALACTIC_MAP_RESET.md
- GALAXY_RESET_COMPLETE.md
- SESSION_COMPLETION_REPORT.md
- SCATTER_QUICK_START.md
- SCATTER_REPULSION_SYSTEM.md
- GIT_PUSH_SETUP_GUIDE.md
- LINODE_SETUP_COMPLETE.md
- SOCKET_TROUBLESHOOTING.md
- SCRIPT_CONTROL_PANEL.md

## Root Files That Should Stay at Root
- CLAUDE.md (AI context - frequently accessed)
- PROJECT_OVERVIEW.md (project introduction)
- README.md (project documentation hub)
- ROADMAP.md (project roadmap)
- CHANGELOG_LATEST.md (recent changes)
- RECENT_CHANGES.md (change log)
- PATCH_NOTES_INDEX.md (patch notes index)
- PATCH_NOTES_v*.md (current patch notes)
- DEVELOPER_LETTER_v0.4.md (important communication)

## Proposed Action Plan

### Phase 1: Archive Legacy/Completed Items
Move completed implementation notes and old fixes to archive:
```bash
mkdir -p /srv/ps/docs/archive/fixes
mkdir -p /srv/ps/docs/archive/completed-implementations
```

### Phase 2: Reorganize Active Documentation
Move implementation guides, systems, and references to proper subdirectories.

### Phase 3: Update docs-tree Generator
The script already scans recursively, so it should pick up the reorganized files automatically.

### Phase 4: Update Internal Links
Check for any broken links in documentation after reorganization.

### Phase 5: Create Index Files
Add README.md files to each subdirectory explaining what belongs there.

## Expected Result
- Root directory: ~15 files (core docs only)
- /guides/: Implementation and tutorial docs
- /systems/: System architecture and design docs
- /reference/: Quick reference materials
- /summaries/: High-level summaries
- /architecture/: Technical architecture
- /archive/: Historical/completed docs
- /session-notes/: Development session logs

## Benefits
- Easier to find relevant documentation
- Clearer organization for new contributors
- Reduced clutter in root directory
- Better categorization in docs tree
- Preserved historical context in archive
