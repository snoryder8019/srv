# Socket Payload Diagnostic Report
**Date:** November 4, 2025
**Issue:** Galaxy positions and player coordinates not rendering on galactic-map-3d

---

## Server-Side Analysis ✅

### What the Server IS Sending (Confirmed via Logs)

The `physics-service.js` is broadcasting `galacticPhysicsUpdate` events with complete data:

```javascript
{
  galaxies: [
    { id: "...", position: {x, y, z}, velocity: {vx, vy, vz} }
  ],  // 13 galaxies
  stars: [],  // 0 stars (none have parentGalaxy set)
  connections: [
    { from: "...", to: "...", state: "forming", strength: 0.xx, age: 0.xx }
  ],  // 9-10 connections
  characters: [
    {
      _id: "...",
      name: "Faithbender",
      userId: "...",
      dockedGalaxyId: "...",
      dockedGalaxyName: "Cosmic Nexus",
      isInTransit: false,
      location: { x: 1504, y: 2503, z: 618 },
      activeInShip: false
    },
    // ... 2 more characters
  ],  // 3 connected characters
  simulationSpeed: 1,
  timestamp: 1730766283177
}
```

**Server Log Evidence:**
```
📡 galacticPhysicsUpdate emitted: galaxies=13, stars=0, connections=10, characters=3
   👤 Character: Faithbender at (1504, 2503, 618) docked at: Cosmic Nexus
   👤 Character: Jon mclain at (-2054, 4019, 2078) docked at: Radiant Archive
   👤 Character: Dom Nominus at (376, 4276, -46) docked at: Void's Edge
```

✅ **Server is working correctly!**

---

## Client-Side Investigation Required

### Socket Event Listeners

There are **TWO** listeners for `galacticPhysicsUpdate`:

1. **GameStateMonitor.js** (line 77-91)
   - Receives the event
   - Processes `data.characters` array
   - Updates internal `players` Map
   - Emits `stateSync` event to subscribers
   - ✅ Logs: `📡 GameStateMonitor: Received X online characters`

2. **galactic-map-3d.js** (line 2801-2809)
   - Receives the event
   - Calls `handleServerPhysicsUpdate(data)`
   - Processes galaxies, stars, connections, AND characters
   - ✅ Logs: `🔔 galacticPhysicsUpdate EVENT FIRED!`
   - ✅ Logs: `⚡ handleServerPhysicsUpdate CALLED`

### Expected Client Behavior

When `galacticPhysicsUpdate` is received:

1. **GalacticMap3D.handleServerPhysicsUpdate()** should:
   - Update galaxy positions (lines 2338-2365)
   - Update star positions (lines 2368-2391)
   - Update connections (lines 2394-2396)
   - **Update character positions** (lines 2398-2431)
     - For each character: `createCharacterPin(char)`
     - Logs expected: `📦 Received X characters`
     - Logs expected: `🎯 About to create pin for NAME`
     - Logs expected: `✅ Pin created for NAME`

2. **GameStateMonitor** should:
   - Store character data in `players` Map
   - Emit `playerPositionUpdate` events
   - Update polling sync every 5 seconds

---

## Diagnostic Steps

### Step 1: Open Debug Page
Navigate to: **http://localhost:3399/debug-socket-payloads.html**

This page will show:
- ✅ Socket connection status
- ✅ Number of updates received
- ✅ Full payload contents (galaxies, characters, connections)
- ✅ Real-time updates as they arrive

**Expected Result:** You should see 3 characters with positions in the "Characters" section.

### Step 2: Check Browser Console on galactic-map-3d

Open [galactic-map-3d](http://localhost:3399/universe/galactic-map-3d) and check console for:

```javascript
// Should see these logs:
🔔 galacticPhysicsUpdate EVENT FIRED! {hasData: true, hasCharacters: true, characterCount: 3}
⚡ handleServerPhysicsUpdate CALLED {galaxies: 13, stars: 0, characters: 3, connections: 10}
📦 Received 3 characters: ["Faithbender @ Cosmic Nexus", ...]
📦 Full character data: [{...}, {...}, {...}]
🎯 About to create pin for Faithbender at (1504, 2503, 618)
✅ Pin created for Faithbender:
   - Players Map size: 1
   - PlayersGroup children: 1
   - Pin exists in map: true
   - Pin position: Vector3 {x: 1504, y: 2503, z: 618}
   - Pin visible: true
   - PlayersGroup visible: true
```

### Step 3: Verify Data Reception

In browser console, run:
```javascript
// Check if events are being received
window.emergencySocket?.listeners('galacticPhysicsUpdate')

// Check GameStateMonitor state
window.gameStateMonitor.getStats()
window.gameStateMonitor.getAllPlayers()

// Check GalacticMap3D state
window.galacticMap.players.size  // Should show 3
window.galacticMap.playersGroup.children.length  // Should show 3
window.galacticMap.assets.size  // Should show 13+ (galaxies + anomalies)
```

---

## Possible Issues

### Issue 1: Browser Cache (MOST LIKELY)
**Symptom:** Old JavaScript code still running, missing new debug logs

**Solution:**
1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Do this 2-3 times
3. Check Network tab - files should show actual size, not "(from cache)"

### Issue 2: Socket Not Connected
**Symptom:** No socket events received at all

**Check:**
```javascript
window.emergencySocket?.connected  // Should be true
window.gameStateMonitor?.connected  // Should be true
```

**Solution:** Reload page

### Issue 3: Event Listener Not Registered
**Symptom:** Socket connected but events not firing

**Check:**
```javascript
// Should show listener function
window.emergencySocket?._callbacks?.$galacticPhysicsUpdate
```

**Solution:** Check if `galacticMap.initializeSocket()` was called

### Issue 4: Characters Filtered Out
**Symptom:** Events fire but no characters in payload

**Server Logic:** Only sends characters whose users are currently connected via Socket.IO

**Check Server Logs:**
```
👥 Connected user IDs (2): [ '68f257a61db390295144f034', '68f1170f6550fbd59b47dc1a' ]
```

Make sure your user ID is in this list!

### Issue 5: Rendering Issue (Characters Created but Not Visible)
**Symptom:** Pins created but not visible in 3D scene

**Check:**
```javascript
// Check if pins exist
window.galacticMap.players.forEach((player, id) => {
  console.log(id, player.mesh.position, player.mesh.visible);
});

// Check camera position
window.galacticMap.camera.position
window.galacticMap.controls.target

// Check scene hierarchy
window.galacticMap.playersGroup.visible
window.galacticMap.playersGroup.parent === window.galacticMap.scene
```

---

## Next Steps

1. ✅ **Open debug page** - Verify payloads are being received
2. ✅ **Hard refresh galactic-map-3d** - Clear browser cache
3. ✅ **Check console logs** - Verify event handlers fire
4. ✅ **Run console commands** - Verify data structures populated
5. ❓ **Report findings** - What logs appear? What's missing?

---

## Files Involved

### Server-Side (Broadcasting)
- `/srv/ps/services/physics-service.js` - Broadcasts galacticPhysicsUpdate
  - Lines 222-231: Payload construction and emission
  - Lines 204-220: Character data formatting

### Client-Side (Receiving)
- `/srv/ps/public/javascripts/GameStateMonitor.js` - First listener
  - Lines 77-91: Event handler
  - Lines 194-227: Character state processing

- `/srv/ps/public/javascripts/galactic-map-3d.js` - Second listener
  - Lines 2801-2809: Event handler
  - Lines 2326-2437: Physics update handler
  - Lines 2398-2431: Character processing

- `/srv/ps/views/universe/galactic-map-3d.ejs` - Page setup
  - Lines 3630-3633: GameStateMonitor initialization

### Diagnostic Tools
- `/srv/ps/public/debug-socket-payloads.html` - Real-time payload viewer (NEW)
- `/srv/ps/public/version-check.html` - Existing socket test page
- `/srv/ps/public/cache-test.html` - Existing cache test page

---

## Expected Outcome

After hard refresh, you should see:
- ✅ 13 galaxies rendered with orbital trails
- ✅ 3 character pins at their galactic positions
- ✅ 9-10 connection lines between galaxies
- ✅ Real-time updates as physics simulation runs

If you DON'T see these, the diagnostic steps above will help identify why.
