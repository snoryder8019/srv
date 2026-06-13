# Socket Not Connecting on Galactic-Map-3D - Diagnostic Guide

## The Issue

The socket debugger page shows:
```
🔍 Socket Payload Debugger initialized
Socket: Object { connected: true, ... }
```

But on galactic-map-3d, you don't see similar logs. This means the socket isn't connecting on the actual 3D map page.

---

## Expected Console Logs on galactic-map-3d

When the page loads, you should see these logs **in order**:

### 1. Socket.IO Library Load
```
🔍 Socket.IO setup section reached! user=true
🔌 Initializing Socket.IO connection (logged in user)...
🔍 typeof io: function
✅ Socket object created: Socket { ... }
```

### 2. Socket Connection
```
✅ Socket.IO CONNECTED! ID: abc123xyz
```

### 3. GameStateMonitor Init
```
🎮 GameStateMonitor initialized for galactic-map-3d (AUTHORITATIVE)
```

### 4. Socket Initialized with Map
```
✅ Socket initialized with galactic map
```

### 5. Character Join Event
```
📡 Character join event emitted
```

### 6. Physics Updates Start
```
🔔 galacticPhysicsUpdate EVENT FIRED! { hasData: true, characterCount: 1 }
⚡ handleServerPhysicsUpdate CALLED { galaxies: 13, characters: 1 }
```

---

## Diagnostic Steps

### Step 1: Open Browser Console

On galactic-map-3d page, open DevTools console (F12) and look for:

**✅ If you see:**
```
✅ Socket.IO CONNECTED! ID: ...
```
→ Socket is working! Skip to Step 3

**❌ If you DON'T see that:**
→ Socket failed to connect, continue to Step 2

### Step 2: Check for Errors

Look for RED errors in console:

**Common errors:**

1. **`io is not defined`**
   - Socket.IO library didn't load
   - Check Network tab for `/socket.io/socket.io.js` - should be 200
   - Hard refresh page: `Ctrl+Shift+R` (3 times)

2. **`Failed to load resource: net::ERR_CONNECTION_REFUSED`**
   - Server not running on port 3399
   - Check: `lsof -ti:3399` should show process IDs

3. **`Socket.IO connection error: ...`**
   - Server running but Socket.IO endpoint not working
   - Check server logs for errors

4. **`Cannot read property 'initializeSocket' of undefined`**
   - GalacticMap3D not created yet
   - Should auto-retry every 100ms, but check if map created

### Step 3: Check Character Join

If socket connected but no physics updates:

**Look for:**
```
📡 Character join event emitted
```

**If missing:**
- `window.currentCharacter` might be undefined
- Check if you're logged in and have an active character
- Check console for: `⚠️ No active character found`

### Step 4: Check Physics Updates

If socket connected and character joined, but no updates:

**Look for:**
```
🔔 galacticPhysicsUpdate EVENT FIRED!
```

**If missing:**
- Server might not be broadcasting
- Check if you're the only user (filter by characterId)
- Open debug-socket-payloads.html in another tab - is it receiving updates?

---

## Quick Tests

### Test 1: Check Socket in Console

Open galactic-map-3d and run in console:
```javascript
window.socket
```

**Expected:**
```
Socket { connected: true, id: "abc123..." }
```

**If undefined or `connected: false`:**
→ Socket not initialized or failed to connect

### Test 2: Check Galactic Map

```javascript
window.galacticMap
```

**Expected:**
```
GalacticMap3D { scene: Scene, camera: Camera, ... }
```

**If undefined:**
→ Map didn't initialize, check for errors earlier in console

### Test 3: Check Character

```javascript
window.currentCharacter
```

**Expected:**
```
{ _id: "...", name: "Faithbender", location: {...} }
```

**If undefined:**
→ Not logged in or no active character

### Test 4: Manually Emit Character Join

```javascript
if (window.socket && window.currentCharacter) {
  window.socket.emit('characterJoin', {
    characterId: window.currentCharacter._id,
    characterName: window.currentCharacter.name,
    userId: window.currentUser._id,
    location: window.currentCharacter.location
  });
  console.log('✅ Manually emitted characterJoin');
}
```

**Then check server logs:**
```bash
tail -20 /tmp/ps-server.log | grep "Character joined"
```

Should see:
```
🎯 Character joined: 68f1c627... name: Faithbender userId: ...
```

### Test 5: Check if Events Are Being Received

```javascript
// Add debug listener
window.socket.on('galacticPhysicsUpdate', (data) => {
  console.log('🔥 DEBUG: Received physics update!', {
    galaxies: data.galaxies?.length,
    characters: data.characters?.length,
    connections: data.connections?.length
  });
});
```

Wait a few seconds. Should see updates every ~1 second.

---

## Common Issues & Solutions

### Issue 1: Hard-Coded Socket Path

Some browsers cache Socket.IO connection.

**Solution:**
1. Hard refresh: `Ctrl+Shift+R` (3-5 times)
2. Clear cache: DevTools → Application → Clear Storage → Clear site data
3. Reload page

### Issue 2: Multiple Socket Instances

The page has 3 socket initializations (lines 3568, 3760, 4637).

**Check which one is active:**
```javascript
// They should all reference the same socket
window.socket === window.emergencySocket  // Should be same object
```

**If they're different:**
→ Multiple socket connections causing conflicts

### Issue 3: Socket.IO Version Mismatch

Client and server using different Socket.IO versions.

**Check versions:**

Client (in browser console):
```javascript
io.version
```

Server (check package.json):
```bash
grep socket.io /srv/ps/package.json
```

Should match major version (e.g., both 4.x.x)

### Issue 4: CORS / Domain Issues

If running on different domain/port than expected.

**Check:**
```javascript
window.location.origin  // Should be http://localhost:3399 or your domain
```

**Server CORS config** (in socket init):
```javascript
cors: {
  origin: process.env.CORS_ORIGIN || '*'
}
```

### Issue 5: Character Not at Galactic Level

Character might be at system/planet level, not galactic.

**Check:**
```javascript
window.currentCharacter.location.type
```

**Expected:** `"galactic"`

**If `"system"` or `"planetary"`:**
→ Character won't be broadcast in galacticPhysicsUpdate

---

## Emergency Socket Workaround

If all else fails, there's an emergency socket on line 4637:

```javascript
window.emergencySocket
```

This should connect and log:
```
✅✅✅ EMERGENCY SOCKET CONNECTED! ID: ...
```

If even this doesn't work, the Socket.IO server endpoint is completely broken.

---

## Verification Checklist

Mark each as you verify:

- [ ] Page loads without JavaScript errors
- [ ] Socket.IO library loaded (`typeof io === 'function'`)
- [ ] Socket created (`window.socket` exists)
- [ ] Socket connected (`window.socket.connected === true`)
- [ ] Logged in user (`window.currentUser` exists)
- [ ] Active character (`window.currentCharacter` exists)
- [ ] Character at galactic level (`location.type === 'galactic'`)
- [ ] GalacticMap created (`window.galacticMap` exists)
- [ ] Socket initialized with map (`galacticMap.socket` exists)
- [ ] GameStateMonitor initialized (`window.gameStateMonitor` exists)
- [ ] Character join emitted (see log: `📡 Character join event emitted`)
- [ ] Server sees join (check `/tmp/ps-server.log`)
- [ ] Physics updates received (see log: `🔔 galacticPhysicsUpdate EVENT FIRED!`)

If ALL are checked ✅ but scene still not updating:
→ Issue is in `updatePlayerPosition` (but we already fixed that!)

If ANY are ❌:
→ That's where the problem is

---

## Next Steps

1. **Open galactic-map-3d**
2. **Open browser console (F12)**
3. **Look for the logs listed above**
4. **Run the Quick Tests**
5. **Report back which logs you DO see and which you DON'T see**

Based on what's missing, we can pinpoint exactly where the connection is failing.

---

*Created: November 4, 2025*
*Issue: Socket not showing as connected on galactic-map-3d page*
*Purpose: Diagnose why socket connection differs from debug page*
