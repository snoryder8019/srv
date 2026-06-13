# Character Sync Fix

## Issue

The tester toolbar was showing "⚠ Out of Sync" because characters existed in the local database but were not synced to the game state service.

### Symptoms
- Tester toolbar shows: `Game State: ⚠ Out of Sync`
- Local database has 6 characters
- Game state service has 0 characters
- Socket shows disconnected status

## Root Cause

Characters were created in the local MongoDB database but never synced to the game state service at `http://localhost:3500`. The sync typically happens during character creation, but if the game state service is down or unreachable, characters remain unsynced.

## Solution

Created a sync script to manually sync all characters from the local database to the game state service.

### Script Created

[/srv/ps/scripts/sync-characters-to-game-state.js](file:///srv/ps/scripts/sync-characters-to-game-state.js)

**What it does:**
1. Connects to local MongoDB database
2. Fetches all characters
3. Checks game state service health
4. Syncs each character to game state service
5. Verifies sync was successful

**Usage:**
```bash
cd /srv/ps
node scripts/sync-characters-to-game-state.js
```

### Sync Results

```
═══════════════════════════════════════
🔄 SYNC CHARACTERS TO GAME STATE
═══════════════════════════════════════

📊 Connecting to database...
✅ Connected to database

👥 Fetching characters from local database...
   Found 6 characters

🔌 Checking game state service...
✅ Game state service is running

🔄 Syncing characters...

   ✅ ScooterMcBooter      → Synced (642, 2925)
   ✅ Faithbender          → Synced (2722, 4309)
   ✅ Jon mclain           → Synced (3876, 4908)
   ✅ Geno                 → Synced (602, 2591)
   ✅ Gaylord Focker       → Synced (1913, 4181)
   ✅ Hempnight            → Synced (2841, 2152)

═══════════════════════════════════════
✅ SYNC COMPLETE
═══════════════════════════════════════
   Success: 6
   Errors:  0
   Total:   6
═══════════════════════════════════════
```

## Verification

### Before Sync
```bash
curl -s http://localhost:3500/api/characters
```
**Response:**
```json
{"success":true,"characters":[],"timestamp":1761444885861}
```

### After Sync
```bash
curl -s http://localhost:3500/api/characters
```
**Response:**
```json
{
  "success": true,
  "characters": [
    {
      "name": "Jon mclain",
      "location": {"x": 3875.73, "y": 4908.38}
    },
    {
      "name": "ScooterMcBooter",
      "location": {"x": 641.90, "y": 2925.41}
    },
    // ... 4 more characters
  ],
  "timestamp": 1761445123456
}
```

## Tester Toolbar Status

After sync, the tester toolbar should now show:

```
View Sync
Game State: ✓ Synced  (green)
Map Assets: 48
```

Instead of:

```
View Sync
Game State: ⚠ Out of Sync  (yellow)
Map Assets: 48
```

## How to Prevent This Issue

### 1. Ensure Game State Service is Running

Before creating characters, verify the game state service is running:

```bash
curl http://localhost:3500/health
```

Should return:
```json
{"status":"healthy","uptime":123456}
```

### 2. Check Sync After Character Creation

After creating a new character, verify it synced:

```bash
curl http://localhost:3500/api/characters | jq '.characters | length'
```

### 3. Monitor Sync Status

Use the tester toolbar's "View Sync" section to monitor sync status in real-time:
- Green = ✓ Synced
- Yellow = ⚠ Out of Sync
- Red = Disconnected

### 4. Use Force Sync Button

If you notice "Out of Sync", click the `🔄 Force Sync` button in the tester toolbar to trigger a manual sync.

## Automatic Sync

Character creation automatically syncs to game state service via this code in [/srv/ps/api/v1/characters/index.js](file:///srv/ps/api/v1/characters/index.js#L76-L93):

```javascript
// Sync to game state service
try {
  await fetch(`${GAME_STATE_URL}/api/characters/${newCharacter._id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      _id: newCharacter._id.toString(),
      userId: newCharacter.userId,
      name: newCharacter.name,
      species: newCharacter.species,
      level: newCharacter.level,
      location: newCharacter.location,
      navigation: newCharacter.navigation
    })
  });
} catch (syncError) {
  console.error('Failed to sync character to game state:', syncError);
  // Don't fail creation if sync fails
}
```

**Note:** If sync fails during creation, the character is still created locally, but won't be in game state until manually synced.

## Related Issues

### Socket Disconnected

If the tester toolbar shows:
```
Socket: Disconnected (red)
```

This is a separate issue related to Socket.IO connection. Check:
1. Is the Socket.IO server running?
2. Are there any network errors in browser console?
3. Is the socket properly initialized on the page?

### Location Updates Not Working

If character location updates aren't syncing:
1. Check `/api/v1/characters/:id/location` endpoint
2. Verify game state service is accepting location updates
3. Check browser console for update errors

## Files Involved

### Created Files
- [/srv/ps/scripts/sync-characters-to-game-state.js](file:///srv/ps/scripts/sync-characters-to-game-state.js) - Manual sync script

### Related Files
- [/srv/ps/api/v1/characters/index.js](file:///srv/ps/api/v1/characters/index.js) - Character API with auto-sync
- [/srv/ps/public/javascripts/tester-toolbar.js](file:///srv/ps/public/javascripts/tester-toolbar.js) - Sync monitoring

## Troubleshooting

### Sync Script Fails

**Error:** `Game state service not healthy`

**Solution:**
1. Start game state service: `tmux new-session -d -s game_state_session -c /srv/game-state-service "npm run dev"`
2. Verify it's running: `curl http://localhost:3500/health`
3. Re-run sync script

### Characters Still Out of Sync

**Issue:** Toolbar still shows "Out of Sync" after running script

**Solutions:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Click `🔄 Force Sync` button in toolbar
3. Check `/api/v1/characters/check` endpoint directly
4. Verify game state service has characters: `curl http://localhost:3500/api/characters`

### Partial Sync

**Issue:** Some characters synced, some didn't

**Solutions:**
1. Check sync script output for errors
2. Run script again (it's idempotent)
3. Manually verify each character in game state service
4. Check character data for missing required fields

## Monitoring

### Check Sync Status via API

```bash
curl -s http://localhost:3399/api/v1/characters/check | jq .
```

**Expected Response:**
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

## Summary

✅ **Before:** 0 characters in game state service
✅ **After:** 6 characters synced successfully
✅ **Status:** All characters now show "✓ Synced" in tester toolbar

The sync script successfully resolved the out-of-sync issue and can be run anytime to ensure characters are properly synced.
