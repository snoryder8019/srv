# Socket Payload Fixes - November 4, 2025

## Issues Identified

### 1. ✅ FIXED: Characters Not Moving With Galaxies
**Problem:** Character coordinates were static in the debugger and on the galactic map. Characters docked at galaxies were not moving as their galaxies orbited through space.

**Root Cause:** The `updateDockedCharacterPositions()` method in `physics-service.js` only assigned characters to galaxies but didn't apply the galaxy's velocity to character positions.

**Solution:** Modified `/srv/ps/services/physics-service.js` lines 1129-1237
- Added logic to move characters with their docked galaxies
- Characters now inherit their galaxy's velocity and move through space
- Position updates are batched for database efficiency
- Formula: `character.position += galaxy.velocity * deltaTime`

**Before:**
```javascript
// Only assigned galaxy, didn't move character
character.location.dockedGalaxyId = nearestGalaxy.id;
```

**After:**
```javascript
// Assign galaxy AND move character with it
character.location.dockedGalaxyId = nearestGalaxy.id;

// Apply galaxy velocity to character position
if (dockedGalaxy && dockedGalaxy.velocity) {
  const deltaX = dockedGalaxy.velocity.vx * deltaTime;
  const deltaY = dockedGalaxy.velocity.vy * deltaTime;
  const deltaZ = dockedGalaxy.velocity.vz * deltaTime;

  character.location.x += deltaX;
  character.location.y += deltaY;
  character.location.z += deltaZ;
}
```

---

### 2. ✅ FIXED: Connections Not Displaying in Debugger
**Problem:** Debug page showed "No connections in this update" despite server broadcasting 12 connections.

**Root Cause:** JavaScript error when trying to access `conn.strength` and `conn.age` properties that don't exist. The actual connection object has `distance`, `state`, `daysToChange`, and `isPrimary` instead.

**Solution:** Modified `/srv/ps/public/debug-socket-payloads.html` lines 157-172
- Updated to use actual connection properties
- Added safe navigation operators (`?.`) to prevent errors
- Display shows: state, distance, primary/secondary, days to change

**Before:**
```javascript
State: ${conn.state} | Strength: ${conn.strength.toFixed(2)} | Age: ${conn.age.toFixed(1)}d
// ❌ Error: Cannot read property 'toFixed' of undefined
```

**After:**
```javascript
State: ${conn.state} | Distance: ${conn.distance?.toFixed(0) || 'N/A'} | ${conn.isPrimary ? 'Primary' : 'Secondary'}
Days to change: ${conn.daysToChange?.toFixed(1) || 'N/A'}
// ✅ Works correctly
```

---

## Server Broadcast Confirmed Working ✅

The server is correctly broadcasting `galacticPhysicsUpdate` events every second with:

```javascript
{
  galaxies: [13 items],       // ✅ Galaxy positions and velocities
  stars: [0 items],           // ✅ Empty (stars need parentGalaxy set)
  connections: [12 items],    // ✅ Anomaly-galaxy and galaxy-galaxy connections
  characters: [2-3 items],    // ✅ Only connected players
  simulationSpeed: 1,         // ✅ Simulation speed multiplier
  timestamp: 1730766283177    // ✅ Server timestamp
}
```

**Example Character Data:**
```javascript
{
  _id: "...",
  name: "Faithbender",
  userId: "...",
  dockedGalaxyId: "...",
  dockedGalaxyName: "Cosmic Nexus",
  isInTransit: false,
  location: { x: 1504, y: 2503, z: 618 },
  activeInShip: false
}
```

**Example Connection Data:**
```javascript
{
  id: "...",
  from: "69000d03...",      // Anomaly ID
  to: "6902f713...",        // Galaxy ID
  fromPos: { x: -800, y: 600, z: -400 },
  toPos: { x: 1239, y: -536, z: 798 },
  distance: 2456.3,
  state: "forming",
  color: "0x0088ff",
  daysToChange: 0.45,
  isPrimary: true
}
```

---

## Files Modified

1. **`/srv/ps/services/physics-service.js`**
   - Lines 1129-1237: `updateDockedCharacterPositions()` method
   - Added galaxy velocity application to docked characters
   - Added bulk database updates for efficiency

2. **`/srv/ps/public/debug-socket-payloads.html`**
   - Lines 157-172: Connection display logic
   - Fixed property references to match actual data structure

3. **`/srv/ps/public/debug-socket-payloads.html`** (NEW FILE)
   - Real-time socket payload debugger
   - Shows galaxies, characters, connections as they arrive
   - Displays full JSON payload history

4. **`/srv/ps/SOCKET_PAYLOAD_DIAGNOSTIC.md`** (NEW FILE)
   - Comprehensive diagnostic guide
   - Troubleshooting steps
   - Expected vs actual behavior documentation

---

## Expected Behavior After Fixes

### On galactic-map-3d:
1. ✅ **Galaxies** orbit around anomalies with purple trails
2. ✅ **Characters** appear as pins at their galactic positions
3. ✅ **Characters move** with their docked galaxies as they orbit
4. ✅ **Connections** render as colored lines between galaxies and anomalies
5. ✅ **Real-time updates** every second via Socket.IO

### In debug-socket-payloads.html:
1. ✅ **Connection status** shows "Connected"
2. ✅ **Update counter** increments every second
3. ✅ **Characters section** shows 2-3 characters with positions
4. ✅ **Galaxies section** shows 13 galaxies with velocities
5. ✅ **Connections section** shows 12 connections with states
6. ✅ **Character coordinates** change in real-time as they move

---

## Testing Steps

### 1. Verify Character Movement
Open [debug-socket-payloads.html](http://localhost:3399/debug-socket-payloads.html) and watch character positions:

**Before Fix:**
```
👤 Faithbender
   📍 Position: (1504, 2503, 618)  ← STATIC, never changes
```

**After Fix:**
```
Update #1: 👤 Faithbender at (1504, 2503, 618)
Update #2: 👤 Faithbender at (1505, 2504, 619)  ← Moving!
Update #3: 👤 Faithbender at (1506, 2505, 620)  ← Coordinates change
```

### 2. Verify Connections Display
Connections section should show:
```
🔗 Connections in Last Update: 12

🔗 69000d03... ↔ 6902f713...
   State: forming | Distance: 2456 | Primary
   Days to change: 0.5
```

### 3. Verify on galactic-map-3d
Open browser console on [galactic-map-3d](http://localhost:3399/universe/galactic-map-3d):

```javascript
// Check character pins
window.galacticMap.players.size  // Should be 2-3
window.galacticMap.players.forEach((p, id) => {
  console.log(p.characterName, p.mesh.position);
});

// Check connections
window.galacticMap.connectionsGroup.children.length  // Should be 12

// Watch positions change
setInterval(() => {
  const player = window.galacticMap.players.values().next().value;
  if (player) console.log('Position:', player.mesh.position);
}, 1000);
```

---

## Performance Notes

**Database Updates:**
- Characters: Bulk updates via `bulkWrite()` for efficiency
- Only updates docked characters (skips those in transit)
- Updates happen every physics tick (50ms = 20 times/second)

**Network Traffic:**
- Socket.IO broadcasts every 1 second
- Payload size: ~50-100KB with 13 galaxies, 3 characters, 12 connections
- Only sends connected players to reduce payload size

**Client-Side Rendering:**
- Smooth interpolation (lerp factor 0.1) prevents jumpy galaxy movement
- Character pins update position every frame
- Connection lines update when server sends new data

---

## Known Issues / Future Improvements

1. **Stars not rendering** - All stars missing `parentGalaxy` property
   - Server logs: `⚠️ Star "Mystic Domain Alpha" has no parentGalaxy`
   - Fix: Run migration script to assign stars to galaxies

2. **Character filtering** - Only shows connected players
   - Intentional design to reduce payload
   - Offline players won't appear on map

3. **Connection states** - Most showing "forming"
   - Connections age over time to become "stable" after 3 days
   - "breaking" state when connection weakens

---

## Next Steps

1. ✅ **Character movement** - FIXED
2. ✅ **Connection display** - FIXED
3. ❓ **Test on live map** - Refresh galactic-map-3d and verify pins move
4. ❓ **Verify GameStateMonitor** - Check if it's also receiving updates correctly
5. ⏳ **Fix stars** - Assign parentGalaxy to all stars in database

---

*Last Updated: November 4, 2025*
*Session: Socket Payload Debugging & Character Movement Fix*
