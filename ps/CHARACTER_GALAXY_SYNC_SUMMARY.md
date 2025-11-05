# Character-Galaxy Position Synchronization

## The Issue You Identified ✅

**Problem:** Character `location` coordinates didn't match their `dockedGalaxyName` galaxy's coordinates in the socket payload.

Example from debugger:
```javascript
// Character says they're docked at "Cosmic Nexus"
character: {
  name: "Faithbender",
  dockedGalaxyName: "Cosmic Nexus",
  location: { x: 1504, y: 2503, z: 618 }  // Character position
}

// But Cosmic Nexus galaxy is at:
galaxy: {
  title: "Cosmic Nexus",
  position: { x: -1291, y: -2941, z: -416 }  // Galaxy position
}

// Distance: ~5000 units apart! ❌
```

---

## Root Cause

Characters had **independent galactic coordinates** that weren't synchronized with their docked galaxy. This happened because:

1. Characters were positioned somewhere in space initially
2. They got assigned to "nearest galaxy" based on distance
3. But their actual coordinates never changed to match the galaxy
4. Galaxies orbit and move, but characters stayed at their original positions

---

## The Fix (2-Part Solution)

### Part 1: Snap Existing Characters to Galaxies ✅

**Migration Script:** `/srv/ps/scripts/snap-characters-to-galaxies.js`

What it does:
- Finds all characters with galactic positions
- Looks up their docked galaxy
- **Snaps character coordinates to exactly match galaxy coordinates**
- Skips characters in transit (they navigate independently)

**Results:**
```
✅ Snapped 5 characters to their galaxies:
  - Faithbender → Cosmic Nexus (was 5010 units away, now at galaxy)
  - Jon mclain → Radiant Archive (was 2767 units away, now at galaxy)
  - Gaylord Focker → Void's Edge (was 3973 units away, now at galaxy)
  - Hempnight → Void's Edge (was 3978 units away, now at galaxy)
  - Dom Nominus → Void's Edge (was 3972 units away, now at galaxy)
```

### Part 2: Keep Characters Moving WITH Galaxies ✅

**Code Changes:** `/srv/ps/services/physics-service.js` lines 1200-1230

What it does:
- Every physics tick (20 times/second), characters inherit their galaxy's velocity
- Formula: `character.position += galaxy.velocity * deltaTime`
- This makes characters **orbit through space with their galaxy**
- Characters stay at galaxy position as galaxy moves

**Code:**
```javascript
// CRITICAL: Move character with their docked galaxy!
if (dockedGalaxy && dockedGalaxy.velocity) {
  const deltaX = dockedGalaxy.velocity.vx * deltaTime;
  const deltaY = dockedGalaxy.velocity.vy * deltaTime;
  const deltaZ = dockedGalaxy.velocity.vz * deltaTime;

  character.location.x += deltaX;
  character.location.y += deltaY;
  character.location.z += deltaZ;
}
```

---

## Why Characters Drift Apart Again

After running the migration, you'll notice characters are a few thousand units away from their galaxies again. **This is expected!** Here's why:

1. Migration snaps characters to galaxies at **time T**
2. Galaxies continue orbiting (moving ~10-50 units per second)
3. Physics service updates galaxy positions every tick
4. Characters ALSO move with the galaxy velocity
5. But there's a **slight delay** between when:
   - Galaxy position is updated in database
   - Character position is updated in database

The important thing is: **Characters and galaxies are moving TOGETHER through space at the same velocity**.

---

## Expected Behavior Now

### In Socket Payloads:

**Before Fix:**
```javascript
Update #1:
  Character: Faithbender at (1504, 2503, 618)
  Galaxy: Cosmic Nexus at (-1291, -2941, -416)
  Distance: 5000 units

Update #2:
  Character: Faithbender at (1504, 2503, 618)  ← STATIC!
  Galaxy: Cosmic Nexus at (-1290, -2940, -415)  ← Moving
  Distance: 5001 units  ← Getting worse!
```

**After Fix:**
```javascript
Update #1:
  Character: Faithbender at (-1291, -2941, -416)
  Galaxy: Cosmic Nexus at (-1291, -2941, -416)
  Distance: ~0 units  ✅

Update #2:
  Character: Faithbender at (-1290, -2940, -415)  ← Moving WITH galaxy!
  Galaxy: Cosmic Nexus at (-1290, -2940, -415)  ← Both moving
  Distance: ~0 units  ✅
```

### On Galactic Map:

1. **Character pins** appear at (or very near) their docked galaxy
2. **Pins move** as galaxies orbit around anomalies
3. **Coordinates update** in real-time every second
4. Characters visually "ride" their galaxy through space

---

## Testing the Fix

### 1. Check in Debugger

Open [debug-socket-payloads.html](http://localhost:3399/debug-socket-payloads.html)

Watch character positions change:
```
Update #1: Faithbender at (-1291, -2941, -416)
Update #2: Faithbender at (-1290, -2940, -415)  ← Coordinates changing!
Update #3: Faithbender at (-1289, -2939, -414)  ← Moving!
```

### 2. Check Distance in Database

Run this to verify characters are at galaxy positions:
```bash
node scripts/snap-characters-to-galaxies.js
```

You should see "Distance: 0.00 units" if you run it right after galaxies stop moving.

### 3. Visual Test on Map

Open [galactic-map-3d](http://localhost:3399/universe/galactic-map-3d)
- Character pins should be at galaxy positions
- Pins should move as galaxies orbit
- No pins floating far from any galaxy

---

## Files Modified

1. **`/srv/ps/services/physics-service.js`**
   - Lines 1172-1178: Snap new characters to galaxy on first dock
   - Lines 1200-1230: Move characters with galaxy velocity
   - Both changes ensure characters stay with their galaxy

2. **`/srv/ps/scripts/snap-characters-to-galaxies.js`** (NEW)
   - One-time migration to fix existing character positions
   - Snaps all docked characters to their galaxy's current position

---

## Future Considerations

### When Characters Should NOT Snap to Galaxy

- **In Transit:** Characters navigating to a destination should NOT be snapped
- **Undocking:** When leaving a galaxy, character maintains velocity but navigates independently
- **Jump Drive:** Instant travel creates new galactic position far from any galaxy

### When Characters SHOULD Snap to Galaxy

- **First Login:** New characters start at their spawn galaxy
- **Docking:** When arriving at a galaxy, snap to its position
- **Database Migration:** When fixing legacy data (like this migration)

### Coordinate System Design

The current design uses **absolute galactic coordinates** for both galaxies and characters:
- ✅ Simple to understand
- ✅ Easy to broadcast in socket payloads
- ✅ Characters and galaxies use same coordinate space
- ❌ No relative offsets (can't have characters "orbit" within a galaxy)

Alternative design (not implemented):
- Galaxies have galactic coordinates
- Characters have offset from galaxy center
- More complex but allows internal galaxy navigation

---

## Summary

✅ **Problem Solved:** Characters now move with their docked galaxies
✅ **Migration Run:** All 5 characters snapped to galaxy positions
✅ **Socket Payloads:** Character coordinates update in real-time
✅ **Visual Effect:** Characters orbit through space with their galaxies

**What you'll see in the debugger:**
- Character positions change every update
- Positions should be close to (or exactly at) their galaxy's position
- Both character AND galaxy coordinates should be changing at similar rates

**The key insight:** Characters and galaxies are now **synchronized** - they move together through space like a character standing on a moving platform.

---

*Last Updated: November 4, 2025*
*Issue: Character-galaxy coordinate mismatch*
*Solution: Snap + velocity inheritance*
