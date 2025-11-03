# 3-Tier Navigation System Design

## Overview
Restructure the universe navigation to support deep exploration from galactic scale down to individual planets.

## Navigation Hierarchy

### Level 1: Galactic Map (Current)
**View:** Entire universe with multiple galaxies
- **Display:** Canvas with galaxy clusters
- **Objects:** Galaxies (from Assets collection where assetType='galaxy')
- **Interactions:**
  - Hover: Show galaxy info pane (name, type, discovered resources, faction control)
  - Click: Zoom into Galaxy View (Level 2)
- **Info Pane Shows:**
  - Galaxy name & description
  - Number of star systems
  - Controlling faction
  - Notable resources
  - Exploration status

### Level 2: Galaxy Map (NEW)
**View:** Inside a specific galaxy showing star systems
- **Display:** Canvas with star positions
- **Objects:** Stars/Star Systems (from Assets collection where assetType='star' and parentGalaxy=selectedGalaxyId)
- **Interactions:**
  - Hover: Show star system info pane
  - Click: Zoom into Star System View (Level 3)
  - Back button: Return to Galactic Map
- **Info Pane Shows:**
  - Star name & type (red dwarf, yellow star, etc.)
  - Number of planets
  - Number of orbital stations
  - Anomalies present
  - Travel distance from current position

### Level 3: Star System Map (NEW)
**View:** Inside a star system showing planets and orbitals
- **Display:** Canvas with orbital paths and planetary bodies
- **Objects:**
  - Central star
  - Planets (from Assets where assetType='planet' and parentStar=selectedStarId)
  - Orbital stations (from Assets where assetType='orbital' and parentStar=selectedStarId)
  - Anomalies (from Assets where assetType='anomaly' and parentStar=selectedStarId)
- **Interactions:**
  - Hover: Show body info pane
  - Click planet: Enter Planet Exploration (Level 4)
  - Click orbital: Dock at station
  - Back button: Return to Galaxy Map
- **Info Pane Shows:**
  - Planet/body name
  - Type (terrestrial, gas giant, ice world, etc.)
  - Atmosphere & climate
  - Resources available
  - Settlements/colonies
  - Exploration zones available

### Level 4: Planet Exploration (FUTURE)
**View:** Ground-level exploration of planetary surface
- Grid-based movement system
- Zones, encounters, resource gathering
- This is the existing zones/exploration system

## Database Schema Changes

### Assets Collection Updates
Add new fields to support hierarchy:

```javascript
{
  // Existing fields...
  assetType: 'galaxy' | 'star' | 'planet' | 'orbital' | 'anomaly',

  // NEW: Hierarchy fields
  parentGalaxy: ObjectId,  // Reference to parent galaxy asset
  parentStar: ObjectId,     // Reference to parent star asset

  // NEW: Position in parent container
  coordinates: {
    x: Number,              // Position in parent view
    y: Number,
    z: Number               // For 3D eventually
  },

  // NEW: Orbital mechanics (for planets)
  orbital: {
    radius: Number,         // Distance from parent star
    speed: Number,          // Orbital speed
    angle: Number           // Current angle in orbit
  },

  // Existing specialized fields remain...
}
```

### New Collections

#### `galaxies` (Alternative: use assets with type='galaxy')
- Store galaxy-level data
- Reference to star assets within

#### `stars` (Alternative: use assets with type='star')
- Store star system data
- Reference to planet/orbital assets

## Routes to Create

### API Routes
- `GET /api/v1/universe/galaxies` - Get all galaxies
- `GET /api/v1/universe/galaxies/:id` - Get specific galaxy details
- `GET /api/v1/universe/galaxies/:id/stars` - Get stars in galaxy
- `GET /api/v1/universe/stars/:id` - Get specific star system
- `GET /api/v1/universe/stars/:id/bodies` - Get planets/orbitals in system

### View Routes
- `/universe/galactic-map` - Level 1 (exists, needs update)
- `/universe/galaxy/:id` - Level 2 (new)
- `/universe/star-system/:id` - Level 3 (new)
- `/zones/:planetId/explore` - Level 4 (exists)

## Implementation Plan

### Phase 1: Database Migration
1. Add hierarchy fields to Asset model
2. Create migration script to organize existing assets
3. Seed galaxies and stars from approved assets

### Phase 2: API Layer
1. Create galaxy API endpoints
2. Create star system API endpoints
3. Update existing endpoints to support hierarchy

### Phase 3: Frontend - Galaxy View
1. Create galaxy-map.ejs view
2. Create galaxy-map.js renderer
3. Add navigation between Galactic → Galaxy
4. Add info panes for stars

### Phase 4: Frontend - Star System View
1. Create star-system.ejs view
2. Create star-system.js renderer with orbital mechanics
3. Add navigation between Galaxy → Star System
4. Add info panes for planets/orbitals

### Phase 5: Integration
1. Connect planet exploration to existing zones system
2. Update breadcrumb navigation
3. Add "Return to Space" options at each level
4. Update character position tracking

## UI/UX Considerations

### Breadcrumb Navigation
```
Galactic Map → [Galaxy Name] → [Star Name] → [Planet Name]
```

### Info Panes
- Consistent design across all levels
- Show relevant stats for each object type
- "Navigate to" / "Explore" / "Dock" buttons
- Resource indicators
- Faction control badges

### Visual Consistency
- Starfield background at all levels (scaled appropriately)
- Zoom transitions between levels
- Faction colors consistent
- Asset pixel art displayed in info panes

## Notes
- Keep all dummy/sample data removed
- All celestial bodies pulled from database
- Support for future procedural generation
- Maintain backwards compatibility with existing character positions
