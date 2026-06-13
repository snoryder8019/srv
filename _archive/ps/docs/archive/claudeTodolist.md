# Claude AI Context & Todo List
## Planetary Exploration System Overhaul - Phase 1

**Session Date:** October 27, 2025
**Version Target:** v0.4.1
**Status:** 🚧 In Progress

---

## Executive Summary

Complete overhaul of the planetary exploration system to enable:
- Sprite-based rendering with efficient atlas system
- Object placement (spaceships, buildings, defenses, resources)
- NPC/monster spawning system (Phase 2)
- Database optimization (delete 462MB of chunk data, use procedural generation)
- Linode Object Storage integration for scalable asset delivery

---

## User Decisions & Requirements

### 1. Linode Object Storage
✅ **APPROVED** - User has credentials configured in `.env`:
- `LINODE_ACCESS`
- `LINODE_SECRET`
- `S3_LOCATION`

**Action:** Integrate Linode Object Storage for sprite atlases and player-uploaded assets

---

### 2. Sprite System Architecture

#### Sprite Atlas Specification
**Grid Size:** 5x5 tiles
**Tile Size:** 16x16 pixels
**Total Atlas Size:** 80x80 pixels per atlas pack

#### Sprite Pack Rules (User-Defined)

**Row 1: Ground Textures**
- Tiles 0-4: Terrain types (grass, dirt, sand, rock, water)
- Used for procedural terrain tile rendering

**Row 2: Environment Objects**
- Tiles 5-9: Trees, boulders, bushes, rocks, plants
- Static decorative objects placed on terrain

**Row 3: Monster Animation (Single)**
- Tiles 10-14: 5-frame animation for one monster type
- Frames: Idle, Walk1, Walk2, Attack, Hit/Death

**Row 4: Aerial Textures**
- Tiles 15-19: Clouds, weather effects, scrolling parallax elements
- Overlay layer for atmospheric effects

**Row 5: (TBD - User Unsure)**
- Tiles 20-24: Open for future use
- Possible uses: Additional animations, UI elements, effects

#### Additional Sprite Pack Types (Future)
- **Monster Packs**: Multiple creature types with animations
- **NPC Packs**: Humanoid characters, merchants, quest givers
- **Dungeon Packs**: Interior tiles, doors, chests, traps
- **Building Packs**: Structures, walls, roofs, decorations

---

### 3. First Placeable Object: Spaceship Landing Site

**Priority Objects (in order):**
1. **Spaceship** - Player's landed spacecraft (spawn point)
2. **Habitory Items** - Living quarters, beds, storage
3. **Reactors** - Power generation buildings
4. **Habitats** - Expanded living structures
5. **Satellite Comms** - Communication arrays
6. **Defenses** - Turrets, shields, walls

**Initial Implementation:** Focus on spaceship as the first object players can place upon landing on a planet.

---

### 4. Database Strategy
✅ **APPROVED** - Delete planetChunks collection

**Current State:**
- 791 planetChunk documents
- ~462MB of storage
- Each chunk: ~600KB (4,096 tiles with full JSON)

**New Strategy:**
- **Procedural generation on-demand** - No chunk storage
- **Track player modifications only** - New `planetModifications` collection
- **Track placed objects** - New `planetObjects` collection

**Immediate Action:** Run cleanup script to delete all chunks

---

### 5. Development Phase Priority

**Phase 1 (Current):** ✅ START NOW
- Sprite system implementation
- Object placement system
- Spaceship landing mechanics
- Database optimization
- Linode Object Storage setup
- Asset builder UI

**Phase 2 (Next):** 🔜 AFTER PHASE 1
- NPC spawning system
- Enemy/monster spawns
- Quest system
- Resource collection & mining

---

## Technical Architecture

### New Database Collections

#### 1. `planetModifications`
```javascript
{
  _id: ObjectId,
  planetId: ObjectId,
  chunkX: Number,
  chunkY: Number,
  modifications: [{
    tileX: Number,       // Local tile position (0-63)
    tileY: Number,
    worldX: Number,      // Absolute position
    worldY: Number,
    type: 'resource_harvested' | 'terrain_modified' | 'tile_changed',
    newTerrain: String,  // If terrain changed
    timestamp: Date,
    playerId: ObjectId
  }],
  createdAt: Date,
  updatedAt: Date
}
```

#### 2. `planetObjects`
```javascript
{
  _id: ObjectId,
  planetId: ObjectId,
  objectType: 'spaceship' | 'building' | 'defense' | 'resource_node' | 'npc',
  assetId: ObjectId,   // Reference to asset definition

  position: {
    worldX: Number,
    worldY: Number,
    chunkX: Number,
    chunkY: Number,
    layer: Number      // Rendering layer (0=ground, 1=objects, 2=air)
  },

  ownerId: ObjectId,   // Player who placed it

  state: {
    health: Number,
    maxHealth: Number,
    active: Boolean,
    powered: Boolean,  // For buildings
    inventory: Array,  // For containers
    aiState: Object    // For NPCs (Phase 2)
  },

  spriteData: {
    atlasId: ObjectId,      // Which sprite atlas
    atlasKey: String,       // Atlas filename
    tileIndex: Number,      // Tile position in atlas
    frame: Number,          // Current animation frame
    animationSpeed: Number, // Frames per second
    rotation: Number        // 0, 90, 180, 270
  },

  metadata: {
    name: String,
    description: String,
    interactionType: String, // 'storage', 'power', 'defense', etc.
    requiredResources: Array // Cost to place
  },

  placedAt: Date,
  lastInteraction: Date,
  modifiedAt: Date
}
```

#### 3. `spriteAtlases`
```javascript
{
  _id: ObjectId,
  name: String,              // "Forest Environment Pack"
  packType: 'terrain' | 'monsters' | 'npcs' | 'buildings' | 'dungeon',

  atlasUrl: String,          // Linode Object Storage URL
  atlasKey: String,          // Storage key

  gridSize: {
    cols: 5,
    rows: 5,
    tileWidth: 16,
    tileHeight: 16
  },

  tileManifest: [{
    index: Number,           // 0-24 for 5x5
    row: Number,             // 0-4
    col: Number,             // 0-4
    name: String,            // "grass_01", "tree_oak", "slime_idle"
    category: String,        // "ground", "environment", "monster", "aerial"
    tags: [String],          // ["grass", "green", "terrain"]
    animated: Boolean,
    frameCount: Number       // If animated
  }],

  uploadedBy: ObjectId,
  approvalStatus: 'pending' | 'approved' | 'rejected',
  upvotes: Number,
  downvotes: Number,

  createdAt: Date,
  approvedAt: Date
}
```

---

## Linode Object Storage Structure

```
Bucket: stringborn-assets (or ps-assets)

/sprites/
  /packs/
    /terrain/
      forest-terrain-001.png (80x80)
      desert-terrain-001.png
      ocean-terrain-001.png
    /monsters/
      slime-pack-001.png
      wolf-pack-001.png
    /buildings/
      spaceship-pack-001.png
      reactor-pack-001.png

/player-uploads/
  /{userId}/
    /sprites/
      custom-pack-{timestamp}.png
    /objects/
      custom-object-{timestamp}.png

/thumbnails/
  /planets/
    {planetId}-thumb.png
  /assets/
    {assetId}-thumb.png
```

---

## Phase 1 Implementation Tasks

### Task 1: Linode Object Storage Setup
- [ ] Install `@aws-sdk/client-s3` package (S3-compatible)
- [ ] Create storage utility: `/srv/ps/utilities/linodeStorage.js`
- [ ] Functions: `uploadFile()`, `getFileUrl()`, `deleteFile()`, `listFiles()`
- [ ] Test connection with existing env vars

### Task 2: Database Cleanup & Migration
- [ ] Backup current database state
- [ ] Run `/srv/ps/scripts/cleanup-planet-chunks.js` (deletes all chunks)
- [ ] Create `planetModifications` collection with indexes
- [ ] Create `planetObjects` collection with indexes
- [ ] Create `spriteAtlases` collection with indexes
- [ ] Update planetGeneration model to skip chunk storage

### Task 3: Sprite Atlas System
- [ ] Create sprite atlas data model: `/srv/ps/api/v1/models/SpriteAtlas.js`
- [ ] Create sprite atlas routes: `/srv/ps/api/v1/routes/sprite-atlases.js`
- [ ] Implement atlas upload endpoint (multer → Linode Object Storage)
- [ ] Implement atlas manifest generator (tile indexing)
- [ ] Create default terrain atlases (forest, desert, ocean)

### Task 4: Sprite Renderer (Client-Side)
- [ ] Create sprite loader: `/srv/ps/public/javascripts/sprite-loader.js`
- [ ] Preload atlases on page load
- [ ] Cache atlases in memory (Image objects)
- [ ] Update chunk renderer to use sprites instead of colored squares
- [ ] Implement tile rendering from atlas (ctx.drawImage with source rect)

### Task 5: Object Placement System
- [ ] Create planetObjects model: `/srv/ps/api/v1/models/PlanetObject.js`
- [ ] Create object placement routes: `/srv/ps/api/v1/routes/planet-objects.js`
- [ ] POST `/api/v1/planets/:id/objects` - Place object
- [ ] GET `/api/v1/planets/:id/objects` - Get objects in area
- [ ] DELETE `/api/v1/planets/:id/objects/:objectId` - Remove object
- [ ] Implement collision detection (can't place on water, occupied tiles)

### Task 6: Spaceship Landing Object
- [ ] Design spaceship sprite (multi-tile object, 3x3 or 4x4)
- [ ] Create spaceship asset definition
- [ ] Implement automatic placement on first planet visit
- [ ] Add spaceship interaction (enter ship, access storage)

### Task 7: Asset Builder UI
- [ ] Create asset builder page: `/srv/ps/views/universe/asset-builder.ejs`
- [ ] Canvas-based sprite pack editor (5x5 grid)
- [ ] Import image and split into tiles
- [ ] Assign tile categories (ground, environment, monster, aerial)
- [ ] Upload to Linode Object Storage
- [ ] Submit for community approval

### Task 8: Update Procedural Generation
- [ ] Modify chunk generation to NOT save to database
- [ ] Return chunk data directly to client
- [ ] Apply modifications from `planetModifications` collection
- [ ] Overlay objects from `planetObjects` collection
- [ ] Cache generated chunks in server memory (TTL: 5 minutes)

### Task 9: Player Modification Tracking
- [ ] Create modification tracking API
- [ ] POST `/api/v1/planets/:id/modify` - Record terrain change
- [ ] POST `/api/v1/planets/:id/harvest` - Record resource harvested
- [ ] Update chunk generation to apply modifications

### Task 10: Testing & Optimization
- [ ] Test sprite rendering performance (1000+ tiles)
- [ ] Test object placement validation
- [ ] Test Linode Object Storage delivery speed
- [ ] Load testing with multiple atlases
- [ ] Memory leak testing (ensure atlases don't duplicate)

---

## API Endpoints (New)

### Sprite Atlases
```
GET    /api/v1/sprite-atlases              - List all approved atlases
GET    /api/v1/sprite-atlases/:id          - Get atlas details
POST   /api/v1/sprite-atlases              - Upload new atlas
PUT    /api/v1/sprite-atlases/:id          - Update atlas
DELETE /api/v1/sprite-atlases/:id          - Delete atlas
POST   /api/v1/sprite-atlases/:id/approve  - Approve atlas (admin)
```

### Planet Objects
```
GET    /api/v1/planets/:planetId/objects              - Get objects in view
GET    /api/v1/planets/:planetId/objects/:objectId   - Get object details
POST   /api/v1/planets/:planetId/objects              - Place object
PUT    /api/v1/planets/:planetId/objects/:objectId   - Update object state
DELETE /api/v1/planets/:planetId/objects/:objectId   - Remove object
POST   /api/v1/planets/:planetId/objects/:id/interact - Interact with object
```

### Planet Modifications
```
GET    /api/v1/planets/:planetId/modifications        - Get modifications
POST   /api/v1/planets/:planetId/modify               - Modify terrain
POST   /api/v1/planets/:planetId/harvest              - Harvest resource
```

### Updated Generation
```
GET    /api/v1/planet-generation/:id/chunk/:x/:y     - Generate chunk (no save)
POST   /api/v1/planet-generation/:id/initialize       - Initialize planet (no chunk creation)
```

---

## File Structure (New Files)

```
/srv/ps/
├── api/v1/
│   ├── models/
│   │   ├── SpriteAtlas.js          (NEW)
│   │   ├── PlanetObject.js         (NEW)
│   │   ├── PlanetModification.js   (NEW)
│   │   └── PlanetGeneration.js     (MODIFIED - remove chunk saving)
│   └── routes/
│       ├── sprite-atlases.js       (NEW)
│       ├── planet-objects.js       (NEW)
│       └── planet-modifications.js (NEW)
│
├── utilities/
│   ├── linodeStorage.js            (NEW - Linode Object Storage client)
│   └── spriteAtlasHelper.js        (NEW - Atlas processing utilities)
│
├── public/
│   ├── javascripts/
│   │   ├── sprite-loader.js        (NEW - Client-side atlas loader)
│   │   ├── object-placement.js     (NEW - Object placement UI)
│   │   └── planetary-chunk-manager.js (MODIFIED - sprite rendering)
│   └── sprites/
│       └── (Atlas files hosted on Linode, not locally)
│
├── views/
│   └── universe/
│       └── asset-builder.ejs       (NEW - Sprite pack editor)
│
├── scripts/
│   ├── seed-default-atlases.js     (NEW - Seed starter sprite packs)
│   └── migrate-to-procedural.js    (NEW - Migration script)
│
└── docs/
    ├── claudeTodolist.md           (THIS FILE)
    ├── SPRITE_ATLAS_SPEC.md        (NEW - Detailed sprite specifications)
    └── PATCH_NOTES_v0.4.md         (UPDATED)
```

---

## Success Criteria

### Phase 1 Complete When:
- [x] Patch notes updated
- [x] Context document created
- [ ] Linode Object Storage integrated and tested
- [ ] planetChunks collection deleted
- [ ] Procedural generation works without saving chunks
- [ ] Sprite atlas system functional (upload, approve, load)
- [ ] At least 3 default atlases created (forest, desert, ocean terrain)
- [ ] Client renders terrain using sprite atlases
- [ ] Spaceship object can be placed on planets
- [ ] Objects render correctly with sprites
- [ ] Asset builder UI functional for creating sprite packs
- [ ] Performance: 60 FPS with 2000+ visible tiles
- [ ] Zero database growth during normal exploration

### Ready for Phase 2 When:
- All Phase 1 criteria met
- System stable for 24 hours with test users
- No memory leaks detected
- Linode Object Storage costs are acceptable

---

## Current Session Progress

### Completed
- [x] ✅ Analyzed existing planetary system
- [x] ✅ Identified database calamity (462MB chunks)
- [x] ✅ Made architectural decisions with user
- [x] ✅ Updated patch notes
- [x] ✅ Created this context document

### Next Steps (In Order)
1. Create detailed sprite atlas specification document
2. Set up Linode Object Storage integration
3. Delete planetChunks collection
4. Create new database models (SpriteAtlas, PlanetObject, PlanetModification)
5. Implement sprite loader on client
6. Update chunk renderer to use sprites
7. Build object placement system
8. Create asset builder UI

---

## Notes & Considerations

### Performance Targets
- **Render Speed:** 60 FPS with 2000+ tiles visible
- **Atlas Load Time:** <500ms per atlas
- **Object Placement Latency:** <100ms round trip
- **Chunk Generation:** <50ms per chunk (procedural only)

### Asset Delivery Strategy
- **CDN:** Linode Object Storage with edge caching
- **Client Caching:** Cache atlases in memory, localStorage for manifests
- **Lazy Loading:** Load atlases on-demand as player explores new biomes
- **Preloading:** Preload common atlases on map load

### Sprite Atlas Guidelines (For Asset Creators)
- **Format:** PNG with transparency
- **Color Depth:** 32-bit RGBA
- **Tile Alignment:** Exact 16x16 pixel tiles
- **No Padding:** Tiles must be directly adjacent
- **Naming Convention:** `{biome}-{type}-{version}.png`
- **File Size:** Keep under 20KB per atlas (optimize with compression)

### Future Enhancements (Post-Phase 2)
- **Animated Sprites:** Multi-frame animation system
- **Dynamic Lighting:** Day/night cycle affecting sprites
- **Weather Effects:** Rain, snow, fog overlays
- **Destructible Terrain:** Explosions, mining changing tiles
- **Custom Sprite Packs:** Players create and share atlases
- **Seasonal Variants:** Different sprites for same tile in different seasons

---

## References

### Related Documentation
- [ADMIN_TESTER_ENHANCEMENTS.md](/srv/ps/docs/ADMIN_TESTER_ENHANCEMENTS.md) - Admin tools
- [PATCH_NOTES_v0.4.md](/srv/ps/docs/PATCH_NOTES_v0.4.md) - Current version

### Key Files to Reference
- [PlanetGeneration.js](/srv/ps/api/v1/models/PlanetGeneration.js:1-559) - Current generation logic
- [planetary-chunk-manager.js](/srv/ps/public/javascripts/planetary-chunk-manager.js:1-884) - Client renderer
- [cleanup-planet-chunks.js](/srv/ps/scripts/cleanup-planet-chunks.js:1-69) - Cleanup script
- [spaceImageHelper.js](/srv/ps/utilities/spaceImageHelper.js:1-187) - Image handling utilities

---

## Contact & Session Info

**AI Assistant:** Claude (Sonnet 4.5)
**Session Start:** October 27, 2025
**Working Directory:** `/srv/ps`
**Environment:** Linode production server

**User Preferences:**
- Commit often, push to git
- Documentation-driven development
- Phase-based implementation
- Community-focused features
- Performance-critical optimizations

---

**Last Updated:** October 27, 2025
**Status:** 📝 Ready to begin Phase 1 implementation
