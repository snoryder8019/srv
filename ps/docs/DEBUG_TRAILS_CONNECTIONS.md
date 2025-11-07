# Debug Guide - Trails & Connections Not Rendering

**Date:** November 5, 2025
**Status:** Debug Logging Added

---

## Debug Logs Added to Client

The following console logs will now appear in your browser DevTools:

### **Connection Lines:**

```
📡 Received 67 connections from server
🔗 Rendering 67 connection lines in galactic view
   Cleared 0 old connection lines
   Connection 0: 69000d03 → 6902f713, state: forming, distance: 1486
   Connection 1: 69000d03 → 69000d04, state: forming, distance: 1879
   Connection 2: 69000d03 → 6902f714, state: forming, distance: 2510
   ✅ Created 67 connection line objects
```

**OR** if something is wrong:

```
⚠️ No connections in physics update data
```

```
⚠️ Skipping connections render - not in galactic view (currentLevel: galaxy)
```

### **Orbital Trails:**

```
💜 Galaxy 69000d03: Trail with 60 positions
✨ Creating trail for 69000d03: 60 positions
```

**OR** if something is wrong:

```
⚠️ Galaxy 69000d03: No trail data yet
⚠️ Trail for 69000d03: Not enough history (1 positions)
⚠️ Skipping trail for 69000d03 - not in galactic view
```

---

## How to Debug

### **Step 1: Open DevTools**

```
F12 (Windows/Linux)
Cmd+Option+I (Mac)
```

### **Step 2: Clear Console**
Click the 🚫 icon or press Ctrl+L

### **Step 3: Hard Refresh**
```
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
```

### **Step 4: Watch for Logs**

You should see these logs **every second** (physics tick):

```
📡 Received 67 connections from server
🔗 Rendering 67 connection lines in galactic view
   ✅ Created 67 connection line objects

💜 Galaxy 69000d03: Trail with 60 positions
💜 Galaxy 69000d04: Trail with 60 positions
...  (34 total)
```

---

## Common Issues & Solutions

### **Issue 1: No Connection Logs**

**Symptom:**
```
⚠️ No connections in physics update data
```

**Cause:** Physics service not broadcasting connections

**Solution:**
```bash
# Check server logs
tmux attach -t ps
# Look for: "📡 galacticPhysicsUpdate emitted: ... connections=67"
# Press Ctrl+B then D to detach

# If connections=0, restart service
tmux kill-session -t ps
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"
```

### **Issue 2: Connection Logs But No Render**

**Symptom:**
```
🔗 Rendering 67 connection lines in galactic view
   ✅ Created 67 connection line objects
```
But no lines visible in scene.

**Possible Causes:**

**A. Camera Position**
- Lines might be behind camera
- **Solution:** Rotate camera 360°, zoom out

**B. Wrong Level**
```
⚠️ Skipping connections render - not in galactic view (currentLevel: galaxy)
```
- You're zoomed into a galaxy interior
- **Solution:** Press 'G' or click "Galactic View" button

**C. Lines Too Transparent**
- Opacity might be too low
- **Solution:** Already increased to 0.6-0.8, should be visible
- Check: Look from different angles

**D. Scene Graph Issue**
- Lines created but not added to scene
- **Solution:** Check `this.connectionsGroup` is added to scene

### **Issue 3: No Trail Logs**

**Symptom:**
```
⚠️ Galaxy 69000d03: No trail data yet
```

**Cause:** Service just started, position history building up

**Solution:** **Wait 10-60 seconds**
- T=0: No trails (need 2+ positions)
- T=10s: Short trails appear
- T=60s: Full trails visible

### **Issue 4: Trail Logs But No Render**

**Symptom:**
```
✨ Creating trail for 69000d03: 60 positions
```
But no purple trails visible.

**Possible Causes:**

**A. Not in Galactic View**
```
⚠️ Skipping trail for 69000d03 - not in galactic view
```
- **Solution:** Zoom out to galactic view

**B. Trails Behind Camera**
- Trails are 3D lines in space
- **Solution:** Rotate camera, zoom out

**C. Trails Too Faint**
- Opacity 0.9, should be visible
- **Solution:** Check from different angles, look near galaxies

**D. Trail Geometry Issue**
- Check console for THREE.js errors
- **Solution:** Hard refresh, clear browser cache

---

## Manual Verification Steps

### **Step 1: Verify Server Broadcast**

```bash
tmux attach -t ps
```

Look for (every second):
```
📡 galacticPhysicsUpdate emitted: galaxies=34, stars=0, connections=67, dockedChars=0, inTransit=0
```

Press `Ctrl+B` then `D` to detach.

### **Step 2: Verify Client Reception**

Open browser console, look for:
```
📡 Received 67 connections from server
```

If you DON'T see this, Socket.IO connection is broken.

### **Step 3: Verify Rendering Pipeline**

Look for:
```
🔗 Rendering 67 connection lines in galactic view
   ✅ Created 67 connection line objects
```

If you see "Created 67" but no lines visible → Camera/visibility issue

### **Step 4: Verify Scene Graph**

In browser console, run:
```javascript
window.galacticMap.connectionsGroup.children.length
// Should be: 67

window.galacticMap.galaxyOrbits.length
// Should be: 34
```

### **Step 5: Check Scene Rendering**

```javascript
window.galacticMap.scene.children.forEach(child => {
  console.log(child.name || child.type, child.children.length);
});
// Look for connectionsGroup and assetsGroup
```

---

## Expected Normal Output

After 60 seconds, browser console should show:

```
📡 Received 67 connections from server
🔗 Rendering 67 connection lines in galactic view
   Cleared 67 old connection lines
   Connection 0: 69000d03 → 6902f713, state: forming, distance: 1486
   Connection 1: 69000d03 → 69000d04, state: forming, distance: 1879
   Connection 2: 69000d03 → 6902f714, state: forming, distance: 2510
   ✅ Created 67 connection line objects

💜 Galaxy 69000d03: Trail with 60 positions
✨ Creating trail for 69000d03: 60 positions
💜 Galaxy 69000d04: Trail with 60 positions
✨ Creating trail for 69000d04: 60 positions
... (32 more)
```

And you should SEE:
- ✅ 67 blue dashed lines connecting galaxies/anomalies
- ✅ 34 purple trails behind each galaxy
- ✅ Lines update every second

---

## Emergency Reset

If nothing works:

### **1. Full Browser Reset**
```
1. Hard refresh: Ctrl+Shift+R
2. Clear cache: Ctrl+Shift+Delete → Clear cached images and files
3. Close browser completely
4. Reopen browser
5. Navigate to /universe/galactic-map-3d
```

### **2. Service Restart**
```bash
tmux kill-session -t ps
sleep 2
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"
sleep 5
```

### **3. Check Asset Counts**
```bash
node -e "
require('dotenv').config();
const { MongoClient } = require('mongodb');
async function check() {
  const client = new MongoClient(process.env.DB_URL);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'projectStringborne');
  const galaxies = await db.collection('assets').countDocuments({ assetType: 'galaxy' });
  console.log('Galaxies:', galaxies, '(should be 34)');
  await client.close();
}
check();
"
```

---

## What the Logs Tell You

| Log | Meaning |
|-----|---------|
| `📡 Received X connections` | Socket.IO working, data arriving |
| `🔗 Rendering X connection lines` | Render pipeline executing |
| `✅ Created X connection line objects` | Lines created successfully |
| `💜 Galaxy X: Trail with Y positions` | Trail data received |
| `✨ Creating trail for X: Y positions` | Trail geometry being created |
| `⚠️ No connections in physics update` | Server not sending connections |
| `⚠️ Skipping connections - not in galactic view` | You're zoomed in |
| `⚠️ No trail data yet` | Wait for position history to build |

---

## Next Steps

1. Open `/universe/galactic-map-3d`
2. Press F12 (DevTools)
3. Watch console logs
4. Report what you see:
   - Are connections being received? (📡)
   - Are connections being rendered? (🔗)
   - Are trails being received? (💜)
   - Are trails being created? (✨)
   - Any warnings? (⚠️)

**With these logs, we can pinpoint exactly where the rendering pipeline is failing!**

---

**Last Updated:** November 5, 2025
**Service:** ✅ Running with debug logging
**User Action:** Open DevTools, watch console, report findings
