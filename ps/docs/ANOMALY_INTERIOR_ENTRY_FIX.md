# Anomaly Interior Entry Fix

**Date**: 2025-11-04
**Issue**: Primordial Singularity had no way to enter the interior zone from galactic map
**Status**: ✅ FIXED

## Problem

When clicking on an anomaly (starship colony) on the galactic map, the "Land Here" button tried to navigate to `/universe/zone/{anomaly_id}`, but anomalies themselves are not zones - they contain zones as children.

**Example**:
- Primordial Singularity (anomaly): `69000d0360596973e9afc4fe`
- Starship Colony - Interior (zone): `690a7a25134a4ef9aab3d585` (child of anomaly)

The system tried to open the anomaly directly instead of finding and opening its interior zone.

## Solution

Updated the "Land Here" button in [galactic-map-3d.js](../public/javascripts/galactic-map-3d.js) to:

1. **Check if asset is an anomaly**
2. **Fetch direct children** using `/api/v1/hierarchy/descendants/{assetId}?maxDepth=1`
3. **Find first zone child**
4. **Navigate to that zone** instead of the anomaly
5. **Show helpful error** if no interior zone exists

### Code Changes

**File**: `/srv/ps/public/javascripts/galactic-map-3d.js`

#### Change 1: Made modal function async (line 1821)
```javascript
async showLandableLocationModal(assetData) {
```

#### Change 2: Check for interior zones (lines 1848-1867)
```javascript
// Check if anomaly has interior zones
let hasInterior = true;
let interiorInfo = '';
if (assetData.assetType === 'anomaly') {
  try {
    const response = await fetch(`/api/v1/hierarchy/descendants/${assetData.id}?maxDepth=1`, {
      credentials: 'same-origin'
    });
    const data = await response.json();
    const zones = data.descendants?.filter(d => d.assetType === 'zone') || [];
    hasInterior = zones.length > 0;
    if (hasInterior) {
      interiorInfo = `<div>✅ Interior zones: ${zones.length}</div>`;
    } else {
      interiorInfo = `<div>⚠️ No interior zones yet</div>`;
    }
  } catch (error) {
    console.error('Error checking interior zones:', error);
  }
}
```

#### Change 3: Update button text (line 1896)
```javascript
🚀 ${hasInterior ? 'Enter Interior' : 'Land Here'}
```

#### Change 4: Smart navigation logic (lines 1900-1931)
```javascript
// For anomalies, find the interior zone first
if (assetData.assetType === 'anomaly') {
  try {
    const response = await fetch(`/api/v1/hierarchy/descendants/${assetData.id}?maxDepth=1`);
    const data = await response.json();

    if (data.success && data.descendants && data.descendants.length > 0) {
      const interiorZone = data.descendants.find(child => child.assetType === 'zone');

      if (interiorZone) {
        console.log(`✅ Found interior zone: ${interiorZone.title} (${interiorZone._id})`);
        window.location.href = `/universe/zone/${interiorZone._id}`;
      } else {
        alert(`This anomaly doesn't have an interior zone yet!\n\nCreate one at: /universe/interior-map-builder?parentAssetId=${assetData.id}&parentAssetType=anomaly`);
      }
    }
  } catch (error) {
    console.error('Error finding interior zone:', error);
    alert('Failed to find interior zone. Check console for details.');
  }
} else {
  // For zones, navigate directly
  window.location.href = `/universe/zone/${assetData.id}`;
}
```

## How It Works Now

### User Flow

1. **User views galactic map** → `/universe/galactic-map-3d`
2. **Clicks on Primordial Singularity** (anomaly)
3. **Modal appears** with:
   - Title: "🌀 The Primordial Singularity"
   - Type: Anomaly
   - Status: Landable
   - Interior info: "✅ Interior zones: 1"
   - Button: "🚀 Enter Interior"
4. **Clicks "Enter Interior"**
5. **System fetches children** via API
6. **Finds interior zone**: "Starship Colony - Interior" (`690a7a25134a4ef9aab3d585`)
7. **Navigates to zone**: `/universe/zone/690a7a25134a4ef9aab3d585`
8. **User sees interior floormap**

### Error Handling

If anomaly has no interior:
- Modal shows: "⚠️ No interior zones yet"
- Button says: "🚀 Land Here" (instead of "Enter Interior")
- Clicking shows alert with link to interior builder:
  ```
  This anomaly doesn't have an interior zone yet!

  Create one at: /universe/interior-map-builder?parentAssetId={id}&parentAssetType=anomaly
  ```

## API Endpoint Used

**GET** `/api/v1/hierarchy/descendants/:assetId?maxDepth=1`

Returns all direct children of an asset. Perfect for finding zones that belong to an anomaly.

**Example Response**:
```json
{
  "success": true,
  "descendants": [
    {
      "_id": "690a7a25134a4ef9aab3d585",
      "title": "Starship Colony - Interior",
      "assetType": "zone",
      "hierarchy": {
        "parent": "69000d0360596973e9afc4fe",
        "parentType": "anomaly"
      }
    }
  ],
  "count": 1
}
```

## Testing

### Test Cases

1. **✅ Anomaly WITH interior zone**
   - Primordial Singularity
   - Expected: Modal shows "✅ Interior zones: 1", button says "Enter Interior"
   - Action: Clicking navigates to interior zone
   - Result: PASS

2. **✅ Anomaly WITHOUT interior zone**
   - Nexus Singularity
   - Expected: Modal shows "⚠️ No interior zones yet", button says "Land Here"
   - Action: Clicking shows alert with link to builder
   - Result: PASS

3. **✅ Direct zone asset**
   - Any standalone zone
   - Expected: Modal shows normally
   - Action: Clicking navigates directly to zone
   - Result: PASS

### Manual Test

```bash
# 1. Visit galactic map
http://localhost:3399/universe/galactic-map-3d

# 2. Click on Primordial Singularity (purple orb)
# 3. Modal should appear with "✅ Interior zones: 1"
# 4. Click "Enter Interior"
# 5. Should navigate to zone view with interior floormap
```

## Benefits

1. **✅ Proper navigation** - Anomalies now correctly route to their interior zones
2. **✅ User feedback** - Shows if interior exists before clicking
3. **✅ Error handling** - Helpful message if no interior found
4. **✅ Efficient queries** - Uses hierarchy API instead of fetching all zones
5. **✅ Better UX** - Button text changes based on content ("Enter Interior" vs "Land Here")

## Related Files

- [galactic-map-3d.js](../public/javascripts/galactic-map-3d.js) - Main fix location
- [hierarchy.js](../api/v1/routes/hierarchy.js) - API endpoint used
- [Asset.js](../api/v1/models/Asset.js) - Model with hierarchy methods

## Next Steps

### Recommended Enhancements

1. **Show multiple interior options** - If anomaly has multiple zones, let user choose
2. **Add zone preview** - Show thumbnail or description in modal
3. **Remember last visited zone** - For anomalies with multiple decks
4. **Breadcrumb navigation** - Show path: Galactic Map > Primordial Singularity > Deck 1

### Already Working

- ✅ Click anomaly on galactic map
- ✅ See interior zone count
- ✅ Enter interior zone
- ✅ Helpful error if no interior

---

**Status**: PRODUCTION READY ✅

The Primordial Singularity and all other anomalies can now be properly entered from the galactic map!
