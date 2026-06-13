# Testing Key - Latest Data Design & Functionality

**Version:** v0.6.0
**Last Updated:** October 29, 2025
**Purpose:** Comprehensive checklist to verify latest data structures and features are running correctly

---

## Quick Reference: Core Systems

### 1. Data Models ✓
- [Character Model](#character-model-verification)
- [Asset Model](#asset-model-verification)
- [Coordinate System](#coordinate-system-verification)
- [Live Universe State](#live-universe-verification)

### 2. Services ✓
- [GameStateMonitor](#gamestatemoditor-verification)
- [Physics Service](#physics-service-verification)
- [Game State Service](#game-state-service-verification)
- [Socket.IO](#socketio-verification)

### 3. Views ✓
- [Galactic Map 3D](#galactic-map-3d-verification)
- [System Map 3D](#system-map-3d-verification)
- [Menu System](#menu-system-verification)

---

## Character Model Verification

**Database:** MongoDB `characters` collection
**File:** `/srv/ps/api/v1/models/Character.js`

### Core Structure
```javascript
{
  _id: ObjectId,
  userId: String,
  name: String,
  species: String,
  stringDomain: String,  // "Time String", "Space String", etc.
  level: Number,

  // NEW: Home Hub System
  homeHub: {
    id: String,
    name: String,
    stringDomain: String,
    location: { x, y, z }
  },

  // NEW: 3D Location with Velocity
  location: {
    type: String,           // "galactic", "planetary", "station"
    x: Number,              // 3D coordinate
    y: Number,              // 3D coordinate
    z: Number,              // 3D coordinate (NEW)
    vx: Number,             // X velocity
    vy: Number,             // Y velocity
    vz: Number,             // Z velocity (NEW)
    zone: String,           // Current zone/hub name
    assetId: ObjectId,      // Docked asset (null if in space)
    lastUpdated: Date
  },

  // Navigation System
  navigation: {
    destination: { x, y, z, assetId, assetName },
    travelSpeed: Number,
    isInTransit: Boolean,
    eta: Date
  },

  // Ship & Inventory
  ship: { ... },
  backpack: { items: [] },
  equipped: { ... }
}
```

### Testing Checklist

- [ ] **Character Creation**: Character spawns at correct home hub location
  - Check `homeHub.location` matches `location.x/y/z` on creation
  - Verify `stringDomain` is set correctly

- [ ] **3D Coordinates**: All location fields exist
  - `location.x`, `location.y`, `location.z` are all present
  - `location.vx`, `location.vy`, `location.vz` are all present (can be 0)

- [ ] **Location Updates**: `Character.updateLocation()` works
  - Updates all 6 position/velocity fields
  - Sets `location.lastUpdated` to current date

- [ ] **Navigation**: Destination setting works
  - `Character.setDestination()` calculates 3D distance correctly
  - ETA is calculated based on distance and travelSpeed

- [ ] **Docking**: Character can dock at assets
  - `Character.dockAtAsset()` moves character to asset position
  - Sets `location.assetId` correctly
  - Clears velocity (vx, vy, vz = 0)

- [ ] **Undocking**: Character can undock from assets
  - `Character.undock()` clears `location.assetId`
  - Character retains position but can now move

- [ ] **Physics Methods**: 3D physics integration works
  - `Character.applyThrust()` updates velocity in 3D
  - `Character.applyGravity()` calculates gravitational forces
  - `Character.updatePhysics()` runs full physics tick
  - `Character.setOrbit()` creates stable circular orbit

**Test Command:**
```javascript
// In browser console or Node
const char = await Character.findById('YOUR_CHARACTER_ID');
console.log('Location:', char.location);
console.log('HomeHub:', char.homeHub);
```

---

## Asset Model Verification

**Database:** MongoDB `assets` collection
**File:** `/srv/ps/api/v1/models/Asset.js`

### Core Structure
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  title: String,
  assetType: String,      // "planet", "star", "station", "galaxy", etc.
  status: String,         // "draft", "submitted", "approved", "rejected"

  // NEW: 3D Coordinates
  coordinates: {
    x: Number,
    y: Number,
    z: Number
  },

  // NEW: Orbital Mechanics
  orbital: {
    radius: Number,       // Distance from parent
    speed: Number,        // Orbital velocity
    angle: Number,        // Current angle in orbit
    clockwise: Boolean    // Direction of orbit
  },

  // NEW: Hierarchy
  parentGalaxy: ObjectId, // Parent galaxy (if star/planet)
  parentStar: ObjectId,   // Parent star (if planet/moon)

  // Images & Visuals
  images: {
    pixelArt: String,
    fullscreen: String,
    indexCard: String
  },

  // Community Features
  votes: Number,
  voters: [],
  suggestions: [],

  // Type-Specific Data
  stats: {},
  resources: [],
  climate: String,
  gravity: Number,
  // ... etc
}
```

### Testing Checklist

- [ ] **Asset Creation**: New assets have coordinate fields
  - `coordinates.x/y/z` exist even if set to 0

- [ ] **3D Positioning**: Assets can be queried by coordinates
  - `Asset.getByTypes()` returns coordinates
  - Coordinates are used in physics calculations

- [ ] **Hierarchy**: Parent-child relationships work
  - `Asset.getStarsInGalaxy()` returns stars for a galaxy
  - `Asset.getBodiesInStarSystem()` returns planets for a star
  - `Asset.getHierarchyPath()` returns full galaxy → star → planet path

- [ ] **Orbital Data**: Planets have orbital mechanics
  - `orbital.radius` determines distance from star
  - `orbital.speed` determines how fast they orbit
  - `orbital.angle` tracks current position in orbit

- [ ] **Community Features**: Voting and suggestions work
  - `Asset.addVote()` increments vote count
  - `Asset.addSuggestion()` adds community suggestions
  - `Asset.findCommunity()` returns submitted assets

- [ ] **Status Workflow**: Asset approval flow works
  - New assets start as "submitted"
  - Admin can approve/reject
  - Only "approved" assets appear in game

**Test Command:**
```javascript
// In browser console
const asset = await Asset.findById('ASSET_ID');
console.log('Coordinates:', asset.coordinates);
console.log('Orbital:', asset.orbital);
console.log('Parent Star:', asset.parentStar);
```

---

## Coordinate System Verification

**Documentation:** `/srv/ps/docs/COORDINATE_SYSTEM.md`
**Authority:** Galactic Map 3D is the authoritative source

### Core Principles

1. **Single Source of Truth**: GameStateMonitor service
2. **Authoritative View**: galactic-map-3d updates positions
3. **Consumer Views**: All other views receive updates
4. **Persistence**: MongoDB stores positions, Socket.IO broadcasts changes

### Universe Bounds
```
X: -4202 to 4190
Y: -2400 to 2207
Z: -4062 to 1769
Center: (-6, -97, -1146)
```

### Testing Checklist

- [ ] **Authority Model**: galactic-map-3d is authoritative
  - Moving in galactic-map-3d updates GameStateMonitor
  - GameStateMonitor broadcasts to other players
  - Other views receive updates but don't send them

- [ ] **Coordinate Perpetuation**: Positions sync across views
  - Open galactic-map-3d in one tab
  - Open system-map-3d in another tab
  - Move in galactic-map-3d → see update in system-map-3d

- [ ] **3D Math**: Distance calculations use 3D formula
  - `distance = sqrt(dx² + dy² + dz²)`
  - Navigation calculates 3D paths
  - Gravity uses 3D vector math

- [ ] **Velocity Integration**: Positions update based on velocity
  - `position.x += velocity.x * deltaTime`
  - Interpolation happens at 20 ticks/sec (50ms)
  - Smooth movement between updates

**Test Command:**
```javascript
// In galactic-map-3d
console.log(window.gameStateMonitor.getStats());
console.log(window.gameStateMonitor.getAllPlayers());
```

---

## GameStateMonitor Verification

**File:** `/srv/ps/public/javascripts/GameStateMonitor.js`
**Type:** Client-side singleton service

### Core Features

1. **Centralized State**: Single source of truth for all positions
2. **Event-Driven**: Views subscribe to position updates
3. **Interpolation**: Smooth movement between server updates
4. **Socket Integration**: Real-time multiplayer sync

### Testing Checklist

- [ ] **Initialization**: GameStateMonitor loads correctly
  - `window.gameStateMonitor` exists globally
  - Check console for "🎮 GameStateMonitor initialized"

- [ ] **Connection**: Socket connection works
  - `window.gameStateMonitor.connected === true`
  - Check console for "✅ GameStateMonitor connected"

- [ ] **Player Tracking**: Other players appear
  - `window.gameStateMonitor.getAllPlayers()` returns array
  - Each player has position, velocity, characterName

- [ ] **Position Updates**: Updates trigger events
  - Subscribe to `playerPositionUpdate` event
  - Verify callback fires when players move

- [ ] **Interpolation**: Smooth movement works
  - Players with velocity interpolate between updates
  - No stuttering or jumps

- [ ] **Event System**: All events work
  - `playerPositionUpdate` - Player moves
  - `playerJoined` - New player enters
  - `playerLeft` - Player disconnects
  - `stateSync` - Initial state load

**Test Commands:**
```javascript
// Check status
window.gameStateMonitor.getStats()

// Get all players
window.gameStateMonitor.getAllPlayers()

// Subscribe to updates
window.gameStateMonitor.on('playerPositionUpdate', (player) => {
  console.log('Player moved:', player.characterName, player.position);
});

// Update current player (authoritative view only)
window.gameStateMonitor.updateCurrentPlayerPosition(
  { x: 100, y: 200, z: 300 },
  { x: 1, y: 0, z: 0 }
);
```

---

## Live Universe Verification

**Service:** Game State Service (port 3500)
**Integration:** LiveUniverseManager in galactic-map-3d
**Documentation:** `/srv/ps/zMDREADME/LIVE_UNIVERSE_SUMMARY.md`

### Core Features

1. **Persistent Simulation**: Universe evolves 24/7
2. **Faction Dynamics**: 5 factions with shifting power
3. **Live Events**: New events every ~2 minutes
4. **SSE Streaming**: Server-Sent Events for real-time updates

### Testing Checklist

- [ ] **Service Running**: Game State Service is active
  - `curl http://localhost:3500/health` returns 200
  - `lsof -i :3500` shows node process

- [ ] **Live Connection**: UI shows "LIVE" status
  - Bottom left shows green "● LIVE" indicator
  - Check console for "✅ Connected to Game State Service"

- [ ] **Event Feed**: Events appear in top right
  - Event feed panel is visible
  - New events appear every ~2 minutes
  - Events have type, severity, timestamp

- [ ] **Faction Dynamics**: Faction power bars update
  - Bottom left shows faction power panel
  - Bars update every 30 seconds
  - Factions sorted by power level

- [ ] **Galactic Cycle**: Cycle counter increments
  - Top of event feed shows "Cycle: X"
  - Cycle increments every 30 seconds

- [ ] **Toast Notifications**: High-severity events trigger toasts
  - High-severity events show toast notifications
  - Toasts appear in top-right corner
  - Toasts auto-dismiss after 5 seconds

- [ ] **Auto-Reconnection**: Connection recovers from failure
  - Stop game-state-service: `pkill -f game-state`
  - UI shows "Disconnected" then "Connecting"
  - Restart service: `cd /srv/game-state-service && node index.js`
  - UI reconnects automatically

**Test Commands:**
```bash
# Check service status
curl http://localhost:3500/health

# Get current state
curl http://localhost:3500/api/state

# Get faction data
curl http://localhost:3500/api/state/factions

# Get recent events
curl http://localhost:3500/api/state/events
```

```javascript
// In browser console (galactic-map-3d)
window.liveUniverse.isConnected        // Should be true
window.liveUniverse.galacticState      // Current state
window.liveUniverse.factions           // Faction data
window.liveUniverse.events             // Recent events
```

---

## Physics Service Verification

**File:** `/srv/ps/services/physics-service.js`
**Type:** Server-side background service

### Core Features

1. **3D Physics**: Gravity, thrust, orbital mechanics
2. **10 Hz Tick Rate**: Updates every 100ms
3. **Persistent**: Runs even when players offline
4. **Real-time Broadcast**: Updates sent via Socket.IO

### Testing Checklist

- [ ] **Service Running**: Physics service is active
  - Check server logs for physics tick messages
  - Characters in motion continue moving

- [ ] **Gravity Simulation**: Gravity affects ships
  - Ships near planets experience gravitational pull
  - Orbits maintain stable paths

- [ ] **Thrust Application**: Ship controls work
  - Thrust updates velocity correctly
  - Velocity affects position over time

- [ ] **Velocity Persistence**: Velocity survives logout/login
  - Set ship in motion
  - Logout and login
  - Ship continues moving in same direction

- [ ] **Database Updates**: Positions saved to MongoDB
  - Character positions update in database
  - `location.lastUpdated` reflects recent changes

**Test Commands:**
```bash
# Check if physics service is running (in server logs)
# Look for: "⚙️ Physics tick" or similar messages

# In tmux session
tmux attach -t ps_session
# Watch for physics-related log output
```

---

## Socket.IO Verification

**Plugin:** `/srv/ps/plugins/socket/index.js`
**Port:** Same as main app (3399)

### Core Events

#### Client → Server
- `characterJoin` - Character enters universe
- `playerMove` - Real-time position update
- `characterLocationUpdate` - General location change

#### Server → Client
- `onlinePlayers` - List of online players (on connect)
- `characterJoined` - New player entered
- `characterLeft` - Player left
- `playerMoved` - Player position update
- `characterLocationUpdate` - Server physics update
- `characterDocked` - Player docked at asset
- `characterUndocked` - Player undocked from asset

### Testing Checklist

- [ ] **Connection**: Socket connects on page load
  - `window.socket.connected === true`
  - Console shows socket connection messages

- [ ] **Online Players**: Initial player list received
  - `onlinePlayers` event fires on connection
  - Other players visible on map

- [ ] **Movement Broadcast**: Movement syncs to other players
  - Open two browser tabs with different characters
  - Move in one tab → see movement in other tab

- [ ] **Join/Leave Events**: Players joining/leaving broadcast
  - New player logs in → others see "Player joined"
  - Player logs out → others see "Player left"

- [ ] **Docking Events**: Docking broadcasts to other players
  - Dock at station → event broadcasts
  - Other players see docking status

**Test Commands:**
```javascript
// Check socket status
window.socket.connected

// Listen to all events (debugging)
window.socket.onAny((eventName, ...args) => {
  console.log('Socket event:', eventName, args);
});

// Emit test event
window.socket.emit('playerMove', {
  characterId: 'YOUR_ID',
  location: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
});
```

---

## Galactic Map 3D Verification

**File:** `/srv/ps/views/universe/galactic-map-3d.ejs`
**URL:** `http://localhost:3399/universe/galactic-map-3d`
**Status:** AUTHORITATIVE VIEW

### Core Features

1. **3D Rendering**: Three.js 3D universe visualization
2. **Real-time Control**: WASD movement, mouse look
3. **Live Universe**: Event feed, faction dynamics
4. **Multiplayer**: See other players in real-time
5. **Asset Interaction**: Click assets to view/dock

### Testing Checklist

- [ ] **3D Scene Loads**: Universe renders correctly
  - Stars, planets, stations visible
  - Camera controls work (WASD + mouse)
  - No JavaScript errors in console

- [ ] **Current Character**: Your ship appears
  - Ship mesh/sprite visible at your location
  - Ship label shows your character name

- [ ] **Other Players**: Other characters visible
  - Other player ships/sprites appear
  - Player names show above ships
  - Players move smoothly in real-time

- [ ] **Movement Controls**: WASD controls work
  - W = Forward, S = Backward
  - A = Left, D = Right
  - Q = Down, E = Up
  - Mouse rotates camera

- [ ] **Live Universe UI**: All UI panels appear
  - **Top Right**: Event feed with 5 recent events
  - **Bottom Left**: Faction power bars
  - **Bottom Left**: Connection status indicator
  - **Top of Event Feed**: Galactic cycle counter

- [ ] **Asset Interaction**: Clicking assets works
  - Click on planet/station → info panel opens
  - "Dock" button appears if close enough
  - Docking moves character to asset location

- [ ] **Live Updates**: Real-time events appear
  - New events appear every ~2 minutes
  - Faction bars update every 30 seconds
  - Galactic cycle increments every 30 seconds

- [ ] **Toast Notifications**: Critical events show toasts
  - High-severity events trigger toast
  - Toast shows in top-right
  - Toast fades after 5 seconds

**Test Navigation:**
```
1. Visit: http://localhost:3399/menu
2. Click "Universe" → "Galactic Map 3D"
3. Or direct: http://localhost:3399/universe/galactic-map-3d
```

---

## System Map 3D Verification

**File:** `/srv/ps/views/universe/system-map-3d.ejs`
**URL:** `http://localhost:3399/universe/system-map-3d`
**Status:** CONSUMER VIEW

### Core Features

1. **Solar System View**: Zoom into individual star systems
2. **Orbital Mechanics**: Planets orbit their stars
3. **3D Navigation**: Fly around the system
4. **Coordinate Sync**: Receives positions from GameStateMonitor

### Testing Checklist

- [ ] **Scene Loads**: Solar system renders
  - Central star visible
  - Planets in orbits
  - Orbital paths shown

- [ ] **Orbital Motion**: Planets move in orbits
  - Planets rotate around star
  - Orbital speed based on `orbital.speed`
  - Direction based on `orbital.clockwise`

- [ ] **Player Position**: Current character visible
  - Your ship appears in system
  - Position matches galactic-map-3d

- [ ] **Coordinate Sync**: Position updates from galactic-map
  - Open galactic-map-3d in one tab
  - Open system-map-3d in another tab
  - Move in galactic-map → position updates in system-map

- [ ] **Asset Details**: Clicking planets shows info
  - Click planet → detail panel opens
  - Shows planet name, type, stats
  - Option to dock if applicable

**Test Navigation:**
```
1. Visit: http://localhost:3399/universe/system-map-3d
2. Or from galactic-map-3d, click a star system
```

---

## Menu System Verification

**File:** `/srv/ps/views/menu-enhanced.ejs`
**URL:** `http://localhost:3399/menu`

### Core Features

1. **Game Launcher**: Central hub for all game features
2. **Card-Based UI**: Visual menu with feature cards
3. **Recent Updates**: Links to documentation
4. **Character Info**: Shows current character

### Testing Checklist

- [ ] **Menu Loads**: All cards visible
  - Universe section with map links
  - Updates & Information section
  - Admin section (if admin)

- [ ] **Navigation Links**: All links work
  - Galactic Map 3D link works
  - System Map 3D link works
  - Documentation link works
  - Asset Builder link works

- [ ] **Character Display**: Current character shown
  - Character name visible
  - String domain shown
  - Level displayed

- [ ] **Documentation Card**: New doc system accessible
  - "Documentation" card visible
  - Click → goes to `/help/documentation`
  - Documentation viewer loads

**Test Navigation:**
```
Visit: http://localhost:3399/menu
```

---

## Quick Test Sequence

### 5-Minute Smoke Test

1. **Start Services** (30 sec)
   ```bash
   # Main app
   cd /srv/ps && npm start

   # Game state service
   cd /srv/game-state-service && node index.js
   ```

2. **Check Menu** (30 sec)
   - Visit `http://localhost:3399/menu`
   - Verify all cards load
   - Check character name displays

3. **Test Galactic Map 3D** (2 min)
   - Click "Galactic Map 3D"
   - Verify 3D scene loads
   - Check Live Universe UI appears (event feed, faction bars)
   - Press WASD to move
   - Check console for GameStateMonitor messages

4. **Test Coordinate Sync** (1 min)
   - Open system-map-3d in new tab
   - Move in galactic-map-3d
   - Verify position updates in system-map-3d

5. **Test Live Universe** (1 min)
   - Watch event feed for new events
   - Watch faction bars for updates
   - Verify galactic cycle increments
   - Check connection status shows "LIVE"

### Expected Results
- ✅ No JavaScript errors in console
- ✅ All UI elements visible and functional
- ✅ Real-time updates working
- ✅ Movement controls responsive
- ✅ Multiplayer sync working (if other players online)

---

## Debugging Commands

### Browser Console

```javascript
// Check all global objects
console.log('Socket:', window.socket?.connected);
console.log('GameStateMonitor:', window.gameStateMonitor?.connected);
console.log('LiveUniverse:', window.liveUniverse?.isConnected);
console.log('Character:', window.currentCharacter);

// Get detailed stats
window.gameStateMonitor?.getStats();
window.liveUniverse?.galacticState;

// Check Three.js scene
console.log('Scene:', window.scene);
console.log('Camera:', window.camera);
console.log('Renderer:', window.renderer);
```

### Server Terminal

```bash
# Check running services
lsof -i :3399  # Main app
lsof -i :3500  # Game state service

# Check MongoDB connection
mongo stringborn --eval "db.characters.count()"
mongo stringborn --eval "db.assets.count()"

# View server logs
tmux attach -t ps_session

# Restart services
pkill -f "node"
cd /srv/ps && npm start
cd /srv/game-state-service && node index.js
```

---

## Common Issues & Solutions

### Issue: GameStateMonitor not connecting
**Symptoms:** `window.gameStateMonitor.connected === false`
**Solution:**
```javascript
// Check socket first
if (!window.socket.connected) {
  console.error('Socket not connected!');
}
// Reinitialize
window.gameStateMonitor.init(socket, currentCharacter._id);
```

### Issue: Live Universe shows "Disconnected"
**Symptoms:** Red status indicator, no events
**Solution:**
```bash
# Restart game-state-service
cd /srv/game-state-service
node index.js
```

### Issue: Player positions not syncing
**Symptoms:** Other players frozen or not visible
**Solution:**
- Check Socket.IO connection: `window.socket.connected`
- Check GameStateMonitor: `window.gameStateMonitor.getStats()`
- Verify both characters are in same zone
- Check server logs for errors

### Issue: 3D scene not rendering
**Symptoms:** Black screen, no 3D objects
**Solution:**
- Check browser console for WebGL errors
- Verify Three.js loaded: `console.log(THREE)`
- Check camera position: `console.log(window.camera.position)`
- Try resetting camera: `window.camera.position.set(0, 100, 500)`

---

## Testing Certification Checklist

Mark these off as you verify each system:

### Data Layer
- [ ] Character Model: 3D coordinates working
- [ ] Asset Model: Hierarchies and coordinates correct
- [ ] MongoDB: All collections accessible
- [ ] Indexes: Performance queries working

### Service Layer
- [ ] GameStateMonitor: Initialized and tracking
- [ ] Physics Service: Running and updating positions
- [ ] Game State Service: Live simulation running
- [ ] Socket.IO: Events broadcasting correctly

### View Layer
- [ ] Galactic Map 3D: Authoritative control working
- [ ] System Map 3D: Consumer sync working
- [ ] Menu: Navigation functional
- [ ] Documentation: Viewer loading docs

### Real-time Features
- [ ] Live Events: Appearing every ~2 minutes
- [ ] Faction Dynamics: Updating every 30 seconds
- [ ] Multiplayer Sync: Players visible in real-time
- [ ] Movement: Smooth interpolation working
- [ ] Docking: Dock/undock broadcasting

### Integration
- [ ] Cross-tab sync: Position updates across tabs
- [ ] Persistence: Data survives logout/login
- [ ] Auto-reconnect: Services recover from failures
- [ ] Error handling: Graceful degradation working

---

## Version History

**v0.6.0** (Oct 29, 2025)
- Added Live Universe integration
- Added faction dynamics
- Added event feed system
- Added SSE streaming

**v0.5.0** (Oct 28, 2025)
- Added 3D coordinate system
- Added GameStateMonitor service
- Added coordinate perpetuation
- Added multiplayer sync

**v0.4.0**
- Added galactic map 3D
- Added system map 3D
- Added physics service
- Added orbital mechanics

---

## Support

For issues or questions:
- Check `/srv/ps/zMDREADME/` for detailed documentation
- Review specific component docs (COORDINATE_SYSTEM.md, LIVE_UNIVERSE_SUMMARY.md, etc.)
- Check browser console for error messages
- Review server logs in tmux session

---

**Last Updated:** October 29, 2025
**Maintainer:** Development Team
**Status:** ✅ Current for v0.6.0
