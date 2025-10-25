# Stringborn Universe - Documentation Index

Welcome to the Stringborn Universe documentation! This directory contains comprehensive guides for all major systems in the project.

---

## 🚀 Quick Start

**New to the project?** Start here:

1. **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** - Complete project overview, features, and architecture
2. **[TESTER_QUICK_REFERENCE.md](TESTER_QUICK_REFERENCE.md)** - Quick reference for testers

---

## 📚 Core Documentation

### System Guides

#### [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
Complete overview of the Stringborn Universe project, including:
- All core systems (characters, assets, universe, zones, testing, analytics)
- Database schema and collections
- API endpoints quick reference
- Project structure
- Getting started guide

#### [ASSET_BUILDER_COMPLETE.md](ASSET_BUILDER_COMPLETE.md)
Comprehensive guide to the community-driven asset creation system:
- 15+ asset types (weapons, armor, ships, characters, etc.)
- Stats system with combat, physical, and special stats
- Rich lore system (history, backstory, flavor text)
- Community collaboration (voting, suggestions, collaborators)
- Pixel art editor with animation support
- Workflow: Draft → Submit → Admin Review → Community Voting

#### [GALACTIC_MAP_COMPLETE.md](GALACTIC_MAP_COMPLETE.md)
Complete guide to the galactic map and universe system:
- 5000x5000 galactic space with 2D physics
- 4 Space Hubs (corner starting locations)
- Navigation system (click-to-travel, trajectory paths)
- Real-time multiplayer (Socket.IO)
- Docking system (hubs, planets, stations)
- Galactic state tracking and events

#### [TESTER_SYSTEM_COMPLETE.md](TESTER_SYSTEM_COMPLETE.md)
Professional testing infrastructure:
- Tester toolbar (bottom-positioned debug bar)
- Global chat system (real-time Socket.IO chat)
- Ship info pane (click players to view details)
- Bug ticket system (comprehensive ticket management)
- Screenshot capture (html2canvas integration)
- User role system (tester, admin, player)

#### [LOCATION_SYSTEM_IMPLEMENTATION.md](LOCATION_SYSTEM_IMPLEMENTATION.md)
Location-based character positioning system:
- Asset-based positioning (docking mechanics)
- Navigation between locations
- Socket.IO real-time updates
- Character location tracking

#### [ANALYTICS_SYSTEM.md](ANALYTICS_SYSTEM.md)
User tracking and analytics:
- User action tracking
- Platform analytics dashboard
- Per-user analytics
- Admin analytics interface

---

## 🎯 Quick References

#### [TESTER_QUICK_REFERENCE.md](TESTER_QUICK_REFERENCE.md)
Quick reference guide for testers with:
- Tester toolbar usage
- Global chat commands
- Bug reporting workflow
- Keyboard shortcuts
- Common issues and solutions

#### [USER_CHARACTER_REFERENCE.md](USER_CHARACTER_REFERENCE.md)
Character system overview:
- Character creation and management
- Stats, equipment, inventory
- Talent trees
- Character limits and rules

#### [MENU_SYSTEM.md](MENU_SYSTEM.md)
Navigation and menu system:
- Main menu structure
- Navigation flow
- Menu routes

#### [STATUS_BAR_README.md](STATUS_BAR_README.md)
Status bar implementation:
- Admin debug bar
- Tester toolbar
- Status indicators

---

## 📁 Project Structure

```
/srv/ps/
├── api/v1/              # RESTful API
│   ├── characters/      # Character endpoints
│   ├── assets/          # Asset endpoints
│   ├── zones/           # Zone endpoints
│   ├── universe/        # Universe endpoints
│   ├── tickets/         # Ticket endpoints
│   └── models/          # Database models
├── routes/              # Express routes (views)
│   ├── assets/
│   ├── zones/
│   ├── universe/
│   ├── admin/
│   └── onboarding/
├── views/               # EJS templates
├── public/              # Static assets
│   ├── javascripts/
│   └── stylesheets/
├── plugins/             # Core integrations
│   ├── socket/          # Socket.IO
│   ├── passport/        # Authentication
│   ├── multer/          # File uploads
│   └── mongodb/         # Database
├── middlewares/         # Custom middleware
├── config/              # Configuration
├── scripts/             # Utility scripts
├── uploads/             # User uploads
└── zMDREADME/          # Documentation (you are here)
```

---

## 🔗 Key Routes

### Application Routes
```
/                              Home page
/auth                          Login/register
/menu                          Main menu (requires character)
/characters                    Character management
```

### Asset Routes
```
/assets                        Asset builder
/assets/voting                 Community voting
/admin/assets                  Asset approval (admin)
```

### Universe Routes
```
/universe/galactic-map         2D galactic map
/universe/tome                 Story/lore compendium
/universe/planetary-grid       Grid system info
```

### Zone Routes
```
/zones                         Zone list
/zones/explore/planetary       Planetary exploration
/zones/:zoneName/spatial       3D spatial viewer
```

### Admin Routes
```
/admin                         Admin dashboard
/admin/analytics               Analytics dashboard
/admin/galactic-map            Map controls
```

---

## 🛠 API Quick Reference

### Base URL
`http://localhost:3399/api/v1`

### Main Endpoints
```
Characters:  /api/v1/characters
Assets:      /api/v1/assets
Zones:       /api/v1/zones
Universe:    /api/v1/universe
Tickets:     /api/v1/tickets
```

Full API documentation available in each system guide.

---

## 🎮 Getting Started

### Start the Server
```bash
cd /srv/ps
npm run dev
```

### Access the Application
```
http://localhost:3399
```

### Check Server Status
```bash
tmux attach -t ps_session
```

### Database
```bash
# Check MongoDB status
sudo systemctl status mongodb

# Access MongoDB shell
mongosh projectStringborne
```

---

## 📖 Archived Documentation

Historical documentation and implementation notes have been moved to the `_archive/` directory:

- Asset builder iterations
- Testing system iterations
- Completion summaries
- Feature implementation notes
- Mobile responsive fixes
- Navigation updates
- Map expansion notes

These documents provide historical context but have been superseded by the consolidated guides above.

---

## 🤝 Contributing

### For Testers
1. Login with tester account
2. Enable tester toolbar
3. Report issues via bug ticket system
4. Use global chat for communication

### For Developers
1. Read [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
2. Familiarize yourself with relevant system guides
3. Follow existing code patterns
4. Test thoroughly before submitting changes

---

## 📊 Current Status

**Version:** 1.0
**Status:** Active Development
**Server Port:** 3399
**Database:** MongoDB (projectStringborne)
**Last Updated:** October 24, 2025

---

## 🆘 Support

### Common Issues

**Server won't start:**
```bash
lsof -i :3399
kill -9 <PID>
```

**Database issues:**
```bash
sudo systemctl restart mongodb
```

**Socket.IO not connecting:**
- Check browser console
- Verify server running
- Check firewall settings

### Logs
```bash
# Server logs
tmux attach -t ps_session

# MongoDB logs
sudo journalctl -u mongodb -n 50
```

---

## 📝 Documentation Guidelines

When adding new documentation:

1. **Use clear, descriptive titles**
2. **Include code examples**
3. **Reference related files with links**
4. **Update this README index**
5. **Keep guides focused on one system**
6. **Archive superseded documentation**

---

## 🗺 Documentation Map

```
zMDREADME/
├── README.md                               ← You are here
├── PROJECT_OVERVIEW.md                     ← Start here for project overview
├── ASSET_BUILDER_COMPLETE.md               ← Asset creation system
├── GALACTIC_MAP_COMPLETE.md                ← Map and universe system
├── TESTER_SYSTEM_COMPLETE.md               ← Testing infrastructure
├── LOCATION_SYSTEM_IMPLEMENTATION.md       ← Location/docking system
├── ANALYTICS_SYSTEM.md                     ← Analytics and tracking
├── TESTER_QUICK_REFERENCE.md               ← Quick reference for testers
├── USER_CHARACTER_REFERENCE.md             ← Character system
├── MENU_SYSTEM.md                          ← Menu and navigation
├── STATUS_BAR_README.md                    ← Status bars
└── _archive/                               ← Historical documentation
    ├── ASSET_BUILDER.md
    ├── ENHANCED_ASSET_BUILDER.md
    ├── TESTING_SYSTEM.md
    ├── COMPLETION_SUMMARY.md
    ├── IMPLEMENTATION_COMPLETE.md
    └── ... (other archived docs)
```

---

**Welcome to the Stringborn Universe!** 🌌

For questions or support, use the in-game bug ticket system or contact the development team.
