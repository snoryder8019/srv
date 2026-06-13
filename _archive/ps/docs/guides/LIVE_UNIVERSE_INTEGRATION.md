# Live Universe Integration

**Version:** 1.0.0
**Date:** October 29, 2025
**Component:** `/universe/galactic-map-3d`

## Overview

The Live Universe Integration connects the 3D Galactic Map to the **game-state-service** microservice, providing real-time universe simulation with persistent state, dynamic events, and faction power tracking.

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│                     │   SSE   │                      │
│  Galactic Map 3D    │◄────────│  Game State Service  │
│  (Port 3399)        │         │  (Port 3500)         │
│                     │  REST   │                      │
│                     │◄────────│                      │
└─────────────────────┘         └──────────────────────┘
        │                                  │
        │                                  │
        ▼                                  ▼
  Live UI Updates              Persistent Simulation
  - Event Feed                 - Faction Power
  - Faction Bars               - Events Generation
  - Status Indicator           - Resource Growth
```

---

## Features

### 1. Real-Time Event Feed 📡
- Displays live universe events as they happen
- Color-coded by severity (low/medium/high)
- Event types: discovery, conflict, economic, environmental
- Auto-scrolling feed with last 5 events
- Toast notifications for high-severity events

### 2. Faction Power Tracking ⚔️
- Live faction power bars with smooth animations
- Dynamic sorting by power level
- Color-coded by faction:
  - **Silicate Consortium:** Purple (#8a4fff)
  - **Lantern Collective:** Green (#00ff9f)
  - **Devan Empire:** Orange (#ff6600)
  - **Human Federation:** Blue (#00aaff)
  - **Independent Systems:** Yellow (#ffaa00)

### 3. Connection Status Indicator
- Real-time connection monitoring
- Auto-reconnect with exponential backoff
- Visual status updates:
  - **LIVE** (green): Connected and receiving updates
  - **Connecting** (orange): Attempting connection
  - **Disconnected** (red): Connection lost
  - **Retry N** (yellow): Reconnecting

### 4. Galactic Cycle Tracker
- Displays current galactic cycle number
- Shows universe year
- Updates in real-time with state changes

---

## Technical Implementation

### LiveUniverseManager Class

**Location:** [galactic-map-3d.ejs:1962-2377](/srv/ps/views/universe/galactic-map-3d.ejs#L1962)

#### Properties

```javascript
{
  gameStateUrl: 'http://localhost:3500',
  eventSource: EventSource,           // SSE connection
  reconnectAttempts: Number,          // Current retry count
  maxReconnectAttempts: 10,           // Max retries
  reconnectDelay: 3000,               // Base delay (ms)
  isConnected: Boolean,               // Connection status

  // State Data
  galacticState: Object,              // Galactic overview
  factions: Object,                   // Faction power data
  events: Array,                      // Event history
  resources: Object,                  // Resource counts

  // UI Elements
  statusIndicator: HTMLElement,       // Connection status
  eventFeed: HTMLElement,             // Event feed panel
  factionPanel: HTMLElement           // Faction bars
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `init()` | Initialize manager and connect |
| `createUI()` | Generate UI panels dynamically |
| `connectToGameState()` | Establish SSE connection for state |
| `connectToEventStream()` | Establish SSE connection for events |
| `handleStateUpdate(data)` | Process incoming state updates |
| `updateAllUI()` | Refresh all UI components |
| `updateEventFeed()` | Update event list display |
| `updateFactionBars()` | Update faction power bars |
| `showToast(event)` | Show critical event notification |
| `attemptReconnect()` | Retry connection with backoff |
| `disconnect()` | Clean shutdown |

---

## UI Components

### 1. Status Indicator

**Position:** Bottom left
**Z-Index:** 1000
**Features:**
- Pulsing dot for connection status
- Status text
- Color-coded border

```html
Bottom Left Corner:
┌─────────────────────────┐
│ ● LIVE                  │
└─────────────────────────┘
```

### 2. Live Event Feed

**Position:** Top right
**Size:** 320px × 400px (max)
**Z-Index:** 999
**Features:**
- Scrollable event list
- Cycle/year display
- Event icons and severity colors
- Timestamps

```html
Top Right Corner:
┌─────────────────────────────┐
│ 📡 LIVE EVENTS   Cycle: 4   │
├─────────────────────────────┤
│ 🔭 DISCOVERY [HIGH]         │
│ New zone discovered in...   │
│ 12:34:56 PM                 │
├─────────────────────────────┤
│ ⚔️ CONFLICT [MEDIUM]        │
│ Border skirmish in...       │
│ 12:33:10 PM                 │
└─────────────────────────────┘
```

### 3. Faction Power Panel

**Position:** Bottom left (above status)
**Size:** 300px width
**Z-Index:** 999
**Features:**
- Sorted by power (descending)
- Animated progress bars
- Percentage display
- Smooth transitions

```html
Bottom Left (above status):
┌─────────────────────────────┐
│ ⚔️ FACTION POWER            │
├─────────────────────────────┤
│ Silicate Consortium    86%  │
│ ████████████████░░░░        │
├─────────────────────────────┤
│ Lantern Collective     69%  │
│ █████████████░░░░░░░        │
└─────────────────────────────┘
```

---

## Data Flow

### State Updates (Every 30 seconds)

```javascript
// SSE Message Format
{
  type: 'update',
  galactic: {
    cycle: 4,
    year: 2847,
    dominantFaction: 'Silicate Consortium',
    totalPopulation: 45000503409
  },
  factions: {
    'Silicate Consortium': { power: 86.3, territory: 42, influence: 78 }
  },
  resources: { ... },
  timestamp: 1761697723456
}
```

### Event Updates (Every 2 minutes + on generation)

```javascript
// SSE Message Format
{
  type: 'event',
  event: {
    id: 1761697622327,
    type: 'economic',
    message: 'Market crash affects Devan Empire',
    timestamp: '2025-10-29T00:27:02.327Z',
    severity: 'high'
  },
  timestamp: 1761697723456
}
```

---

## Connection Management

### Auto-Reconnect Logic

```javascript
Attempt 1: Retry after 3 seconds
Attempt 2: Retry after 6 seconds
Attempt 3: Retry after 9 seconds
...
Attempt 10: Give up (max attempts)
```

### Connection States

| State | Visual | Description |
|-------|--------|-------------|
| Connecting | Orange pulsing | Initial connection |
| LIVE | Green solid | Successfully connected |
| Disconnected | Red solid | Connection lost |
| Retry N | Yellow pulsing | Reconnecting attempt N |
| Failed | Red solid | Max retries exceeded |

---

## Configuration

### Game State Service URL

**Default:** `http://localhost:3500`

To change the service URL, modify:
```javascript
// In LiveUniverseManager constructor
this.gameStateUrl = 'http://your-service-url:port';
```

### Reconnection Settings

```javascript
this.maxReconnectAttempts = 10;  // Max retry attempts
this.reconnectDelay = 3000;      // Base delay in ms
```

### UI Update Intervals

Controlled by game-state-service:
- **State updates:** 30 seconds
- **New events:** 2 minutes
- **SSE heartbeat:** 30 seconds

---

## Integration Points

### 1. Galactic Map Initialization

The Live Universe Manager starts automatically 2 seconds after page load:

```javascript
// In galactic-map-3d.ejs:2383
setTimeout(() => {
  liveUniverse = new LiveUniverseManager();
  window.liveUniverse = liveUniverse;  // Global access for debugging
}, 2000);
```

### 2. Cleanup on Exit

Connections are properly closed when leaving the page:

```javascript
window.addEventListener('beforeunload', () => {
  if (liveUniverse) {
    liveUniverse.disconnect();
  }
});
```

---

## API Endpoints Used

### REST Endpoints (not used in SSE mode)
- `GET /api/state` - Full state snapshot
- `GET /api/state/galactic` - Galactic state only
- `GET /api/state/events` - Event list
- `GET /api/state/factions` - Faction data

### SSE Streams (actively used)
- `GET /api/stream/state` - Real-time state updates
- `GET /api/stream/events` - Real-time event feed

---

## Event Types & Severity

### Event Types

| Type | Icon | Examples |
|------|------|----------|
| discovery | 🔭 | New zone discovered, Ancient artifact found |
| conflict | ⚔️ | War declared, Border skirmish |
| economic | 💰 | Market crash, Mineral boom |
| environmental | 🌪️ | Solar flare, Asteroid collision |

### Severity Levels

| Severity | Color | Behavior |
|----------|-------|----------|
| low | Green (#00ff9f) | Normal display |
| medium | Yellow (#ffaa00) | Normal display |
| high | Red (#ff0000) | Toast notification + display |

---

## Debugging

### Access Live Manager

```javascript
// In browser console
console.log(window.liveUniverse);
console.log(window.liveUniverse.galacticState);
console.log(window.liveUniverse.factions);
console.log(window.liveUniverse.events);
```

### Check Connection Status

```javascript
window.liveUniverse.isConnected  // true/false
window.liveUniverse.reconnectAttempts  // Current retry count
```

### Manual Reconnect

```javascript
window.liveUniverse.connectToGameState();
```

### Manual Disconnect

```javascript
window.liveUniverse.disconnect();
```

---

## Performance Considerations

### Memory Usage
- Event history limited to 20 events
- Event feed displays last 5 events
- UI updates use efficient DOM manipulation

### Network Usage
- SSE connection: ~2KB per state update (every 30s)
- Event stream: ~500B per event (every 2min average)
- Heartbeats: Minimal overhead (every 30s)

### CPU Usage
- UI updates triggered only on data changes
- Smooth CSS animations (GPU-accelerated)
- Efficient event handling

---

## Troubleshooting

### Issue: "Disconnected" status

**Causes:**
- game-state-service not running
- Network connectivity issue
- Port 3500 blocked

**Solutions:**
```bash
# Check if service is running
lsof -i :3500

# Start service if needed
cd /srv/game-state-service
node index.js

# Check service health
curl http://localhost:3500/health
```

### Issue: No events appearing

**Causes:**
- Event stream connection failed
- Game state service not generating events

**Solutions:**
```bash
# Check event stream manually
curl http://localhost:3500/api/state/events

# Check browser console for errors
# Should see: "✅ Connected to Game State Service"
```

### Issue: UI panels not appearing

**Causes:**
- JavaScript error during initialization
- CSS conflicts

**Solutions:**
- Check browser console for errors
- Verify no z-index conflicts
- Check that elements are being created

---

## Future Enhancements

### Planned Features
- [ ] Asset motion simulation integration
- [ ] Player character tracking on map
- [ ] Resource visualization overlays
- [ ] Faction territory heat maps
- [ ] Event filtering/search
- [ ] Historical event timeline
- [ ] Persistent notifications log
- [ ] Custom event subscriptions
- [ ] Trade route visualization
- [ ] Conflict zone highlighting

### Possible Optimizations
- WebSocket fallback for SSE
- State delta updates (vs full state)
- Compressed data transfer
- Lazy-loaded event history
- Virtualized event list for large datasets

---

## Related Documentation

- [Game State Service README](/srv/game-state-service/README.md)
- [Galactic Map 3D Implementation](/srv/ps/views/universe/galactic-map-3d.ejs)
- [3D Universe Patch Notes](/srv/ps/docs/PATCH_NOTES_v0.5.0.md)
- [CLAUDE.md Context](/srv/ps/zMDREADME/CLAUDE.md)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-10-29 | Initial live universe integration |

---

**Status:** ✅ Active and running
**Service:** game-state-service on port 3500
**View:** `/universe/galactic-map-3d`
