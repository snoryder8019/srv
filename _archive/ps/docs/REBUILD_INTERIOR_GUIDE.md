# Rebuilding Interior Map - Quick Guide

**Date**: 2025-11-04
**Issue**: Existing zone shows only rectangle grid because zoneData is null

## Why You Need to Rebuild

Your previous interior map wasn't saved because:
1. The API wasn't handling `zoneData` field (fixed now ✅)
2. The dropdown wasn't populated (fixed now ✅)

The zone exists in the database but has `zoneData: null`, so it renders as a default grid.

## Quick Rebuild Steps

### Option 1: Create New Interior (Recommended)

1. **Open Interior Map Builder**:
   ```
   http://localhost:3399/assets/interior-map-builder
   ```

2. **Select Parent Asset**:
   - Look at "Link to World Asset" dropdown
   - Select "The Primordial Singularity" from the 🌀 Anomalies group
   - You should see alert: "Linked to The Primordial Singularity"

3. **Design Your Interior**:
   - Set map dimensions (e.g., 40x25 for medium ship interior)
   - Select "Floor" tool and paint walkable areas
   - Select "Wall" tool and create corridors/rooms
   - Select "Window" tool for external viewports
   - Place one "Spawn" point (green) where player starts
   - Place "Exit" points (cyan) to leave the zone
   - Optional: Place "Loot" (yellow) and "NPC" (purple) markers

4. **Save Details**:
   - Map Name: "Starship Colony - Interior" (or new name)
   - Map Type: "Interior" (not dungeon)
   - Description: Your existing description or new one
   - Tags: "starship, colony, interior"

5. **Save as Zone Asset**:
   - Click "Save as Zone Asset" button
   - Should see success message
   - Note the new zone ID from the response

6. **Update Old Zone** (optional):
   - You can delete the old empty zone
   - Or keep it as backup

### Option 2: Edit via Interior Map Builder with Zone ID

If you want to load the existing zone and add data to it:

1. **Open with Zone ID**:
   ```
   http://localhost:3399/assets/interior-map-builder?zoneId=690a7a25134a4ef9aab3d585
   ```

2. **This will**:
   - Load existing zone metadata (title, description)
   - Show empty map (since zoneData is null)
   - Parent should already be linked

3. **Paint Your Interior** (as above)

4. **Save** - This will UPDATE the existing zone with zoneData

### Option 3: Direct Database Update (Advanced)

If you want to manually add test data:

```javascript
// Connect to MongoDB and run:
db.assets.updateOne(
  { _id: ObjectId("690a7a25134a4ef9aab3d585") },
  {
    $set: {
      zoneData: {
        type: "interior",
        difficulty: 1,
        width: 40,
        height: 25,
        tileSize: 32,
        layers: {
          ground: [
            // 2D array of tile IDs
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
            // ... more rows ...
          ],
          walls: [
            // 2D array for walls (1 = wall, 0 = empty)
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            // ... more rows ...
          ],
          objects: [],
          sprites: []
        },
        spawnPoints: [
          { x: 20, y: 12, type: 'player' }
        ],
        exitPoints: [
          { x: 20, y: 23, type: 'exit' }
        ],
        lootPoints: [],
        npcPoints: [],
        hazardPoints: [],
        metadata: {
          theme: 'sci-fi',
          lighting: 'normal'
        }
      }
    }
  }
)
```

## Testing After Rebuild

1. **View in Browser**:
   ```
   http://localhost:3399/universe/zone/690a7a25134a4ef9aab3d585
   ```
   OR if you created a new zone:
   ```
   http://localhost:3399/universe/zone/[NEW_ZONE_ID]
   ```

2. **Check Console**:
   - Should show: `Zone dimensions: 40 x 25` (your custom size)
   - NOT: `Zone dimensions: 50 x 30` (default fallback)

3. **Visual Check**:
   - Should see your custom floor tiles (not just grid)
   - Should see walls rendered
   - Player should spawn at your spawn point
   - Should be able to walk around

4. **Test from Galactic Map**:
   ```
   http://localhost:3399/universe/galactic-map-3d
   ```
   - Click on Primordial Singularity
   - Click "🚀 Enter Interior"
   - Should load your custom interior

## What to Expect

### Before (Current State)
- Zone loads with green grid pattern
- 50x30 default dimensions
- No walls, just boundaries
- Generic floor
- Player in center

### After Rebuild
- Zone loads with your custom tilemap
- Your custom dimensions (e.g., 40x25)
- Actual walls and corridors
- Different floor tiles
- Player spawns at your spawn point
- Exit points visible
- Loot/NPC markers if you placed them

## Verification Checklist

After rebuilding, verify:
- ✅ Interior Map Builder shows "Linked to The Primordial Singularity"
- ✅ You painted floor tiles (gray/dark tiles)
- ✅ You painted wall tiles (visible borders)
- ✅ You placed exactly ONE spawn point (green dot)
- ✅ You placed at least ONE exit point (cyan dot)
- ✅ You entered a name and clicked "Save as Zone Asset"
- ✅ You saw success message with zone ID
- ✅ Zone view loads your custom interior (not grid)
- ✅ Console shows your custom dimensions
- ✅ Player spawns at your spawn point
- ✅ Walls are visible and rendered

## Troubleshooting

### Still Seeing Grid Floor?
- Check browser console for zoneData value
- Should see `zoneData: { type: "interior", layers: {...}, ... }`
- If null, the save didn't work - check for errors

### Can't Select Parent Asset?
- Make sure you're using the latest code
- Refresh the Interior Map Builder page
- Check console for API errors

### Save Button Does Nothing?
- Check browser console for errors
- Verify you're logged in
- Check network tab for failed POST request

### Player Can Walk Through Walls?
- Collision detection not implemented yet (known limitation)
- This is visual only for now
- Future enhancement will add collision

## Quick Rebuild Command

**Fastest way to rebuild**:
```bash
# 1. Open Interior Map Builder with the zone
open http://localhost:3399/assets/interior-map-builder?zoneId=690a7a25134a4ef9aab3d585

# 2. Paint your interior (manual step)

# 3. Click Save as Zone Asset (manual step)

# 4. Test it
open http://localhost:3399/universe/zone/690a7a25134a4ef9aab3d585
```

---

**Recommendation**: Use **Option 2** - load the existing zone and add the floormap data to it. This preserves your zone ID and hierarchy, so the galactic map integration continues to work without changes.
