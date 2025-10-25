# Stringborn Universe (PS) - Project Overview

## What is Stringborn Universe?

A **community-driven sci-fi universe platform** featuring character progression, asset creation, galactic exploration, and real-time multiplayer interaction.

---

## Current Project Status

**Server:** Running on port 3399
**Database:** MongoDB (projectStringborne)
**Technology:** Node.js, Express, Socket.IO, Three.js, EJS
**Last Major Update:** October 23, 2025

---

## Core Systems

### 1. Character System
**File:** [/srv/ps/api/v1/models/Character.js](../api/v1/models/Character.js)

- Character creation with species, class, traits
- Location tracking in 5000x5000 galactic space
- Navigation with ETA calculation
- Ship inventory (fittings, cargo hold)
- Equipment slots (9 total)
- Talent tree system with point allocation
- Docking/undocking at assets
- Max 3 characters per user

**Key Endpoints:**
```
GET    /api/v1/characters
POST   /api/v1/characters
GET    /api/v1/characters/:id
PUT    /api/v1/characters/:id
DELETE /api/v1/characters/:id
POST   /api/v1/characters/:id/navigate
POST   /api/v1/characters/:id/dock
POST   /api/v1/characters/:id/undock
PUT    /api/v1/characters/:id/talents
```

### 2. Asset Builder System
**Files:** [/srv/ps/api/v1/models/Asset.js](../api/v1/models/Asset.js)

Community-driven asset creation with:
- **15+ asset types:** Characters, weapons, armor, ships, modules, consumables, environments, abilities, factions, etc.
- **Comprehensive stats system:** Damage, defense, health, energy, speed, value, durability, range, fire rate, capacity
- **Rich lore fields:** Lore/history, backstory, flavor text
- **7 rarity tiers:** Common → Mythic → Unique
- **Community collaboration:** Voting, suggestions, upvoting, collaborators
- **Pixel art editor:** 16x16, 32x32, 64x64 grids with animation support
- **Multi-image upload:** Pixel art, fullscreen, index card
- **Approval workflow:** Draft → Submit → Admin Review → Approved/Rejected → Community Voting

**Key Endpoints:**
```
GET    /api/v1/assets
POST   /api/v1/assets
PUT    /api/v1/assets/:id
DELETE /api/v1/assets/:id
POST   /api/v1/assets/:id/submit
POST   /api/v1/assets/:id/vote
POST   /api/v1/assets/:id/suggestions
POST   /api/v1/assets/:id/collaborators
GET    /api/v1/assets/approved/list
GET    /api/v1/assets/community
```

**Routes:**
- `/assets` - Asset builder (authenticated)
- `/assets/voting` - Community voting (public)
- `/admin/assets` - Admin approval interface

**Details:** See [ASSET_BUILDER_COMPLETE.md](ASSET_BUILDER_COMPLETE.md)

### 3. Universe & Galactic Map
**Files:** [/srv/ps/public/javascripts/galactic-map-optimized.js](../public/javascripts/galactic-map-optimized.js)

- **5000x5000 galactic space** with 2D physics simulation
- **4 Space Hubs** (corner positions):
  - Temporal Nexus (Time String - Purple) - (500, 500)
  - Quantum Forge (Tech String - Green) - (4500, 500)
  - Celestial Sanctum (Faith String - Orange) - (500, 4500)
  - Crimson Bastion (War String - Red) - (4500, 4500)
- **Real-time multiplayer** - See all online players on map
- **Navigation system** - Click-to-travel with trajectory paths
- **Galactic state tracking** - Universe-wide events
- **Planetary grid system** - World transition handoffs

**Routes:**
- `/universe/galactic-map` - 2D visualization map
- `/universe/tome` - Story/lore compendium
- `/universe/galactic-state` - ASCII galactic state (deprecated)
- `/universe/planetary-grid` - Grid system info

**Details:** See [GALACTIC_MAP_COMPLETE.md](GALACTIC_MAP_COMPLETE.md)

### 4. Zones & Planetary Exploration
**Files:** [/srv/ps/api/v1/zones/index.js](../api/v1/zones/index.js)

- Planetary zone system with exploration mechanics
- 3D spatial zone viewer (Three.js)
- Zone list and details
- Planetary grid handoff system

**Routes:**
- `/zones` - Zone list
- `/zones/explore/planetary` - Planetary exploration game
- `/zones/:zoneName/spatial` - 3D spatial viewer

### 5. Testing & Debug System
**Files:** [/srv/ps/public/javascripts/tester-toolbar.js](../public/javascripts/tester-toolbar.js)

Professional testing infrastructure for all testers:
- **Tester Toolbar** - Bottom-positioned debug toolbar
  - Location display (coordinates)
  - FPS monitoring
  - PING/latency tracking
  - Screenshot capture
  - Bug report system
  - Chat toggle
- **Global Chat** - Real-time chat with Socket.IO
- **Ship Info Pane** - Click players to view details
- **Bug Ticket System** - Comprehensive ticket management with types, severity, comments
- **User Roles** - Tester, admin, player roles

**Details:** See [TESTER_SYSTEM_COMPLETE.md](TESTER_SYSTEM_COMPLETE.md)

### 6. Socket.IO Real-Time Features
**Files:** [/srv/ps/plugins/socket/index.js](../plugins/socket/index.js)

**Events:**
- `characterJoin` - Player enters universe
- `characterDock` / `characterUndock` - Docking status changes
- `characterNavigate` - Player starts traveling
- `onlinePlayers` - List of all online players
- `onlineCount` - Updated player count
- `chatMessage` - Global chat messages
- `requestCharacterInfo` - Get player details

### 7. Analytics System
**Files:** [/srv/ps/middlewares/analyticsTracker.js](../middlewares/analyticsTracker.js)

- User action tracking
- Platform analytics (30-day default)
- Per-user analytics
- Admin dashboard with metrics

**Route:** `/admin/analytics`

**Details:** See [ANALYTICS_SYSTEM.md](ANALYTICS_SYSTEM.md)

### 8. Authentication & User Management
**Files:** [/srv/ps/plugins/passport/auth.js](../plugins/passport/auth.js)

- Passport.js with local and OAuth (Google, Facebook)
- Session management with MongoDB store
- User roles system
- Onboarding flow (welcome → intro → character creation)
- Profile pages

**Routes:**
- `/auth` - Login/register
- `/welcome` - Onboarding welcome
- `/intro` - Introduction tutorial
- `/profile` - User profile
- `/characters` - Character management

---

## Database Collections

**Core Collections:**
- `users` - User accounts with authentication
- `characters` - Player characters
- `assets` - Community-submitted assets
- `zones` - Planetary zones
- `species` - Species configuration
- `talentTrees` - Talent tree nodes
- `galacticState` - Universe-wide state
- `planetaryState` - Planetary grid state
- `userActions` - Analytics tracking
- `sessions` - Express sessions

---

## Project Structure

```
/srv/ps/
├── api/v1/              # RESTful API endpoints
│   ├── characters/
│   ├── assets/
│   ├── zones/
│   ├── universe/
│   ├── tickets/
│   └── models/
├── routes/              # Express view routes
│   ├── assets/
│   ├── zones/
│   ├── universe/
│   ├── admin/
│   └── onboarding/
├── views/               # EJS templates
│   ├── assets/
│   ├── zones/
│   ├── universe/
│   ├── admin/
│   ├── characters/
│   └── onboarding/
├── public/              # Static assets
│   ├── javascripts/
│   └── stylesheets/
├── plugins/             # Core integrations
│   ├── socket/
│   ├── passport/
│   ├── multer/
│   └── mongodb/
├── middlewares/         # Custom middleware
│   ├── authGates.js
│   ├── characterSession.js
│   └── analyticsTracker.js
├── config/              # Configuration
│   ├── database.js
│   ├── spaceHubs.js
│   └── constants.js
├── scripts/             # Utility scripts
├── uploads/             # User-uploaded files
└── zMDREADME/           # Documentation
```

---

## Key Features

### ✅ Implemented
- Character creation and progression
- Asset creation with community voting
- Galactic map with real-time multiplayer
- Navigation and docking system
- Talent tree system
- Ship inventory and equipment
- Global chat
- Testing and debug tools
- Admin dashboard
- Analytics tracking
- Bug ticket system
- Onboarding flow

### 🚧 In Progress / Future
- Planetary exploration mechanics
- Combat system
- Trading system
- Crafting recipes
- Faction system
- Quest/mission system
- Mobile app

---

## Getting Started

### Start Server
```bash
cd /srv/ps
npm run dev
```

### Access Application
- Main site: http://localhost:3399
- Login: http://localhost:3399/auth
- Galactic Map: http://localhost:3399/universe/galactic-map
- Asset Builder: http://localhost:3399/assets
- Admin Dashboard: http://localhost:3399/admin

### Check Server Status
```bash
tmux attach -t ps_session
```

---

## Documentation Index

### Feature Documentation
- [Asset Builder System](ASSET_BUILDER_COMPLETE.md) - Comprehensive asset creation guide
- [Galactic Map & Universe](GALACTIC_MAP_COMPLETE.md) - Map system and navigation
- [Tester System](TESTER_SYSTEM_COMPLETE.md) - Testing tools and debug features
- [Analytics System](ANALYTICS_SYSTEM.md) - User tracking and analytics
- [Location System](LOCATION_SYSTEM_IMPLEMENTATION.md) - Docking and positioning

### Quick References
- [User Character Reference](USER_CHARACTER_REFERENCE.md) - Character system overview
- [Menu System](MENU_SYSTEM.md) - Navigation and menus
- [Status Bar](STATUS_BAR_README.md) - Status bar implementation

### Archived (Historical)
- [Mobile Responsive Fix](MOBILE_RESPONSIVE_FIX.md)
- [Navigation Update](NAVIGATION_UPDATE.md)
- [Dynamic Link Breaking](DYNAMIC_LINK_BREAKING.md)
- [Trajectory Path System](TRAJECTORY_PATH_SYSTEM.md)
- [Galactic Map State System](GALACTIC_MAP_STATE_SYSTEM.md)
- [Galactic Map Expansion](GALACTIC_MAP_EXPANSION.md)

---

## API Quick Reference

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

### Authentication
Most endpoints require authentication via session cookies.

---

## Support & Troubleshooting

### Common Issues

**Server won't start:**
```bash
# Check if port is in use
lsof -i :3399
# Kill process if needed
kill -9 <PID>
```

**Database connection issues:**
```bash
# Check MongoDB status
sudo systemctl status mongodb
# Restart if needed
sudo systemctl restart mongodb
```

**Socket.IO not connecting:**
- Check browser console for errors
- Verify server is running
- Check firewall settings

### Logs
```bash
# Server logs
tmux attach -t ps_session

# MongoDB logs
sudo journalctl -u mongodb -n 50
```

---

## Contributing

### For Testers
1. Login with tester account
2. Enable tester toolbar in settings
3. Use bug report button for issues
4. Submit feedback via tickets

### For Developers
1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

---

**Project:** Stringborn Universe
**Version:** 1.0
**Status:** Active Development
**Last Updated:** October 24, 2025
