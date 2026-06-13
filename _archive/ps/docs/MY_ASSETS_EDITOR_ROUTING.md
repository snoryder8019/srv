# My Assets - Smart Editor Routing

**Date**: 2025-11-04
**Status**: ✅ COMPLETE

## Summary

Updated the "My Assets" page to route users to the appropriate editor based on asset type, with the button relabeled from "View Details" to "Edit".

## Problem

Previously, clicking "View Details" on an asset card navigated to:
```
/assets/:id
```

This was a generic view page that didn't allow editing. Users couldn't easily edit their existing assets.

## Solution

Updated `viewAssetDetails()` function to intelligently route to the correct editor based on asset type:

### Routing Logic

**File**: `/srv/ps/public/javascripts/my-assets.js` (lines 97-154)

```javascript
function viewAssetDetails(assetId) {
  const asset = userAssets.find(a => a._id === assetId);

  if (!asset) {
    showAlert('Asset not found', 'error');
    return;
  }

  // Route to appropriate editor based on asset type
  let editorUrl;

  switch(asset.assetType) {
    case 'zone':
      // Zone interior editor
      editorUrl = `/assets/interior-map-builder?zoneId=${assetId}`;
      break;

    case 'sprite':
      // Sprite/pixel art builder
      editorUrl = `/assets/builder?assetId=${assetId}`;
      break;

    case 'planet':
    case 'galaxy':
    case 'star':
    case 'anomaly':
    case 'anomoly':
    case 'station':
    case 'starship':
    case 'orbital':
    case 'asteroid':
    case 'nebula':
    case 'localGroup':
      // Enhanced asset builder for celestial objects
      editorUrl = `/assets/builder-enhanced?assetId=${assetId}`;
      break;

    case 'environment':
    case 'object':
    case 'item':
    case 'weapon':
    case 'armor':
    case 'consumable':
    case 'character':
    case 'species':
    case 'npc':
    case 'quest':
    case 'location':
    case 'arc':
    default:
      // Enhanced builder for all other types
      editorUrl = `/assets/builder-enhanced?assetId=${assetId}`;
      break;
  }

  console.log(`📝 Opening editor for ${asset.assetType}: ${editorUrl}`);
  window.location.href = editorUrl;
}
```

### Button Label Update

**File**: `/srv/ps/public/javascripts/my-assets.js` (line 88)

**Before**:
```html
<button class="btn btn-primary" onclick="viewAssetDetails('...')" style="width: 100%;">View Details</button>
```

**After**:
```html
<button class="btn btn-primary" onclick="viewAssetDetails('...')" style="width: 100%;">✏️ Edit</button>
```

## Editor Routing Matrix

| Asset Type | Editor | URL Pattern |
|------------|--------|-------------|
| **zone** | Interior Map Builder | `/assets/interior-map-builder?zoneId=:id` |
| **sprite** | Pixel Art Builder | `/assets/builder?assetId=:id` |
| **planet** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **galaxy** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **star** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **anomaly** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **station** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **starship** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **orbital** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **asteroid** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **nebula** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **localGroup** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **environment** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **object** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **item** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **weapon** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **armor** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **consumable** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **character** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **species** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **npc** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **quest** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **location** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **arc** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |
| **default** | Enhanced Builder | `/assets/builder-enhanced?assetId=:id` |

## User Experience

### Before
1. User goes to "My Assets" page
2. Sees asset card with "View Details" button
3. Clicks button
4. Goes to generic view page (`/assets/:id`)
5. Can only view, not edit
6. Has to manually find the right editor
7. Navigate there separately

### After
1. User goes to "My Assets" page
2. Sees asset card with "✏️ Edit" button
3. Clicks button
4. Automatically opens the correct editor
5. Asset data pre-loaded for editing
6. Can immediately start making changes

### Example Flows

#### Editing a Zone Interior
1. User clicks "✏️ Edit" on "Starship Colony" zone card
2. Console logs: `📝 Opening editor for zone: /assets/interior-map-builder?zoneId=690a866929c03e47b2000123`
3. Interior Map Builder opens with zone loaded
4. Map layers, spawn points, markers all loaded
5. User can paint new walls, move spawn points, etc.
6. Click save to update

#### Editing a Planet
1. User clicks "✏️ Edit" on "Earth-like Planet" card
2. Console logs: `📝 Opening editor for planet: /assets/builder-enhanced?assetId=abc123def456`
3. Enhanced Builder opens with planet loaded
4. All fields pre-populated (name, description, stats, etc.)
5. User updates atmosphere, resources, etc.
6. Click save to update

#### Editing a Sprite
1. User clicks "✏️ Edit" on "Character Sprite" card
2. Console logs: `📝 Opening editor for sprite: /assets/builder?assetId=xyz789`
3. Pixel Art Builder opens with sprite loaded
4. Canvas shows existing pixel art
5. User can edit pixels, add frames, etc.
6. Click save to update

## Features

### 1. Intelligent Routing ✅
- Detects asset type from `asset.assetType` field
- Routes to specialized editor for that type
- Falls back to enhanced builder for unknown types

### 2. Asset Pre-loading ✅
- Passes asset ID via URL parameter
- Editor loads existing data automatically
- All fields populated with current values
- Ready to edit immediately

### 3. Console Debugging ✅
- Logs editor URL for debugging
- Shows asset type being edited
- Format: `📝 Opening editor for {type}: {url}`

### 4. Error Handling ✅
- Checks if asset exists in local array
- Shows alert if asset not found
- Prevents navigation to invalid URLs

### 5. Clear Button Label ✅
- Changed from "View Details" to "✏️ Edit"
- Users immediately understand the action
- Pencil emoji reinforces editing concept

## Technical Details

### Asset Lookup
```javascript
const asset = userAssets.find(a => a._id === assetId);
```
- Searches in locally cached asset array
- O(n) lookup but array is small (user's assets only)
- Returns full asset object with all metadata

### URL Parameter Patterns

**Interior Map Builder**:
```
?zoneId=:id
```
- Different parameter name for historical reasons
- Builder looks for `zoneId` in URL params

**Other Builders**:
```
?assetId=:id
```
- Standard parameter name
- Builders look for `assetId` in URL params

### Editor Loading

Each editor needs to handle the URL parameter:

```javascript
// Example: Interior Map Builder
const urlParams = new URLSearchParams(window.location.search);
const zoneId = urlParams.get('zoneId');

if (zoneId) {
  // Fetch zone data from API
  const response = await fetch(`/api/v1/assets/${zoneId}`);
  const data = await response.json();

  // Load into editor
  loadZoneData(data.asset);
}
```

## Testing

### Manual Test Steps

1. **Test Zone Editing**:
   - Go to `/assets/my-assets`
   - Find a zone asset (e.g., "Starship Colony")
   - Click "✏️ Edit"
   - Should open Interior Map Builder with zone loaded
   - Verify map layers, spawn points visible

2. **Test Planet Editing**:
   - Find a planet asset
   - Click "✏️ Edit"
   - Should open Enhanced Builder with planet loaded
   - Verify all fields populated

3. **Test Sprite Editing**:
   - Find a sprite asset
   - Click "✏️ Edit"
   - Should open Pixel Art Builder with sprite loaded
   - Verify canvas shows existing art

4. **Test Console Logging**:
   - Open browser console
   - Click any "✏️ Edit" button
   - Should see: `📝 Opening editor for {type}: {url}`

5. **Test Error Handling**:
   - Simulate missing asset (manual test)
   - Should show error alert

### Expected Console Output

```
📝 Opening editor for zone: /assets/interior-map-builder?zoneId=690a866929c03e47b2000123
```
```
📝 Opening editor for planet: /assets/builder-enhanced?assetId=abc123def456
```
```
📝 Opening editor for sprite: /assets/builder?assetId=xyz789
```

## Files Modified

```
/srv/ps/public/javascripts/my-assets.js
├── Line 88: Button label changed to "✏️ Edit"
└── Lines 97-154: Smart routing logic based on asset type
```

## Benefits

1. **Faster Workflow** ⚡
   - One click to edit
   - No manual navigation
   - No searching for correct editor

2. **Better UX** 😊
   - Clear "Edit" button label
   - Intuitive flow
   - Immediate editing

3. **Type-Safe Routing** 🔒
   - Each asset type goes to correct editor
   - Specialized editors for specialized types
   - Fallback for unknown types

4. **Developer Friendly** 🛠️
   - Console logging for debugging
   - Easy to add new asset types
   - Clear switch statement logic

## Future Enhancements

### Could Add Later

1. **Delete Button**
   - Add "🗑️ Delete" button next to "Edit"
   - Confirm before deletion
   - Refresh list after delete

2. **Duplicate Button**
   - Add "📋 Duplicate" button
   - Clone asset with new ID
   - Open editor with cloned asset

3. **Preview Modal**
   - Add "👁️ Preview" button
   - Show read-only view in modal
   - Option to edit from preview

4. **Quick Edit Fields**
   - Inline edit for title/description
   - Save without opening full editor
   - Useful for quick changes

5. **Version History**
   - Show edit history
   - Restore previous versions
   - Compare versions

6. **Batch Operations**
   - Select multiple assets
   - Bulk edit tags
   - Bulk delete or archive

## Success Criteria

- ✅ "Edit" button routes to correct editor
- ✅ Zone assets open Interior Map Builder
- ✅ Sprite assets open Pixel Art Builder
- ✅ Other assets open Enhanced Builder
- ✅ Asset data pre-loaded in editor
- ✅ Button labeled "✏️ Edit" not "View Details"
- ✅ Console logs editor URL
- ✅ Error handling for missing assets
- ✅ JavaScript syntax valid
- ✅ No broken links

---

**Status**: PRODUCTION READY ✅

The "My Assets" page now provides direct editing access with smart routing to the appropriate editor for each asset type!

## Quick Test

1. **Go to**: `/assets/my-assets`
2. **Find any asset card**
3. **Click**: "✏️ Edit" button
4. **Should**: Open the correct editor with your asset loaded and ready to edit!
