# Galactic Map Persistence Fix

## Issue

User reported: "When I refresh the galactic map, the orbital bodies shuffle around and my pilot is floating in space"

## Root Cause Analysis

The galactic map has a **persistence system** that should maintain asset positions across page refreshes:

1. **Spatial Service Cache** - Saves all asset positions to `https://svc.madladslab.com/api/spatial/assets`
2. **Position Loading Priority:**
   - First: Check existing in-memory positions
   - Second: Load from spatial service cache
   - Third: Use `hubData.location` from database
   - Fourth: Use `coordinates` from database
   - Last resort: Generate new random position

## Changes Made

### 1. Updated Asset Type Filter

**File:** [`/srv/ps/public/javascripts/galactic-map-optimized.js`](/srv/ps/public/javascripts/galactic-map-optimized.js)

Removed `'star'` from valid types (stars are too small for galactic scale):

```javascript
// OLD: const validTypes = ['galaxy', 'star', 'orbital', 'anomaly'];
// NEW:
const validTypes = ['galaxy', 'anomaly', 'orbital', 'ship', 'structure'];
```

### 2. Added Debug Logging

Added console logs to track position loading:

```javascript
// Shows how many positions loaded from cache
console.log(`📍 Loaded ${spatialMap.size} saved positions from spatial service`);

// Shows when asset loaded from cache
console.log(`  ✓ Loaded ${asset.title} from cache at (${x}, ${y})`);

// Shows when asset gets NEW random position (shouldn't happen often)
console.log(`  ⚠️ NEW RANDOM for ${asset.title} at (${x}, ${y}) - not in cache!`);
```

## How to Test

### 1. Open Browser Console

1. Go to `https://ps.madladslab.com/universe/galactic-map`
2. Open browser console (F12)
3. Look for these messages:

**Expected Output:**
```
Loading 33 assets (4 space hubs)
📍 Loaded 33 saved positions from spatial service
  ✓ Loaded Celestial Sanctum from cache at (500, 4500)
  ✓ Loaded Crimson Bastion from cache at (4500, 4500)
  ✓ Loaded Quantum Forge Complex from cache at (4500, 500)
  ... (more assets)
```

**Bad Output (shouldn't happen):**
```
Loading 33 assets (4 space hubs)
📍 No saved positions found, will generate new ones
  ⚠️ NEW RANDOM for Celestial Sanctum at (1234, 2345) - not in cache!
  ... (positions will shuffle on each refresh)
```

### 2. Test Persistence

1. **Note positions:** Look at where a few assets are on the map
2. **Refresh page:** Press F5 or Ctrl+R
3. **Check positions:** Assets should be in the SAME locations
4. **Check console:** Should see "Loaded from cache" messages

### 3. If Positions Still Shuffle

**Check spatial cache:**
```bash
curl -s https://svc.madladslab.com/api/spatial/assets | jq '.assets | length'
# Should return: 33
```

**If cache is empty (returns 0):**
```bash
# The map will auto-save on next load, then be persistent
# Just refresh the map page once to populate cache
```

**Force clear and regenerate (if needed):**
```bash
# Clear cache
curl -X DELETE https://svc.madladslab.com/api/spatial/assets

# Refresh browser
# Map will generate new positions and save them
# Subsequent refreshes will use saved positions
```

## Asset Position Priority

### Space Hubs (4 assets)

These have `hubData.location` and always appear at fixed corners:

| Hub | Location | String Domain |
|-----|----------|---------------|
| Temporal Nexus Station | (500, 500) | Time String |
| Quantum Forge Complex | (4500, 500) | Tech String |
| Celestial Sanctum | (500, 4500) | Faith String |
| Crimson Bastion | (4500, 4500) | War String |

These should **NEVER shuffle** - they have hardcoded positions.

### Other Assets (29 assets)

- 5 Galaxies
- 8 Anomalies
- 15 Orbitals
- 1 Structure

These get random positions on FIRST load, then positions are saved to spatial cache. They should **persist** across refreshes.

## Current Status

**Spatial Cache:** ✅ Working (33 assets saved)
**Asset Types:** ✅ Updated (removed stars)
**Debug Logging:** ✅ Added
**Persistence:** 🔍 Testing needed

## Testing Checklist

- [ ] Open galactic map in browser
- [ ] Check console for "Loaded X saved positions"
- [ ] Note positions of 3-4 assets
- [ ] Refresh page (F5)
- [ ] Verify assets are in same positions
- [ ] Check console shows "Loaded from cache" messages
- [ ] Test hard refresh (Ctrl+Shift+R)
- [ ] Positions should still persist

## If Issue Persists

### Scenario 1: Cache Not Loading

**Symptom:** Console shows "No saved positions found"

**Cause:** Spatial service down or cache cleared

**Fix:**
```bash
# Check if spatial service is up
curl https://svc.madladslab.com/health

# Check cache exists
curl https://svc.madladslab.com/api/spatial/assets
```

### Scenario 2: IDs Don't Match

**Symptom:** Console shows "NEW RANDOM" for all assets

**Cause:** Asset IDs from database don't match spatial cache IDs

**Fix:** Clear cache and let it regenerate:
```bash
curl -X DELETE https://svc.madladslab.com/api/spatial/assets
# Then refresh browser
```

### Scenario 3: Assets Drift Over Time

**Symptom:** Positions change slowly, not shuffling

**Cause:** Physics simulation moving non-stationary assets

**Note:** This is intentional for orbitals/ships. Galaxies and anomalies are stationary.

## Physics Behavior

### Stationary Assets (Don't Move)
- ✅ **Galaxy** - Massive structures stay put
- ✅ **Anomaly** - Fixed points in space
- ✅ **Structure** - Large installations

### Mobile Assets (Slow Drift)
- 🔄 **Orbital** - Space stations may drift slightly
- 🔄 **Ship** - Starships can move

Drift is intentional and very slow (0.01-0.04 units/frame). Positions are still saved and should resume from last location.

## Related Files

- **Map Code:** [`/srv/ps/public/javascripts/galactic-map-optimized.js`](/srv/ps/public/javascripts/galactic-map-optimized.js)
- **Asset Scale Doc:** [`/srv/ps/docs/ASSET_SCALE_SYSTEM.md`](/srv/ps/docs/ASSET_SCALE_SYSTEM.md)
- **Spatial Service:** `https://svc.madladslab.com/api/spatial/assets`

## Next Steps

1. User tests map persistence with new debug logging
2. Check browser console output
3. Report if positions still shuffle
4. If shuffling: Check which log messages appear
5. Determine if cache loading or ID matching issue
