# Asset Scale System

## Overview

The Stringborn Universe uses a multi-scale system to organize assets based on their size and scope. Different views show different scales of objects.

## Scale Hierarchy

### 🌌 Galactic Scale (Intergalactic View)

**View:** Galactic Map (`/universe/galactic-map`)

**Visible Asset Types:**
- ✅ **Galaxy** - Massive galactic structures (Andromeda Spiral, Crimson Nebula, etc.)
- ✅ **Anomaly** - Large spatial anomalies (wormholes, temporal rifts, quantum singularities)
- ✅ **Orbital** - Space stations, outposts, platforms (Trading Post Sigma, Sanctuary Station)
- ✅ **Ship** - Starships and intergalactic vessels
- ✅ **Structure** - Large space structures and installations

**Hidden Asset Types:**
- ❌ **Star** - Too small (stellar scale, zoom into galaxy to see)
- ❌ **Planet** - Too small (planetary scale, zoom into star system to see)
- ❌ **Moon** - Too small (planetary scale)

**Scale Reference:**
- Map size: 5000 x 5000 units
- 1 unit ≈ 1 light-year
- Minimum visible object: ~100 light-years

### ⭐ Stellar Scale (Star System View)

**View:** Star System Map (future implementation)

**Visible Asset Types:**
- ✅ **Star** - Central stars and binary systems
- ✅ **Planet** - Planets orbiting the star
- ✅ **Moon** - Major moons
- ✅ **Orbital** - Orbital stations around planets
- ✅ **Anomaly** - Local anomalies (asteroid belts, etc.)

**Hidden Asset Types:**
- ❌ **Galaxy** - Too large (visible as background)
- ❌ **Zone** - Too small (surface scale)
- ❌ **Structure** - Surface structures (zoom into planet to see)

**Scale Reference:**
- Map size: ~1000 AU (Astronomical Units)
- 1 unit ≈ 1 AU
- Minimum visible object: ~1 AU

### 🌍 Planetary Scale (Planet Surface View)

**View:** Planet Surface Map (future implementation)

**Visible Asset Types:**
- ✅ **Zone** - Regions, biomes, territories
- ✅ **Structure** - Buildings, stations, installations
- ✅ **Environment** - Terrain features
- ✅ **Character** - NPCs, quest givers

**Hidden Asset Types:**
- ❌ **Star** - Too large (visible as sun in sky)
- ❌ **Planet** - Too large (you're on it)
- ❌ **Galaxy** - Too large
- ❌ **Item** - Too small (inventory scale)

**Scale Reference:**
- Map size: ~40,000 km (planet circumference)
- 1 unit ≈ 1 km
- Minimum visible object: ~1 km

### 👤 Personal Scale (Character View)

**View:** Character Screen, Inventory

**Visible Asset Types:**
- ✅ **Item** - Inventory items, loot
- ✅ **Weapon** - Weapons and tools
- ✅ **Armor** - Armor pieces and clothing
- ✅ **Consumable** - Med kits, energy cells
- ✅ **Module** - Ship modules, upgrades

**Scale Reference:**
- Objects range from centimeters to meters
- Personal inventory and equipment

## Current Implementation

### Galactic Map Filter

**File:** [`/srv/ps/public/javascripts/galactic-map-optimized.js`](/srv/ps/public/javascripts/galactic-map-optimized.js)

```javascript
// Filter to only show INTERGALACTIC scale assets
const validTypes = ['galaxy', 'anomaly', 'orbital', 'ship', 'structure'];
const filteredAssets = assets.filter(asset =>
  validTypes.includes(asset.assetType)
);
```

**Why Stars Are Hidden:**

Stars were previously shown on the galactic map, but this doesn't make sense from a scale perspective:

- **Galactic map shows:** 5000 x 5000 light-years
- **Star size:** ~1 light-second (not light-year!)
- **Scale difference:** ~31 million times too small

It would be like trying to see a grain of sand on a map of the United States. Stars should only appear when you zoom into a specific galaxy or region.

## Asset Type Definitions

### Galaxy
- **Scale:** Millions of light-years
- **Examples:** Andromeda Spiral, Crimson Nebula Galaxy, Elysium Cluster
- **Contains:** Star systems, nebulae, dark matter
- **Visibility:** Galactic map only

### Anomaly
- **Scale:** Hundreds to thousands of light-years
- **Examples:** Temporal Nexus Station, Quantum Singularity, Void Gate
- **Contains:** Spatial distortions, wormholes, rifts
- **Visibility:** Galactic map
- **Stationary:** Yes (fixed points in space)

### Orbital (Space Stations)
- **Scale:** Tens to hundreds of light-years (patrol range)
- **Examples:** Trading Post Sigma, Sanctuary Station, Battle Station Omega
- **Contains:** Docking bays, markets, services
- **Visibility:** Galactic map, star system map
- **Stationary:** May drift slowly

### Ship (Starships)
- **Scale:** Visible at galactic scale due to range
- **Examples:** Player ships, NPC fleets, trade convoys
- **Contains:** Crew, cargo, modules
- **Visibility:** Galactic map (when in intergalactic space)
- **Stationary:** No (actively moving)

### Structure (Space Structures)
- **Scale:** Large installations spanning light-years
- **Examples:** Dyson spheres, mega-gates, ringworlds
- **Contains:** Various facilities
- **Visibility:** Galactic map
- **Stationary:** Yes

### Star
- **Scale:** Light-seconds to light-minutes
- **Examples:** Lumina Prime, Astra Nova, Celestara
- **Contains:** Planetary systems
- **Visibility:** Star system map only
- **Hidden on:** Galactic map (too small)

### Planet/Moon
- **Scale:** Thousands of kilometers
- **Examples:** Mercatus Prime, Argent Moon, Anvil World
- **Contains:** Surface zones, biomes
- **Visibility:** Star system map, planet surface map
- **Hidden on:** Galactic map (too small)

## Database Asset Count

Current asset distribution (as of last check):

| Type | Total | Approved | Galactic Map |
|------|-------|----------|--------------|
| Galaxy | 5 | 5 | ✅ Visible |
| Anomaly | 14 | 12 | ✅ Visible |
| Orbital | 19 | 15 | ✅ Visible |
| Ship | 1 | 0 | ✅ Visible |
| Structure | 1 | 1 | ✅ Visible |
| **Star** | **16** | **16** | ❌ **Hidden** |
| Planet | 67 | 53 | ❌ Hidden |
| Character | 4 | 2 | ❌ Hidden |
| Item | 7 | 3 | ❌ Hidden |
| Weapon | 3 | 1 | ❌ Hidden |
| Armor | 5 | 0 | ❌ Hidden |
| Module | 6 | 0 | ❌ Hidden |

**Galactic Map Now Shows:** 40 approved assets (5 galaxies + 12 anomalies + 15 orbitals + 1 structure)
**Previously Showed:** 56 assets (included 16 stars that were too small)

## Migration Notes

### Changes Made

1. **Removed `'star'` from galactic map valid types**
   - Stars are now hidden on galactic view
   - Will appear in future star system view

2. **Added `'ship'` and `'structure'` to valid types**
   - Future-proofing for starship implementation
   - Large structures now visible

3. **Updated stationarity logic**
   - Galaxies: Stationary
   - Anomalies: Stationary
   - Structures: Stationary
   - Orbitals: May drift slowly
   - Ships: Mobile

### Impact

**Before:**
```
Galactic Map: 5 galaxies + 12 anomalies + 15 orbitals + 16 stars = 48 objects
(Stars were too small to be realistic at this scale)
```

**After:**
```
Galactic Map: 5 galaxies + 12 anomalies + 15 orbitals + 1 structure = 33 objects
(All objects are appropriately sized for galactic scale)
```

### For Players

- **Galactic map is now cleaner** - Only shows large-scale structures
- **Stars will have dedicated view** - Future star system zoom view
- **More realistic scale** - Objects shown are appropriate for the view
- **Better performance** - Fewer objects to render

### For Developers

- **Asset types are scale-aware** - Each type has appropriate visibility
- **Easy to extend** - Add new asset types to appropriate scale
- **Clear separation** - Galactic vs stellar vs planetary vs personal

## Future Enhancements

### Star System View
- Zoom into a galaxy to see its star systems
- Navigate between stars
- View planetary orbits

### Planetary View
- Zoom into a planet to see surface zones
- Explore biomes and territories
- View structures and settlements

### Dynamic LOD (Level of Detail)
- Automatically show/hide assets based on zoom level
- Smooth transitions between scales
- Adaptive rendering for performance

## Testing

### Verify Galactic Map Filter

1. Open galactic map: `https://ps.madladslab.com/universe/galactic-map`
2. Check browser console for asset count
3. Should see: "Loading 33 assets" (no stars)
4. Previously saw: "Loading 48 assets" (included stars)

### Check Asset Visibility

```bash
# Run asset type check
cd /srv/ps
DB_URL="mongodb+srv://..." node scripts/check-asset-types.js
```

### Clear Spatial Cache

```bash
# Force map reload with new filters
curl -X DELETE https://svc.madladslab.com/api/spatial/assets
```

Then hard refresh browser: `Ctrl+Shift+R`

## Related Documentation

- [Galactic Map Settings](/srv/ps/docs/GALACTIC_MAP_RESET.md)
- [Asset Schema](/srv/ps/api/v1/models/Asset.js)
- [Spatial Service Integration](/srv/ps/docs/GAME_STATE_SYNC_FIX.md)

## Conclusion

The asset scale system ensures that each view shows objects appropriate for its scale:
- ✅ Galactic map: Galaxies, anomalies, space stations, ships
- ❌ Galactic map: Stars (too small), planets (way too small)
- 🔜 Future: Star system view for stars and planets
- 🔜 Future: Planetary view for surface details

This creates a more realistic and performant multi-scale universe.
