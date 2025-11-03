# Tester Toolbar - Sync Debugging

## Overview

The tester toolbar now includes comprehensive sync debugging features to help diagnose and fix view synchronization issues on the galactic map.

## New Features

### View Sync Section

Located in the debug info panel (click the debug icon 🐛), the View Sync section shows:

#### Real-time Sync Status

1. **Game State** - Connection status to game state service
   - `✓ Synced` (green) - All systems synchronized
   - `⚠ Out of Sync` (yellow) - Sync issues detected
   - `Disconnected` (red) - Game state service unreachable
   - `Error` (red) - Sync check failed

2. **Map Assets** - Number of assets loaded on the map
   - Shows count of `publishedAssets` array
   - Updates every 500ms

3. **View X / View Y** - Current view offset position
   - Shows map pan offset values
   - Useful for debugging camera position

4. **Zoom** - Current zoom level as percentage
   - 100% = 1.0 scale
   - Updates every 500ms

### Action Buttons

#### 🔄 Force Sync
Forces a complete synchronization of the view with the game state:

**What it does:**
1. Reloads all published assets from `/api/v1/assets/approved/list`
2. Reloads travel connections
3. Checks game state sync status
4. Shows success/error notification

**When to use:**
- Assets not appearing on map
- Map seems outdated
- After admin makes changes to assets
- View appears "stuck" or frozen

**Usage:**
```javascript
// Called automatically by button click
testerToolbar.forceSyncView();
```

#### 📍 Center
Centers the map view on your current character:

**What it does:**
1. Gets current character location from `map.currentCharacter.location`
2. Calculates center position based on canvas size
3. Adjusts zoom to comfortable level (minimum 50%)
4. Updates map offsets to center character
5. Shows character name and coordinates

**When to use:**
- Lost track of your character on map
- Character appears off-screen
- After teleport or location update
- Quick navigation to character

**Usage:**
```javascript
// Called automatically by button click
testerToolbar.centerOnCharacter();
```

## Sync Monitoring

### Auto-checks
- **Every 10 seconds**: Game state sync status check
- **Every 500ms**: Map asset count, view position, zoom level updates
- **On connect**: Initial sync status check

### Manual Checks
Click `🔄 Force Sync` button to manually trigger a full sync operation.

## Integration with Map

The tester toolbar connects to the galactic map instance:

```javascript
// In galactic-map.ejs or wherever map is initialized
if (window.testerToolbar && galacticMap) {
  testerToolbar.connectMap(galacticMap);
}
```

This enables:
- Real-time location monitoring
- FPS tracking
- Sync status monitoring
- Force sync capabilities
- Center on character functionality

## Troubleshooting

### Sync Status Shows "Error"
**Cause:** Cannot reach `/api/v1/characters/check` endpoint

**Solutions:**
1. Check if you're logged in
2. Verify user has proper authentication
3. Check browser console for errors
4. Ensure PS service is running

### Sync Status Shows "Out of Sync"
**Cause:** Local state doesn't match game state service

**Solutions:**
1. Click `🔄 Force Sync` button
2. Check browser console for sync issues
3. Verify game state service is running
4. Check `/api/v1/characters/check` response in Network tab

### Map Assets Shows 0 or Wrong Number
**Cause:** Assets not loading properly

**Solutions:**
1. Click `🔄 Force Sync` button
2. Check `/api/v1/assets/approved/list` endpoint
3. Verify assets have `status: 'approved'`
4. Check browser console for loading errors

### Center Button Does Nothing
**Cause:** No character location available

**Solutions:**
1. Ensure you have an active character
2. Check `map.currentCharacter.location` exists
3. Verify character has `x` and `y` coordinates
4. Check character location in database

### Force Sync Button Stuck on "Syncing..."
**Cause:** API call failed or timed out

**Solutions:**
1. Refresh the page
2. Check network connectivity
3. Verify API endpoints are responding
4. Check browser console for errors

## API Endpoints Used

### `/api/v1/characters/check`
Checks synchronization between local DB and game state service.

**Response:**
```json
{
  "local": {
    "count": 6,
    "characters": [...]
  },
  "gameState": {
    "status": "connected",
    "count": 6,
    "characters": [...]
  },
  "sync": {
    "inSync": true,
    "issues": {
      "missingInGameState": [],
      "extraInGameState": []
    }
  }
}
```

### `/api/v1/assets/approved/list`
Loads published assets for the map.

**Query params:**
- `limit` - Number of assets to load (default: 1000)

**Response:**
```json
{
  "success": true,
  "assets": [...]
}
```

## Console Debugging

Enable detailed logging by checking the browser console when:
- Force sync is triggered
- Center on character is clicked
- Sync status changes
- Errors occur

**Example output:**
```
📍 Centered on ScooterMcBooter at (642, 2925)
✅ View synced successfully
⚠️ Sync issues: {missingInGameState: [], extraInGameState: []}
```

## Files Modified

### JavaScript
- [/srv/ps/public/javascripts/tester-toolbar.js](file:///srv/ps/public/javascripts/tester-toolbar.js)
  - Added `startSyncMonitor()` method
  - Added `checkGameStateSync()` method
  - Added `forceSyncView()` method
  - Added `centerOnCharacter()` method
  - Added View Sync section to debug panel

### CSS
- [/srv/ps/public/stylesheets/tester-toolbar.css](file:///srv/ps/public/stylesheets/tester-toolbar.css)
  - Added `.debug-btn` styles for action buttons
  - Added hover/active/disabled states

## Related Documentation

- [GAME_STATE_SYNC_FIX.md](file:///srv/ps/docs/GAME_STATE_SYNC_FIX.md) - Game state sync fix
- [GALACTIC_MAP_RESET.md](file:///srv/ps/docs/GALACTIC_MAP_RESET.md) - Map reset guide
- [SCATTER_REPULSION_SYSTEM.md](file:///srv/ps/docs/SCATTER_REPULSION_SYSTEM.md) - Scatter system

## Future Enhancements

Potential improvements:
1. **Auto-sync on detection** - Automatically sync when out of sync detected
2. **Sync history** - Track sync status over time with graph
3. **Asset diff viewer** - Show what changed between syncs
4. **Character trail** - Visualize character movement history
5. **Bookmark locations** - Save and jump to favorite map locations
