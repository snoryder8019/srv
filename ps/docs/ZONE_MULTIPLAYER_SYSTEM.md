# Zone-Based Multiplayer System

**Date**: 2025-11-04
**Status**: 🚧 IN PROGRESS

## Summary

Implementing a zone-based multiplayer system with Socket.IO to separate zone-level gameplay from galactic-level navigation. This allows players to interact in interior zones (like the Primordial Singularity) while offloading zone state management from the main game state service.

## Architecture

### Two-Level Location System

**Galactic Level** (Game State Service):
- Player ships navigating between stars/planets/anomalies
- Large-scale coordinates (x, y, z in galactic space)
- Physics simulation for ship movement
- Handled by existing game-state-service

**Zone Level** (Zone Monitor Service):
- Player characters inside zones (interiors, dungeons, stations)
- Small-scale coordinates (x, y in tile-based grid)
- 2D movement, collision detection
- NEW zone-specific Socket.IO rooms

### Location Types

**Character.location Structure**:

```javascript
// Type 1: Galactic location (ship in space)
{
  type: 'galactic',
  x: 2500,        // Galactic coordinates
  y: 2500,
  z: 0,
  vx: 10,         // Velocity
  vy: 5,
  vz: 0,
  lastUpdated: Date
}

// Type 2: Zone location (character in interior)
{
  type: 'zone',
  zoneId: ObjectId('...'),  // Reference to zone asset
  zoneName: 'Starship Colony',
  x: 32.5,        // Tile coordinates in zone
  y: 18.2,
  z: 0,           // Floor level (for multi-level zones)
  vx: 0,          // Movement velocity
  vy: 0,
  lastUpdated: Date
}
```

## Character Model Changes

**File**: [Character.js](../api/v1/models/Character.js:730-923)

### New Methods

#### enterZone(characterId, zoneId, spawnPoint)
Moves character from galactic space into a zone.

```javascript
await Character.enterZone(characterId, zoneId, { x: 32, y: 16 });
```

**Behavior**:
1. Fetches zone data from assets collection
2. Finds player spawn point from zone.Data.spawnPoints
3. Fallback to zone center if no spawn found
4. Updates character.location to zone-based
5. Returns updated character

#### exitZone(characterId, galacticCoords)
Moves character from zone back to galactic space.

```javascript
await Character.exitZone(characterId, { x: 2500, y: 2500, z: 0 });
```

**Behavior**:
1. Gets character's current zone
2. Uses provided coords or parent asset's location
3. Updates character.location back to galactic
4. Returns updated character

#### updateZonePosition(characterId, position)
Updates character's position within a zone.

```javascript
await Character.updateZonePosition(characterId, {
  x: 32.5,
  y: 18.2,
  vx: 0.1,
  vy: 0
});
```

**Behavior**:
- Updates location.x, location.y
- Optionally updates vx, vy, z
- Faster than full character update
- Used for real-time movement

#### getCharactersInZone(zoneId)
Gets all characters currently in a specific zone.

```javascript
const players = await Character.getCharactersInZone(zoneId);
// Returns: [{ _id, userId, name, species, level, location }]
```

**Use Cases**:
- Showing other players in zone
- Zone-wide events
- Leaderboards
- Quest objectives

## Socket.IO Events

**File**: [socket/index.js](../plugins/socket/index.js:326-448)

### Zone Entry

**Client → Server**:
```javascript
socket.emit('zone:enter', {
  characterId: '...',
  characterName: 'Player1',
  zoneId: '690a866929c03e47b2000123',
  zoneName: 'Starship Colony',
  x: 32,
  y: 16
});
```

**Server Behavior**:
1. Joins socket to room `zone:${zoneId}`
2. Updates onlinePlayers registry
3. Broadcasts to other players in zone
4. Sends list of existing players

**Server → Client**:
```javascript
// To entering player
socket.emit('zone:playersInZone', [
  { characterId, characterName, x, y, ... }
]);

// To other players in zone
socket.emit('zone:playerJoined', {
  characterId, characterName, x, y, timestamp
});
```

### Zone Exit

**Client → Server**:
```javascript
socket.emit('zone:exit', {
  characterId: '...',
  zoneId: '...',
  galacticLocation: { x, y, z }
});
```

**Server Behavior**:
1. Leaves socket room `zone:${zoneId}`
2. Broadcasts to remaining players
3. Updates onlinePlayers to galactic location

**Server → Client**:
```javascript
socket.emit('zone:playerLeft', {
  characterId, characterName, timestamp
});
```

### Zone Movement

**Client → Server** (throttled, ~10x/second):
```javascript
socket.emit('zone:move', {
  characterId: '...',
  x: 32.5,
  y: 18.2,
  vx: 0.1,
  vy: 0
});
```

**Server → Other Clients in Zone**:
```javascript
socket.emit('zone:playerMoved', {
  characterId, x, y, vx, vy, timestamp
});
```

### Zone Chat

**Client → Server**:
```javascript
socket.emit('zone:chat', {
  characterId: '...',
  characterName: '...',
  message: 'Hello!'
});
```

**Server → All Clients in Zone**:
```javascript
socket.emit('zone:chatMessage', {
  characterId, characterName, message, timestamp
});
```

### Zone Actions

**Client → Server**:
```javascript
socket.emit('zone:action', {
  characterId: '...',
  action: 'interact',
  targetId: 'npc_123',
  targetType: 'npc'
});
```

**Server → Other Clients**:
```javascript
socket.emit('zone:playerAction', {
  characterId, characterName, action, targetId, targetType, timestamp
});
```

## Socket Rooms

Socket.IO rooms provide isolated channels for each zone.

### Room Naming Convention
```
zone:{zoneId}
```

**Example**:
```
zone:690a866929c03e47b2000123
zone:690a866929c03e47b2000456
```

### Benefits

1. **Isolation**: Players only receive events from their current zone
2. **Scalability**: Reduces bandwidth (not broadcasting to all players)
3. **Performance**: Server only sends to relevant clients
4. **Privacy**: Zone chat doesn't leak to other zones

### Room Management

```javascript
// Join zone room
socket.join('zone:690a866929c03e47b2000123');

// Leave zone room
socket.leave('zone:690a866929c03e47b2000123');

// Broadcast to room
socket.to('zone:690a866929c03e47b2000123').emit('event', data);

// Broadcast to room including sender
io.to('zone:690a866929c03e47b2000123').emit('event', data);
```

## Zone Monitor Service (Planned)

**Purpose**: Dedicated service for zone-level state management.

### Why Separate Service?

**Game State Service** (existing):
- Handles galactic-level physics
- Ship movement, orbital mechanics
- Asset positions in 3D space
- Already at capacity

**Zone Monitor Service** (new):
- Handles zone-level state
- Player positions in zones
- Zone-specific events
- NPCs, loot spawns, combat
- Reduces load on game state service

### Responsibilities

1. **Zone State**:
   - Track players in each zone
   - NPC positions and AI
   - Loot spawns and despawns
   - Environmental hazards

2. **Physics** (2D):
   - Collision detection with walls
   - Player movement validation
   - Projectile trajectories
   - Area effects

3. **Persistence**:
   - Save player positions
   - Update zone state
   - Loot collection tracking
   - Quest progress

4. **Events**:
   - Zone-wide announcements
   - Environmental changes
   - Boss spawns
   - Timed events

### API Endpoints (Planned)

```
GET  /api/zone/:zoneId/state          - Get zone state
GET  /api/zone/:zoneId/players        - Get players in zone
POST /api/zone/:zoneId/enter          - Character enters zone
POST /api/zone/:zoneId/exit           - Character exits zone
POST /api/zone/:zoneId/move           - Update position
POST /api/zone/:zoneId/interact       - Interact with object
GET  /api/zone/:zoneId/npcs           - Get NPCs in zone
GET  /api/zone/:zoneId/loot           - Get loot spawns
```

## Client Integration (Zone Renderer)

**File**: [zone-renderer.js](../public/javascripts/zone-renderer.js) (TODO)

### Socket Connection

```javascript
class ZoneRenderer {
  constructor() {
    // ... existing code
    this.socket = io();  // Connect to Socket.IO server
    this.otherPlayers = new Map();  // characterId -> {name, x, y, color}
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    // Enter zone
    this.socket.emit('zone:enter', {
      characterId: window.characterData._id,
      characterName: window.characterData.name,
      zoneId: this.zone._id,
      zoneName: this.zone.title,
      x: this.player.x,
      y: this.player.y
    });

    // Receive other players
    this.socket.on('zone:playersInZone', (players) => {
      players.forEach(p => {
        if (p.characterId !== window.characterData._id) {
          this.otherPlayers.set(p.characterId, {
            name: p.characterName,
            x: p.location.x,
            y: p.location.y,
            color: this.randomPlayerColor()
          });
        }
      });
    });

    // Player joined
    this.socket.on('zone:playerJoined', (data) => {
      this.otherPlayers.set(data.characterId, {
        name: data.characterName,
        x: data.x,
        y: data.y,
        color: this.randomPlayerColor()
      });
      this.showNotification(`${data.characterName} entered the zone`);
    });

    // Player moved
    this.socket.on('zone:playerMoved', (data) => {
      if (this.otherPlayers.has(data.characterId)) {
        const player = this.otherPlayers.get(data.characterId);
        player.x = data.x;
        player.y = data.y;
      }
    });

    // Player left
    this.socket.on('zone:playerLeft', (data) => {
      this.otherPlayers.delete(data.characterId);
      this.showNotification(`${data.characterName} left the zone`);
    });

    // Chat message
    this.socket.on('zone:chatMessage', (data) => {
      this.addChatMessage(data.characterName, data.message);
    });
  }

  update(deltaTime) {
    // ... existing player movement code

    // Emit position update (throttled)
    if (this.frameCount % 6 === 0) {  // ~10x per second at 60fps
      this.socket.emit('zone:move', {
        characterId: window.characterData._id,
        x: this.player.x,
        y: this.player.y,
        vx: this.player.vx,
        vy: this.player.vy
      });
    }
  }

  render() {
    // ... existing rendering code

    // Render other players
    this.renderOtherPlayers();
  }

  renderOtherPlayers() {
    this.otherPlayers.forEach((player, characterId) => {
      const offsetX = -this.camera.x + this.canvas.width / 2;
      const offsetY = -this.camera.y + this.canvas.height / 2;

      const screenX = offsetX + (player.x * this.tileSize);
      const screenY = offsetY + (player.y * this.tileSize);

      // Draw player
      this.ctx.fillStyle = player.color;
      this.ctx.fillRect(
        screenX - (this.tileSize * 0.4),
        screenY - (this.tileSize * 0.4),
        this.tileSize * 0.8,
        this.tileSize * 0.8
      );

      // Draw name
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(player.name, screenX, screenY - this.tileSize * 0.6);
    });
  }

  cleanup() {
    // Exit zone
    this.socket.emit('zone:exit', {
      characterId: window.characterData._id,
      zoneId: this.zone._id,
      galacticLocation: { x: 0, y: 0, z: 0 }  // From character data
    });

    this.socket.disconnect();
  }
}
```

## Spawning Players on Primordial Singularity

**Goal**: Have players spawn in the Primordial Singularity zone by default.

### Steps

1. **Find/Create Primordial Singularity Zone**:
```javascript
const anomaly = await db.collection('assets').findOne({
  title: 'The Primordial Singularity',
  assetType: 'anomaly'
});

const zone = await db.collection('assets').findOne({
  'hierarchy.parent': anomaly._id,
  assetType: 'zone'
});
```

2. **Update Character Creation**:
```javascript
// In Character.create()
const primordialZone = await this.getPrimordialZone();

if (primordialZone) {
  character.location = {
    type: 'zone',
    zoneId: primordialZone._id,
    zoneName: primordialZone.title,
    x: 32,  // Center of zone
    y: 32,
    z: 0,
    vx: 0,
    vy: 0,
    lastUpdated: new Date()
  };
} else {
  // Fallback to galactic spawn
  character.location = { type: 'galactic', ... };
}
```

3. **Character Selection Screen**:
   - After selecting character
   - Check character.location.type
   - If 'zone', redirect to `/universe/zone/${location.zoneId}`
   - If 'galactic', redirect to `/universe/galactic-map-3d`

## Benefits of This System

### 1. **Performance**
- Zone events only broadcast to players in that zone
- Game state service focuses on galactic physics
- Reduced bandwidth (don't send all player movements to all players)

### 2. **Scalability**
- Each zone is independent
- Can handle thousands of zones simultaneously
- Room-based architecture scales horizontally

### 3. **Gameplay**
- Social hubs (Primordial Singularity, stations)
- Cooperative dungeons
- PvP arenas
- Zone-specific events and quests

### 4. **Development**
- Clear separation of concerns
- Zone service can be developed/deployed independently
- Easier to add zone-specific features

## Implementation Status

### ✅ Completed

1. **Character Model**:
   - ✅ Zone-based location support
   - ✅ enterZone() method
   - ✅ exitZone() method
   - ✅ updateZonePosition() method
   - ✅ getCharactersInZone() method

2. **Socket.IO Events**:
   - ✅ zone:enter event handler
   - ✅ zone:exit event handler
   - ✅ zone:move event handler
   - ✅ zone:chat event handler
   - ✅ zone:action event handler
   - ✅ Socket rooms for zones
   - ✅ Disconnect cleanup

### 🚧 In Progress

3. **Zone Renderer**:
   - ⏳ Socket.IO integration
   - ⏳ Multiplayer player rendering
   - ⏳ Chat UI
   - ⏳ Position sync

4. **Zone Monitor Service**:
   - ⏳ Service skeleton
   - ⏳ API endpoints
   - ⏳ State management
   - ⏳ NPC/loot systems

5. **Primordial Singularity Spawn**:
   - ⏳ Character creation update
   - ⏳ Character selection routing
   - ⏳ Default spawn logic

### 📋 Todo

6. **API Routes**:
   - ❌ POST /api/v1/characters/:id/enter-zone
   - ❌ POST /api/v1/characters/:id/exit-zone
   - ❌ GET /api/v1/zones/:id/players

7. **Testing**:
   - ❌ Zone entry/exit flow
   - ❌ Multiplayer sync
   - ❌ Chat system
   - ❌ Disconnect handling

## Next Steps

1. **Update Zone Renderer** for multiplayer
2. **Create Zone Monitor Service** skeleton
3. **Add character spawn logic** for Primordial Singularity
4. **Add API routes** for zone operations
5. **Test multiplayer** in zones

---

**Status**: 🚧 Core infrastructure complete, integration in progress

The foundation is ready for zone-based multiplayer! Character model supports zones, Socket.IO events are wired up, now we need to integrate with the client-side renderer and create the zone monitor service.
