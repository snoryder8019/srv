# Galactic Map 3D - Complete Repair Plan

## Current State Analysis

### ✅ What's Working
1. **THREE.js Initialization** - Map creates and renders
2. **Ray Casting** - Click detection working
3. **GameStateMonitor** - Exists and has interpolation logic
4. **Physics Service** - Server-side physics for characters exists
5. **Socket.IO** - Server listening for events

### ❌ What's Broken
1. **Socket.IO doesn't initialize on page load** - Requires login but no clear flow
2. **Chat doesn't load** - Depends on socket connection
3. **3D Coordinates** - Scene loads but physics not running server-side for galaxies
4. **Perpetual Polling** - No continuous state updates from server
5. **Galactic Orbit Physics** - Client-side only, not server-authoritative
6. **Physics not in GameStateMonitor** - Should be in service, not just client

## The Problem

### Current Flow (Broken)
```
Page Load
  → THREE.js loads
  → Map initializes
  → Assets fetch (but no socket yet)
  → User must be logged in for socket
  → Socket might never connect
  → Chat never initializes
  → No physics updates from server
  → Galaxies orbit in client only (not persistent)
```

### Desired Flow (Fixed)
```
Page Load
  → THREE.js loads
  → Map initializes
  → Socket.IO connects (with or without login)
  → GameStateMonitor initializes
  → Assets fetch with 3D coords
  → Server physics service broadcasts galaxy positions
  → Client receives updates via socket
  → Chat initializes (if logged in)
  → Perpetual polling keeps state fresh
  → Galaxies orbit around anomalies (server-authoritative)
```

## Repair Tasks

### 1. Socket.IO Initialization Fix
**Problem:** Socket only initializes if user logged in
**Solution:** Initialize socket for all users, but auth features require login

**Files to Modify:**
- `/srv/ps/views/universe/galactic-map-3d.ejs`

**Changes:**
```javascript
// BEFORE (lines 1724-1729)
<% if (user) { %>
const socket = io({...});
<% } %>

// AFTER - Socket for everyone, auth features conditional
const socket = io({
  auth: {
    userId: '<%= user ? user._id : null %>',
    username: '<%= user ? user.username : 'guest' %>'
  }
});

// Chat only if logged in
<% if (user) { %>
  socket.on('connect', async () => {
    // Initialize chat here
    if (typeof initGlobalChat === 'function') {
      window.globalChat = initGlobalChat(socket, userObj, character);
    }
  });
<% } %>
```

### 2. Server-Side Galactic Physics Service
**Problem:** Galaxy orbits only happen in client, not persistent
**Solution:** Add galactic physics to physics-service.js

**File to Modify:**
- `/srv/ps/services/physics-service.js`

**Add New Method:**
```javascript
/**
 * Update galactic physics - galaxies orbit anomalies
 */
async updateGalacticPhysics() {
  try {
    // Get all anomalies and galaxies
    const anomalies = await Asset.find({ assetType: 'anomaly' });
    const galaxies = await Asset.find({ assetType: 'galaxy' });

    // Physics constants
    const G = 50000; // Gravitational constant
    const ANOMALY_MASS = 1000000;
    const GALAXY_MASS = 100000;
    const MAX_VELOCITY = 5;
    const CAPTURE_DISTANCE = 800;

    // Update each galaxy
    for (const galaxy of galaxies) {
      if (!galaxy.physics) {
        galaxy.physics = { vx: 0, vy: 0, vz: 0 };
      }

      let totalForceX = 0;
      let totalForceY = 0;
      let totalForceZ = 0;

      // Calculate forces from nearby anomalies
      for (const anomaly of anomalies) {
        const dx = anomaly.coordinates.x - galaxy.coordinates.x;
        const dy = anomaly.coordinates.y - galaxy.coordinates.y;
        const dz = anomaly.coordinates.z - galaxy.coordinates.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        const dist = Math.sqrt(distSq);

        if (dist < CAPTURE_DISTANCE) {
          // Gravitational force: F = G * m1 * m2 / r^2
          const force = (G * ANOMALY_MASS * GALAXY_MASS) / (distSq + 1);

          // Direction unit vector
          const forceX = (dx / dist) * force;
          const forceY = (dy / dist) * force;
          const forceZ = (dz / dist) * force;

          totalForceX += forceX;
          totalForceY += forceY;
          totalForceZ += forceZ;
        }
      }

      // Apply forces to velocity (F = ma, assuming m = 1)
      const deltaTime = this.tickRate / 1000;
      galaxy.physics.vx += totalForceX * deltaTime;
      galaxy.physics.vy += totalForceY * deltaTime;
      galaxy.physics.vz += totalForceZ * deltaTime;

      // Clamp velocity
      const speed = Math.sqrt(
        galaxy.physics.vx**2 +
        galaxy.physics.vy**2 +
        galaxy.physics.vz**2
      );
      if (speed > MAX_VELOCITY) {
        const scale = MAX_VELOCITY / speed;
        galaxy.physics.vx *= scale;
        galaxy.physics.vy *= scale;
        galaxy.physics.vz *= scale;
      }

      // Update position
      galaxy.coordinates.x += galaxy.physics.vx * deltaTime;
      galaxy.coordinates.y += galaxy.physics.vy * deltaTime;
      galaxy.coordinates.z += galaxy.physics.vz * deltaTime;

      // Save to database
      await galaxy.save();
    }

    return galaxies.length;
  } catch (error) {
    console.error('Galactic physics error:', error);
    return 0;
  }
}
```

**Add to tick() method:**
```javascript
async tick() {
  try {
    // Update character physics
    const characters = await Character.getGalacticCharacters();
    // ... existing character physics

    // Update galactic physics (every tick)
    await this.updateGalacticPhysics();

  } catch (error) {
    console.error('Physics tick error:', error);
  }
}
```

### 3. Broadcast Galaxy Positions via Socket.IO
**Problem:** Client doesn't receive galaxy position updates
**Solution:** Emit galaxy positions from physics service

**File to Modify:**
- `/srv/ps/services/physics-service.js`

**Add After updateGalacticPhysics:**
```javascript
async tick() {
  try {
    // ... character physics

    // Update galactic physics
    const updatedGalaxies = await this.updateGalacticPhysics();

    // Broadcast to all connected clients
    if (updatedGalaxies.length > 0 && this.io) {
      this.io.emit('galacticPhysicsUpdate', {
        galaxies: updatedGalaxies.map(g => ({
          id: g._id,
          position: g.coordinates,
          velocity: g.physics
        })),
        timestamp: Date.now()
      });
    }

  } catch (error) {
    console.error('Physics tick error:', error);
  }
}
```

**Pass io to PhysicsService:**
In `/srv/ps/bin/www` or wherever physics service starts:
```javascript
import physicsService from '../services/physics-service.js';

// After socket.io setup
const io = initSockets(server);
physicsService.setIO(io);
physicsService.start();
```

### 4. Client-Side: Receive Galaxy Position Updates
**Problem:** Client doesn't listen for server physics updates
**Solution:** Add socket listener in galactic-map-3d

**File to Modify:**
- `/srv/ps/views/universe/galactic-map-3d.ejs`

**Add Socket Listener:**
```javascript
// Listen for galactic physics updates from server
socket.on('galacticPhysicsUpdate', (data) => {
  if (!window.galacticMap) return;

  // Update galaxy positions from server
  data.galaxies.forEach(galaxy => {
    const asset = window.galacticMap.assets.get(galaxy.id);
    if (asset && asset.mesh) {
      // Update mesh position
      asset.mesh.position.set(
        galaxy.position.x,
        galaxy.position.y,
        galaxy.position.z
      );

      // Store velocity for interpolation
      if (!asset.physics) asset.physics = {};
      asset.physics.vx = galaxy.velocity.vx;
      asset.physics.vy = galaxy.velocity.vy;
      asset.physics.vz = galaxy.velocity.vz;
    }
  });

  console.log(`🌌 Updated ${data.galaxies.length} galaxy positions from server`);
});
```

### 5. Perpetual Polling for State Sync
**Problem:** No continuous polling, state can drift
**Solution:** Add polling in GameStateMonitor

**File to Modify:**
- `/srv/ps/public/javascripts/GameStateMonitor.js`

**Add Polling Method:**
```javascript
startPolling() {
  // Poll server every 5 seconds for full state sync
  this.pollingInterval = setInterval(async () => {
    try {
      const response = await fetch('/api/v1/state/galactic-state');
      const data = await response.json();

      if (data.success) {
        // Update assets/galaxies
        if (data.galaxies) {
          data.galaxies.forEach(galaxy => {
            if (window.galacticMap) {
              const asset = window.galacticMap.assets.get(galaxy._id);
              if (asset && asset.mesh) {
                asset.mesh.position.set(
                  galaxy.coordinates.x,
                  galaxy.coordinates.y,
                  galaxy.coordinates.z
                );
              }
            }
          });
        }

        console.log('🔄 State synced from server');
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 5000);
}

// Call in init()
init(socket, currentCharacterId) {
  // ... existing code
  this.startPolling();
}
```

### 6. Create Galactic State API Endpoint
**Problem:** No API endpoint for polling
**Solution:** Add endpoint to fetch current galaxy positions

**File to Create:**
- `/srv/ps/api/v1/routes/galactic-state.js`

```javascript
import express from 'express';
import { Asset } from '../models/Asset.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const galaxies = await Asset.find({ assetType: 'galaxy' })
      .select('_id title coordinates physics')
      .lean();

    const anomalies = await Asset.find({ assetType: 'anomaly' })
      .select('_id title coordinates')
      .lean();

    res.json({
      success: true,
      galaxies,
      anomalies,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
```

**Add to routes in app.js:**
```javascript
import galacticStateRoutes from './api/v1/routes/galactic-state.js';
app.use('/api/v1/state/galactic-state', galacticStateRoutes);
```

## Implementation Order

1. ✅ **Socket.IO for all users** - Make socket work without login requirement
2. ✅ **Server-side galactic physics** - Add to physics-service.js
3. ✅ **Socket broadcasts** - Emit galaxy updates
4. ✅ **Client socket listener** - Receive and apply updates
5. ✅ **Perpetual polling** - Backup for state sync
6. ✅ **API endpoint** - For polling requests
7. ✅ **Test integration** - Verify everything works

## Expected Result

After repairs:
- ✅ Page loads, socket connects immediately
- ✅ Chat appears (if logged in)
- ✅ Galaxies load with 3D coordinates
- ✅ Server calculates galaxy orbits around anomalies
- ✅ Positions broadcast every 50ms via socket
- ✅ Client interpolates between updates smoothly
- ✅ Perpetual polling syncs state every 5 seconds
- ✅ Physics persistent across page reloads
- ✅ Multiplayer sees same galaxy positions

## Files to Modify Summary

1. `/srv/ps/views/universe/galactic-map-3d.ejs` - Socket init fix, listeners
2. `/srv/ps/services/physics-service.js` - Add galactic physics
3. `/srv/ps/public/javascripts/GameStateMonitor.js` - Add polling
4. `/srv/ps/api/v1/routes/galactic-state.js` - New endpoint (CREATE)
5. `/srv/ps/bin/www` - Pass io to physics service
6. `/srv/ps/app.js` - Register new route

Ready to implement?
