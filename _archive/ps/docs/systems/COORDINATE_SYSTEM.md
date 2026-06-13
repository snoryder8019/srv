# Coordinate Perpetuation System

## Overview

The coordinate perpetuation system ensures that all player positions, asset locations, and celestial body coordinates are consistently tracked, synchronized, and displayed across all views in the game. This system is built on a **single source of truth** model with the GameStateMonitor service at its core.

## Architecture

### Core Components

1. **GameStateMonitor Service** (`/public/javascripts/GameStateMonitor.js`)
   - Centralized coordinate and state management
   - Single source of truth for all entity positions
   - Event-driven architecture for view updates
   - Real-time synchronization via Socket.IO

2. **Physics Service** (`/services/physics-service.js`)
   - Server-side physics calculations
   - Gravity, velocity, and position updates
   - Runs at 10 ticks per second (100ms intervals)

3. **Socket.IO Plugin** (`/plugins/socket/index.js`)
   - Real-time communication layer
   - Broadcasts position updates to all connected clients
   - Manages online player registry

4. **Character Model** (`/api/v1/models/Character.js`)
   - Database persistence layer
   - Stores character location data (x, y, z, vx, vy, vz)
   - Provides methods for updating and querying positions

## Authority Model

### Authoritative View: galactic-map-3d

The **galactic-map-3d** view is the **AUTHORITATIVE** source for real-time spatial updates. This view:

- Updates player positions in real-time based on user input
- Broadcasts position changes to GameStateMonitor
- Enforces game rules and spatial constraints
- All players are bound by the rules of this map

**File**: `/views/universe/galactic-map-3d.ejs`

```javascript
// When player moves in galactic-map-3d
window.gameStateMonitor.updateCurrentPlayerPosition(position, velocity);
```

### Consumer Views

All other views **CONSUME** coordinate data from the GameStateMonitor service:

1. **system-map-3d** - 3D solar system view
2. **galactic-map** - 2D galaxy overview
3. **star-system** - Star system details
4. **Any future views**

These views:
- Subscribe to GameStateMonitor events
- Receive position updates passively
- Display coordinates but don't modify them directly

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     AUTHORITATIVE SOURCE                     │
│                    galactic-map-3d View                      │
│                  (User input, real-time)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ Position updates
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   GameStateMonitor Service                   │
│              (Centralized coordinate tracking)               │
│  • Player positions (x, y, z, vx, vy, vz)                  │
│  • Asset locations                                           │
│  • Celestial body positions                                  │
│  • Event emission to subscribers                             │
└──┬───────────────────┬────────────────────┬─────────────────┘
   │                   │                    │
   │ Updates           │ Updates            │ Updates
   ▼                   ▼                    ▼
┌──────────┐    ┌──────────┐       ┌──────────────┐
│ Socket.IO│    │ Consumer │       │   Consumer   │
│ (Server) │    │  Views   │       │    Views     │
│          │    │          │       │              │
│ Broadcast│    │ system-  │       │ galactic-map │
│ to other │    │ map-3d   │       │     (2D)     │
│ clients  │    │          │       │              │
└────┬─────┘    └──────────┘       └──────────────┘
     │
     │ Broadcast
     ▼
┌──────────────────────────────────────────────────────────────┐
│                Server-Side Physics Service                    │
│           (Gravity, velocity calculations)                    │
│              Updates Character database                       │
└───────────────────────────────────────────────────────────────┘
```

## GameStateMonitor API

### Initialization

```javascript
// Initialize with socket and current character ID
window.gameStateMonitor.init(socket, currentCharacterId);
```

### Event Subscription

```javascript
// Subscribe to player position updates
window.gameStateMonitor.on('playerPositionUpdate', (playerState) => {
  console.log('Player moved:', playerState.characterName);
  // playerState contains: characterId, position, velocity, characterName
});

// Subscribe to player join events
window.gameStateMonitor.on('playerJoined', (data) => {
  console.log('Player joined:', data.characterName);
});

// Subscribe to player leave events
window.gameStateMonitor.on('playerLeft', (data) => {
  console.log('Player left:', data.characterName);
});

// Subscribe to full state synchronization
window.gameStateMonitor.on('stateSync', (data) => {
  console.log('State synced, player count:', data.players.length);
});
```

### Position Updates (Authoritative View Only)

```javascript
// Update current player position (galactic-map-3d only)
window.gameStateMonitor.updateCurrentPlayerPosition(
  { x: 100, y: 200, z: 300 },
  { x: 1.5, y: 0, z: 0.5 } // velocity (optional)
);
```

### Querying State

```javascript
// Get a specific player's state
const playerState = window.gameStateMonitor.getPlayerState(characterId);
// Returns: { characterId, position, velocity, characterName, lastUpdated }

// Get all players
const allPlayers = window.gameStateMonitor.getAllPlayers();

// Get all players except current
const otherPlayers = window.gameStateMonitor.getOtherPlayers();

// Get asset position
const assetPos = window.gameStateMonitor.getAssetPosition(assetId);
```

### Statistics

```javascript
// Get monitoring statistics
const stats = window.gameStateMonitor.getStats();
// Returns: { connected, playerCount, assetCount, currentCharacterId, tickRate, uptime }
```

## Coordinate System

### 3D Galactic Coordinates

All positions use a 3D Cartesian coordinate system:

- **X-axis**: Horizontal (left-right)
- **Y-axis**: Vertical (up-down)
- **Z-axis**: Depth (forward-backward)

### Universe Bounds

Based on current asset distribution:
- X: -4202 to 4190
- Y: -2400 to 2207
- Z: -4062 to 1769
- Center: (-6, -97, -1146)

### Velocity

Velocity is stored as a vector (vx, vy, vz) representing units per second.

## Socket.IO Events

### Client → Server

- `characterJoin` - Announce character entering the universe
- `playerMove` - Real-time position update from authoritative view
- `characterLocationUpdate` - General location change notification

### Server → Client

- `onlinePlayers` - List of all online players (on connect)
- `characterJoined` - New player entered universe
- `characterLeft` - Player left universe
- `playerMoved` - Real-time position update from another player
- `characterLocationUpdate` - Position update from server physics

## Implementation Guide

### Adding a New View

To add a new view that displays player positions:

1. **Include GameStateMonitor script**:
```html
<script src="/javascripts/GameStateMonitor.js"></script>
```

2. **Initialize as CONSUMER** (not authoritative):
```javascript
socket.on('connect', () => {
  if (window.gameStateMonitor && !window.gameStateMonitor.connected) {
    window.gameStateMonitor.init(socket, currentCharacterId);
    console.log('🎮 GameStateMonitor connected (CONSUMER)');
  }
});
```

3. **Subscribe to position updates**:
```javascript
window.gameStateMonitor.on('playerPositionUpdate', (playerState) => {
  // Update your view with new position
  updatePlayerDisplay(playerState.characterId, playerState.position);
});
```

4. **Handle player join/leave**:
```javascript
window.gameStateMonitor.on('playerJoined', (data) => {
  addPlayerToView(data);
});

window.gameStateMonitor.on('playerLeft', (data) => {
  removePlayerFromView(data.characterId);
});
```

5. **Sync on initial load**:
```javascript
window.gameStateMonitor.on('stateSync', (data) => {
  data.players.forEach(player => {
    addPlayerToView(player);
  });
});
```

### Example: Consumer View Integration

```javascript
// In your view's socket connection handler
socket.on('connect', () => {
  const character = getCurrentCharacter();

  if (window.gameStateMonitor && !window.gameStateMonitor.connected) {
    window.gameStateMonitor.init(socket, character._id);

    // Position updates
    window.gameStateMonitor.on('playerPositionUpdate', (state) => {
      if (state.characterId !== character._id) {
        myView.updatePlayer(state.characterId, state.position);
      }
    });

    // New players
    window.gameStateMonitor.on('playerJoined', (data) => {
      if (data.characterId !== character._id) {
        myView.addPlayer(data);
      }
    });

    // Players leaving
    window.gameStateMonitor.on('playerLeft', (data) => {
      myView.removePlayer(data.characterId);
    });

    // Initial state sync
    window.gameStateMonitor.on('stateSync', (data) => {
      data.players.forEach(player => {
        if (player.characterId !== character._id) {
          myView.addPlayer(player);
        }
      });
    });
  }
});
```

## Persistence

### Database Storage

Character positions are persisted in MongoDB via the Character model:

```javascript
// Location schema in Character model
location: {
  type: { type: String, enum: ['galactic', 'planetary', 'station'], default: 'galactic' },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  z: { type: Number, default: 0 },
  vx: { type: Number, default: 0 }, // X velocity
  vy: { type: Number, default: 0 }, // Y velocity
  vz: { type: Number, default: 0 }, // Z velocity
  assetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
  lastUpdated: { type: Date, default: Date.now }
}
```

### Update Frequency

- **Real-time updates**: Every movement in galactic-map-3d (instant)
- **Physics updates**: Every 100ms (server-side)
- **Database writes**: On significant events (dock, undock, navigation complete)

## Performance Considerations

1. **Interpolation**: GameStateMonitor interpolates positions between updates using velocity
2. **Update throttling**: Client-side updates at 20 ticks/second (50ms)
3. **Server physics**: 10 ticks/second (100ms) for gravity calculations
4. **Event batching**: Multiple position updates combined when possible

## Testing

### Verify Coordinate Perpetuation

1. Open galactic-map-3d in one browser/tab
2. Open system-map-3d or galactic-map in another browser/tab
3. Move the ship in galactic-map-3d
4. Verify position updates appear in the other views
5. Check browser console for GameStateMonitor logs

### Debug Commands

```javascript
// Check GameStateMonitor status
console.log(window.gameStateMonitor.getStats());

// Get all tracked players
console.log(window.gameStateMonitor.getAllPlayers());

// Get specific player
console.log(window.gameStateMonitor.getPlayerState('characterId'));
```

## Troubleshooting

### Positions Not Updating

1. **Check GameStateMonitor initialization**:
   ```javascript
   console.log(window.gameStateMonitor.connected); // Should be true
   ```

2. **Verify Socket.IO connection**:
   ```javascript
   console.log(window.socket.connected); // Should be true
   ```

3. **Check event subscriptions**:
   ```javascript
   console.log(window.gameStateMonitor.listeners); // Should have registered callbacks
   ```

### Duplicate Position Updates

- Ensure GameStateMonitor is only initialized once per view
- Check for duplicate socket event listeners
- Verify `!window.gameStateMonitor.connected` check before init

### Position Desync

- Check server-side physics service is running
- Verify Socket.IO broadcast is working
- Ensure all views use the same coordinate system

## Future Enhancements

1. **Prediction**: Client-side prediction for smoother movement
2. **Lag compensation**: Handle network latency better
3. **Spatial partitioning**: Only track nearby players for performance
4. **Zone-based updates**: Different update rates for different areas
5. **Historical tracking**: Store position history for replays

## Related Files

- `/public/javascripts/GameStateMonitor.js` - Core service
- `/views/universe/galactic-map-3d.ejs` - Authoritative view
- `/views/universe/system-map-3d.ejs` - Consumer view
- `/views/universe/galactic-map.ejs` - Consumer view
- `/services/physics-service.js` - Server physics
- `/plugins/socket/index.js` - Socket.IO configuration
- `/api/v1/models/Character.js` - Database model

## Contact

For questions or issues related to the coordinate system, consult this documentation or check the code comments in the relevant files listed above.
