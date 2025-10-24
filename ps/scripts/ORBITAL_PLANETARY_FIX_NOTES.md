# Orbital-Planetary Relationship Fix Notes

## Date: 2025-10-22

## Problem Identified
The orbital-planetary relationship was backwards:
- **OLD**: Planets had `orbitalId` and `orbitData.parentId` pointing to orbitals (planets orbited orbitals)
- **CORRECT**: Orbitals should orbit planets (like satellites and space stations in reality)

## Changes Made

### 1. Database Migration ✅
**Script**: `/srv/ps/scripts/fix-orbital-planetary-relationships-v2.js`

**What it does**:
- Found all planets with `orbitData.parentId` (17 planets)
- For each orbital that had planets incorrectly orbiting it:
  - Added `planetId` to the orbital pointing to one of the planets
  - Added `orbitData` to the orbital with `parentType: 'planet'`
  - Removed `orbitData` from all planets
- Result: 7 orbitals now correctly orbit planets, 17 planets are now independent

**Verification**:
```
✓ Orbitals with planetId: 7
✓ Orbitals with orbitData (parent=planet): 7
✓ Planets with orbitData: 0 (correct)
```

### 2. View Code Updates ✅
**File**: `/srv/ps/public/javascripts/galactic-state-stream.js`

**Changes**:
- Renamed function comment to "Display planetary systems with their orbiting orbitals"
- Changed filter logic from `planets.filter(p => p.orbitalId === orbital._id)`
  to `orbitals.filter(o => o.planetId === planet._id)`
- Now displays planets as primary objects with orbitals listed underneath them
- Updated UI text from "Orbiting Planets" to "Orbiting Stations"
- Added planet stats display (temperature, gravity, atmosphere, resources)
- Changed icons so planets are primary (with planet icons) and orbitals are secondary (🛰️)

**File**: `/srv/ps/views/universe/galacticState-stream.ejs`

**Changes**:
- Updated section title from "Orbital Bodies & Planetary Systems" to "Planetary Systems & Orbital Stations"
- Added subtitle: "Planets and the orbital stations that orbit them"

### 3. Creation Script Needs Update ⚠️
**File**: `/srv/ps/scripts/create-orbital-zones-and-planets.js`

**Status**: NOT YET UPDATED

**Required Changes**:
1. When creating planets (around line 223-280):
   - Remove `orbitalId` and `orbitalName` fields from planet assets
   - Remove `orbitData` from planet assets
   - Store the first planet's ID for the orbital to reference

2. After creating all planets for an orbital:
   - Update the orbital asset with:
     - `planetId`: ID of the first/primary planet
     - `planetName`: Name of that planet
     - `orbitData`: Object with parentId (planet ID), parentType ('planet'), orbit parameters

3. Update descriptions:
   - Planet description: "world with [orbital name] in orbit" instead of "planet in the [orbital name] system"
   - Planet lore: Remove references to orbiting the orbital

**Example code to add after planet loop**:
```javascript
// After creating all planets for this orbital
if (firstPlanetId) {
  await assetsCollection.updateOne(
    { _id: orbitalAsset._id },
    {
      $set: {
        planetId: firstPlanetId.toString(),
        planetName: firstPlanetName,
        orbitData: {
          parentId: firstPlanetId.toString(),
          parentType: 'planet',
          orbitRadius: 50, // Closer orbit for orbital station
          orbitSpeed: 0.005,
          orbitAngle: Math.random() * Math.PI * 2
        }
      }
    }
  );
  console.log(`  ✓ Updated orbital to orbit ${firstPlanetName}`);
}
```

## New Data Structure

### Planet Asset
```javascript
{
  _id: ObjectId,
  assetType: 'planet',
  title: 'Mercatus Prime',
  subType: 'terrestrial',
  zoneId: '...',
  zoneName: '...',
  // NO orbitalId
  // NO orbitData
  stats: {
    temperature: 37,
    gravity: '1.42',
    atmosphere: 'Dense CO2',
    resources: 3
  }
}
```

### Orbital Asset
```javascript
{
  _id: ObjectId,
  assetType: 'orbital',
  title: 'Trading Post Sigma',
  subType: 'trading-station',
  planetId: '...',  // NEW: References planet it orbits
  planetName: 'Mercatus Prime',  // NEW
  orbitData: {  // NEW: Orbital has orbit data now
    parentId: '...',
    parentType: 'planet',
    orbitRadius: 50,
    orbitSpeed: 0.005,
    orbitAngle: 1.23
  },
  stats: {
    capacity: 7758,
    defenseRating: 524,
    dockingBays: 40
  }
}
```

## Testing

To verify the fix is working:
1. Visit https://ps.madladslab.com/universe/galactic-state
2. Scroll to "Planetary Systems & Orbital Stations"
3. Should see planets listed first with orbital stations underneath them
4. Example: "Mercatus Prime" planet with "Trading Post Sigma" orbital in its list

## Future Considerations

- Update any other scripts that create orbital/planet relationships
- Update 3D visualization to show orbitals orbiting planets
- Consider adding multiple orbitals per planet support in future
- Add ability for players to build their own orbital stations around planets

## Related Files

- Migration: `/srv/ps/scripts/fix-orbital-planetary-relationships-v2.js`
- Old migration: `/srv/ps/scripts/fix-orbital-planetary-relationships.js` (deprecated)
- View JS: `/srv/ps/public/javascripts/galactic-state-stream.js`
- View EJS: `/srv/ps/views/universe/galacticState-stream.ejs`
- Creation script: `/srv/ps/scripts/create-orbital-zones-and-planets.js` (needs update)
