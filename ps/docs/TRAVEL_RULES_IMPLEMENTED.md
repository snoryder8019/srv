# Travel Rules - Implementation Complete ✅

**Date:** November 5, 2025
**Status:** LIVE - Connection-Based Travel & Fall-Into-Galaxy

---

## Summary of Changes

### 1. **All Characters Given 20k Fuel** ✅
- **Script:** [scripts/give-fuel-20k.js](../scripts/give-fuel-20k.js)
- **Result:** All 5 characters now have 20,000 fuel capacity and 20,000 fuel remaining
- **Location:** `character.ship.fittings.fuelTanks.capacity` & `.remaining`

---

## Travel Rules Implemented

### Rule 1: Fall Into Galaxy 🪐

**Requirements:**
- **Distance:** Must be within **500 units** of the galaxy
- **Food:** At least **10 food** in life support
- **Medkits:** At least **1 medkit** in medical bay
- **NO FUEL REQUIRED**

**How It Works:**
- When clicking a galaxy, modal shows two options
- "Fall Into Galaxy" button is **enabled** only if all requirements met
- Button is **orange** when available, **gray** when unavailable
- Uses gravity/momentum to fall into galaxy (no fuel cost)

**Validation:**
- Server validates in `/api/v1/travel/validate` with `travelType: 'fall'`
- Checks distance, food, and medkit requirements
- Returns blockers if any requirement not met

---

### Rule 2: Travel Along Connection 🚀

**Requirements:**
- **Connection:** Must have active **visible connection line** (green/yellow/orange/red)
- **Fuel:** Calculated based on distance (`distance * 0.5` units)
- **Food:** Based on travel time (`travelTimeHours * 2`)
- **Oxygen:** Based on travel time (`travelTimeHours * 5`)
- **Medkits:** Recommended for long journeys (>5000 units)

**How It Works:**
- When clicking a galaxy, modal shows two options
- "Travel Along Connection" button is **always visible**
- Must verify connection exists on galactic map (green/yellow/orange/red line)
- Uses fuel to travel along the established connection path

**Connection States:**
- 🟢 **Green** = Stable (safe to travel)
- 🟡 **Yellow** = Straining (75-85% distance, caution advised)
- 🟠 **Orange** = Getting close to breaking (85-95% distance, risky)
- 🔴 **Red Solid** = About to break (>95% distance, very dangerous)
- 🔴 **Red Dashed** = Recently broken (no travel possible)

---

## Modal UI

### Galaxy Entry Confirmation Dialog

When clicking a galaxy, the modal shows:

```
╔════════════════════════════════════════╗
║  Enter [Galaxy Name]?                  ║
╠════════════════════════════════════════╣
║  Distance: XXX units                   ║
║  Your Ship:                            ║
║    ⛽ Fuel: XXX / XXX needed           ║
║    🍔 Food: XXX / XXX needed           ║
║    💨 Oxygen: XXX / XXX needed         ║
║    💊 Medkits: XXX                     ║
║                                        ║
║  ┌─────────────────────────────────┐  ║
║  │ Choose Travel Method:           │  ║
║  │                                 │  ║
║  │ [🪐 Fall Into Galaxy]           │  ║
║  │ (Food + First Aid)              │  ║
║  │                                 │  ║
║  │ [🚀 Travel Along Connection]    │  ║
║  │ (Requires Fuel + Connection)    │  ║
║  │                                 │  ║
║  │ Fall: <500 units, 10 food, 1 medkit │
║  │ Travel: Active connection, fuel │  ║
║  └─────────────────────────────────┘  ║
║                                        ║
║  ⚠️ You will need supplies to escape  ║
║                                        ║
║  [🚫 Stay Here]                       ║
╚════════════════════════════════════════╝
```

---

## Files Modified

### 1. [api/v1/routes/travel.js](../api/v1/routes/travel.js)
**Lines Modified:** 16-140

**Changes:**
- Added `destinationAssetId`, `currentAsset`, `travelType` parameters
- Implemented "fall" travel type validation
- Checks distance (<500 units), food (>=10), medkits (>=1)
- Connection travel still uses fuel/food/oxygen calculations
- Returns `travelType`, `requirements`, `currentSupplies`, `blockers`, `warnings`

### 2. [views/universe/galactic-map-3d.ejs](../views/universe/galactic-map-3d.ejs)
**Lines Modified:** 3345-3408

**Changes:**
- Added two-button travel selection UI
- "Fall Into Galaxy" button (orange, conditional enable)
- "Travel Along Connection" button (blue, always visible)
- Dynamic button state based on distance/supplies
- Inline validation display
- Custom button handlers replacing default confirm button

### 3. [scripts/give-fuel-20k.js](../scripts/give-fuel-20k.js) ✨ NEW
**Purpose:** Give all characters 20,000 fuel

**What It Does:**
```javascript
db.collection('characters').updateMany(
  {},
  {
    $set: {
      'ship.fittings.fuelTanks.capacity': 20000,
      'ship.fittings.fuelTanks.remaining': 20000
    }
  }
);
```

---

## How To Use

### As a Player:

1. **Navigate to galactic map** (`/universe/galactic-map-3d`)
2. **Click on a galaxy** you want to enter
3. **Modal appears** with two travel options:

#### Option A: Fall Into Galaxy 🪐
- **Check your distance:** Must be within 500 units
- **Check your supplies:** Need 10 food + 1 medkit
- If button is **orange**, you can fall in (no fuel cost)
- If button is **gray**, you're too far or missing supplies

#### Option B: Travel Along Connection 🚀
- **Look for connection line:** Green, yellow, orange, or red line connecting to galaxy
- **Check your fuel:** Need enough fuel for the journey
- If connection exists and you have fuel, you can travel
- Connection color indicates safety level

---

## Testing Checklist

### Test Fall Into Galaxy:
- [ ] Click galaxy when >500 units away → Button should be gray/disabled
- [ ] Move character to <500 units from galaxy → Button should enable
- [ ] Have 0 food → Button should be gray/disabled
- [ ] Have 10 food, 1 medkit, <500 units → Button should be orange/enabled
- [ ] Click "Fall Into Galaxy" → Should enter galaxy interior

### Test Travel Along Connection:
- [ ] Click galaxy with NO visible connection line → Should warn "no connection"
- [ ] Click galaxy with GREEN line visible → Should allow travel (if fuel available)
- [ ] Have 0 fuel → Should show "insufficient fuel" blocker
- [ ] Have 20k fuel → Should allow travel
- [ ] Click "Travel Along Connection" → Should navigate to galaxy

---

## Connection Line States (Reminder)

| Color | State | Distance | Safe to Travel? |
|-------|-------|----------|-----------------|
| 🔵 Blue Dashed | Forming | <5 sec old | ✅ Yes |
| 🟢 Green Solid | Stable | <75% max | ✅ Yes |
| 🟡 Yellow Solid | Straining | 75-85% max | ⚠️ Caution |
| 🟠 Orange Solid | Close to Breaking | 85-95% max | ⚠️ Risky |
| 🔴 Red Solid | About to Break | >95% max | ❌ Dangerous |
| 🔴 Red Dashed | Recently Broken | Broken <10sec ago | ❌ Cannot Travel |

---

## Technical Details

### Fall Into Galaxy Validation
```javascript
if (travelType === 'fall' && destinationAsset?.assetType === 'galaxy') {
  if (distance > 500) blockers.push({ type: 'distance', ... });
  if (currentFood < 10) blockers.push({ type: 'food', ... });
  if (currentMedkits < 1) blockers.push({ type: 'medkits', ... });

  return {
    canTravel: blockers.length === 0,
    travelType: 'fall',
    requirements: { food: 10, medkits: 1, distance: 500 },
    ...
  };
}
```

### Connection Travel Fuel Calculation
```javascript
const requirements = {
  fuel: Math.ceil(distance * 0.5),
  food: Math.ceil(travelTimeHours * 2),
  oxygen: Math.ceil(travelTimeHours * 5),
  medkits: distance > 5000 ? 2 : 0
};
```

---

## Future Enhancements

**Possible Additions:**
1. **Connection travel deduction:** Automatically deduct fuel when traveling along connection
2. **Fall damage:** Take damage based on fall distance (higher = more damage)
3. **Connection failure:** If traveling on red/orange connection, chance of getting stranded mid-journey
4. **Emergency beacon:** If stranded, call for rescue (costs resources)
5. **Trade routes:** Establish profitable trade routes along stable connections
6. **Fast travel:** If connection is green and stable for X days, instant travel option

---

## Summary

✅ **All characters have 20k fuel**
✅ **Fall into galaxy: <500 units, 10 food, 1 medkit**
✅ **Travel along connection: Active line visible, fuel required**
✅ **Modal shows both options with dynamic enable/disable**
✅ **Connection colors show safety level (green→yellow→orange→red)**

**Travel rules now enforce strategic resource management and connection-based navigation!** 🚀🪐

---

**Last Updated:** November 5, 2025
**Status:** ✅ Complete and ready for testing
**Next Step:** Hard refresh browser and test both travel methods!
