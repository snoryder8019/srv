# My Assets - Universe Route Fix

**Date**: 2025-11-04
**Status**: ✅ COMPLETE

## Summary

Updated the "Edit" button for zone assets to route to the universe path instead of assets path.

## Problem

Zone assets were routing to:
```
/assets/interior-map-builder?zoneId=...
```

But the interior-map-builder template and route are in the universe section:
```
/universe/interior-map-builder
```

This caused routing confusion and required an extra redirect in the assets route.

## Solution

Updated the zone routing in my-assets.js to go directly to the universe route:

**File**: `/srv/ps/public/javascripts/my-assets.js` (line 111)

**Before**:
```javascript
case 'zone':
  // Zone interior editor
  editorUrl = `/assets/interior-map-builder?zoneId=${assetId}`;
  break;
```

**After**:
```javascript
case 'zone':
  // Zone interior editor (in universe routes)
  editorUrl = `/universe/interior-map-builder?zoneId=${assetId}`;
  break;
```

## Benefits

1. **Direct Routing** ⚡
   - No redirect needed
   - Goes directly to correct route
   - Faster page load

2. **Correct Organization** 📁
   - Interior map builder is part of universe features
   - Keeps routing consistent with feature organization
   - Matches where template actually lives

3. **Cleaner Code** 🧹
   - Removes need for redirect in assets route
   - More straightforward routing logic
   - Less indirection

## Routing Matrix (Updated)

| Asset Type | Route | Template |
|------------|-------|----------|
| **zone** | `/universe/interior-map-builder?zoneId=:id` | `universe/interior-map-builder.ejs` |
| **sprite** | `/assets/builder?assetId=:id` → redirect → `/assets/builder-enhanced?assetId=:id` | `assets/builder-enhanced.ejs` |
| **planet** | `/assets/builder-enhanced?assetId=:id` | `assets/builder-enhanced.ejs` |
| **galaxy** | `/assets/builder-enhanced?assetId=:id` | `assets/builder-enhanced.ejs` |
| **anomaly** | `/assets/builder-enhanced?assetId=:id` | `assets/builder-enhanced.ejs` |
| **other** | `/assets/builder-enhanced?assetId=:id` | `assets/builder-enhanced.ejs` |

## User Flow

### Before
1. User clicks "✏️ Edit" on zone
2. Routes to `/assets/interior-map-builder?zoneId=123`
3. Assets route renders `universe/interior-map-builder` template
4. Works but routing is confusing

### After
1. User clicks "✏️ Edit" on zone
2. Routes to `/universe/interior-map-builder?zoneId=123`
3. Universe route renders `universe/interior-map-builder` template
4. Direct, clean routing

## Route Locations

### Assets Routes (`/srv/ps/routes/assets/index.js`)
- `/assets/builder` - Redirects to builder-enhanced
- `/assets/builder-enhanced` - Enhanced builder for most assets
- `/assets/my-assets` - User asset management
- `/assets/voting` - Community voting
- `/assets/builder-hub` - Universal builder hub
- `/assets/sprite-creator` - Sprite creator tool

### Universe Routes (`/srv/ps/routes/universe/index.js`)
- `/universe/galactic-map-3d` - 3D galactic map
- `/universe/interior-map-builder` - Interior map builder ✅
- `/universe/zone/:zoneId` - Zone interior view
- `/universe/planetary-grid` - Planetary grid system
- `/universe/galactic-state` - Galactic state view

## Console Output

When clicking "Edit" on a zone, you'll now see:
```
📝 Opening editor for zone: /universe/interior-map-builder?zoneId=690a866929c03e47b2000123
```

Instead of:
```
📝 Opening editor for zone: /assets/interior-map-builder?zoneId=690a866929c03e47b2000123
```

## Optional: Clean Up Assets Route

Since zones now route to `/universe/interior-map-builder`, you could optionally remove or update the assets route. However, keeping it allows for backwards compatibility if any old links exist.

**Current Assets Route** (can be kept or removed):
```javascript
// In /srv/ps/routes/assets/index.js (line 154-159)
router.get('/interior-map-builder', isAuthenticated, (req, res) => {
  res.render('universe/interior-map-builder', {
    title: 'Interior Map Builder',
    user: req.user
  });
});
```

**Options**:
1. **Keep it** - Provides backwards compatibility
2. **Remove it** - Cleaner, forces universe route only
3. **Make it redirect** - Redirect to universe route

For now, keeping it is fine and provides flexibility.

## Files Modified

```
/srv/ps/public/javascripts/my-assets.js
└── Line 111: Changed zone route from /assets to /universe
```

## Testing

### Test Zone Edit
1. Go to `/assets/my-assets`
2. Find a zone asset (e.g., "Starship Colony")
3. Click "✏️ Edit"
4. Should navigate to `/universe/interior-map-builder?zoneId=...`
5. Interior Map Builder should load
6. Console should show universe route

### Test Other Assets
1. Click "Edit" on planet asset
2. Should still go to `/assets/builder-enhanced?assetId=...`
3. Should still work correctly

### Verify Routes Exist
```bash
# Universe route should exist and work
curl -s https://ps.madladslab.com/universe/interior-map-builder | grep -o "<title>.*</title>"
# Expected: <title>Interior Map Builder</title>
```

## Success Criteria

- ✅ Zone edit button routes to `/universe/interior-map-builder`
- ✅ Query parameter `?zoneId=` preserved
- ✅ Interior Map Builder loads correctly
- ✅ Other assets still route to correct builders
- ✅ Console logs show correct URL
- ✅ No 404 errors
- ✅ JavaScript syntax valid

---

**Status**: PRODUCTION READY ✅

Zone assets now route directly to the universe interior-map-builder route where they belong!

## Quick Test

1. **Go to**: `/assets/my-assets`
2. **Find zone asset**
3. **Click**: "✏️ Edit"
4. **Should**: Navigate to `/universe/interior-map-builder?zoneId=...`
5. **Verify**: Interior Map Builder loads with your zone data ✅
