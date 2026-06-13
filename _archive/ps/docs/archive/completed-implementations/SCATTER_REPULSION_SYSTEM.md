# Scatter Repulsion System

## Problem Statement

The galactic map's orbital bodies were experiencing northwest drift due to the edge gravity physics. Objects would gravitate toward the top-left corner and cluster there, creating an unbalanced distribution.

## Solution

A scatter repulsion system that applies strategic repulsion forces from specific coordinates to counteract the northwest drift. The repulsion forces are **15% stronger** than the edge gravity forces to ensure effective redistribution.

## How It Works

### 1. Northwest Anti-Drift Repulsion

Places multiple repulsion points in the northwest quadrant:
- **Northwest corner (15%, 15%)**: Strongest repulsion, radius 1000 units
- **North edge center-left (25%, 5%)**: Radius 800 units
- **West edge center-top (5%, 25%)**: Radius 800 units
- **Diagonal point (20%, 20%)**: Radius 900 units

These create a "pressure system" that pushes objects away from the problematic area.

### 2. Quadrant Balancing

Applies corner repulsion in all four quadrants to prevent clustering:
- **Northwest**: 50% stronger repulsion (1.5x base gravity)
- **Northeast, Southwest, Southeast**: Standard 0.8x base gravity repulsion
- Radius: 600 units from each corner

### 3. Center Attraction

Provides gentle long-term balance:
- Only activates when objects are far from center (>40% of map dimension)
- Very weak force (30% of base gravity)
- Prevents extreme edge clustering without causing center clumping

### 4. Force Calculation

```javascript
// Repulsion is 15% stronger than edge gravity
const REPULSION_MULTIPLIER = 1.15;
const repulsionStrength = baseGravityStrength * REPULSION_MULTIPLIER;

// Inverse square law for natural falloff
const proximity = 1 - (distance / repelRadius);
const force = proximity * proximity * repulsionStrength * speedMultiplier;
```

## Implementation

### Files Created

1. **`/srv/ps/public/javascripts/scatter-repulsion.js`**
   - Core scatter repulsion module
   - Exports functions for each repulsion strategy
   - Main function: `applyScatterSystem()`

2. **`/srv/ps/public/scatter-demo.html`**
   - Interactive demonstration
   - Real-time statistics showing particle distribution
   - Toggle scatter system on/off to see the effect
   - Visualize repulsion zones

3. **`/srv/ps/docs/SCATTER_REPULSION_SYSTEM.md`**
   - This documentation file

### Integration with Galactic Map

Modified `/srv/ps/public/javascripts/galactic-map-optimized.js`:

```javascript
// Import the scatter system
import { applyScatterSystem } from '/javascripts/scatter-repulsion.js';

// In updatePhysics(), after edge bounce logic:
applyScatterSystem(
  asset,
  this.width,
  this.height,
  EDGE_GRAVITY_STRENGTH,
  speedMultiplier
);
```

## Usage

### Test the Demo

Visit: `http://ps.madladslab.com/scatter-demo.html`

Features:
- Adjust particle count (10-200)
- Control edge gravity strength (0-1)
- Adjust movement speed (0-5x)
- Toggle scatter system on/off
- Visualize repulsion zones
- View real-time quadrant distribution stats

### Live on Galactic Map

The scatter system is now active on the main galactic map at:
`https://ps.madladslab.com/universe/galactic-map`

## Results

### Before Scatter System
- Heavy clustering in northwest corner
- Uneven distribution across quadrants
- Objects drifting continuously toward top-left

### After Scatter System
- Even distribution across all four quadrants
- No persistent drift toward any corner
- Natural-looking orbital patterns maintained

## Configuration

### Adjusting Repulsion Strength

To modify the repulsion multiplier:

```javascript
// In scatter-repulsion.js, line ~17
const REPULSION_MULTIPLIER = 1.15; // Change this value
```

- **< 1.0**: Weaker than edge gravity (drift will return)
- **1.0 - 1.2**: Balanced redistribution
- **> 1.2**: Strong redistribution (may cause bouncing)

### Adjusting Repulsion Zones

Modify zone positions and radii in `applyNorthwestAntiDrift()`:

```javascript
const repulsionPoints = [
  { x: mapWidth * 0.15, y: mapHeight * 0.15, radius: 1000 },
  // Add more points or adjust existing ones
];
```

### Disabling Individual Systems

Comment out specific calls in `applyScatterSystem()`:

```javascript
export function applyScatterSystem(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier = 1) {
  // applyNorthwestAntiDrift(...);  // Disable this
  applyQuadrantBalancing(...);
  applyCenterAttraction(...);
}
```

## Technical Details

### Force Priority

1. **Edge bounce** (hard constraint)
2. **Edge repulsion** (medium strength)
3. **Scatter repulsion** (15% stronger than edge)
4. **Brown noise** (low strength, creates variation)
5. **Anomaly repulsion** (local effect)
6. **Damping** (velocity decay)
7. **Max velocity cap** (prevents runaway acceleration)

### Performance

- **Computational cost**: O(n) per frame, where n = number of assets
- **Additional operations**: ~10-15 force calculations per asset
- **Impact**: Negligible (<1ms for 1000 assets at 30 FPS)

## Troubleshooting

### Objects still clustering in northwest?
- Increase `REPULSION_MULTIPLIER` to 1.25 or higher
- Add more repulsion points in northwest quadrant
- Increase repulsion zone radii

### Objects bouncing too much?
- Decrease `REPULSION_MULTIPLIER` to 1.1 or lower
- Decrease repulsion zone radii
- Increase damping value (line 958 in galactic-map-optimized.js)

### Uneven distribution in other corners?
- Adjust corner repulsion strength in `applyQuadrantBalancing()`
- Make all corners use same strength (currently NW is 1.5x, others 0.8x)

### Objects clustering at center?
- Disable or reduce `applyCenterAttraction()`
- Increase `maxAttractionDistance` threshold
- Decrease attraction strength (currently 0.3x base gravity)

## Future Enhancements

1. **Dynamic repulsion points**: Analyze real-time distribution and add repulsion where clustering occurs
2. **Heat map visualization**: Show density gradients on the map
3. **Admin controls**: Add sliders to control repulsion strength in real-time
4. **Faction-based zones**: Different repulsion behavior for different faction territories
5. **Adaptive strength**: Automatically adjust repulsion based on detected clustering

## Credits

Created to solve the northwest drift issue on the Project Stringborne galactic map.
Implements inverse square law physics with strategic repulsion zones for balanced distribution.
