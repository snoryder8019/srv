# Map Level System

## Problem
Assets like starships need to be positioned at different "zoom levels" of the universe:
- **Galactic level** - Floating in deep space between galaxies
- **Galaxy level** - Orbiting a galactic core
- **System level** - Orbiting a star or planet
- **Orbital level** - Station keeping near a specific object

Currently, all assets with coordinates show on ALL map levels, which is wrong.

## Solution: Add `mapLevel` Field

### Asset Schema Addition

```javascript
{
  _id: ObjectId,
  assetType: 'starship', // or any type
  title: 'USS Enterprise',

  // NEW: Map level determines WHERE this asset is shown
  mapLevel: 'galactic',  // 'galactic' | 'galaxy' | 'system' | 'orbital'

  // Existing fields
  coordinates: { x, y, z },
  hierarchy: {
    parent: ObjectId,  // What it orbits or is near
    parentType: 'planet' // or 'star', 'galaxy', null
  }
}
```

### Map Level Definitions

| Level | Scope | Shows | Examples |
|-------|-------|-------|----------|
| `galactic` | Universe-wide | Galaxies, deep space stations, colony ships | Anomalies, massive structures, generational ships |
| `galaxy` | Inside a galaxy | Stars, galactic structures, large stations | Starships traveling between stars, space stations |
| `system` | Solar system | Planets, moons, stations, ships | Starships in orbit, space stations, asteroids |
| `orbital` | Near a specific body | Close objects, landing zones | Satellites, docked ships, orbital platforms |

### Rendering Rules

**Galactic Map 3D** (`/universe/galactic-map-3d`):
```javascript
// Only show galactic-level assets
const assets = allAssets.filter(a =>
  a.mapLevel === 'galactic' ||
  a.assetType === 'galaxy' ||
  a.assetType === 'anomaly'
);
```

**Galaxy View** (when drilling into a galaxy):
```javascript
// Show galaxy-level assets within this galaxy
const assets = allAssets.filter(a =>
  (a.mapLevel === 'galaxy' && a.hierarchy.parent === galaxyId) ||
  (a.assetType === 'star' && a.hierarchy.parent === galaxyId)
);
```

**System View** (when drilling into a star):
```javascript
// Show system-level assets within this system
const assets = allAssets.filter(a =>
  (a.mapLevel === 'system' && a.hierarchy.parent === starId) ||
  (a.assetType === 'planet' && a.hierarchy.parent === starId)
);
```

**Orbital View** (near a planet):
```javascript
// Show orbital-level assets near this planet
const assets = allAssets.filter(a =>
  a.mapLevel === 'orbital' && a.hierarchy.parent === planetId
);
```

## Asset Type + Map Level Matrix

| Asset Type | Default Map Level | Can Be At |
|------------|------------------|-----------|
| `galaxy` | `galactic` | galactic only |
| `anomaly` | `galactic` | galactic only |
| `star` | `galaxy` | galaxy only |
| `planet` | `system` | system only |
| `station` | any | galactic, galaxy, system, orbital |
| `starship` | any | galactic, galaxy, system, orbital |
| `zone` | `orbital` | orbital (landable) |
| `asteroid` | `system` or `orbital` | system, orbital |

## Starship Examples

### Deep Space Colony Ship
```javascript
{
  assetType: 'starship',
  title: 'Generation Ship Exodus',
  mapLevel: 'galactic',  // Shows on galactic map
  coordinates: { x: 1000, y: 500, z: -200 },
  hierarchy: {
    parent: null,  // Not orbiting anything
    parentType: null
  }
}
```

### Interstellar Transport
```javascript
{
  assetType: 'starship',
  title: 'Trade Vessel Meridian',
  mapLevel: 'galaxy',  // Shows when viewing a galaxy
  coordinates: { x: 50, y: 20, z: 10 },  // Relative to galaxy center
  hierarchy: {
    parent: ObjectId('galaxy_id'),
    parentType: 'galaxy'
  }
}
```

### Orbital Station
```javascript
{
  assetType: 'station',
  title: 'Orbital Platform Alpha',
  mapLevel: 'system',  // Shows in system view
  coordinates: { x: 100, y: 0, z: 0 },  // Orbiting position
  hierarchy: {
    parent: ObjectId('planet_id'),
    parentType: 'planet'
  }
}
```

### Docked Ship
```javascript
{
  assetType: 'starship',
  title: 'Shuttle Hermes',
  mapLevel: 'orbital',  // Shows in close orbital view
  coordinates: { x: 5, y: 2, z: 0 },  // Very close
  hierarchy: {
    parent: ObjectId('station_id'),
    parentType: 'station'
  }
}
```

## Implementation Steps

### 1. Add Field to Asset Model
```javascript
// /srv/ps/api/v1/models/Asset.js
static async create(assetData) {
  const asset = {
    // ... existing fields
    mapLevel: assetData.mapLevel || this.getDefaultMapLevel(assetData.assetType),
    // ... rest
  };
}

static getDefaultMapLevel(assetType) {
  const defaults = {
    'galaxy': 'galactic',
    'anomaly': 'galactic',
    'star': 'galaxy',
    'planet': 'system',
    'orbital': 'system',
    'zone': 'orbital',
    'station': 'system',
    'starship': 'system',  // Default, but can be changed
    'asteroid': 'system'
  };
  return defaults[assetType] || 'system';
}
```

### 2. Update Galactic Map Loader
```javascript
// /srv/ps/public/javascripts/galactic-map-3d.js
async loadAssets() {
  // ... fetch all assets

  // Filter by current map level
  let visibleAssets;
  if (this.currentLevel === 'galactic') {
    visibleAssets = this.allAssets.filter(a =>
      a.mapLevel === 'galactic' ||
      a.assetType === 'galaxy' ||
      a.assetType === 'anomaly'
    );
  } else if (this.currentLevel === 'galaxy') {
    visibleAssets = this.allAssets.filter(a =>
      (a.mapLevel === 'galaxy' && a.parentGalaxy === this.selectedGalaxyId) ||
      (a.assetType === 'star' && a.parentGalaxy === this.selectedGalaxyId)
    );
  } else if (this.currentLevel === 'system') {
    visibleAssets = this.allAssets.filter(a =>
      (a.mapLevel === 'system' && a.parentStar === this.selectedStarId) ||
      (a.assetType === 'planet' && a.parentStar === this.selectedStarId)
    );
  }

  visibleAssets.forEach(asset => this.addAsset(asset));
}
```

### 3. Add to Asset Builder Form
```html
<!-- /srv/ps/views/assets/builder-enhanced.ejs -->
<div class="form-group">
  <label for="mapLevel">Map Level</label>
  <select id="mapLevel" name="mapLevel">
    <option value="">Auto (based on type)</option>
    <option value="galactic">Galactic (deep space)</option>
    <option value="galaxy">Galaxy (inside galaxy)</option>
    <option value="system">System (solar system)</option>
    <option value="orbital">Orbital (near planet/station)</option>
  </select>
  <small>Where should this asset appear on the map?</small>
</div>
```

### 4. Migration Script
```javascript
// /srv/ps/scripts/add-map-levels.js
async function addMapLevels() {
  const db = getDb();

  // Set default map levels based on asset type
  await db.collection('assets').updateMany(
    { assetType: 'galaxy' },
    { $set: { mapLevel: 'galactic' } }
  );

  await db.collection('assets').updateMany(
    { assetType: 'anomaly' },
    { $set: { mapLevel: 'galactic' } }
  );

  await db.collection('assets').updateMany(
    { assetType: 'star' },
    { $set: { mapLevel: 'galaxy' } }
  );

  await db.collection('assets').updateMany(
    { assetType: 'planet' },
    { $set: { mapLevel: 'system' } }
  );

  // ... etc
}
```

## Benefits

1. **Flexible Positioning** - Place starships anywhere in the hierarchy
2. **Clean Rendering** - Each map level only shows relevant objects
3. **Scale Independence** - Small objects don't clutter galactic view
4. **Gameplay Clarity** - Players see appropriate detail at each zoom level
5. **Unified System** - All assets use same positioning logic

## Use Cases

**Generational Starship Colony:**
- mapLevel: `galactic`
- parent: `null` (deep space)
- Shows on galactic map as selectable/landable

**Trade Hub Station:**
- mapLevel: `galaxy`
- parent: `galaxy_id`
- Shows when viewing that galaxy

**Mining Ship:**
- mapLevel: `system`
- parent: `star_id`
- Shows in solar system view, can orbit asteroids

**Shuttle:**
- mapLevel: `orbital`
- parent: `station_id`
- Only visible in close orbital view

---

This system gives you complete control over WHERE assets appear while maintaining the unified asset database structure!
