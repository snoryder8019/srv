# Galactic Map Expansion Fix

Extended the galactic map physics to allow orbitals to travel to the full extent of the 5000x5000 map.

## Problem

Orbitals (moving objects like planets and space stations) were not reaching the edges of the galactic map. They were clustering near the center due to:
1. **Central gravity** starting too close to center (500 units)
2. **Orbital motion** forces keeping objects in circular paths
3. Map is 5000x5000, but physics forces prevented exploration beyond ~1500-2000 units from center

## Solution

### 1. Added Visible Boundary
Created `renderBoundary()` function to clearly show map edges:
- **Green dashed border** around entire 5000x5000 map
- **Corner markers** with L-shaped brackets for visibility
- **Coordinate labels** at all four corners showing (0,0), (5000,0), etc.

### 2. Adjusted Physics Forces

**Before:**
```javascript
// Central gravity started at 500 units from center
if (distFromCenter > 500) {
  const gravityForce = 0.005 * (distFromCenter / 1000);
  // Pull toward center
}

// Orbital motion everywhere beyond 200 units
if (distFromCenter > 200) {
  const orbitalForce = 0.002;
  // Creates circular motion
}
```

**After:**
```javascript
// Central gravity only starts at 80% toward map corners
// For a 5000x5000 map, that's ~2828 units (much further out)
const maxDistFromCenter = Math.sqrt(centerX * centerX + centerY * centerY);
if (distFromCenter > maxDistFromCenter * 0.8) {
  const gravityForce = 0.003 * (distFromCenter / 1000);
  // Very weak pull toward center
}

// Orbital motion only in inner 60% of map
// Allows free movement in outer regions
if (distFromCenter > 200 && distFromCenter < maxDistFromCenter * 0.6) {
  const orbitalForce = 0.002;
  // Creates circular motion in inner region only
}
```

## Map Zones

The 5000x5000 galactic map now has three distinct zones:

### Inner Zone (0-60% from center, ~0-2121 units)
- **Orbital Motion**: Active circular/orbital forces
- **Repulsion**: Objects push away from each other
- **Result**: Dynamic, swirling motion around center

### Middle Zone (60-80% from center, ~2121-2828 units)
- **Free Movement**: No central gravity or orbital forces
- **Repulsion Only**: Objects still avoid collision
- **Result**: Natural expansion outward, can reach far regions

### Outer Zone (80-100% from center, ~2828-3536 units to corners)
- **Weak Central Gravity**: Gentle pull prevents infinite drift
- **Repulsion**: Objects still avoid collision
- **Result**: Objects can reach edges but won't drift beyond

## Visual Improvements

### Boundary Rendering
```javascript
renderBoundary() {
  // Dashed green border
  ctx.strokeStyle = 'rgba(0, 255, 159, 0.3)';
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 10]);
  ctx.strokeRect(0, 0, this.width, this.height);

  // Corner markers (L-shaped brackets)
  const markerSize = 100;
  ctx.strokeStyle = 'rgba(0, 255, 159, 0.5)';
  ctx.lineWidth = 6;
  // ... draws L-shapes at each corner

  // Coordinate labels
  ctx.fillStyle = 'rgba(0, 255, 159, 0.7)';
  ctx.font = '24px monospace';
  ctx.fillText('(0, 0)', 10, 30);
  // ... labels at all corners
}
```

## Expected Behavior

### Orbital Movement Patterns

1. **Starting Near Center**
   - Orbitals experience circular motion
   - Gradually drift outward due to repulsion
   - Move in spiraling patterns

2. **Reaching Middle Regions**
   - Free to expand in any direction
   - No central forces constraining them
   - Can explore faction territories

3. **Approaching Edges**
   - Gentle pull prevents going beyond boundaries
   - Can still reach corners and edges
   - Natural "soft boundary" feel

### Faction Territory Coverage

With this fix, faction territories can now:
- ✅ Extend to map edges (0-5000 in both X and Y)
- ✅ Reach corners for strategic positioning
- ✅ Create buffer zones along boundaries
- ✅ Establish outposts in remote regions

## Physics Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| Map Size | 5000x5000 | Full galactic space |
| Inner Zone | 60% radius | Orbital motion active |
| Outer Zone | 80% radius | Gravity begins |
| Max Velocity | 3 units/frame | Speed cap |
| Repulsion Range | 300 units | Collision avoidance |
| Damping | 0.995 | Velocity decay |

## Performance Impact

**No Performance Degradation:**
- Same number of calculations per frame
- Only changed threshold values
- Boundary rendering is minimal (just 4 lines + labels)
- Renders once per frame with other map elements

## Testing

### Verification Steps
1. ✅ Orbitals start near center
2. ✅ Gradually expand outward over time
3. ✅ Can reach positions >2500 units from center
4. ✅ Map boundary is clearly visible
5. ✅ Corner markers help orientation
6. ✅ Coordinate labels show exact position ranges

### Visual Confirmation
- Zoom out fully (scale 0.1x) to see entire 5000x5000 map
- Green dashed border should be visible around entire perimeter
- Corner markers (L-shapes) at all four corners
- Orbitals should eventually reach outer regions

## Files Modified

### JavaScript
- `/srv/ps/public/javascripts/galactic-map-optimized.js`
  - Added `renderBoundary()` function (lines 965-1019)
  - Modified `updatePhysics()` central gravity threshold (line 829)
  - Modified `updatePhysics()` orbital motion zone (line 837)
  - Called `renderBoundary()` in render loop (line 919)

## Future Enhancements

### Map Expansion Features
- [ ] Add "frontier zones" along edges with special properties
- [ ] Edge regions could have higher resource yields
- [ ] Corner territories as strategic strongholds
- [ ] Border patrol routes along perimeter
- [ ] Wormholes at edges connecting to opposite side

### Physics Refinements
- [ ] Faction-specific gravity wells at faction centers
- [ ] Dynamic "current" flows pushing objects in patterns
- [ ] Trade route corridors with speed boosts
- [ ] Danger zones with turbulence effects
- [ ] Safe havens with reduced orbital motion

### Visual Enhancements
- [ ] Grid density increases near edges (navigation aid)
- [ ] Edge regions have different star density
- [ ] Nebula clouds along boundaries
- [ ] Sector labels (quadrants) on map
- [ ] Mini-map showing full extent at all times

## Rollback

If issues arise, revert physics changes:
```javascript
// Restore old values:
if (distFromCenter > 500) { // Was: maxDistFromCenter * 0.8
  const gravityForce = 0.005 * (distFromCenter / 1000);
  // ...
}

if (distFromCenter > 200) { // Was: && distFromCenter < maxDistFromCenter * 0.6
  const orbitalForce = 0.002;
  // ...
}
```

And remove boundary rendering:
```javascript
// Comment out or remove this line from render():
// this.renderBoundary();
```

---

**Map fully expanded!** Orbitals can now explore the entire 5000x5000 galactic space with clear visual boundaries.
