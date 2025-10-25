# Galactic Map & Universe System - Complete Guide

## Overview

The Stringborn Universe features a 5000x5000 galactic space with real-time 2D physics simulation, multiplayer interaction, navigation system, and four domain-based starting hubs.

---

## Galactic Space

### Dimensions
- **Size:** 5000x5000 units
- **Physics:** 2D physics simulation with gravity, damping, noise
- **Movement:** Click-to-travel navigation with trajectory paths
- **Real-time:** All online players visible on map

### Coordinate System
- **Origin:** (0, 0) at top-left
- **X-axis:** 0 to 5000 (left to right)
- **Y-axis:** 0 to 5000 (top to bottom)
- **Center:** (2500, 2500)

---

## Space Hubs (Starting Locations)

### 1. Temporal Nexus Station
- **String Domain:** Time String
- **Species:** Silicates
- **Color:** Purple (#8b5cf6)
- **Location:** Top-Left Corner (500, 500)
- **Description:** Ancient time-manipulating station

### 2. Quantum Forge Complex
- **String Domain:** Tech String
- **Species:** Humans
- **Color:** Green (#34d399)
- **Location:** Top-Right Corner (4500, 500)
- **Description:** High-tech manufacturing hub

### 3. Celestial Sanctum
- **String Domain:** Faith String
- **Species:** Lanterns
- **Color:** Orange (#fb923c)
- **Location:** Bottom-Left Corner (500, 4500)
- **Description:** Spiritual sanctuary

### 4. Crimson Bastion
- **String Domain:** War String
- **Species:** Devan
- **Color:** Red (#ef4444)
- **Location:** Bottom-Right Corner (4500, 4500)
- **Description:** Military fortress

---

## Navigation System

### Click-to-Travel

**File:** [/srv/ps/public/javascripts/galactic-map-optimized.js](../public/javascripts/galactic-map-optimized.js)

```javascript
// Click map to set destination
canvas.addEventListener('click', (e) => {
  const worldPos = map.screenToWorld(e.clientX, e.clientY);

  // Send navigation request
  fetch(`/api/v1/characters/${character._id}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: { x: worldPos.x, y: worldPos.y }
    })
  });
});
```

### Trajectory Paths

- **Visual:** Arrow from current position to destination
- **Color:** String domain color
- **ETA Calculation:** Based on distance and travel speed
- **Auto-stop:** Character stops when reaching destination

### Navigation API

```
POST /api/v1/characters/:id/navigate
Body: {
  destination: { x: Number, y: Number }
}
Response: {
  character: Object,
  eta: Number,
  distance: Number
}

POST /api/v1/characters/:id/navigate/cancel
Response: {
  character: Object
}
```

---

## Docking System

### How It Works

Characters can dock at assets (hubs, planets, stations):

```javascript
// Dock at asset
POST /api/v1/characters/:id/dock
Body: { assetId: String }

// Undock
POST /api/v1/characters/:id/undock

// Navigate to asset (auto-dock on arrival)
POST /api/v1/characters/:id/navigate-to-asset
Body: { assetId: String }
```

### Docked State
- Character position matches asset position
- `location.assetId` set to asset ID
- `location.zone` set to asset name
- Cannot navigate while docked (must undock first)

### Undocked State
- Character in open space
- `location.assetId` is null
- Can freely navigate
- Position is independent coordinates

---

## Real-Time Multiplayer

**File:** [/srv/ps/plugins/socket/index.js](../plugins/socket/index.js)

### Online Player Registry

Server maintains a Map of all connected players:

```javascript
const onlinePlayers = new Map();

// Structure:
{
  socketId: String,
  characterId: String,
  characterName: String,
  userId: String,
  location: { x: Number, y: Number },
  assetId: String,
  joinedAt: Date
}
```

### Socket.IO Events

**Character Join:**
```javascript
// Client emits
socket.emit('characterJoin', {
  characterId: character._id,
  characterName: character.name,
  userId: user._id,
  location: character.location,
  assetId: character.location.assetId
});

// Server broadcasts
io.emit('characterJoined', { characterName });
io.emit('onlinePlayers', Array.from(onlinePlayers.values()));
io.emit('onlineCount', onlinePlayers.size);
```

**Character Movement:**
```javascript
// When character navigates
socket.emit('characterNavigate', {
  characterId,
  destination: { x, y },
  eta: Number
});

// Server broadcasts to all
io.emit('characterNavigating', {
  characterId,
  destination,
  eta
});
```

**Character Dock/Undock:**
```javascript
socket.emit('characterDock', { characterId, assetId });
socket.emit('characterUndock', { characterId });

// Server updates and broadcasts
io.emit('characterDocked', { characterId, assetId });
io.emit('characterUndocked', { characterId });
```

### Player Rendering

**Current Player:**
- Green glow (#34d399)
- Larger marker
- Always centered (if camera follows)

**Other Players:**
- Color-coded by String Domain
- Normal size marker
- Name label above marker

**Character ID Comparison:**
```javascript
// Important: Handle both _id and characterId fields
const isCurrentPlayer =
  character.characterId === this.currentCharacter?._id ||
  character.characterId === this.currentCharacter?.characterId;
```

---

## Map Features

### Zoom & Pan

```javascript
// Mouse wheel zoom
canvas.addEventListener('wheel', (e) => {
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  map.zoom *= zoomFactor;
  map.zoom = Math.max(0.1, Math.min(5, map.zoom));
});

// Click and drag to pan
let isDragging = false;
let dragStart = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStart = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    map.offset.x += dx;
    map.offset.y += dy;
    dragStart = { x: e.clientX, y: e.clientY };
  }
});
```

### Coordinate Conversion

```javascript
// World coordinates to screen pixels
function worldToScreen(worldX, worldY) {
  return {
    x: (worldX * map.zoom) + map.offset.x,
    y: (worldY * map.zoom) + map.offset.y
  };
}

// Screen pixels to world coordinates
function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - map.offset.x) / map.zoom,
    y: (screenY - map.offset.y) / map.zoom
  };
}
```

---

## Galactic State

**File:** [/srv/ps/api/v1/models/GalacticState.js](../api/v1/models/GalacticState.js)

### State Tracking

```javascript
{
  _id: ObjectId,
  timestamp: Date,
  activeEvents: [{
    eventId: String,
    eventType: String,
    location: { x: Number, y: Number },
    radius: Number,
    startTime: Date,
    endTime: Date
  }],
  controlledZones: [{
    zoneId: String,
    controllingFaction: String,
    controlPercent: Number
  }],
  onlinePlayerCount: Number,
  settings: {
    movementSpeed: Number,     // Default: 100
    gravity: Number,            // Default: 0.1
    damping: Number,            // Default: 0.98
    noise: Number               // Default: 0.01
  }
}
```

### API Endpoints

```
GET /api/v1/universe/galactic-state
Response: Current galactic state

PUT /admin/api/galactic-state/settings
Body: { movementSpeed, gravity, damping, noise }
Response: Updated state
```

---

## Planetary Grid System

**File:** [/srv/ps/api/v1/models/PlanetaryState.js](../api/v1/models/PlanetaryState.js)

### Grid Handoff

When exploring planets, characters can transition between adjacent grid cells:

```javascript
POST /api/v1/zones/handoff
Body: {
  characterId: String,
  fromGrid: { x: Number, y: Number },
  toGrid: { x: Number, y: Number },
  exitEdge: String  // 'north', 'south', 'east', 'west'
}
Response: {
  newZone: String,
  entryPosition: { x: Number, y: Number }
}
```

### Grid Structure
- Each planet divided into grid cells
- Seamless transitions between cells
- Exit one edge, enter opposite edge of adjacent cell
- Maintains exploration continuity

---

## Admin Controls

**Route:** `/admin/galactic-map`

### Map Settings

Admins can adjust physics parameters:

```javascript
// Movement Speed (50-200)
// Default: 100
// Higher = faster travel

// Gravity (0-1)
// Default: 0.1
// Higher = stronger pull toward center

// Damping (0.8-1.0)
// Default: 0.98
// Lower = more friction/slower deceleration

// Noise (0-0.1)
// Default: 0.01
// Higher = more randomness in movement
```

### Event Management

Admins can create galactic events:
- Location on map
- Radius of effect
- Event type
- Duration (start/end time)

---

## Routes

### View Routes
```
GET /universe/galactic-map
    Main 2D galactic map visualization
    Requires: Authenticated user with active character

GET /universe/tome
    Story/lore compendium
    Public access

GET /universe/planetary-grid
    Grid system information
    Public access

GET /universe/galactic-state (deprecated)
    ASCII text-based galactic state
    Use /galactic-map instead
```

### API Routes
```
GET  /api/v1/universe/galactic-state
     Get current galactic state

GET  /api/v1/universe/species
     Get all species data

GET  /api/v1/universe/talent-trees
     Get talent tree configurations

GET  /api/v1/universe/planetary-state
     Get planetary grid state

GET  /api/v1/universe/events
     Get active galactic events
```

---

## Performance Optimization

**File:** [/srv/ps/public/javascripts/galactic-map-optimized.js](../public/javascripts/galactic-map-optimized.js)

### Rendering Loop

```javascript
let lastFrameTime = performance.now();

function render() {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000; // seconds
  lastFrameTime = now;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render background
  renderStarfield();

  // Render hubs
  renderSpaceHubs();

  // Render players
  renderOnlinePlayers();

  // Render current character
  renderCurrentCharacter();

  // Render navigation path
  if (character.navigation?.isInTransit) {
    renderTrajectoryPath(character);
  }

  requestAnimationFrame(render);
}
render();
```

### Optimizations

- **Canvas-based rendering** (not DOM)
- **RequestAnimationFrame** for smooth 60 FPS
- **Culling** - Only render visible elements
- **Batching** - Group draw calls
- **Debouncing** - Throttle socket emissions

---

## Integration Example

```html
<!-- galactic-map.ejs -->
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/stylesheets/galactic-map.css">
</head>
<body>
  <canvas id="galactic-map"></canvas>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/javascripts/galactic-map-optimized.js"></script>

  <script>
    const socket = io();
    const user = <%- JSON.stringify(user) %>;
    const character = <%- JSON.stringify(character) %>;

    socket.on('connect', () => {
      // Initialize map
      const map = new GalacticMap('galactic-map', character, {
        zoom: 0.5,
        center: { x: 2500, y: 2500 }
      });

      // Connect socket
      map.connectSocket(socket);

      // Join universe
      socket.emit('characterJoin', {
        characterId: character._id,
        characterName: character.name,
        userId: user._id,
        location: character.location,
        assetId: character.location.assetId
      });

      // Listen for players
      socket.on('onlinePlayers', (players) => {
        map.updatePlayers(players);
      });
    });
  </script>
</body>
</html>
```

---

## Future Enhancements

- **3D visualization** - Three.js spatial view
- **Wormholes** - Fast travel between hubs
- **Anomalies** - Dynamic events on map
- **Fog of war** - Unexplored regions
- **Territory control** - Faction zones
- **Resource nodes** - Gatherable locations
- **Trade routes** - NPC traffic visualization
- **Weather systems** - Space phenomena
- **Mini-map** - Corner overview
- **Waypoints** - Save favorite locations

---

**Status:** ✅ Complete and Functional
**Route:** `/universe/galactic-map`
**Performance:** 60 FPS with 50+ online players

---

**Files Referenced:**
- Map Script: [/srv/ps/public/javascripts/galactic-map-optimized.js](../public/javascripts/galactic-map-optimized.js)
- Socket Handler: [/srv/ps/plugins/socket/index.js](../plugins/socket/index.js)
- Galactic State Model: [/srv/ps/api/v1/models/GalacticState.js](../api/v1/models/GalacticState.js)
- Character API: [/srv/ps/api/v1/characters/index.js](../api/v1/characters/index.js)
