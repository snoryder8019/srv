# Sprite Atlas Specification
## Planetary Exploration System - v0.4.1

**Version:** 1.0
**Status:** Active Specification
**Last Updated:** October 27, 2025

---

## Overview

This document defines the sprite atlas system for the Stringborn Universe planetary exploration feature. All sprite atlases must conform to these specifications to ensure proper rendering and compatibility.

---

## Atlas Format Specification

### Grid Structure
- **Grid Size:** 5 columns × 5 rows = 25 tiles per atlas
- **Tile Size:** 16×16 pixels per tile
- **Total Atlas Size:** 80×80 pixels
- **Format:** PNG with alpha transparency (RGBA)
- **Color Depth:** 32-bit
- **Compression:** Standard PNG compression
- **Max File Size:** 20KB (recommended), 50KB (maximum)

### Coordinate System
```
Tile Index = (row × 5) + col

Example 5×5 Grid:
┌────┬────┬────┬────┬────┐
│ 0  │ 1  │ 2  │ 3  │ 4  │  Row 0 (Ground Textures)
├────┼────┼────┼────┼────┤
│ 5  │ 6  │ 7  │ 8  │ 9  │  Row 1 (Environment Objects)
├────┼────┼────┼────┼────┤
│ 10 │ 11 │ 12 │ 13 │ 14 │  Row 2 (Monster Animation)
├────┼────┼────┼────┼────┤
│ 15 │ 16 │ 17 │ 18 │ 19 │  Row 3 (Aerial Textures)
├────┼────┼────┼────┼────┤
│ 20 │ 21 │ 22 │ 23 │ 24 │  Row 4 (Reserved/Custom)
└────┴────┴────┴────┴────┘
```

### Pixel Coordinates for Rendering
```javascript
// To extract tile at index N:
const col = N % 5;
const row = Math.floor(N / 5);
const sourceX = col * 16;
const sourceY = row * 16;

// ctx.drawImage(atlas, sourceX, sourceY, 16, 16, destX, destY, 16, 16);
```

---

## Row-Based Layout Rules

### Row 0: Ground Textures (Tiles 0-4)
**Purpose:** Base terrain tiles for procedural map generation

**Standard Layout:**
- **Tile 0:** Primary ground (grass, sand, dirt)
- **Tile 1:** Secondary ground (light variation)
- **Tile 2:** Tertiary ground (dark variation)
- **Tile 3:** Transition tile (edge blending)
- **Tile 4:** Special ground (water, lava, ice)

**Example Biome Packs:**
- **Forest:** Grass, Light Grass, Dark Grass, Grass-Dirt Edge, Water
- **Desert:** Sand, Light Sand, Dark Sand, Sand-Rock Edge, Oasis Water
- **Ocean:** Deep Water, Shallow Water, Beach Sand, Foam, Dark Water
- **Volcanic:** Ash, Dark Ash, Lava Rock, Lava Edge, Lava
- **Ice:** Snow, Light Snow, Ice, Glacier Edge, Frozen Water

**Usage:** Selected by biome type during procedural generation

---

### Row 1: Environment Objects (Tiles 5-9)
**Purpose:** Static decorative objects placed on terrain

**Standard Layout:**
- **Tile 5:** Small vegetation (bush, small rock)
- **Tile 6:** Medium vegetation (shrub, medium rock)
- **Tile 7:** Large object (tree, boulder)
- **Tile 8:** Special object 1 (flowers, crystals)
- **Tile 9:** Special object 2 (dead tree, ruin fragment)

**Example Packs:**
- **Forest:** Small Bush, Medium Bush, Oak Tree, Wildflowers, Dead Stump
- **Desert:** Small Cactus, Medium Cactus, Large Rock, Skull, Ancient Pillar
- **Ocean:** Coral, Kelp, Rock Formation, Seashell Cluster, Shipwreck Piece
- **Volcanic:** Small Vent, Steam Vent, Obsidian Boulder, Crystal, Lava Rock
- **Ice:** Ice Chunk, Ice Spike, Frozen Tree, Snow Drift, Ice Crystal

**Rendering:**
- Placed randomly during chunk generation based on density settings
- Can overlap ground tiles (rendered on layer 1, above terrain layer 0)
- Collision detection: Large objects (tile 7) block movement

---

### Row 2: Monster/Creature Animation (Tiles 10-14)
**Purpose:** Single creature with 5-frame animation cycle

**Standard Animation Sequence:**
- **Tile 10:** Idle/Standing (Frame 0)
- **Tile 11:** Walk Cycle 1 (Frame 1)
- **Tile 12:** Walk Cycle 2 (Frame 2)
- **Tile 13:** Attack/Action (Frame 3)
- **Tile 14:** Hit/Death (Frame 4)

**Animation Playback:**
```javascript
// Walk animation: loop frames 11-12
// Attack sequence: 10 → 13 → 10
// Death sequence: 13 → 14 (hold)
```

**Example Creatures:**
- **Forest:** Wolf (idle, walk1, walk2, bite, injured)
- **Desert:** Scorpion (idle, crawl1, crawl2, sting, dead)
- **Ocean:** Crab (idle, walk1, walk2, pinch, shell-hide)
- **Volcanic:** Fire Elemental (idle, float1, float2, fireball, dissipate)
- **Ice:** Ice Golem (idle, stomp1, stomp2, smash, shatter)

**Sprite Direction:**
- All sprites face RIGHT by default
- Flip horizontally in code for LEFT facing
- No vertical flip needed (top-down view)

---

### Row 3: Aerial/Overlay Textures (Tiles 15-19)
**Purpose:** Atmospheric effects and parallax scrolling elements

**Standard Layout:**
- **Tile 15:** Cloud 1 (small, light)
- **Tile 16:** Cloud 2 (medium, fluffy)
- **Tile 17:** Cloud 3 (large, dark)
- **Tile 18:** Weather effect 1 (rain, snow, ash)
- **Tile 19:** Weather effect 2 (fog, mist, storm)

**Example Packs:**
- **Forest:** White Cloud, Gray Cloud, Storm Cloud, Light Rain, Fog
- **Desert:** Dust Cloud, Sand Swirl, Dark Cloud, Heat Wave, Sandstorm
- **Ocean:** Sea Mist, White Cloud, Storm Cloud, Rain, Heavy Fog
- **Volcanic:** Ash Cloud, Smoke Plume, Dark Ash, Ember Shower, Lava Smoke
- **Ice:** Snow Cloud, Ice Crystal Drift, Blizzard Cloud, Light Snow, Heavy Snow

**Rendering:**
- Layer 2 (above objects)
- Parallax scrolling (slower than camera movement)
- Semi-transparent (alpha 0.3-0.7)
- Optional animation: drift slowly across screen

---

### Row 4: Reserved/Custom (Tiles 20-24)
**Purpose:** Future expansion, custom pack-specific content

**Suggested Uses:**
- Additional animation frames (extend monster animations)
- UI elements (selection cursor, placement indicator)
- Special effects (explosions, sparkles, damage numbers)
- Resource nodes (ore deposits, plants to harvest)
- Building components (walls, doors, windows)

**Currently:** No enforced standard, flexible for pack creator

---

## Pack Types & Categories

### 1. Terrain Packs
**Focus:** Rows 0-1 (ground + environment)
**Biomes:** Forest, Desert, Ocean, Volcanic, Ice, Grassland, Tundra, Swamp, etc.
**File Naming:** `{biome}-terrain-{version}.png`
**Example:** `forest-terrain-001.png`

### 2. Monster Packs
**Focus:** Row 2 (multiple creatures, 5 atlases = 5 monsters)
**Themes:** Forest Beasts, Desert Creatures, Undead, Elementals, etc.
**File Naming:** `{theme}-monsters-{version}.png`
**Example:** `forest-monsters-001.png`

### 3. NPC Packs (Phase 2)
**Focus:** Row 2 (humanoid characters)
**Types:** Merchants, Guards, Civilians, Quest Givers
**File Naming:** `{type}-npcs-{version}.png`
**Example:** `merchant-npcs-001.png`

### 4. Dungeon Packs (Phase 2)
**Focus:** Rows 0-1 (interior tiles + furniture)
**Themes:** Cave, Temple, Spaceship Interior, Lab, Prison
**File Naming:** `{theme}-dungeon-{version}.png`
**Example:** `cave-dungeon-001.png`

### 5. Building Packs (Phase 1)
**Focus:** Rows 1-4 (structures, components)
**Types:** Spaceship, Reactor, Habitat, Defense, Comms
**File Naming:** `{building}-pack-{version}.png`
**Example:** `spaceship-pack-001.png`

---

## Technical Implementation

### Atlas Loading (Client-Side)

```javascript
class SpriteAtlasLoader {
  constructor() {
    this.atlases = new Map(); // atlasKey → Image
    this.manifests = new Map(); // atlasKey → manifest data
  }

  async loadAtlas(atlasKey, atlasUrl, manifest) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.atlases.set(atlasKey, img);
        this.manifests.set(atlasKey, manifest);
        resolve(img);
      };
      img.onerror = reject;
      img.src = atlasUrl;
    });
  }

  drawTile(ctx, atlasKey, tileIndex, destX, destY, scale = 1) {
    const atlas = this.atlases.get(atlasKey);
    if (!atlas) return false;

    const col = tileIndex % 5;
    const row = Math.floor(tileIndex / 5);
    const sourceX = col * 16;
    const sourceY = row * 16;
    const size = 16 * scale;

    ctx.drawImage(
      atlas,
      sourceX, sourceY, 16, 16,
      destX, destY, size, size
    );
    return true;
  }
}
```

### Tile Manifest Structure

```javascript
{
  atlasId: "674f1a2b3c4d5e6f7890abcd",
  atlasKey: "forest-terrain-001",
  atlasUrl: "https://{bucket}.{region}.linodeobjects.com/sprites/packs/terrain/forest-terrain-001.png",

  gridSize: {
    cols: 5,
    rows: 5,
    tileWidth: 16,
    tileHeight: 16
  },

  tiles: [
    { index: 0, name: "grass", category: "ground", tags: ["grass", "green"] },
    { index: 1, name: "grass_light", category: "ground", tags: ["grass", "light"] },
    { index: 2, name: "grass_dark", category: "ground", tags: ["grass", "dark"] },
    { index: 3, name: "grass_dirt_edge", category: "ground", tags: ["transition"] },
    { index: 4, name: "water", category: "ground", tags: ["water", "blue"] },

    { index: 5, name: "bush_small", category: "environment", tags: ["bush"] },
    { index: 6, name: "bush_medium", category: "environment", tags: ["bush"] },
    { index: 7, name: "oak_tree", category: "environment", tags: ["tree"], collision: true },
    { index: 8, name: "wildflowers", category: "environment", tags: ["decoration"] },
    { index: 9, name: "dead_stump", category: "environment", tags: ["wood"] },

    { index: 10, name: "wolf_idle", category: "monster", tags: ["wolf"], animated: true, frameIndex: 0 },
    { index: 11, name: "wolf_walk1", category: "monster", tags: ["wolf"], animated: true, frameIndex: 1 },
    { index: 12, name: "wolf_walk2", category: "monster", tags: ["wolf"], animated: true, frameIndex: 2 },
    { index: 13, name: "wolf_attack", category: "monster", tags: ["wolf"], animated: true, frameIndex: 3 },
    { index: 14, name: "wolf_hit", category: "monster", tags: ["wolf"], animated: true, frameIndex: 4 },

    { index: 15, name: "cloud_white", category: "aerial", tags: ["cloud"] },
    { index: 16, name: "cloud_gray", category: "aerial", tags: ["cloud"] },
    { index: 17, name: "cloud_storm", category: "aerial", tags: ["cloud", "dark"] },
    { index: 18, name: "rain_light", category: "aerial", tags: ["weather"] },
    { index: 19, name: "fog", category: "aerial", tags: ["weather"] },

    { index: 20, name: "ore_iron", category: "resource", tags: ["ore"] },
    { index: 21, name: "ore_copper", category: "resource", tags: ["ore"] },
    { index: 22, name: "ore_gold", category: "resource", tags: ["ore"] },
    { index: 23, name: "plant_herb", category: "resource", tags: ["plant"] },
    { index: 24, name: "plant_fiber", category: "resource", tags: ["plant"] }
  ]
}
```

---

## Asset Builder UI Workflow

### Step 1: Upload Image
- User uploads 80×80 PNG image
- System validates dimensions (must be exactly 80×80)
- Preview shown with 5×5 grid overlay

### Step 2: Tile Categorization
- User clicks each tile to assign category:
  - Ground Texture
  - Environment Object
  - Monster/NPC Frame
  - Aerial Effect
  - Custom/Reserved
- System suggests categories based on row position

### Step 3: Naming & Tagging
- User names the atlas pack (e.g., "Forest Terrain Pack")
- User assigns names to individual tiles (e.g., "oak_tree")
- User adds tags for searchability

### Step 4: Animation Setup (Optional)
- User links tiles into animation sequences
- Define frame order and playback speed
- Preview animation in builder

### Step 5: Upload & Submit
- System uploads to Linode Object Storage
- Generates manifest JSON
- Submits to community for approval (voting system)

---

## Rendering Layers

```
Layer 0: Ground Terrain (Row 0 tiles)
Layer 1: Environment Objects (Row 1 tiles)
Layer 2: Player Character & NPCs
Layer 3: Monsters/Creatures (Row 2 tiles)
Layer 4: Placed Objects (buildings, spaceships)
Layer 5: Aerial Effects (Row 3 tiles)
Layer 6: UI Overlays (selection, cursors)
```

**Z-Index Order:** Layer 0 (bottom) → Layer 6 (top)

---

## Performance Guidelines

### Client-Side
- **Atlas Preloading:** Load atlases on map initialization, before first render
- **Caching:** Keep loaded atlases in memory, don't reload
- **Draw Call Optimization:** Batch draws from same atlas together
- **Culling:** Only draw tiles visible in viewport

### Server-Side
- **CDN Delivery:** Serve atlases from Linode Object Storage with caching
- **Manifest Caching:** Cache manifests in Redis for 1 hour
- **Lazy Loading:** Only send manifest data for atlases in use

### Target Metrics
- **Atlas Load Time:** <300ms per atlas (with CDN)
- **Render Performance:** 60 FPS with 2000+ visible tiles
- **Memory Usage:** <50MB for 10 loaded atlases
- **Network Transfer:** <200KB total for initial atlas load

---

## Default Atlas Packs (Seed Data)

### Phase 1 Starter Packs

1. **Forest Terrain Pack** (`forest-terrain-001.png`)
   - Ground: Grass variations, water
   - Environment: Bushes, oak tree, flowers, stump
   - Monster: Wolf (5-frame animation)
   - Aerial: Clouds, rain, fog
   - Resources: Iron ore, herbs

2. **Desert Terrain Pack** (`desert-terrain-001.png`)
   - Ground: Sand variations, oasis water
   - Environment: Cacti, rocks, skull, pillar
   - Monster: Scorpion (5-frame animation)
   - Aerial: Dust clouds, sandstorm
   - Resources: Copper ore, desert plants

3. **Ocean Terrain Pack** (`ocean-terrain-001.png`)
   - Ground: Water depths, beach sand
   - Environment: Coral, kelp, rocks, shells
   - Monster: Crab (5-frame animation)
   - Aerial: Sea mist, storm clouds
   - Resources: Pearls, seaweed

4. **Spaceship Building Pack** (`spaceship-pack-001.png`)
   - Row 0: Hull tiles (metal floor variations)
   - Row 1: Exterior components (thrusters, wings, cockpit)
   - Row 2: Interior objects (console, seat, door)
   - Row 3: UI elements (selection, placement indicator)
   - Row 4: Damage states (broken, sparking)

---

## File Naming Conventions

### Atlas Files
```
{biome|theme}-{type}-{version}.png

Examples:
- forest-terrain-001.png
- desert-monsters-002.png
- merchant-npcs-001.png
- cave-dungeon-001.png
- spaceship-pack-001.png
```

### Manifest Files (Server-Side)
```
{atlasKey}.json

Examples:
- forest-terrain-001.json
- desert-monsters-002.json
```

### Linode Object Storage Keys
```
sprites/packs/{category}/{filename}

Examples:
- sprites/packs/terrain/forest-terrain-001.png
- sprites/packs/monsters/desert-monsters-002.png
- sprites/packs/buildings/spaceship-pack-001.png
```

---

## Validation Rules

### Upload Validation
- [x] Dimensions must be exactly 80×80 pixels
- [x] Format must be PNG
- [x] File size must be ≤50KB
- [x] Must have alpha channel (RGBA)
- [x] No embedded metadata (strip EXIF)

### Manifest Validation
- [x] Must define all 25 tiles (0-24)
- [x] Tile names must be unique within atlas
- [x] Category must be valid enum
- [x] Tags must be lowercase alphanumeric
- [x] Animation sequences must reference valid tile indices

### Community Approval Requirements
- [x] Net upvotes > 5 (upvotes - downvotes)
- [x] Approval ratio > 75% (upvotes / total votes)
- [x] Minimum 10 votes cast
- [x] No copyright violations reported
- [x] Admin final approval

---

## Future Enhancements

### Phase 2+
- **Multi-Frame Animations:** Allow >5 frames per creature (multiple rows)
- **Dynamic Atlases:** Combine multiple packs client-side into mega-atlas
- **Seasonal Variants:** Same atlas with different color palettes
- **Procedural Generation:** AI-assisted sprite generation from prompts
- **Atlas Marketplace:** Economy for buying/selling custom packs
- **Modding Support:** Allow local atlas overrides for testing

---

## Appendix: Example Atlas PNG Structure

```
Visual representation of forest-terrain-001.png (80×80):

┌───────────────────────────────────────────────────────────────────────────┐
│ 🟩🟩  🟩🟩  🟩🟩  🟩🌿  🟦🟦 │  Row 0: Ground Textures
│ grass grass grass grass water │  (16×16 each)
│       light dark  edge        │
├───────────────────────────────────────────────────────────────────────────┤
│ 🌿🌿  🌳🌳  🌲🌲  🌸🌸  🪵🪵 │  Row 1: Environment Objects
│ bush  bush  tree  flower stump│
│ small med   oak   wild   dead │
├───────────────────────────────────────────────────────────────────────────┤
│ 🐺➡️  🐺🦵  🐺🦵  🐺😠  🐺💥 │  Row 2: Wolf Animation
│ wolf  wolf  wolf  wolf  wolf  │
│ idle  walk1 walk2 attack hit  │
├───────────────────────────────────────────────────────────────────────────┤
│ ☁️☁️  ☁️☁️  🌧️🌧️  🌧️🌧️  🌫️🌫️ │  Row 3: Aerial Textures
│ cloud cloud cloud rain  fog   │
│ white gray  storm light       │
├───────────────────────────────────────────────────────────────────────────┤
│ ⛏️⛏️  ⛏️⛏️  ⛏️⛏️  🌿🌿  🌿🌿 │  Row 4: Resources
│ ore   ore   ore   plant plant │
│ iron  copper gold  herb  fiber│
└───────────────────────────────────────────────────────────────────────────┘
```

---

**End of Specification**

**Version History:**
- v1.0 (2025-10-27): Initial specification
