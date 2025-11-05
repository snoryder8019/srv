# Hierarchical Builder System - Revised Architecture

## Overview
Create an interconnected asset building system where all assets link hierarchically from universe down to individual sprites.

## Asset Hierarchy

```
Universe (Root)
  └── Anomaly (Gravitational center)
       └── Galaxy (Orbiting anomaly)
            └── Star System (Within galaxy)
                 └── Planet (Orbiting star)
                      └── Zone (Surface location - Roguelite dungeon)
                           └── Room (Zone interior)
                                └── Tile (Grid position)
                                     └── Sprite (Visual element + collision)
                                          └── Component (Interactive elements)
```

## Builder Integration Points

### 1. **Asset Builder Enhanced** (`/assets/builder-enhanced`)
- **Current:** Creates galaxies, stars, planets, stations, anomalies
- **Revision:** Add parent asset linking
  - When creating galaxy → select parent anomaly
  - When creating star → select parent galaxy
  - When creating planet → select parent star
  - Add "Build Interior" button → launches Interior Map Builder for that asset

### 2. **Interior Map Builder** (`/universe/interior-map-builder`)
- **Current:** 2D tile-based map editor
- **Revision:** Zone builder with roguelite features
  - Accept parent asset (planet, station, etc.)
  - Create Zone asset linked to parent
  - Build rooms/corridors with tile-based editor
  - Add spawn points, loot tables, enemy patterns
  - Export as Zone asset with interior map data

### 3. **Sprite Creator** (NEW - `/assets/sprite-creator`)
- **Modes:**
  1. **JSON Import:** Bulk create sprites from sprite sheet definition
  2. **Manual Creation:** Create individual sprite with properties
  3. **Zone Assignment:** Add sprite to existing zone/room

- **Properties:**
  - Visual: sprite sheet, frame, animation
  - Physics: collision box, solid/passthrough
  - Interactive: door, chest, NPC, item
  - Parent: zone/room assignment

### 4. **Universal Builder Hub** (NEW - `/universe/builder-hub`)
- **Central navigation for all builders**
- Browse existing hierarchy
- Quick-create child assets
- Visual tree view of asset relationships

## Database Schema Updates

### Assets Collection Enhancement

```javascript
{
  // Existing fields...
  assetType: 'galaxy' | 'star' | 'planet' | 'zone' | 'sprite' | ...,

  // NEW: Hierarchical linking
  hierarchy: {
    parent: ObjectId,        // Parent asset ID
    parentType: String,      // Parent asset type
    children: [ObjectId],    // Array of child asset IDs
    depth: Number,           // Hierarchy depth (0=universe, 1=anomaly, etc.)
    path: [ObjectId]         // Full path from root
  },

  // Zone-specific (for roguelite dungeons)
  zoneData: {
    type: 'dungeon' | 'city' | 'wilderness',
    difficulty: Number,
    width: Number,
    height: Number,
    tileSize: Number,
    layers: {
      ground: [[tileId]],
      walls: [[tileId]],
      objects: [[tileId]],
      sprites: [{ x, y, spriteId, properties }]
    },
    spawnPoints: [{ x, y, type: 'player' | 'enemy' | 'loot' }],
    lootTables: [{ rarity, items[] }],
    enemyPatterns: [{ type, count, patrol }]
  },

  // Sprite-specific
  spriteData: {
    spriteSheet: String,     // Sprite sheet asset ID
    frame: Number,           // Frame index
    width: Number,
    height: Number,
    collision: { x, y, w, h },
    solid: Boolean,
    interactive: Boolean,
    properties: {}           // Custom properties
  }
}
```

## Implementation Phases

### Phase 1: Database Schema
- [x] Add hierarchy fields to Asset model
- [ ] Create migration script to link existing assets
- [ ] Add zone-specific fields
- [ ] Add sprite-specific fields

### Phase 2: Builder Integration
- [ ] Update Asset Builder Enhanced to show parent selection
- [ ] Add "Build Interior" button to planet/station/zone builders
- [ ] Add hierarchy breadcrumbs to all builders

### Phase 3: Interior Map Builder Enhancement
- [ ] Accept parent asset parameter
- [ ] Create Zone asset on save
- [ ] Link to parent asset
- [ ] Add roguelite features (spawn points, loot tables)

### Phase 4: Sprite Creator
- [ ] Create sprite-creator.ejs
- [ ] JSON import functionality
- [ ] Manual sprite creation form
- [ ] Zone assignment dropdown
- [ ] Preview system

### Phase 5: Universal Builder Hub
- [ ] Create builder-hub.ejs
- [ ] Visual hierarchy tree
- [ ] Quick-create buttons
- [ ] Navigation between builders

## User Workflow Examples

### Example 1: Building a Dungeon Planet
1. **Asset Builder:** Create planet "Dark Caverns"
2. Click "Build Interior" → Interior Map Builder opens
3. **Interior Map Builder:** Design 50x50 tile dungeon
4. Add spawn points, loot chests, enemy zones
5. Click "Add Sprites" → Sprite Creator opens
6. **Sprite Creator:** Import sprite sheet JSON for torches, doors, chests
7. Place sprites on dungeon map
8. Save → Creates Zone asset linked to planet

### Example 2: Creating a Space Station
1. **Asset Builder:** Create station "Trade Hub Alpha"
2. Click "Build Interior" → Interior Map Builder opens
3. **Interior Map Builder:** Design station interior (docking bays, shops, corridors)
4. Add NPC spawn points, shop zones
5. **Sprite Creator:** Add NPC sprites, shop counters, terminals
6. Save → Station with interactive interior

### Example 3: Bulk Sprite Import
1. **Sprite Creator:** Select "JSON Import" mode
2. Upload sprite sheet + JSON definition
3. System creates 100+ sprite assets
4. Assign sprites to zone "Underground Ruins"
5. Sprites now available in Interior Map Builder

## API Endpoints Needed

```
POST /api/v1/assets/hierarchy/link      - Link child to parent
GET  /api/v1/assets/hierarchy/:id       - Get hierarchy tree
POST /api/v1/assets/zones/create        - Create zone with interior map
PUT  /api/v1/assets/zones/:id/map       - Update zone map data
POST /api/v1/assets/sprites/import      - Bulk import sprites from JSON
POST /api/v1/assets/sprites/create      - Create individual sprite
GET  /api/v1/assets/sprites/by-zone/:id - Get all sprites in zone
```

## Benefits

1. **Hierarchical Organization:** Clear parent-child relationships
2. **Roguelite Zones:** Procedural dungeons with loot/enemy systems
3. **Sprite Reusability:** Import once, use everywhere
4. **Builder Integration:** Seamless flow between builders
5. **Data Consistency:** All assets properly linked

## Next Steps

1. Update Asset model with hierarchy fields
2. Create migration script for existing assets
3. Enhance Asset Builder with parent selection
4. Build Sprite Creator tool
5. Add roguelite features to Interior Map Builder
6. Create Universal Builder Hub
