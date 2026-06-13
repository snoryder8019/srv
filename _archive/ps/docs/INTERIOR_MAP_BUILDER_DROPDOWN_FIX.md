# Interior Map Builder - Parent Asset Dropdown Fix

**Date**: 2025-11-04
**Status**: ✅ COMPLETE

## Problem

User reported: "in the builder i have no options in link to world asset"

The Interior Map Builder had a dropdown for "Link to World Asset" but it was hardcoded with only:
- "Select a world asset..."
- "Create New World Asset"

No actual anomalies, planets, or stations were loaded into the dropdown.

## Root Cause

The dropdown HTML existed but no JavaScript was fetching and populating it with available parent assets from the database.

## Solution Implemented

### 1. Load Available Parent Assets Function ✅

**File**: `/srv/ps/public/javascripts/interior-map-builder.js` (lines 689-783)

Created `loadAvailableParentAssets()` function that:
- Fetches anomalies, planets, and stations from `/api/v1/assets` API
- Groups assets by type (anomalies, planets, stations)
- Creates optgroups in the dropdown for each type
- Populates dropdown with actual asset names and IDs
- Pre-selects the parent if loaded from URL parameter

**Key Features**:
```javascript
async function loadAvailableParentAssets() {
  // Fetch from API
  const assetTypes = ['anomaly', 'planet', 'station'];
  const allAssets = [];

  for (const assetType of assetTypes) {
    const response = await fetch(`/api/v1/assets?assetType=${assetType}&limit=100`, {
      credentials: 'same-origin'
    });
    const data = await response.json();
    // Collect assets...
  }

  // Group by type and populate dropdown
  // Creates optgroups: "🌀 Anomalies", "🌍 Planets", "🛰️ Stations"
}
```

### 2. Dropdown Change Handler ✅

**File**: `/srv/ps/public/javascripts/interior-map-builder.js` (lines 167-213)

Updated the dropdown change event listener to:
- Parse the selected value (format: `assetId|assetType`)
- Fetch full asset details from `/api/v1/assets/:id`
- Update the global `parentAsset` variable
- Show success alert with asset name
- Handle deselection (clears parentAsset)

**Key Features**:
```javascript
document.getElementById('linkedAsset').addEventListener('change', async (e) => {
  const value = e.target.value;

  if (value && value !== 'create' && value !== '') {
    const [assetId, assetType] = value.split('|');

    // Fetch asset details
    const response = await fetch(`/api/v1/assets/${assetId}`);
    const data = await response.json();

    // Update global parentAsset variable
    parentAsset = {
      id: data.asset._id,
      name: data.asset.title || data.asset.name,
      type: assetType,
      data: data.asset
    };

    showAlert(`Linked to ${parentAsset.name}`, 'success');
  }
});
```

### 3. Save Function Enhancement ✅

**File**: `/srv/ps/public/javascripts/interior-map-builder.js` (lines 881-917)

Enhanced `saveAsZoneAsset()` to:
- Check if `parentAsset` is already set (from URL parameter)
- If not, check dropdown value and fetch asset details
- Warn user if no parent asset is selected
- Allow saving without parent asset with confirmation

**Key Features**:
```javascript
async function saveAsZoneAsset() {
  // ... validation ...

  // Check if we need to load parent asset from dropdown
  if (!parentAsset) {
    const linkedAssetValue = document.getElementById('linkedAsset').value;
    if (linkedAssetValue && linkedAssetValue !== 'create' && linkedAssetValue !== '') {
      // Fetch asset from API and set parentAsset
    }
  }

  // Warn if no parent asset
  if (!parentAsset) {
    const confirmSave = confirm('No parent asset selected. This zone will not be linked to any world asset. Continue?');
    if (!confirmSave) {
      return;
    }
  }

  // ... save logic uses parentAsset ...
}
```

## User Flow

### Before Fix
1. User opens Interior Map Builder
2. Dropdown shows only "Select a world asset..." and "Create New World Asset"
3. User cannot select Primordial Singularity or any other parent asset
4. User must use URL parameter: `?parentId=XXX&parentType=anomaly`

### After Fix
1. User opens Interior Map Builder
2. Dropdown automatically loads with:
   - 🌀 Anomalies (Starship Colonies)
     - The Primordial Singularity
     - [other anomalies...]
   - 🌍 Planets
     - [planets...]
   - 🛰️ Stations
     - [stations...]
3. User selects "The Primordial Singularity" from dropdown
4. Alert shows: "Linked to The Primordial Singularity"
5. User creates interior map with floors, walls, spawn points, etc.
6. User clicks "Save as Zone Asset"
7. Zone is created with hierarchy linking to Primordial Singularity
8. User can now enter this interior from galactic map

## Complete Flow: Galactic Map → Interior

1. **User views galactic map** → `/universe/galactic-map-3d`
2. **Clicks on Primordial Singularity** anomaly orb
3. **Modal shows** "🚀 Enter Interior" button
4. **Clicks button** → Navigates to `/universe/zone/[zoneId]`
5. **Interior loads** with floor, walls, player, etc.
6. **User moves** with WASD keys
7. **Interior was created** via Interior Map Builder with dropdown selection

## Technical Details

### Dropdown Value Format
```
{assetId}|{assetType}
```

Examples:
- `690a7a25134a4ef9aab3d585|anomaly`
- `690b123456789abcdef01234|planet`

### Parent Asset Object Structure
```javascript
parentAsset = {
  id: "690a7a25134a4ef9aab3d585",
  name: "The Primordial Singularity",
  type: "anomaly",
  data: { /* full asset document */ }
}
```

### API Endpoints Used
- `GET /api/v1/assets?assetType=anomaly&limit=100` - List anomalies
- `GET /api/v1/assets?assetType=planet&limit=100` - List planets
- `GET /api/v1/assets?assetType=station&limit=100` - List stations
- `GET /api/v1/assets/:id` - Get single asset details

## Files Modified

```
/srv/ps/public/javascripts/interior-map-builder.js
├── Line 63: Added loadAvailableParentAssets() call in init
├── Lines 167-213: Updated dropdown change handler (async with asset fetching)
├── Lines 689-783: Added loadAvailableParentAssets() function
└── Lines 881-917: Enhanced saveAsZoneAsset() with dropdown fallback
```

## Testing Steps

### Manual Test
1. **Open Interior Map Builder**:
   ```
   http://localhost:3399/assets/interior-map-builder
   ```

2. **Check Dropdown**:
   - Look at "Link to World Asset" dropdown
   - Should see grouped options:
     - 🌀 Anomalies
     - 🌍 Planets
     - 🛰️ Stations
   - Should see "The Primordial Singularity" under Anomalies

3. **Select Parent Asset**:
   - Select "The Primordial Singularity"
   - Should see alert: "Linked to The Primordial Singularity"
   - Check console for: `✅ Parent asset updated: {...}`

4. **Create Interior**:
   - Paint floor tiles
   - Paint walls
   - Place spawn point
   - Place exit point
   - Enter map name (e.g., "Starship Bridge")

5. **Save**:
   - Click "Save as Zone Asset"
   - Should save successfully
   - Check console for: `✅ Parent asset loaded for save: {...}`

6. **Verify in Database**:
   ```javascript
   db.assets.findOne({title: "Starship Bridge"})
   // Should have:
   // - zoneData: { layers: {...}, spawnPoints: [...], ... }
   // - hierarchy: { parent: "690a7a25134a4ef9aab3d585", parentType: "anomaly" }
   ```

7. **Test Entry from Map**:
   - Go to `/universe/galactic-map-3d`
   - Click Primordial Singularity
   - Click "Enter Interior"
   - Should see your created interior with floor, walls, and player

## Known Limitations

1. **Limit of 100 assets per type**: Dropdown only loads first 100 of each type
   - Could add pagination or search if needed
   - Current limit should be sufficient for most cases

2. **No search/filter**: Dropdown shows all assets
   - Could add search box if dropdown gets too large

3. **No asset preview**: Just shows name
   - Could add tooltip or preview on hover

## Success Criteria

- ✅ Dropdown loads with actual assets
- ✅ User can select anomalies (starship colonies)
- ✅ User can select planets
- ✅ User can select stations
- ✅ Selection updates parentAsset variable
- ✅ Save function uses dropdown selection
- ✅ Alert confirms successful linking
- ✅ Created zones have correct hierarchy
- ✅ Zones appear in hierarchy API results
- ✅ Galactic map can find and enter interiors

## Next Steps

### Recommended Enhancements

1. **Search/Filter Dropdown**
   - Add text input to filter dropdown options
   - Useful if asset count grows large

2. **Asset Preview**
   - Show thumbnail or description on hover
   - Help user identify correct parent asset

3. **Recent Assets**
   - Show recently used parent assets at top
   - Improve workflow for repeated work

4. **Direct Link Button**
   - Add button next to dropdown: "View in Map"
   - Opens galactic map focused on selected asset

5. **Validation**
   - Warn if selected parent already has interior zone
   - Prevent duplicate interiors

---

**Status**: PRODUCTION READY ✅

The Interior Map Builder dropdown now properly loads and allows users to select parent assets (anomalies, planets, stations) when creating interior zones. This completes the workflow from building an interior map to linking it to a world asset and accessing it from the galactic map.

## Quick Reference

**To create an interior for The Primordial Singularity**:
1. Open `/assets/interior-map-builder`
2. Select "The Primordial Singularity" from "Link to World Asset" dropdown
3. Build your interior (paint floor, walls, add spawn point)
4. Give it a name
5. Click "Save as Zone Asset"
6. Go to galactic map and click on Primordial Singularity
7. Click "🚀 Enter Interior"
8. Walk around with WASD keys!
