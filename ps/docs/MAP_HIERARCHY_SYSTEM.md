# Map Hierarchy System - 3-Level Drill-Down

**Date:** October 27, 2025
**Status:** ✅ Galactic Level Implemented

---

## Overview

The galactic map uses a **3-level hierarchical drill-down system** to manage the scale of the universe:

```
Level 1: GALACTIC MAP    →  Level 2: GALAXY MAP    →  Level 3: SYSTEM MAP
(Galaxies & Zones)          (Stars in a galaxy)        (Planets & Orbitals)
```

This prevents information overload and provides logical navigation through the universe.

---

## Level 1: Galactic Map (Current View)

**Purpose:** Top-level overview of the entire universe

**Shows:**
- 🟣 **Galaxies** (5 total) - Large purple spheres
- 🔵 **Zones** (4 total) - Wireframe torus rings
  - Crystal Fields (500, 500, 0)
  - Trade Route Alpha (-500, 500, 0)
  - Dark Sector (-500, -500, 0)
  - Nebula Wastes (500, -500, 0)
- ✨ **Anomalies** (14 total) - Special points of interest

**Does NOT Show:**
- ❌ Stars (belong in Galaxy Map)
- ❌ Planets (belong in System Map)
- ❌ Orbitals (belong in System Map)
- ❌ Ships/Characters (too detailed for this level)

**File:** `/srv/ps/views/universe/galactic-map-3d.ejs`
**Script:** `/srv/ps/public/javascripts/galactic-map-3d.js`

**Asset Filter:**
```javascript
const galacticTypes = ['galaxy', 'zone', 'anomaly'];
```

**Navigation:**
- Click on a **Galaxy** → Drill down to Galaxy Map (Level 2)
- Click on a **Zone** → Show zone information
- Click on an **Anomaly** → Show anomaly details

---

## Level 2: Galaxy Map (Future Implementation)

**Purpose:** Show star systems within a selected galaxy

**Shows:**
- ⭐ **Stars** (16 total across all galaxies)
- Galaxy boundary/backdrop
- Parent galaxy name in header

**Does NOT Show:**
- ❌ Other galaxies
- ❌ Planets (belong in System Map)
- ❌ Orbitals (belong in System Map)

**Asset Filter (proposed):**
```javascript
const galaxyTypes = ['star'];
const parentGalaxyId = selectedGalaxy._id;
// Filter: assetType='star' AND parentGalaxy=selectedGalaxy
```

**Navigation:**
- Click on a **Star** → Drill down to System Map (Level 3)
- **Back Button** → Return to Galactic Map (Level 1)

**File (to create):** `/srv/ps/views/universe/galaxy-map-3d.ejs`

---

## Level 3: System Map (Future Implementation)

**Purpose:** Show planetary bodies within a selected star system

**Shows:**
- 🌍 **Planets** (67 total across all systems)
- 🛰️ **Orbitals** (19 total - moons, stations)
- 🚀 **Ships** (dynamic from state manager)
- 👤 **Characters** (dynamic from state manager)
- Parent star in center

**Does NOT Show:**
- ❌ Other stars
- ❌ Galaxies

**Asset Filter (proposed):**
```javascript
const systemTypes = ['planet', 'orbital', 'station', 'ship'];
const parentStarId = selectedStar._id;
// Filter: assetType IN systemTypes AND parentStar=selectedStar
```

**State Manager Integration:**
- ✅ Real-time character positions
- ✅ Ship movements with 3D physics
- ✅ Orbital mechanics
- ✅ Velocity visualization

**Navigation:**
- Click on a **Planet** → Show planet details
- Click on an **Orbital** → Show orbital details
- **Back Button** → Return to Galaxy Map (Level 2)

**File (to create):** `/srv/ps/views/universe/system-map-3d.ejs`

---

## Database Schema

### Assets Collection

Each asset has a hierarchy defined by parent references:

```javascript
{
  _id: ObjectId,
  assetType: 'galaxy' | 'star' | 'planet' | 'orbital' | 'zone' | 'anomaly',
  title: String,
  coordinates: {
    x: Number,
    y: Number,
    z: Number  // ✅ All orbital bodies now have Z
  },
  
  // Hierarchy relationships
  parentGalaxy: ObjectId,  // For stars
  parentStar: ObjectId,    // For planets, orbitals
  parentPlanet: ObjectId,  // For orbitals (moons)
  
  status: 'approved',
  stats: { ... }
}
```

### Current Z Coordinate Status

✅ **All 102 orbital bodies have Z coordinates:**
- 16 Stars (z coordinate from migration)
- 67 Planets (z coordinate from migration)
- 19 Orbitals (z coordinate from migration)

**Verified:** `scripts/check-orbital-z-coords.js`

---

## Implementation Status

### ✅ Level 1: Galactic Map - COMPLETE

**Features:**
- Only shows galaxies, zones, anomalies
- Wireframe torus rings for zones
- 3D starfield surrounding camera
- Smooth camera focus on click
- No clutter from lower-level objects

**Code:**
- [galactic-map-3d.js:612-620](../ps/public/javascripts/galactic-map-3d.js#L612-L620) - Asset type filter
- [galactic-map-3d.js:636-638](../ps/public/javascripts/galactic-map-3d.js#L636-L638) - State manager disabled

### 🚧 Level 2: Galaxy Map - TODO

**Needs:**
1. New route: `/universe/galaxy/:galaxyId/3d`
2. New view file: `galaxy-map-3d.ejs`
3. Filter stars by `parentGalaxy`
4. Back button to galactic map
5. Galaxy name in header

### 🚧 Level 3: System Map - TODO

**Needs:**
1. New route: `/universe/system/:starId/3d`
2. New view file: `system-map-3d.ejs`
3. Filter planets/orbitals by `parentStar`
4. Enable state manager sync (characters, ships)
5. Physics visualization
6. Back button to galaxy map

---

## Navigation Flow

```
User Journey:

1. GALACTIC MAP
   User sees: 5 galaxies, 4 zones, 14 anomalies
   User clicks: "Andromeda Spiral" galaxy
   ↓

2. GALAXY MAP (Andromeda)
   User sees: 3 stars within Andromeda
   User clicks: "Lumina Prime" star
   ↓

3. SYSTEM MAP (Lumina Prime System)
   User sees: 4 planets, 2 moons, characters, ships
   User clicks: "Mercatus Prime" planet
   ↓

4. PLANET DETAILS
   Shows: Planet info, resources, population, etc.
```

---

## Benefits of Hierarchy

### Performance
- **Reduced rendering load** - Only show relevant objects
- **Faster raycast checks** - Fewer objects to check on click
- **Better framerates** - Less geometry in scene

### User Experience
- **Less visual clutter** - Easier to understand
- **Logical navigation** - Intuitive drill-down
- **Appropriate detail** - Show what's relevant at each level

### Scale Management
- **Galactic:** Thousands of light-years
- **Galaxy:** Hundreds of light-years (star-to-star)
- **System:** Millions of kilometers (planet-to-planet)

---

## Asset Counts by Level

| Level | Asset Types | Count | Purpose |
|-------|-------------|-------|---------|
| **Galactic** | Galaxy, Zone, Anomaly | 23 | Universe overview |
| **Galaxy** | Star | 16 | Star selection |
| **System** | Planet, Orbital, Ship, Character | 100+ | Detailed gameplay |

**Total Galactic Assets:** 126 (excluding non-galactic items removed)

---

## Next Steps

To complete the 3-level hierarchy:

1. **Create Galaxy Map View**
   - Copy `galactic-map-3d.ejs` → `galaxy-map-3d.ejs`
   - Filter for stars in selected galaxy
   - Add back button to galactic map

2. **Create System Map View**
   - Copy `galactic-map-3d.ejs` → `system-map-3d.ejs`
   - Filter for planets/orbitals in selected star
   - Enable state manager sync
   - Add physics visualization
   - Add back button to galaxy map

3. **Add Navigation Routes**
   ```javascript
   router.get('/universe/galactic/3d', showGalacticMap);
   router.get('/universe/galaxy/:galaxyId/3d', showGalaxyMap);
   router.get('/universe/system/:starId/3d', showSystemMap);
   ```

4. **Add Click Handlers**
   - Galactic map: Galaxy click → Navigate to galaxy map
   - Galaxy map: Star click → Navigate to system map
   - System map: Planet click → Show details panel

---

## Current State

✅ **Galactic Map** is now clean and only shows top-level objects
✅ **Z coordinates** are persisting correctly in database
✅ **Click/focus** working without objects disappearing
✅ **Zones** rendering as distinctive wireframe rings
✅ **Starfield** surrounds camera in 3D space

**Ready for:** Galaxy and System map implementation

---

**End of Map Hierarchy Documentation**
