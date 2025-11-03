# 3D State Manager Integration - Z Coordinates

**Date:** October 27, 2025
**Status:** ✅ Complete - Full 3D coordinate support in state manager

---

## Summary

Added complete 3D coordinate support (X, Y, Z) to the game state manager and character tracking system. Characters and ships now have Z-axis positioning and velocity, enabling accurate 3D visualization on the galactic map.

---

## Changes Made

### 1. Character Model - Z Coordinate Support ✅

**File:** `/srv/ps/api/v1/models/Character.js`

#### Location Field (lines 117-129)

**Before:**
```javascript
location: {
  type: 'galactic',
  x: spawnLocation.x,
  y: spawnLocation.y,  // Only 2D
  vx: 0,
  vy: 0,              // Only 2D velocity
  zone: homeHub.name,
  assetId: null,
  lastUpdated: new Date()
}
```

**After:**
```javascript
location: {
  type: 'galactic',
  x: spawnLocation.x,
  y: spawnLocation.y,
  z: spawnLocation.z || 0, // 3D coordinate for galactic map
  vx: 0,
  vy: 0,
  vz: 0,                   // Z-axis velocity
  zone: homeHub.name,
  assetId: null,
  lastUpdated: new Date()
}
```

#### Update Location Method (lines 170-191)

**Before:**
```javascript
static async updateLocation(characterId, locationData) {
  const updateData = {
    'location.x': locationData.x,
    'location.y': locationData.y,      // Only 2D
    'location.vx': locationData.vx ?? 0,
    'location.vy': locationData.vy ?? 0, // Only 2D velocity
    'location.lastUpdated': new Date(),
    updatedAt: new Date()
  };
  // ...
}
```

**After:**
```javascript
static async updateLocation(characterId, locationData) {
  const updateData = {
    'location.x': locationData.x,
    'location.y': locationData.y,
    'location.z': locationData.z ?? 0,    // 3D coordinate
    'location.vx': locationData.vx ?? 0,
    'location.vy': locationData.vy ?? 0,
    'location.vz': locationData.vz ?? 0,  // Z-axis velocity
    'location.lastUpdated': new Date(),
    updatedAt: new Date()
  };
  // ...
}
```

#### Navigation Distance Calculation (lines 198-207)

**Before:**
```javascript
const dx = destination.x - character.location.x;
const dy = destination.y - character.location.y;
const distance = Math.sqrt(dx * dx + dy * dy); // 2D distance
```

**After:**
```javascript
const dx = destination.x - character.location.x;
const dy = destination.y - character.location.y;
const dz = (destination.z || 0) - (character.location.z || 0);
const distance = Math.sqrt(dx * dx + dy * dy + dz * dz); // 3D distance
```

---

### 2. 3D Galactic Map - Character Rendering ✅

**File:** `/srv/ps/public/javascripts/galactic-map-3d.js`

#### New Method: `fetchCharacters()`

```javascript
/**
 * Fetch characters from database for 3D positioning
 */
async fetchCharacters() {
  try {
    const response = await fetch('/api/v1/characters');
    const data = await response.json();

    console.log(`🚀 Fetched ${data.characters.length} characters`);

    // Update or add characters to the map
    data.characters.forEach(character => {
      if (character.location && character.location.x !== undefined) {
        const charData = {
          _id: character._id,
          title: character.name,
          assetType: 'ship', // Show as ship icon (blue sphere)
          coordinates: {
            x: character.location.x,
            y: character.location.y,
            z: character.location.z || 0 // Use Z coordinate!
          },
          stats: {
            velocity: {
              x: character.location.vx || 0,
              y: character.location.vy || 0,
              z: character.location.vz || 0
            }
          }
        };

        if (this.assets.has(character._id)) {
          // Update existing position
          this.updateAssetPosition(character._id, charData.coordinates);
        } else {
          // Add new character
          this.addAsset(charData);
        }
      }
    });

  } catch (error) {
    console.error('Failed to fetch characters:', error);
  }
}
```

#### Updated: `startStateManagerSync()`

```javascript
startStateManagerSync() {
  console.log('🔄 Starting state manager sync for orbital bodies and characters...');

  // Initial fetch
  this.fetchOrbitalBodies();
  this.fetchCharacters();  // ← NEW: Fetch characters too

  // Poll for updates every 10 seconds
  this.stateManagerInterval = setInterval(() => {
    this.fetchOrbitalBodies();
    this.fetchCharacters();  // ← NEW: Update characters too
  }, 10000);
}
```

---

## How It Works

### Character Positioning Flow

```
1. Character moves in game
   ↓
2. Character.updateLocation() called with {x, y, z, vx, vy, vz}
   ↓
3. MongoDB updated with new 3D position
   ↓
4. 3D Galactic Map polls /api/v1/characters every 10 seconds
   ↓
5. fetchCharacters() retrieves all characters with Z coordinates
   ↓
6. Characters rendered as blue spheres in 3D space
   ↓
7. updateAssetPosition() moves existing characters smoothly
```

### Data Structure

**Character in Database:**
```json
{
  "_id": "...",
  "name": "Captain Nova",
  "location": {
    "type": "galactic",
    "x": 150.5,
    "y": 200.3,
    "z": 50.0,     // ← 3D coordinate
    "vx": 2.5,
    "vy": -1.0,
    "vz": 0.5,     // ← Z velocity
    "zone": "Core Worlds",
    "lastUpdated": "2025-10-27T..."
  }
}
```

**Character on 3D Map:**
```javascript
{
  _id: "...",
  title: "Captain Nova",
  assetType: "ship",         // Rendered as blue sphere
  coordinates: {
    x: 150.5,
    y: 200.3,
    z: 50.0                  // ← Position in 3D space
  },
  stats: {
    velocity: {
      x: 2.5,
      y: -1.0,
      z: 0.5                 // ← Can be used for trails/motion blur
    }
  }
}
```

---

## Features Enabled

### 1. Real-Time Character Tracking

Characters appear on the galactic map as **blue spheres** that:
- ✅ Show current 3D position
- ✅ Update every 10 seconds
- ✅ Move smoothly between positions
- ✅ Can be clicked to select and focus camera

### 2. 3D Navigation

Characters can now:
- ✅ Move in all 3 dimensions (X, Y, Z)
- ✅ Set destination with Z coordinate
- ✅ Calculate accurate 3D distance
- ✅ Display correct ETA for 3D travel

### 3. Velocity Tracking

System tracks:
- ✅ **vx** - Velocity in X direction
- ✅ **vy** - Velocity in Y direction
- ✅ **vz** - Velocity in Z direction

**Future uses:**
- Motion trails
- Predictive positioning
- Collision avoidance
- Intercept calculations

---

## API Integration

### Update Character Position

**Endpoint:** `Character.updateLocation(characterId, locationData)`

**Request:**
```javascript
await Character.updateLocation(characterId, {
  x: 150.5,
  y: 200.3,
  z: 50.0,      // ← Z coordinate
  vx: 2.5,
  vy: -1.0,
  vz: 0.5,      // ← Z velocity
  zone: "Core Worlds"
});
```

**Response:**
```javascript
true // Success
```

### Set Navigation Destination

**Endpoint:** `Character.setDestination(characterId, destination)`

**Request:**
```javascript
await Character.setDestination(characterId, {
  x: 300,
  y: 400,
  z: 100  // ← 3D destination
});
```

**Calculation:**
```javascript
// Calculates 3D distance
const dx = 300 - 150.5 = 149.5
const dy = 400 - 200.3 = 199.7
const dz = 100 - 50.0 = 50.0

const distance = √(149.5² + 199.7² + 50.0²)
               = √(22350.25 + 39880.09 + 2500)
               = √64730.34
               = 254.4 units

const eta = 254.4 / travelSpeed
```

### Fetch Characters for Map

**Endpoint:** `GET /api/v1/characters`

**Response:**
```json
{
  "success": true,
  "characters": [
    {
      "_id": "...",
      "name": "Captain Nova",
      "location": {
        "x": 150.5,
        "y": 200.3,
        "z": 50.0,
        "vx": 2.5,
        "vy": -1.0,
        "vz": 0.5,
        "zone": "Core Worlds"
      }
    }
  ]
}
```

---

## Visual Representation

### On 3D Galactic Map

**Character appears as:**
- 🔵 **Blue sphere** (ship icon)
- **Size:** 2 units (default ship size)
- **Glow:** Blue glow effect (1.5× sphere size)
- **Update frequency:** Every 10 seconds
- **Clickable:** Yes - focuses camera and shows details

### Color Coding

| Asset Type | Color | Description |
|------------|-------|-------------|
| Ship/Character | 🔵 Blue | Player ships and characters |
| Planet | 🟢 Green | Celestial bodies |
| Star | 🟡 Yellow | Solar bodies |
| Station | 🟠 Orange | Space stations |
| Orbital | 🟠 Orange | Moons, satellites |

---

## Testing

### Verify Z Coordinate Support

1. **Create/Update Character:**
```javascript
const char = await Character.create({
  userId: "...",
  name: "Test Character",
  stringDomain: "Time String"
});

// Character automatically gets z: 0 at spawn location
console.log(char.location.z); // 0
```

2. **Move Character in 3D:**
```javascript
await Character.updateLocation(charId, {
  x: 100,
  y: 200,
  z: 50    // ← Set Z coordinate
});
```

3. **View on 3D Map:**
- Navigate to `/universe/galactic-map-3d`
- Look for blue sphere at (100, 200, 50)
- Click to select and camera will focus on it

4. **Check Console:**
```
🚀 Fetched 6 characters
✅ Adding ship: Test Character at (100.0, 200.0, 50.0)
```

---

## Backward Compatibility

### Existing Characters

Characters created before this update:
- ✅ Automatically get `z: 0` (flat plane)
- ✅ Still render correctly on map
- ✅ Can be moved to Z coordinates via `updateLocation()`

### Migration

No migration needed! The code handles:
```javascript
z: spawnLocation.z || 0    // Defaults to 0 if not present
z: locationData.z ?? 0     // Defaults to 0 if not provided
```

---

## Future Enhancements

### 1. Real-Time Movement

Instead of 10-second polling, use WebSocket:

```javascript
socket.on('character:moved', (charId, position) => {
  map.updateAssetPosition(charId, position);
});
```

### 2. Movement Prediction

Use velocity to predict position between updates:

```javascript
// In animate() loop
const timeDelta = (Date.now() - lastUpdate) / 1000;
predictedPos.x = lastPos.x + velocity.x * timeDelta;
predictedPos.y = lastPos.y + velocity.y * timeDelta;
predictedPos.z = lastPos.z + velocity.z * timeDelta;
```

### 3. Motion Trails

Show path history using velocity:

```javascript
// Add trail renderer
const trail = new THREE.TrailRenderer(mesh, scene, {
  length: 20,
  color: 0x00aaff
});
```

### 4. Formation Flying

Multiple ships maintain relative Z positions:

```javascript
const formation = {
  leader: { x: 100, y: 200, z: 50 },
  wingman1: { x: 90, y: 190, z: 55 },  // +5 Z offset
  wingman2: { x: 110, y: 190, z: 55 }  // +5 Z offset
};
```

### 5. Altitude Indicators

Show Z-height with visual cues:

```javascript
// Add altitude line from character to XY plane
const line = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(x, y, 0)  // Down to Z=0
  ]),
  new THREE.LineDashedMaterial({ color: 0x00aaff })
);
```

---

## Performance Considerations

### Polling Frequency

Current: **10 seconds**

**Why?**
- ✅ Balances real-time vs server load
- ✅ Good enough for galactic-scale movement
- ✅ Matches orbital body sync frequency

**Adjust if needed:**
```javascript
// Faster updates (5 seconds)
setInterval(() => {
  this.fetchCharacters();
}, 5000);

// Slower updates (30 seconds)
setInterval(() => {
  this.fetchCharacters();
}, 30000);
```

### Network Traffic

**Per sync cycle:**
- Characters endpoint: ~2-10 KB
- 6 characters × 10 seconds = minimal bandwidth
- Can cache unchanged positions

---

## Success Metrics

✅ **Character Model** - Z coordinate and velocity added
✅ **Update Methods** - Support 3D position updates
✅ **Distance Calculations** - Use 3D math
✅ **3D Map Integration** - Characters render with Z coordinates
✅ **Real-Time Sync** - Updates every 10 seconds
✅ **Backward Compatible** - Defaults to Z=0 if not present

---

## Console Output

### Expected Output

```
🔄 Starting state manager sync for orbital bodies and characters...
📡 Fetching assets from API...
🚀 Fetched 6 characters
✅ Adding ship: Captain Nova at (150.5, 200.3, 50.0)
✅ Adding ship: Commander Blaze at (200.0, 300.0, 75.0)
✅ Added to scene. Assets in group: 12, Total tracked: 6
```

---

**Status:** ✅ Complete - Full 3D coordinate support
**Next:** Real-time WebSocket updates for instant position changes

---

**End of 3D State Manager Integration Document**
