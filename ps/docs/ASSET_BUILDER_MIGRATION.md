# Asset Builder Migration Guide
## Old Workshop → New Unified Asset & Sprite Builder

**Date:** October 27, 2025
**Status:** ✅ Complete - Old builder deprecated

---

## Summary

The old **Asset Builder** (`/assets/builder-enhanced`) has been **replaced** by the new **Asset & Sprite Builder** (`/universe/sprite-creator`), which provides a superior workflow with integrated pixel art tools.

---

## Why the Change?

### Old Asset Builder Issues:
- ❌ No visual sprite creation - had to create sprites externally
- ❌ Separated sprite creation from asset metadata
- ❌ No tile mapping or multi-tile configuration
- ❌ Limited to JSON-based workflow
- ❌ No real-time preview

### New Asset & Sprite Builder Benefits:
- ✅ **Integrated pixel editor** - Draw 80×80 sprite atlases in-browser
- ✅ **32-color palette** - Professional retro palette for consistent art
- ✅ **5×5 sprite tile grid** - Clear visual boundaries for tile design
- ✅ **Copy/paste tiles** - Duplicate and modify tiles easily
- ✅ **Eraser with transparency** - Proper alpha channel support
- ✅ **Pack type rules** - Automatic tile categorization (Terrain, Monsters, NPCs, Buildings, Dungeons)
- ✅ **Asset metadata integration** - Optional second form for placeable objects
- ✅ **Multi-tile configuration** - Define 2×2, 3×3, 4×4, 5×5 objects
- ✅ **Stats and attributes** - Health, capacity, power, defense, collision
- ✅ **Unified workflow** - Sprites + Assets in one place

---

## Feature Comparison

| Feature | Old Builder | New Builder |
|---------|-------------|-------------|
| **Sprite Creation** | External tools required | ✅ Integrated pixel editor |
| **Color Palette** | Custom only | ✅ 32-color palette + custom |
| **Grid Overlay** | None | ✅ 5×5 tile grid + fine pixel grid |
| **Tile Tools** | None | ✅ Copy/paste, eraser, fill |
| **Pack Types** | Manual JSON | ✅ Auto-categorized (5 types) |
| **Animation Rules** | Manual | ✅ Row-based rules (monsters, NPCs) |
| **Asset Metadata** | Full form required | ✅ Optional toggle |
| **Multi-Tile Objects** | Not supported | ✅ 1×1 to 5×5, custom |
| **Preview** | Static | ✅ Real-time canvas preview |
| **Export Format** | JSON + separate image | ✅ 80×80 PNG with manifest |

---

## Migration Path

### For Users with Existing Assets:

1. **Assets already in the system remain valid** - No data loss
2. **Continue using Content Library** to manage existing assets
3. **Create new sprites** using the new builder at `/universe/sprite-creator`

### For Developers:

**Old Routes (Deprecated):**
```
/assets/builder-enhanced  → Deprecated (still functional)
```

**New Routes (Active):**
```
/universe/sprite-creator  → New unified builder
/api/v1/sprite-atlases    → New sprite atlas API (10 endpoints)
```

**Data Models:**
- Old: `Asset` model (still in use for existing assets)
- New: `SpriteAtlas` + optional `Asset` creation
- Future: Gradual migration of old assets to sprite-based system

---

## New Builder Workflow

### Step 1: Create Sprite Atlas

**Draw Mode:**
1. Use 32-color palette or custom color picker
2. Draw/erase on 80×80 pixel canvas (400×400 display)
3. See fine pixel grid + 5×5 tile grid overlay
4. Copy/paste tiles to duplicate patterns
5. Update preview to see final result

**Upload Mode:**
1. Drag & drop 80×80 PNG
2. Or click to browse files
3. Preview shows with grid overlay

### Step 2: Configure Atlas

1. **Atlas Name** - Pack identifier
2. **Pack Type** - Terrain, Monsters, NPCs, Buildings, Dungeon
   - Auto-updates tile categories based on type
3. **Planet Type/Biome** - Forest, Desert, Ocean, etc.
4. **Description** - Brief pack summary

**Tile Categories (Auto-Generated):**
- **Terrain Pack:** Ground → Environment → Monster → Aerial → Resources
- **Monster Pack:** 5 rows of monster animations (5 creatures × 5 frames)
- **NPC Pack:** 5 rows of NPC animations
- **Building Pack:** Hull → Exterior → Interior → UI → Damage
- **Dungeon Pack:** Floor → Wall → Objects → Traps → Collectibles

### Step 3: Asset Metadata (Optional)

**Enable "Create Placeable Asset"** if this sprite represents an object players can place:

**Basic Info:**
- Asset Title (e.g., "Scout Ship MK-1")
- Description
- Asset Type (Object, Structure, Ship, Item, Environment)
- Rarity (Common → Mythic → Unique)

**Multi-Tile Configuration:**
- Single Tile (1×1)
- Small Object (2×2)
- Medium Object (3×3) - **Perfect for spaceships**
- Large Object (4×4)
- Massive Object (5×5)
- Custom (define your own)

**Lore & Story:**
- Lore/History text
- Tags (comma-separated)

**Object Stats (Expandable):**
- Health/Durability
- Storage Capacity
- Power Output
- Defense Rating
- Interactive checkbox
- Blocks Movement (collision) checkbox

### Step 4: Submit

- Click **🚀 Upload Sprite Atlas**
- Goes to community approval (voting system)
- Admin final approval required
- Available in game after approval

---

## Technical Details

### Sprite Atlas Specification

```
Format: PNG RGBA (32-bit color depth)
Size: 80×80 pixels
Grid: 5 columns × 5 rows = 25 tiles
Tile Size: 16×16 pixels each
Max File Size: 50KB
```

### Row-Based Layout Rules

**Row 0:** Ground Textures (5 variations)
**Row 1:** Environment Objects (Small → Large)
**Row 2:** Animation Frames (Idle, Walk 1-2, Attack, Hit/Death)
**Row 3:** Aerial Effects (Clouds, weather)
**Row 4:** Custom/Reserved

*Varies by pack type - see SPRITE_ATLAS_SPEC.md for full details*

### API Endpoints

**Sprite Atlas:**
```javascript
GET    /api/v1/sprite-atlases           // List approved
GET    /api/v1/sprite-atlases/pending   // Pending approval (tester/admin)
GET    /api/v1/sprite-atlases/my-atlases // User's uploads
POST   /api/v1/sprite-atlases           // Upload new
POST   /api/v1/sprite-atlases/:id/vote  // Vote
POST   /api/v1/sprite-atlases/:id/approve // Admin approve
POST   /api/v1/sprite-atlases/:id/reject  // Admin reject
DELETE /api/v1/sprite-atlases/:id       // Delete
```

### Database Collections

**New:**
- `spriteAtlases` - Sprite atlas metadata with voting
- `planetObjects` - Placed objects on planets
- `planetModifications` - Player modifications to terrain

**Existing (Still Used):**
- `assets` - Legacy assets from old builder
- `characters` - Character data
- `planets` - Planet data

---

## Deprecation Timeline

### Phase 1 (Current) - October 27, 2025
✅ New builder fully functional
✅ Old builder still accessible
✅ Menu updated to point to new builder

### Phase 2 (Future) - TBD
- Add migration tool to convert old assets to sprite-based system
- Display deprecation notice on old builder
- Redirect `/assets/builder-enhanced` to new builder

### Phase 3 (Future) - TBD
- Remove old builder routes
- Full migration of old assets
- Archive old builder code

---

## Files Changed

### New Files Created
1. `/srv/ps/views/universe/sprite-creator.ejs` - Main builder UI
2. `/srv/ps/api/v1/routes/sprite-atlases.js` - API routes
3. `/srv/ps/api/v1/models/SpriteAtlas.js` - Data model
4. `/srv/ps/api/v1/models/PlanetObject.js` - Placed objects
5. `/srv/ps/api/v1/models/PlanetModification.js` - Terrain changes
6. `/srv/ps/utilities/linodeStorage.js` - CDN upload utility
7. `/srv/ps/public/javascripts/pixel-editor.js` - Enhanced pixel editor
8. `/srv/ps/public/javascripts/sprite-loader.js` - Client-side sprite loader
9. `/srv/ps/docs/SPRITE_ATLAS_SPEC.md` - Full specification
10. `/srv/ps/docs/ASSET_BUILDER_MIGRATION.md` - This file

### Modified Files
1. `/srv/ps/views/menu-enhanced.ejs` - Updated link to new builder
2. `/srv/ps/views/partials/header.ejs` - Updated dropdown link
3. `/srv/ps/routes/universe/index.js` - Added `/sprite-creator` route
4. `/srv/ps/api/v1/index.js` - Mounted sprite-atlases routes

### Deprecated Files (Still Exists)
- `/srv/ps/views/assets/builder-enhanced.ejs` - Old builder (will archive later)

---

## User Communication

**Announcement Text:**

> 🎨 **New Asset & Sprite Builder Now Available!**
>
> We've launched a completely redesigned asset creation system with:
> - Integrated pixel art editor with 32-color palette
> - Real-time sprite preview with tile grid overlay
> - Copy/paste tools for rapid sprite creation
> - Automatic tile categorization by pack type
> - Optional asset metadata for placeable objects
>
> The old asset builder is now deprecated. Please use the new builder at `/universe/sprite-creator` or access it from the Player Menu.
>
> Existing assets are safe and remain in your Content Library.

---

## Support

For questions or issues with the new builder:
1. Check [SPRITE_ATLAS_SPEC.md](/srv/ps/docs/SPRITE_ATLAS_SPEC.md) for full specifications
2. Check [PHASE_1_PROGRESS.md](/srv/ps/docs/PHASE_1_PROGRESS.md) for development status
3. Report bugs via GitHub issues

---

**End of Migration Guide**
