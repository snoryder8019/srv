# Stringborn Universe - Official Roadmap

**Last Updated:** October 30, 2025
**Current Version:** v0.5.1
**Vision:** Community-Driven Game Builder Platform

---

## 🎯 Core Vision

**Stringborn Universe is NOT a traditional MMO.** It's a **user-driven game creation platform** where:

- **Players BUILD the game content** - Ships, stations, dungeons, planets, all pixel-based
- **Community curates quality** - Democratic voting on user-created assets
- **Logistics drive strategy** - Distance, isolation, and supply chains matter
- **Seasons create fresh starts** - Persistent universe resets with legacy rewards
- **Empires rise and fall** - Isolated pockets conquered or championed

---

## 🏗️ Core Pillars

### 1. **Community Creation Tools** 🎨
*Players are the developers*

**Current:**
- ✅ Asset Builder (15+ asset types)
- ✅ Sprite Creator (80x80px atlases)
- ✅ Democratic voting system
- ✅ Community approval workflow

**Next Phase:**
- 🔄 Pixel World Builder for ship interiors
- 🔄 Dungeon/Station Editor (grid-based)
- 📋 Room template system
- 📋 Multi-tile object designer
- 📋 Animation frame editor

**Future:**
- Planet biome designer
- NPC behavior scripting
- Quest/mission creator
- Loot table editor
- Boss encounter designer

---

### 2. **Persistent Universe Mechanics** 🌌
*Distance and logistics matter*

**Current:**
- ✅ 3D galactic map with physics
- ✅ Real-time multiplayer tracking
- ✅ Asset hierarchy (planet→star→galaxy→anomaly)
- ✅ Coordinate system (galactic, scene, system, orbital)

**Next Phase:**
- 🔄 Travel time calculations based on distance
- 📋 Fuel/resource consumption during travel
- 📋 Supply chain mechanics
- 📋 Trade route establishment
- 📋 Cargo capacity limits

**Future:**
- Isolated pocket mechanics (resource-rich regions far from centers)
- Logistics networks (efficient vs inefficient routes)
- Empire collapse from overstretched supply lines
- Seasonal territory resets
- Legacy system (carry achievements between seasons)

---

### 3. **Dual Gameplay Modes** 🎮
*Two games, one universe*

#### A. **3D Space Explorer** (Tactical/Strategy)
*Navigate the galaxy, manage logistics*

**Current:**
- ✅ 3D galactic navigation
- ✅ System map with orbital mechanics
- ✅ Ship combat system
- ✅ Real-time multiplayer

**Next:**
- 📋 Travel time enforcement (no instant teleport)
- 📋 Fuel management
- 📋 Cargo trading
- 📋 Fleet management
- 📋 Route planning UI

**Future:**
- Convoy systems
- Blockade mechanics
- Warp gate construction
- Supply depot management

#### B. **2D Roguelite Planetary** (Action/Exploration)
*Explore surfaces, loot dungeons, combat*

**Current:**
- 🔄 Planetary chunk generation (Phase 1, 55% complete)
- 🔄 Sprite-based rendering
- 🔄 Object placement system

**Next:**
- 📋 Roguelite mechanics (permadeath, random generation)
- 📋 Dungeon exploration
- 📋 Combat system (top-down)
- 📋 Loot drops
- 📋 NPC/monster spawns

**Future:**
- Player-built dungeons
- Station interior exploration
- Ship boarding mechanics
- Environmental hazards
- Boss encounters

---

## 📅 Development Timeline

### **Phase 1: Planetary Exploration Foundation** (55% Complete)
*Target: November 2025*

**Status:** 🔄 In Progress

**Remaining Tasks:**
- [ ] Complete sprite atlas system
- [ ] Planet object placement API
- [ ] Chunk renderer sprite integration
- [ ] Spaceship landing mechanics
- [ ] Procedural terrain (no DB storage)

**Goal:** Players can land on planets, place objects, see sprite-based worlds

---

### **Phase 2: Player World Builder**
*Target: December 2025*

**Features:**
- Ship interior builder (pixel grid)
- Station interior builder
- Dungeon creator
- Multi-room layouts
- Door/portal connections
- Lighting and atmosphere

**Goal:** Players can design and share ship/station/dungeon interiors

---

### **Phase 3: Roguelite Mechanics**
*Target: January 2026*

**Features:**
- Planetary surface combat
- Dungeon exploration (player-built)
- Loot system
- Permadeath with progression
- NPC spawns
- Monster AI

**Goal:** Functional roguelite gameplay loop on planets

---

### **Phase 4: Logistics & Distance**
*Target: February 2026*

**Features:**
- Real travel times (no instant teleport)
- Fuel consumption
- Cargo capacity
- Trade routes
- Supply chains
- Distance calculations affect everything

**Goal:** Distance and logistics become core strategic elements

---

### **Phase 5: Isolation & Empires**
*Target: March 2026*

**Features:**
- Territory control
- Isolated pocket mechanics
- Resource scarcity in distant regions
- Empire expansion limits
- Logistics-based collapse
- Conquest mechanics

**Goal:** Isolated regions can thrive or fail based on supply chains

---

### **Phase 6: Seasonal System**
*Target: Q2 2026*

**Features:**
- Season duration (3-6 months)
- Universe reset at season end
- Legacy rewards (carry over bonuses)
- Seasonal leaderboards
- Empire hall of fame
- New content each season

**Goal:** Fresh starts with meaningful progression

---

## 🎯 Immediate Priorities (Next 30 Days)

### Week 1-2
1. ✅ Update roadmap documentation (this file)
2. 🔄 Complete Phase 1 planetary system
3. 📋 Design ship interior builder UI mockup
4. 📋 Plan logistics calculation system

### Week 3-4
1. 📋 Build ship interior editor prototype
2. 📋 Test multi-room layouts
3. 📋 Implement travel time calculations
4. 📋 Design fuel consumption mechanics

---

## 🔧 Technical Architecture Goals

### Builder Tools
- **Grid-based editors** for all pixel worlds
- **Template system** for reusable rooms/layouts
- **Import/export** JSON for sharing creations
- **Preview mode** before publishing
- **Version control** for iterative improvements

### Logistics Engine
- **Distance calculation** using 3D coordinates
- **Pathfinding** for efficient routes
- **Resource tracking** per ship/station
- **Supply chain simulation** (production → consumption)
- **Failure states** when logistics break down

### Seasonal System
- **Universe snapshots** at season end
- **Legacy calculation** based on achievements
- **Content rotation** (new sprites, dungeons each season)
- **Leaderboard archives** for historical records
- **Migration tools** for carrying over select content

---

## 🎨 Player Creation Pipeline

### Current Flow (v0.5.1)
1. Create sprite atlas (80x80px, 5x5 tiles)
2. Submit for community voting
3. Admin approves high-quality assets
4. Players use approved sprites

### Future Flow (v0.6+)
1. Create sprites using builder tools
2. Design rooms/dungeons using sprites
3. Test in sandbox mode
4. Submit to community
5. Players vote on quality
6. High-rated content enters main universe
7. Creator earns legacy points

---

## 🌟 Success Metrics

### Builder Adoption
- 50% of active users create at least one asset
- 1,000+ community-approved sprites
- 500+ player-built dungeons/stations

### Logistics Impact
- 80% of player decisions influenced by distance
- Active trade routes between 100+ systems
- 10+ player-run supply chains

### Seasonal Engagement
- 70% player retention between seasons
- 30% increase in activity at season start
- 500+ empires compete per season

---

## 🚫 What We're NOT Building

To stay focused on the vision:

- ❌ VR support (not necessary for pixel builder)
- ❌ First-person planetary walking (2D roguelite is the plan)
- ❌ Fully 3D ship interiors (pixel grid-based)
- ❌ Real-time space combat sim (tactical 3D is sufficient)
- ❌ Single-player offline mode (persistent universe only)

---

## 💡 Design Philosophy

### Player Agency
- **Players build everything** - We provide the canvas and tools
- **Community curates** - Democratic quality control
- **No paywalls for creation** - Everyone can build

### Meaningful Choices
- **Distance matters** - Logistics aren't abstracted away
- **Isolation is powerful** - Remote regions offer unique opportunities
- **Time is valuable** - Travel takes real time (within reason)

### Fresh Starts
- **Seasons prevent stagnation** - No permanent mega-empires
- **Legacy rewards skill** - Veterans earn advantages
- **New players can compete** - Every season is a reset

---

## 📚 Related Documentation

- [claudeTodolist.md](claudeTodolist.md) - Phase 1 implementation details
- [PHASE_1_PROGRESS.md](PHASE_1_PROGRESS.md) - Current development status
- [SPRITE_ATLAS_SPEC.md](SPRITE_ATLAS_SPEC.md) - Technical sprite specifications
- [PATCH_NOTES_v0.5.0.md](PATCH_NOTES_v0.5.0.md) - Latest release notes

---

## 🤝 Community Involvement

We need community input on:

1. **Season duration** - How long should seasons last?
2. **Legacy rewards** - What should carry over between seasons?
3. **Logistics balance** - How punishing should distance be?
4. **Builder tools** - What features do creators need most?
5. **Conquest mechanics** - How should territory control work?

**Feedback:** Use in-game ticket system or GitHub discussions

---

## 🎯 The Ultimate Goal

**By v1.0 (Q2 2026):**

A thriving game creation platform where:
- **Thousands of players** build dungeons, stations, and ships
- **Logistics networks** span the galaxy
- **Seasonal empires** rise and fall based on strategy
- **Isolated pockets** become legendary conquest targets
- **Community content** drives 90% of gameplay

**The universe is built by the players, for the players.**

---

*Last Updated: October 30, 2025*
*Vision Aligned: User-Driven Game Builder Platform*
