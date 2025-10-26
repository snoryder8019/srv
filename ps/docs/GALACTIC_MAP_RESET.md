# Galactic Map Reset Guide

## Overview

The galactic map reset system completely resets all asset positions, character locations, and clears the spatial service cache. This forces a fresh distribution of all objects across the 5000x5000 map with the new scatter repulsion system.

## What Gets Reset

1. **Asset Coordinates** (49 approved assets)
   - Clears `coordinates` field
   - Clears `initialPosition` field
   - Assets will regenerate random positions on next map load

2. **Character Locations** (all characters)
   - Resets all character locations to random galactic positions
   - Uses padding (200 units) to avoid edge spawning
   - Maintains `type: 'galactic'` location type

3. **Spatial Service Cache**
   - Clears all cached asset positions in game state service
   - Forces fresh physics simulation

4. **Legacy State** (if exists)
   - Clears old `galacticStates` collection

## Methods to Reset

### Method 1: Run Script Directly (Recommended)

```bash
cd /srv/ps
node scripts/reset-galactic-map.js
```

**Output:**
```
═══════════════════════════════════════
🌌 GALACTIC MAP RESET
═══════════════════════════════════════

📊 Connecting to database...
✅ Connected to database

🗑️  Step 1: Clearing spatial service cache...
✅ Spatial service cache cleared

📍 Step 2: Resetting asset coordinates...
✅ Reset 49 approved assets

👤 Step 3: Resetting character locations...
   Found 6 characters to reset

   ✓ ScooterMcBooter      → ( 642, 2925)
   ✓ Faithbender          → (2722, 4309)
   ✓ Jon mclain           → (3538,  773)
   ✓ Geno                 → ( 602, 2591)
   ✓ Gaylord Focker       → (1913, 4181)
   ✓ Hempnight            → (2841, 2152)

✅ Reset 6 character locations

═══════════════════════════════════════
✅ RESET COMPLETE
═══════════════════════════════════════
   Assets reset:      49
   Characters reset:  6
   Spatial cache:     Cleared
═══════════════════════════════════════
```

### Method 2: Admin API Endpoint

**Endpoint:** `POST /admin/api/galactic-map/randomize`

**Requires:** Admin authentication

**Response:**
```json
{
  "success": true,
  "message": "Galactic map reset complete",
  "details": {
    "assetsReset": 49,
    "charactersReset": 6,
    "spatialCacheCleared": true
  }
}
```

**Example (with authentication):**
```bash
curl -X POST https://ps.madladslab.com/admin/api/galactic-map/randomize \
  -H "Cookie: your-session-cookie"
```

## After Reset

### Immediate Effects

1. **Asset Positions**
   - All 49 approved assets have cleared coordinates
   - Map will generate new random positions on next load
   - Scatter repulsion system will prevent northwest drift

2. **Character Locations**
   - All 6 characters moved to new random positions
   - Spread across the map with 200-unit padding from edges
   - Characters maintain their data (name, level, inventory, etc.)

3. **Spatial Cache**
   - Game state service cache cleared
   - Physics simulation starts fresh

### What to Do Next

1. **Reload the Galactic Map**
   ```
   https://ps.madladslab.com/universe/galactic-map
   ```

2. **Verify Distribution**
   - Check the browser console
   - Assets should be evenly distributed (not clustered in northwest)
   - Characters appear at their new random locations

3. **Monitor Over Time**
   - With scatter repulsion active, objects should maintain even distribution
   - No drift toward northwest corner
   - Balanced physics simulation

## Technical Details

### Map Dimensions
- **Size:** 5000x5000 units
- **Padding:** 200 units from edges
- **Character spawn area:** 4600x4600 effective area

### Reset Logic

```javascript
// Asset reset - clear coordinates
await db.collection('assets').updateMany(
  { status: 'approved' },
  { $unset: { 'coordinates': '', 'initialPosition': '' } }
);

// Character reset - random location
const newLocation = {
  type: 'galactic',
  x: 200 + Math.random() * 4600,
  y: 200 + Math.random() * 4600
};
```

### Files Modified/Created

**Script:**
- [/srv/ps/scripts/reset-galactic-map.js](file:///srv/ps/scripts/reset-galactic-map.js) - Comprehensive reset script

**API Endpoint:**
- [/srv/ps/routes/admin/index.js](file:///srv/ps/routes/admin/index.js#L385-L447) - Admin API endpoint

**Documentation:**
- [/srv/ps/docs/GALACTIC_MAP_RESET.md](file:///srv/ps/docs/GALACTIC_MAP_RESET.md) - This file

## Troubleshooting

### Script Fails to Connect
```
Error: Could not connect to MongoDB
```

**Solution:**
- Check `.env` file has correct `DB_URL` and `DB_NAME`
- Verify MongoDB is running
- Check network connectivity

### Spatial Service Unreachable
```
⚠️  Could not reach spatial service: ECONNREFUSED
```

**Solution:**
- This is OK if game state service is not running
- Reset will still work for database and character positions
- Spatial cache will be empty on next service start

### No Assets Reset
```
Assets reset: 0
```

**Solution:**
- Check if assets have `status: 'approved'`
- Run: `node scripts/check-all-asset-coords.js` to verify
- May need to approve assets first

### Characters Don't Move on Map
**Issue:** Character position reset in database but not on map

**Solution:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Clear browser cache
3. Check browser console for errors
4. Verify character location updated:
   ```bash
   mongosh projectStringborne --eval "db.characters.find({}, {name:1, location:1})"
   ```

## Reset History

### 2025-10-26 - First Reset with Scatter System
- Reset 49 approved assets
- Reset 6 character locations
- Cleared spatial cache
- Applied new scatter repulsion system
- Fixed northwest drift issue

## Related Documentation

- [SCATTER_REPULSION_SYSTEM.md](file:///srv/ps/docs/SCATTER_REPULSION_SYSTEM.md) - Scatter repulsion details
- [SCATTER_QUICK_START.md](file:///srv/ps/docs/SCATTER_QUICK_START.md) - Quick start guide
- [GAME_STATE_SYNC_FIX.md](file:///srv/ps/docs/GAME_STATE_SYNC_FIX.md) - Game state sync fix

## Safety Notes

⚠️ **Important:**
- **Backup First:** Consider backing up character data before reset
- **User Impact:** All players will see their character position changed
- **Asset Positions:** All assets get new random positions
- **No Data Loss:** Only positions change, all other data preserved

✅ **Safe Operations:**
- Can be run multiple times
- Does not delete characters or assets
- Does not affect inventory or stats
- Reversible (can reset again)
