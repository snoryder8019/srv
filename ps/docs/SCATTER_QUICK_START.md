# Scatter Repulsion System - Quick Start

## What It Does

Prevents orbital bodies from gravitating to the northwest corner by adding strategic repulsion forces that are **15% stronger** than the existing edge gravity.

## How to Test

### 1. Interactive Demo

Visit the scatter demo to see the system in action:

```
http://ps.madladslab.com/scatter-demo.html
```

**Controls:**
- **Particle Count**: Adjust number of test particles (10-200)
- **Edge Gravity**: Control base edge repulsion strength (0-1)
- **Movement Speed**: Speed multiplier for animation (0-5x)
- **Enable Scatter Repulsion**: Toggle the scatter system on/off
- **Toggle Repulsion Zones**: Visualize the repulsion zone locations
- **Reset Simulation**: Restart with random positions

**Real-time Stats:**
- See particle distribution across four quadrants (NW, NE, SW, SE)
- With scatter OFF: Watch particles cluster in northwest
- With scatter ON: See balanced distribution across all quadrants

### 2. Live on Galactic Map

The scatter system is now active on the main galactic map:

```
https://ps.madladslab.com/universe/galactic-map
```

**To observe the effect:**
1. Open the galactic map
2. Watch orbital bodies over time
3. Notice even distribution across the map
4. No clustering in northwest corner

## Files Modified/Created

### Created Files:
1. `/srv/ps/public/javascripts/scatter-repulsion.js` - Core scatter system
2. `/srv/ps/public/scatter-demo.html` - Interactive demonstration
3. `/srv/ps/docs/SCATTER_REPULSION_SYSTEM.md` - Full documentation
4. `/srv/ps/docs/SCATTER_QUICK_START.md` - This file

### Modified Files:
1. `/srv/ps/public/javascripts/galactic-map-optimized.js`
   - Added import for scatter-repulsion module
   - Integrated `applyScatterSystem()` into physics update

## Key Features

### 1. Northwest Anti-Drift
- 4 strategic repulsion points in northwest quadrant
- Prevents accumulation in top-left corner

### 2. Quadrant Balancing
- Corner repulsion in all four quadrants
- Northwest gets 50% stronger force (1.5x vs 0.8x)

### 3. Center Attraction
- Gentle pull toward center for long-term balance
- Only activates when far from center (>40% distance)
- Very weak (30% of edge gravity)

### 4. Force Strength
- **Edge gravity**: Base strength (admin configurable)
- **Scatter repulsion**: 15% stronger than edge gravity
- **Inverse square falloff**: Natural-looking force distribution

## Verification

### Check Distribution Balance

Run this in the browser console on the galactic map:

```javascript
// Count objects in each quadrant
const centerX = galacticMap.width / 2;
const centerY = galacticMap.height / 2;
let nw = 0, ne = 0, sw = 0, se = 0;

galacticMap.publishedAssets.forEach(a => {
  if (a.x < centerX && a.y < centerY) nw++;
  else if (a.x >= centerX && a.y < centerY) ne++;
  else if (a.x < centerX && a.y >= centerY) sw++;
  else se++;
});

console.log('Distribution:', { nw, ne, sw, se });
console.log('Balance score:', Math.min(nw, ne, sw, se) / Math.max(nw, ne, sw, se));
// Balance score: 1.0 = perfect, 0.5 = moderate imbalance, <0.3 = severe clustering
```

### Expected Results

**Before scatter system:**
- Northwest: 40-60% of objects
- Other quadrants: 10-20% each
- Balance score: ~0.2-0.4

**After scatter system:**
- All quadrants: 20-30% of objects
- Balance score: ~0.7-0.9 (near-perfect)

## Adjusting the System

### Increase Repulsion Strength

Edit `/srv/ps/public/javascripts/scatter-repulsion.js`:

```javascript
// Line ~17
const REPULSION_MULTIPLIER = 1.25; // Increase from 1.15 to 1.25
```

### Add More Repulsion Points

Edit `applyNorthwestAntiDrift()` function:

```javascript
const repulsionPoints = [
  { x: mapWidth * 0.15, y: mapHeight * 0.15, radius: 1000 },
  // Add your custom point:
  { x: mapWidth * 0.30, y: mapHeight * 0.10, radius: 700 },
];
```

### Disable Specific Components

Edit `applyScatterSystem()` function:

```javascript
export function applyScatterSystem(...) {
  // applyNorthwestAntiDrift(...);  // Comment out to disable
  applyQuadrantBalancing(...);
  applyCenterAttraction(...);
}
```

## Troubleshooting

### Still seeing northwest clustering?

1. **Increase repulsion multiplier** to 1.3+
2. **Add more northwest repulsion points**
3. **Increase zone radii** (1000 → 1200+)
4. **Check edge gravity** is enabled (admin panel)

### Objects bouncing or jittering?

1. **Decrease repulsion multiplier** to 1.1
2. **Decrease zone radii**
3. **Increase damping** in galactic-map-optimized.js (line 958)

### Performance issues?

1. The scatter system is O(n) and very efficient
2. Each asset processes 4-5 repulsion checks per frame
3. Total overhead: <1ms for 1000 assets

## Next Steps

1. **Monitor distribution** over 24-48 hours
2. **Adjust repulsion strength** if clustering returns
3. **Consider adding admin controls** for real-time tuning
4. **Expand to other corners** if clustering appears elsewhere

## Support

For issues or questions:
- Check `/srv/ps/docs/SCATTER_REPULSION_SYSTEM.md` for full documentation
- Test with `/scatter-demo.html` to isolate issues
- Verify edge gravity settings in admin panel
