# Game State Microservice

A real-time microservice for Stringborn Universe game state, providing live updates via Server-Sent Events (SSE) streaming and REST API.

## Features

- 🎮 **Real-time game state simulation**
- 📡 **Server-Sent Events (SSE) streaming**
- 🌍 **REST API for snapshots**
- 📊 **Chunked planetary data**
- ⚡ **Event generation and streaming**
- 🔄 **Auto-reconnection support**

## Architecture

```
┌──────────────┐         ┌─────────────────┐
│              │   SSE   │                 │
│  Frontend    │◄────────│  Game State     │
│  (PS App)    │         │  Service        │
│              │   REST  │  (Port 3500)    │
│              │◄────────│                 │
└──────────────┘         └─────────────────┘
```

## API Endpoints

### REST API

```
GET  /health                  Health check
GET  /api/state               Complete game state snapshot
GET  /api/state/galactic      Galactic state only
GET  /api/state/events        Active events list
GET  /api/state/factions      Faction standings
GET  /api/state/planetary     Planetary zones (chunked)
     ?chunk=0&chunkSize=50
```

### SSE Streams

```
GET  /api/stream/state        Real-time state updates
GET  /api/stream/events       Real-time event feed
GET  /api/stream/planetary    Chunked planetary data stream
     ?chunkSize=50
```

## Data Structures

### Galactic State
```javascript
{
  cycle: Number,
  year: Number,
  currentSeason: String,
  dominantFaction: String,
  threatLevel: String,
  economicState: String,
  totalPopulation: Number,
  activeConflicts: Number
}
```

### Faction Data
```javascript
{
  "Faction Name": {
    power: Number (0-100),
    territory: Number (0-100),
    influence: Number (0-100)
  }
}
```

### Events
```javascript
{
  id: Number,
  type: String, // 'discovery', 'conflict', 'economic', 'environmental'
  message: String,
  timestamp: ISO String,
  severity: String // 'low', 'medium', 'high'
}
```

### Planetary Zones
```javascript
{
  id: Number,
  name: String,
  type: String,
  climate: String,
  level: Number,
  controller: String,
  population: Number,
  resources: {
    energy: Number,
    minerals: Number,
    technology: Number
  },
  dangerLevel: Number,
  discovered: Boolean,
  coordinates: { x: Number, y: Number }
}
```

## SSE Message Format

### State Stream
```javascript
// Initial connection
{
  type: 'init',
  state: { ...completeState },
  timestamp: Number
}

// Updates
{
  type: 'update',
  galactic: { ...galacticState },
  factions: { ...factionData },
  resources: { ...resources },
  timestamp: Number
}
```

### Event Stream
```javascript
// Initial connection
{
  type: 'init',
  events: [ ...events ],
  timestamp: Number
}

// New event
{
  type: 'event',
  event: { ...eventData },
  timestamp: Number
}
```

### Planetary Stream
```javascript
{
  type: 'chunk',
  chunk: Number,        // Current chunk index
  total: Number,        // Total zones
  hasMore: Boolean,     // More chunks available
  zones: [ ...zones ],  // Chunk data
  timestamp: Number
}
```

## Update Intervals

- **State Updates:** Every 30 seconds
- **New Events:** Every 2 minutes
- **Planetary Chunks:** Every 5 seconds (in stream mode)
- **Heartbeat:** Every 30 seconds

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Environment Variables
```
PORT=3500
NODE_ENV=production
CORS_ORIGIN=http://localhost:3399,http://ps.madladslab.com
```

## Frontend Integration

### Connect to SSE Stream
```javascript
const eventSource = new EventSource('http://localhost:3500/api/stream/state');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'init') {
    // Initialize UI with complete state
    updateUI(data.state);
  } else if (data.type === 'update') {
    // Update UI with changes
    updateUI(data);
  }
};

eventSource.onerror = (error) => {
  // Handle reconnection
  console.error('Connection lost, reconnecting...');
};
```

### Fetch Snapshot
```javascript
const response = await fetch('http://localhost:3500/api/state');
const { state } = await response.json();
```

### Chunked Planetary Data
```javascript
const response = await fetch('http://localhost:3500/api/state/planetary?chunk=0&chunkSize=50');
const { zones, hasMore } = await response.json();
```

## Game State Simulation

The service simulates a dynamic universe:

### Faction Power Changes
- Adjusts ±1.5 every 30 seconds
- Maintains 0-100 range
- Determines dominant faction

### Resource Generation
- Energy: +0-100,000 per update
- Minerals: +0-150,000 per update
- Technology: +0-50 per update
- Population: +0-1,000,000 per update

### Zone Discovery
- 30% chance per update
- Discovered zones increase
- Unexplored zones decrease

### Event Generation
- New event every 2 minutes
- Types: discovery, conflict, economic, environmental
- Random templates with placeholders
- Severity levels: low, medium, high

## CORS Configuration

The service supports CORS for:
- localhost:3399 (dev)
- ps.madladslab.com (production)
- Direct IP access

Configure in `.env`:
```
CORS_ORIGIN=http://localhost:3399,http://ps.madladslab.com,http://104.237.138.28
```

## Error Handling

### Client-Side Reconnection
```javascript
let reconnectAttempts = 0;
const MAX_ATTEMPTS = 5;

eventSource.onerror = () => {
  if (reconnectAttempts < MAX_ATTEMPTS) {
    reconnectAttempts++;
    setTimeout(() => connectToStream(), 3000 * reconnectAttempts);
  }
};
```

### Server-Side Cleanup
- Automatic cleanup on client disconnect
- Heartbeat detection
- Listener removal
- Interval clearing

## Performance

- **Memory:** Minimal (generates on-the-fly)
- **CPU:** Low (updates every 30s)
- **Connections:** Supports multiple concurrent SSE streams
- **Data Size:** ~2KB per state update

## Scaling

For high traffic:
1. Use Redis for state sharing
2. Deploy multiple instances behind load balancer
3. Implement state persistence
4. Add WebSocket fallback for SSE

## Monitoring

Check service health:
```bash
curl http://localhost:3500/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 123.456
}
```

## Integration with PS App

The PS app connects via:
- Route: `/universe/galactic-state`
- View: `galacticState-stream.ejs`
- Script: `galactic-state-stream.js`

Automatically streams:
- Galactic overview
- Faction power
- Resources
- Live events

---

**Status:** ✅ Running on port 3500
**Ready for:** Real-time game state streaming
