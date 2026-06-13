# Galactic Map State System

## Overview
The galactic map is a **5000x5000** persistent 2D space featuring moving zones, floating orbitals, and dynamic travel paths. The entire state survives server restarts through MongoDB persistence.

## ✅ Database Persistence (NEW!)

### Model: GalacticState
**Location:** `/srv/ps/api/v1/models/GalacticState.js`

The system now saves galactic state to MongoDB:
- **Zone positions** (4 main zones: Alpha, Beta, Gamma, Delta)
- **Zone velocities** (movement vectors)
- **Orbital positions** (player-created assets)
- **Space dimensions** (5000x5000)
- **Movement settings** (speed multipliers, grid size)

### Automatic Saving
- Zones auto-save every **5 seconds** during movement
- State loads automatically on server startup
- Positions restored exactly where they were before restart

### API Methods
```javascript
// Get current state (creates if doesn't exist)
await GalacticState.getState();

// Update entire state
await GalacticState.updateState({ spaceWidth: 5000, spaceHeight: 5000 });

// Update only zones
await GalacticState.updateZones(zones);

// Update only orbitals
await GalacticState.updateOrbitals(orbitals);

// Reset to defaults
await GalacticState.resetState();
```

## Full-Scale Floating System

### NOT X-Pattern - True Orbital Mechanics

**Location:** `/srv/ps/public/javascripts/galactic-map-optimized.js:698-797`

The system uses **three positioning methods**:

1. **Space Hubs** (Stationary - Fixed Corners)
   - Fixed positions at corners of map
   - No movement (vx=0, vy=0)
   - Radius: 50 units
   - Example: `{x: 500, y: 500, vx: 0, vy: 0, isStationary: true}`

2. **Assets with Initial Positions** (Dynamic/Stationary)
   - Predefined positions from database
   - Anomalies: stationary (vx=0, vy=0)
   - Galaxies/Orbitals: move with velocity vectors
   - Velocity: `0.01 - 0.05` units/frame
   - Example: `{x: 2341, y: 3892, vx: 0.023, vy: -0.031}`

3. **New Assets** (Circular Distribution with Random Movement)
   - Initial position: Circle around map center
   - Random radius: `100 - 400` units from center
   - Random angle: `0 - 2π`
   - Random velocity vectors for non-stationary
   - **NOT A FIXED PATTERN** - each asset gets unique position

### Physics Update System
**Location:** `/srv/ps/public/javascripts/galactic-map-optimized.js:786-850`

```javascript
// Each frame:
1. Update position: x += vx, y += vy
2. Apply boundary wrapping (toroidal space)
3. Calculate gravity from center (keeps objects in orbit)
4. Apply velocity decay (prevents infinite acceleration)
5. Save to spatial service every 2 seconds
```

## Color-Coded Travel Paths

### ✅ FULLY IMPLEMENTED
**Location:** `/srv/ps/public/javascripts/galactic-map-optimized.js:1260-1365`

### Color System

| Color | Meaning | Status | Stability | Visual |
|-------|---------|--------|-----------|--------|
| **BLUE** | Future paths near | `conn.status === 'future'` | 0.9 | Dashed lines (10,10) |
| **GREEN** | Stable/Safe paths | `conn.status === 'active'` | 0.8 | Tight dashes (3,3) |
| **YELLOW-RED** | Paths expiring by distance | `conn.status === 'warning'` | 0.3-0.6 | Warning dashes (5,5) |

### Path Generation
**Location:** `/srv/ps/public/javascripts/galactic-map-optimized.js:529-636`

```javascript
// 1. Hub to Orbital (BLUE - Future routes)
connections.push({
  fromX: hub.x, fromY: hub.y,
  toX: orbital.x, toY: orbital.y,
  status: 'future',  // BLUE
  stability: 0.9
});

// 2. Orbital to Orbital (GREEN - Stable routes)
connections.push({
  fromX: orbital.x, fromY: orbital.y,
  toX: other.x, toY: other.y,
  status: 'active',  // GREEN
  stability: 0.8
});

// 3. Orbital to Anomaly (RED - Dangerous routes)
connections.push({
  fromX: orbital.x, fromY: orbital.y,
  toX: anomaly.x, toY: anomaly.y,
  status: 'warning',  // YELLOW-RED
  stability: 0.3
});
```

### Dynamic Color Rendering

**BLUE (Future Paths):**
```javascript
color = `rgb(30, 144, ${100 + stability * 155})`;  // Brighter = more stable
glowColor = `rgba(30, 144, 255, ${stability * 0.5})`;
dashPattern = [10, 10];  // Long dashes
```

**GREEN (Stable Paths):**
```javascript
color = `rgb(16, ${150 + stability * 105}, 129)`;
glowColor = `rgba(16, 185, 129, ${stability * 0.4})`;
dashPattern = [3, 3];  // Tight dashes
```

**RED-YELLOW (Expiring Paths):**
```javascript
// stability 0.6-0.8 = Yellow
// stability 0.3-0.5 = Orange
// stability 0.0-0.3 = Red
if (stability > 0.5) {
  color = `rgb(255, ${200 - orangeRatio * 100}, 0)`;  // Yellow-Orange
} else {
  color = `rgb(255, ${100 - redRatio * 100}, 0)`;  // Orange-Red
}
dashPattern = [5, 5];  // Warning dashes
lineWidth = 2 + (1 - stability) * 2;  // Thicker when unstable
```

### Visual Effects

1. **Glow Effect**: Shadow blur around paths
2. **Midpoint Markers**: Dots at path midpoints with status color
3. **Pulsing Animation**: Unstable paths (stability < 0.4) pulse
4. **Thickness**: Unstable paths get thicker (warning visual)
5. **Alpha Transparency**: Based on stability

## Route Endpoints

### `/universe/galacticState/state`
GET - Returns current galactic state as JSON
```json
{
  "spaceWidth": 5000,
  "spaceHeight": 5000,
  "zones": [...],
  "timestamp": 1234567890
}
```

### `/universe/galacticState/map`
GET - Returns ASCII visualization of map
- Query params: `?x=2500&y=2500&scale=25`

### `/universe/galacticState/tick`
POST - Manual zone update (auto-runs every 100ms)

### `/universe/galacticState/reset`
POST - Reset all zones to initial positions

## Architecture Summary

```
┌─────────────────────────────────────────────────┐
│           CLIENT (galactic-map-optimized.js)     │
│                                                  │
│  • Renders 5000x5000 canvas                     │
│  • Manages orbital positions                    │
│  • Physics updates (30 FPS)                     │
│  • Color-coded travel paths                     │
│  • Saves to Spatial Service (svc.madladslab.com)│
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│      SERVER (routes/universe/galacticState.js)   │
│                                                  │
│  • Updates zone positions (100ms interval)      │
│  • Saves zones to MongoDB (5 second interval)  │
│  • Loads state on startup                       │
│  • Provides ASCII map visualization             │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│        DATABASE (MongoDB - GalacticState)        │
│                                                  │
│  • Zones (4 main: Alpha, Beta, Gamma, Delta)   │
│  • Orbitals (player-created assets)            │
│  • Space dimensions (5000x5000)                │
│  • Movement settings                            │
│  • Auto-restore on server restart              │
└─────────────────────────────────────────────────┘
```

## Key Features

✅ **Persistent State** - Survives server restarts
✅ **Full-Scale Floating** - NOT X-pattern, real orbital mechanics
✅ **Color-Coded Paths** - Blue (future), Green (stable), Red (expiring)
✅ **Dynamic Travel Routes** - Based on actual asset positions
✅ **Gravity Physics** - Objects orbit around center
✅ **Toroidal Space** - Wraps at boundaries
✅ **Automatic Saving** - Every 5 seconds for zones, 2 seconds for orbitals
✅ **Spatial Service Integration** - Perpetual orbital positions

## Files Modified

1. **NEW:** `/srv/ps/api/v1/models/GalacticState.js` - Database model
2. **UPDATED:** `/srv/ps/routes/universe/galacticState.js` - Added DB persistence
3. **EXISTING:** `/srv/ps/public/javascripts/galactic-map-optimized.js` - Full rendering system

## Testing

```bash
# Check if state is saving
curl http://localhost:3399/universe/galacticState/state

# Reset zones
curl -X POST http://localhost:3399/universe/galacticState/reset

# View ASCII map
curl "http://localhost:3399/universe/galacticState/map?scale=25"

# In MongoDB
db.galacticstates.findOne({ stateId: 'main' })
```

## Status: ✅ COMPLETE

All requested features are implemented:
- ✅ Database persistence for server restarts
- ✅ Full-scale floating orbital system (NOT X-pattern)
- ✅ Color-coded paths (Blue=future, Red=expiring, Green=stable)
