# Starship Colony Building Workflow

Complete guide for building out starship colonies with interior floormaps and sprites.

## Overview

Everything is an asset in the database with hierarchical relationships:

```
Anomaly (Starship Colony) ← Shows on galactic map as orb
  ├─ Zone (Interior Floormap) ← The actual playable interior
  │   ├─ Sprite (Wall Tile)
  │   ├─ Sprite (Floor Tile)
  │   ├─ Sprite (Door)
  │   └─ Sprite (...)
  └─ 3D Model (GLTF) ← Optional exterior model for galactic map
```

## Step-by-Step Workflow

### Phase 1: Create Your Starship Colony (Anomaly)

**You already have:**
- The Primordial Singularity
- The Nexus Singularity

**To create more:**
1. Go to `/assets/builder-enhanced`
2. Select Asset Type: **Anomaly**
3. Fill in:
   - Name: "USS Enterprise" (or whatever)
   - Description: "Generational starship colony"
   - Coordinates: (will appear on galactic map)
4. **Save Draft** or **Publish**

**Database Structure:**
```javascript
{
  _id: ObjectId,
  assetType: 'anomaly',
  title: 'The Primordial Singularity',
  coordinates: { x: 235, y: 1032, z: -501 },
  renderData: {
    color: '#ff00ff',
    size: 40,
    glow: true
  },
  hierarchy: {
    parent: null,
    children: [], // Will contain Zone IDs
    depth: 0
  }
}
```

---

### Phase 2: Create Interior Floormap (Zone)

**Option A: Use Interior Map Builder**
1. Go to `/universe/interior-map-builder?parentAssetId={anomalyId}&parentAssetType=anomaly`
2. Design your floormap with the tile editor
3. Mark spawn points, loot, NPCs
4. Click **"Save as Zone Asset"**
5. This creates a Zone linked to your Anomaly

**Option B: Use Asset Builder**
1. Go to `/assets/builder-enhanced`
2. Select Asset Type: **Zone**
3. Select Parent: Your anomaly
4. Fill in zone details
5. Add zoneData manually (or use map builder)

**Database Structure:**
```javascript
{
  _id: ObjectId,
  assetType: 'zone',
  title: 'Primordial Singularity - Deck 1',
  hierarchy: {
    parent: ObjectId('anomaly_id'),
    parentType: 'anomaly',
    depth: 1
  },
  zoneData: {
    type: 'interior',
    width: 50,
    height: 50,
    tileSize: 32,
    layers: {
      ground: [[1,1,0,...]], // Tile map
      walls: [[0,1,0,...]],
      sprites: [] // Will be populated
    },
    spawnPoints: [
      { x: 25, y: 25, type: 'player' }
    ]
  }
}
```

---

### Phase 3: Create Sprite Sheet

**You need a PNG sprite sheet** with all your tiles. Example structure:

```
[Wall][Floor][Door]
[Bed] [Table][Chair]
[...]
```

**To import:**
1. Go to `/assets/sprite-creator`
2. Click **"Import from Sprite Sheet"** tab
3. Upload your PNG sprite sheet
4. Provide JSON definition:

```json
{
  "name": "Starship Interior Tileset",
  "tileWidth": 32,
  "tileHeight": 32,
  "sprites": [
    {
      "name": "Metal Wall",
      "frame": 0,
      "solid": true,
      "collision": { "x": 0, "y": 0, "w": 32, "h": 32 }
    },
    {
      "name": "Metal Floor",
      "frame": 1,
      "solid": false
    },
    {
      "name": "Airlock Door",
      "frame": 2,
      "solid": true,
      "interactive": true,
      "interactionType": "door"
    }
  ]
}
```

5. Select your Zone as the target
6. Click **Import Sprites**

**This creates:**
- 1 Sprite Sheet asset (the PNG)
- Multiple Sprite assets (one per tile)
- All linked to your Zone

**Database Structure:**
```javascript
// Sprite Sheet Asset
{
  _id: ObjectId,
  assetType: 'sprite_sheet',
  title: 'Starship Interior Tileset',
  images: {
    fullscreen: '/uploads/sprites/sprite-123456.png'
  }
}

// Individual Sprite Assets
{
  _id: ObjectId,
  assetType: 'sprite',
  title: 'Metal Wall',
  spriteData: {
    spriteSheetId: ObjectId('sprite_sheet_id'),
    frame: 0,
    width: 32,
    height: 32,
    solid: true,
    collision: { x: 0, y: 0, w: 32, h: 32 }
  },
  hierarchy: {
    parent: ObjectId('zone_id'),
    parentType: 'zone',
    depth: 2
  }
}
```

---

### Phase 4: Assign Sprites to Floormap Tiles

**Option A: Via Interior Map Builder**
1. Open Interior Map Builder with your zone
2. Load sprite palette (shows all sprites linked to this zone)
3. Paint tiles onto the grid
4. Each tile references a sprite ID
5. Save updates the zoneData.layers.sprites

**Option B: Via API**
```javascript
POST /api/v1/sprites/assign-to-zone
{
  "zoneId": "zone_id",
  "spriteIds": ["sprite1_id", "sprite2_id", ...]
}
```

**Updated Zone:**
```javascript
{
  zoneData: {
    layers: {
      sprites: [
        { spriteId: ObjectId('wall_sprite'), x: 0, y: 0 },
        { spriteId: ObjectId('floor_sprite'), x: 1, y: 0 },
        { spriteId: ObjectId('door_sprite'), x: 2, y: 0 }
      ]
    }
  }
}
```

---

### Phase 5: Add 3D Model to Anomaly (Optional)

**For galactic map exterior:**
1. Go to `/assets/builder-enhanced`
2. Edit your anomaly
3. Upload GLTF/GLB model
4. This replaces the orb with your ship model

**Database Update:**
```javascript
{
  assetType: 'anomaly',
  models: {
    gltf: '/uploads/models/starship-123456.glb'
  }
}
```

---

## Complete Hierarchy Example

```
The Primordial Singularity (Anomaly)
  │
  ├─ Deck 1 - Command Center (Zone)
  │   ├─ Metal Wall (Sprite)
  │   ├─ Metal Floor (Sprite)
  │   ├─ Command Console (Sprite)
  │   └─ Viewport (Sprite)
  │
  ├─ Deck 2 - Living Quarters (Zone)
  │   ├─ Bunk Bed (Sprite)
  │   ├─ Locker (Sprite)
  │   └─ ...
  │
  └─ Starship Exterior (3D Model GLTF)
```

---

## Quick Reference URLs

**Builder Hub:** `/assets/builder-hub`
- Central navigation for all builders
- View asset hierarchy tree
- Quick access to all tools

**Asset Builder:** `/assets/builder-enhanced`
- Create anomalies, zones, etc.
- Set hierarchy relationships
- Upload 3D models

**Interior Map Builder:** `/universe/interior-map-builder`
- Design tile-based floormaps
- Mark spawn points, loot, NPCs
- Creates Zone assets

**Sprite Creator:** `/assets/sprite-creator`
- Import sprite sheets
- Create individual sprites
- Assign to zones

**Galactic Map:** `/universe/galactic-map-3d`
- View all anomalies in 3D space
- Click to land on starships
- See orbiting physics

---

## Database Queries

**Find all zones for an anomaly:**
```javascript
db.assets.find({
  assetType: 'zone',
  'hierarchy.parent': ObjectId('anomaly_id')
})
```

**Find all sprites for a zone:**
```javascript
db.assets.find({
  assetType: 'sprite',
  'hierarchy.parent': ObjectId('zone_id')
})
```

**Get full hierarchy tree:**
```javascript
GET /api/v1/hierarchy/tree/{assetId}
```

---

## Everything is an Asset

You're absolutely right - **everything IS an asset**:
- Anomalies → Asset (type: anomaly)
- Zones → Asset (type: zone)
- Sprites → Asset (type: sprite)
- Sprite Sheets → Asset (type: sprite_sheet)
- Galaxies → Asset (type: galaxy)
- Stars → Asset (type: star)
- Planets → Asset (type: planet)

**All assets share:**
- `_id` (unique identifier)
- `assetType` (what kind of thing)
- `hierarchy` (parent-child relationships)
- `coordinates` (where in space)
- `renderData` (how to display)
- Type-specific data (`zoneData`, `spriteData`, etc.)

This unified structure means you can:
- Query everything the same way
- Link any asset to any other asset
- Build complex hierarchies naturally
- Reuse assets across the universe

---

## Next Steps

1. **Check your zones:** Do they already have sprites linked?
2. **Create sprite sheet:** Design or find a PNG tileset
3. **Import sprites:** Use Sprite Creator
4. **Link to zone:** Assign sprites to your floormap
5. **Test landing:** Click anomaly on galactic map → Land Here

Need help with any specific step?
