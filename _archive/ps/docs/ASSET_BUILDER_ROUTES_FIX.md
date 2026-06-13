# Asset Builder Routes Fix

**Date**: 2025-11-04
**Issue**: 404 errors when clicking "Edit" button on My Assets page

## Problem

Missing routes for asset builders:
- `/assets/builder` - Basic/sprite builder (404)
- `/assets/interior-map-builder` - Interior map builder (404)

User clicked "Edit" on assets and got 404 errors.

## Solution

Added missing routes to `/srv/ps/routes/assets/index.js`:

### 1. Basic Builder Route ✅

**Lines 48-57**:
```javascript
/**
 * GET /assets/builder
 * Basic asset/sprite builder page (authenticated users only)
 */
router.get('/builder', isAuthenticated, (req, res) => {
  res.render('assets/builder', {
    title: 'Asset Builder',
    user: req.user
  });
});
```

**Purpose**:
- Renders basic asset builder page
- Used for sprite/pixel art creation
- Requires authentication

**URL Pattern**:
```
/assets/builder
/assets/builder?assetId=:id
```

### 2. Interior Map Builder Route ✅

**Lines 149-158**:
```javascript
/**
 * GET /assets/interior-map-builder
 * Interior map builder for creating zone floormaps
 */
router.get('/interior-map-builder', isAuthenticated, (req, res) => {
  res.render('assets/interior-map-builder', {
    title: 'Interior Map Builder',
    user: req.user
  });
});
```

**Purpose**:
- Renders interior map builder page
- Used for zone floormap creation
- Handles spawn points, loot, NPCs, exits
- Requires authentication

**URL Pattern**:
```
/assets/interior-map-builder
/assets/interior-map-builder?zoneId=:id
```

## Complete Route List

After these additions, the `/assets` routes are:

| Route | Auth | Purpose |
|-------|------|---------|
| `/assets` | ✅ | Default route → enhanced builder |
| `/assets/builder` | ✅ | Basic/sprite builder |
| `/assets/builder-enhanced` | ✅ | Enhanced asset builder (celestial objects, items, etc.) |
| `/assets/interior-map-builder` | ✅ | Interior map builder (zone floormaps) |
| `/assets/my-assets` | ✅ | User's asset management page |
| `/assets/voting` | ❌ | Community voting (public) |
| `/assets/builder-hub` | ✅ | Universal builder hub (navigation) |
| `/assets/sprite-creator` | ✅ | Sprite creator tool |

## File Modified

```
/srv/ps/routes/assets/index.js
├── Lines 48-57: Added /assets/builder route
└── Lines 149-158: Added /assets/interior-map-builder route
```

## Testing

### Test Basic Builder
```bash
# Should load builder page
curl -s https://ps.madladslab.com/assets/builder | grep -o "<title>.*</title>"
# Expected: <title>Asset Builder</title>
```

### Test Interior Map Builder
```bash
# Should load interior map builder
curl -s https://ps.madladslab.com/assets/interior-map-builder | grep -o "<title>.*</title>"
# Expected: <title>Interior Map Builder</title>
```

### Test With Asset ID
```
# Should load builder with asset pre-loaded
https://ps.madladslab.com/assets/interior-map-builder?zoneId=690a866929c03e47b2000123
```

### Test My Assets Flow
1. Go to `/assets/my-assets`
2. Find a zone asset
3. Click "✏️ Edit"
4. Should load: `/assets/interior-map-builder?zoneId=...`
5. Should NOT get 404 ✅

## Success Criteria

- ✅ `/assets/builder` route exists
- ✅ `/assets/interior-map-builder` route exists
- ✅ Both routes require authentication
- ✅ Both routes render correct template
- ✅ No 404 errors when clicking Edit
- ✅ Asset ID passed via URL parameter
- ✅ JavaScript syntax valid

---

**Status**: PRODUCTION READY ✅

The asset builder routes are now properly configured. Users can click "Edit" on their assets and reach the correct editor without 404 errors!
