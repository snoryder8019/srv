# Character Rendering Debug Guide

**Last Updated**: 2025-11-04 03:45 UTC

## Current Issue

Characters appear in real-time on `/version-check.html` but NOT on `/universe/galactic-map-3d`.

## What We Know

✅ **Socket.IO is working** - version-check.html receives `galacticPhysicsUpdate` events with character data
✅ **Server is broadcasting** - Physics service sends 3 characters every second
✅ **Galaxies render correctly** - 13 galaxies load successfully on galactic-map-3d
❌ **Characters don't render** - No character pins appear on the 3D map
❌ **No debug logs** - None of the expected debug logs appear in console

## Most Likely Cause

**Browser Cache**: Your browser is running an OLD version of `galactic-map-3d.js` that doesn't have the new debugging code.

## Debugging Steps

### Step 1: Hard Refresh the Browser

1. Open the galactic map: `https://ps.madladslab.com/universe/galactic-map-3d`
2. Open DevTools (F12)
3. Go to Console tab
4. **Hard Refresh**: Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
5. Watch the console output

### Step 2: Expected Console Output

After hard refresh, you should see these NEW logs (if code is updated):

```
🔔 galacticPhysicsUpdate EVENT FIRED! {hasData: true, hasCharacters: true, characterCount: 3, timestamp: "..."}
⚡ handleServerPhysicsUpdate CALLED {hasData: true, galaxies: 13, stars: 0, characters: 3, connections: 0}
📦 Received 3 characters: ["Faithbender @ Cosmic Nexus", ...]
📦 Full character data: [{...}, {...}, {...}]
🎯 About to create pin for Faithbender at (x, y, z)
✅ Pin created for Faithbender:
   - Players Map size: 1
   - PlayersGroup children: 1
   - Pin exists in map: true
   - Pin position: Vector3 {x: ..., y: ..., z: ...}
   - Pin visible: true
   - PlayersGroup visible: true
   - In scene hierarchy: true
🎬 Camera state:
   - Position: Vector3 {x: ..., y: ..., z: ...}
   - Looking at: Vector3 {x: ..., y: ..., z: ...}
   - Zoom: 1
```

### Step 3: Diagnose Based on Output

#### Scenario A: No New Logs Appear
**Problem**: Browser still has cached JavaScript
**Solution**:
1. Open DevTools → Application tab → Storage → Clear site data
2. Close and reopen the tab
3. Visit the page again

#### Scenario B: EVENT FIRED but No Characters
```
🔔 galacticPhysicsUpdate EVENT FIRED! {hasData: true, hasCharacters: false, characterCount: 0}
```
**Problem**: Server not sending character data to this client
**Solution**: Check server logs for character broadcasting

#### Scenario C: Characters Received but Not Visible
```
✅ Pin created for Faithbender:
   - Pin visible: true
   - PlayersGroup visible: true
   - In scene hierarchy: true
```
**Problem**: Pins created but not in view
**Solution**: Camera positioning issue - check camera target

#### Scenario D: All Logs Show Success but Still Can't See
**Problem**: Character pins are too far from camera or too small
**Action**:
1. Note the pin positions from console
2. Compare to camera position
3. Calculate distance
4. Zoom out or navigate to pin location

## Quick Tests

### Test 1: Verify Socket Connection
Visit: `https://ps.madladslab.com/version-check.html`
Expected: Characters appear in real-time ✅

### Test 2: Verify Cache Status
Visit: `https://ps.madladslab.com/cache-test.html`
Expected: Socket updates show characters ✅

### Test 3: Verify Updated Code
Open DevTools → Sources → `galactic-map-3d.js` → Search for "🔔 galacticPhysicsUpdate EVENT FIRED"
Expected: This log should exist in the file

## Files Modified (Session Nov 4)

1. `/srv/ps/public/javascripts/galactic-map-3d.js`
   - Added event firing log at line ~2786
   - Added handler entry log at line ~2327
   - Added character processing logs at line ~2392+
   - Added pin creation verification at line ~2400+
   - Added camera state logging at line ~2417+

2. `/srv/ps/services/physics-service.js`
   - Removed offset calculations
   - Added `dockedGalaxyName` to character payload
   - Added galaxy name lookup from cache

## Contact Points

If you still don't see characters after hard refresh:

1. Share full console output (from page load to 5 seconds after)
2. Share Network tab showing `galactic-map-3d.js` load (should NOT say "from cache")
3. Share any error messages in console

## Expected Behavior

After all fixes:
- Characters appear as pins near their galaxies (150-250 units away)
- Each pin has an orb, ring, and label
- Pins update position in real-time as characters move
- Console shows character count and galaxy names every second
