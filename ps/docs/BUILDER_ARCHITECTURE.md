# Builder Architecture Overview
## Two Separate Content Creation Systems

**Date:** October 27, 2025
**Status:** Active Architecture

---

## System Separation

### 1. World Sprite Builder (2D Pixel Art)
**Route:** `/universe/sprite-creator`
**Purpose:** Create 2D sprite atlases for planetary exploration

**Use Cases:**
- ✅ Planetary terrain tiles (grass, sand, water)
- ✅ Environment objects (trees, rocks, bushes)
- ✅ Monster/NPC animations (5-frame cycles)
- ✅ Aerial effects (clouds, weather)
- ✅ Resource nodes (ores, plants)

**Technology:**
- Format: PNG (80×80 pixels, 32-bit RGBA)
- Grid: 5×5 tiles (16×16 pixels each)
- Editor: Browser-based pixel editor with 32-color palette
- Storage: Linode Object Storage (CDN)
- Rendering: 2D canvas, top-down view

**Features:**
- Integrated pixel art editor
- 32-color professional palette
- Copy/paste tiles
- Eraser with alpha transparency
- Pack type rules (Terrain, Monsters, NPCs, Buildings, Dungeons)
- Community voting/approval

---

### 2. Asset Builder (3D Objects)
**Route:** `/assets/builder-enhanced`
**Purpose:** Create 3D game items and equipment

**Use Cases:**
- ✅ **Ships** - Spaceships and vehicles (GLTF models)
- ✅ **Weapons** - Guns, lasers, melee weapons (GLTF models)
- ✅ **Ammo** - Ammunition types (GLTF models)
- ✅ **Mods** - Ship modules and upgrades (GLTF models)
- ✅ **Armor** - Protective equipment (GLTF models)
- ✅ **Items** - General inventory items (GLTF models)
- ✅ **Planets** - 3D planet textures (PNG/JPG textures)
- ✅ **Characters/NPCs** - 3D character models (GLTF)
- ✅ **Structures** - 3D buildings (GLTF models)

**Technology:**
- **Primary Format:** GLTF/GLB (3D models)
- **Texture Format:** PNG/JPG (for planet surfaces, materials)
- **Editor:** External 3D modeling tools (Blender, etc.)
- **Storage:** MongoDB (metadata) + Linode Object Storage (files)
- **Rendering:** Three.js/WebGL, 3D viewport

**Features:**
- Stats and attributes system
- Rarity tiers
- Lore and backstory
- Location/hierarchy (galaxy → star → planet)
- Type-specific fields (weapon stats, armor ratings, etc.)
- Community voting/approval
- JSON-based configuration

---

## File Format Breakdown

### World Sprite Builder Outputs

**Sprite Atlas:**
```javascript
{
  atlasImage: PNG file (80×80 pixels, RGBA),
  manifest: {
    name: "forest-terrain-001",
    packType: "terrain", // terrain, monsters, npcs, buildings, dungeon
    planetType: "forest",
    tiles: [
      { index: 0, name: "grass", category: "ground_texture", ... },
      { index: 1, name: "grass_light", category: "ground_texture", ... },
      // ... 25 tiles total
    ]
  }
}
```

**Storage:**
- Atlas PNG: `sprites/packs/terrain/forest-terrain-001.png` (Linode CDN)
- Metadata: `spriteAtlases` collection (MongoDB)

---

### Asset Builder Outputs

**3D Asset (Ships, Ammo, Mods):**
```javascript
{
  title: "Plasma Rifle MK-II",
  assetType: "weapon",
  modelFile: GLTF/GLB file,
  textureFiles: [PNG/JPG materials],
  stats: {
    damage: 45,
    range: 500,
    fireRate: 2.5,
    // ...
  },
  rarity: "epic",
  lore: "Advanced energy weapon...",
  // ...
}
```

**Planet Texture:**
```javascript
{
  title: "Desert Planet Kepler-442b",
  assetType: "planet",
  surfaceTexture: PNG/JPG file (equirectangular projection),
  normalMap: PNG file (optional),
  roughnessMap: PNG file (optional),
  stats: {
    radius: 6371,
    atmosphere: "thin",
    climate: "arid",
    // ...
  }
}
```

**Storage:**
- GLTF models: `assets/models/{assetId}.glb` (Linode CDN)
- Textures: `assets/textures/{assetId}/{filename}.png` (Linode CDN)
- Metadata: `assets` collection (MongoDB)

---

## When to Use Which Builder

### Use World Sprite Builder For:
- 🎨 Creating pixel art for planets
- 🌍 Designing terrain tilesets
- 👾 Making monster/NPC sprite sheets
- 🌳 Environment decoration sprites
- ☁️ Weather and atmospheric effects

**Example:** You're creating a new forest biome and need grass tiles, tree sprites, and a wolf animation.

---

### Use Asset Builder For:
- 🚀 Creating 3D spaceship models
- 🔫 Designing weapons and equipment
- 🛡️ Making armor and protective gear
- 🧩 Building ship modules and upgrades
- 🌐 Uploading planet surface textures
- 🎭 Creating NPC character models

**Example:** You're creating a new plasma rifle that players can equip, or uploading a 4K texture for a desert planet.

---

## Workflow Examples

### Creating a Complete Planet

**Step 1: World Sprite Builder**
- Create terrain sprite atlas (ground tiles, trees, rocks)
- Create monster sprite atlas (native creatures)
- Upload sprite packs

**Step 2: Asset Builder**
- Upload planet 3D texture (equirectangular map)
- Set planet stats (radius, atmosphere, gravity)
- Define lore and backstory

**Result:** Planet has both 2D exploration (sprite-based) and 3D visualization (textured sphere in space)

---

### Creating a Complete Spaceship

**Step 1: External 3D Modeling**
- Model ship in Blender
- UV unwrap and texture
- Export as GLTF/GLB

**Step 2: Asset Builder**
- Upload GLTF model
- Upload texture maps (albedo, normal, metallic, roughness)
- Set stats (speed, armor, cargo capacity)
- Define lore and faction

**Result:** Ship appears in 3D space view and can be piloted by players

---

## Integration Points

### Where They Connect:

1. **Planet Exploration**
   - 3D planet (Asset Builder) renders in space
   - Land on planet → Switch to 2D sprite view (World Sprite Builder assets)
   - Sprites are procedurally placed based on biome (from Asset Builder planet data)

2. **Ship Interior**
   - 3D ship model (Asset Builder) renders in space
   - Enter ship → Could use 2D sprite tiles (World Sprite Builder) for interior layout
   - Or use 3D interior (Asset Builder separate model)

3. **Combat**
   - 3D space combat uses ship models (Asset Builder)
   - Ground combat uses 2D sprites (World Sprite Builder monster animations)

4. **Inventory**
   - Items stored as 3D assets (Asset Builder)
   - Inventory UI could show 2D sprite icons (World Sprite Builder)

---

## Technical Architecture

### World Sprite Builder Stack

```
Frontend:
- /views/universe/sprite-creator.ejs
- /public/javascripts/pixel-editor.js (32-color palette, grid, eraser)
- /public/javascripts/sprite-loader.js (client-side atlas loading)

Backend:
- /api/v1/routes/sprite-atlases.js (10 endpoints)
- /api/v1/models/SpriteAtlas.js (MongoDB schema)
- /utilities/linodeStorage.js (CDN upload)

Database:
- spriteAtlases collection (metadata, voting)
- planetObjects collection (placed sprites)
- planetModifications collection (terrain changes)
```

### Asset Builder Stack

```
Frontend:
- /views/assets/builder-enhanced.ejs
- External: Three.js viewer (for GLTF preview)

Backend:
- /api/v1/routes/assets.js (existing endpoints)
- /api/v1/models/Asset.js (MongoDB schema)
- /utilities/linodeStorage.js (CDN upload)

Database:
- assets collection (metadata, voting)
```

---

## Future Enhancements

### World Sprite Builder
- [ ] Animation preview (play monster animations)
- [ ] Tile layering (overlay multiple tiles)
- [ ] Procedural generation hints
- [ ] Import from Aseprite/Pyxel Edit

### Asset Builder
- [ ] **GLTF upload support** (PRIORITY)
- [ ] **Texture upload for planets** (PRIORITY)
- [ ] In-browser 3D preview (Three.js viewer)
- [ ] GLTF validation (check file format, size)
- [ ] Material editor (PBR textures)
- [ ] Animation support (rigged characters)
- [ ] LOD (Level of Detail) support

---

## Development Priorities

### Immediate (Next Session):
1. ✅ Keep World Sprite Builder separate from Asset Builder
2. 🔧 Add GLTF upload to Asset Builder
3. 🔧 Add texture upload for planets
4. 🔧 Add 3D model preview in Asset Builder

### Phase 2:
- Integrate Three.js viewer for GLTF preview
- Add GLTF validation
- Support for rigged/animated models
- PBR material workflow

### Phase 3:
- Connect sprite atlases to planets
- Render sprites on planet surface during exploration
- Place 3D objects (spaceships) on 2D sprite maps

---

## Summary

**Two Systems, One Universe:**
- **World Sprite Builder** = 2D pixel art for planetary exploration
- **Asset Builder** = 3D models/textures for items, ships, planets

**They complement each other:**
- Planets have both 3D textures (space view) AND 2D sprite tiles (ground view)
- Ships are 3D models in space, but could land on 2D sprite planets
- Items can be 3D models with 2D sprite icons

**DO NOT merge them** - they serve different purposes with different workflows!

---

**End of Document**
