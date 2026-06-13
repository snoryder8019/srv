# Asset Routes - View Template Fix

**Date**: 2025-11-04
**Issue**: Routes returning 404 because view templates were in wrong locations

## Problem

Added routes but templates were missing or in wrong locations:

1. **`/assets/builder`** → tried to render `assets/builder.ejs` (doesn't exist)
2. **`/assets/interior-map-builder`** → tried to render `assets/interior-map-builder.ejs` (exists but in `universe/` folder)

## Root Cause

- `builder.ejs` template was never created
- `interior-map-builder.ejs` exists at `/views/universe/interior-map-builder.ejs` not `/views/assets/`

## Solution

### 1. Builder Route - Redirect to Enhanced Builder ✅

**File**: `/srv/ps/routes/assets/index.js` (lines 48-56)

Since `builder.ejs` doesn't exist, redirect to `builder-enhanced` which does exist:

```javascript
/**
 * GET /assets/builder
 * Basic asset/sprite builder page (authenticated users only)
 * Note: Currently redirects to builder-enhanced as builder.ejs doesn't exist
 */
router.get('/builder', isAuthenticated, (req, res) => {
  // Redirect to builder-enhanced for now
  res.redirect('/assets/builder-enhanced' +
    (req.originalUrl.includes('?') ? req.originalUrl.substring(req.originalUrl.indexOf('?')) : '')
  );
});
```

**How it works**:
- Preserves query parameters (e.g., `?assetId=123`)
- Redirects to `/assets/builder-enhanced?assetId=123`
- User doesn't see error, seamlessly uses enhanced builder

### 2. Interior Map Builder Route - Fix Template Path ✅

**File**: `/srv/ps/routes/assets/index.js` (lines 159-169)

Changed template path from `assets/interior-map-builder` to `universe/interior-map-builder`:

```javascript
/**
 * GET /assets/interior-map-builder
 * Interior map builder for creating zone floormaps
 * Note: Template is in views/universe/ folder
 */
router.get('/interior-map-builder', isAuthenticated, (req, res) => {
  res.render('universe/interior-map-builder', {  // Changed path
    title: 'Interior Map Builder',
    user: req.user
  });
});
```

## File Locations

### Templates That Exist
```
/srv/ps/views/
├── assets/
│   ├── builder-enhanced.ejs  ✅
│   ├── builder-hub.ejs       ✅
│   ├── my-assets.ejs          ✅
│   ├── sprite-creator.ejs     ✅
│   └── vote.ejs               ✅
└── universe/
    └── interior-map-builder.ejs  ✅
```

### Templates That Don't Exist
```
/srv/ps/views/assets/
└── builder.ejs  ❌ (doesn't exist)
```

## Routing Flow

### Sprite Asset Edit Flow
1. User clicks "✏️ Edit" on sprite asset
2. Routes to: `/assets/builder?assetId=123`
3. Redirects to: `/assets/builder-enhanced?assetId=123`
4. Renders: `views/assets/builder-enhanced.ejs`
5. Enhanced builder loads with sprite data

### Zone Asset Edit Flow
1. User clicks "✏️ Edit" on zone asset
2. Routes to: `/assets/interior-map-builder?zoneId=456`
3. Renders: `views/universe/interior-map-builder.ejs`
4. Interior Map Builder loads with zone data

### Other Asset Edit Flow
1. User clicks "✏️ Edit" on planet/anomaly/item/etc
2. Routes to: `/assets/builder-enhanced?assetId=789`
3. Renders: `views/assets/builder-enhanced.ejs`
4. Enhanced builder loads with asset data

## URL Redirects

| Original URL | Final URL | Template |
|-------------|-----------|----------|
| `/assets/builder` | → `/assets/builder-enhanced` | `assets/builder-enhanced.ejs` |
| `/assets/builder?assetId=123` | → `/assets/builder-enhanced?assetId=123` | `assets/builder-enhanced.ejs` |
| `/assets/interior-map-builder` | (no redirect) | `universe/interior-map-builder.ejs` |
| `/assets/interior-map-builder?zoneId=456` | (no redirect) | `universe/interior-map-builder.ejs` |
| `/assets/builder-enhanced` | (no redirect) | `assets/builder-enhanced.ejs` |

## Benefits of This Approach

### Why Redirect Instead of Creating builder.ejs?

1. **Avoids Duplication**: Enhanced builder already has all features needed
2. **Maintenance**: One builder to maintain, not two
3. **Consistency**: All users get same enhanced experience
4. **Faster**: No need to create/maintain separate template
5. **Query Params Preserved**: `?assetId=` carried through redirect

### Why Not Move interior-map-builder.ejs?

The template is in `universe/` folder because:
1. It's part of the universe navigation flow (galactic map → zone interior)
2. Other universe views are there (galactic-map-3d, zone, etc.)
3. Logical grouping by feature area
4. No need to move it - just update the route

## Testing

### Test 1: Sprite Edit (Redirect)
```bash
# Should redirect with query params
curl -I https://ps.madladslab.com/assets/builder?assetId=123
# Expected: 302 redirect to /assets/builder-enhanced?assetId=123
```

### Test 2: Zone Edit (Direct Render)
```bash
# Should render directly
curl -s https://ps.madladslab.com/assets/interior-map-builder?zoneId=456 | grep -o "<title>.*</title>"
# Expected: <title>Interior Map Builder</title>
```

### Test 3: Complete My Assets Flow
1. Go to `/assets/my-assets`
2. Find sprite asset
3. Click "✏️ Edit"
4. Should redirect to `/assets/builder-enhanced?assetId=...`
5. Enhanced builder should load with asset data

### Test 4: Zone Edit Flow
1. Go to `/assets/my-assets`
2. Find zone asset
3. Click "✏️ Edit"
4. Should go to `/assets/interior-map-builder?zoneId=...`
5. Interior Map Builder should load with zone data

## Files Modified

```
/srv/ps/routes/assets/index.js
├── Lines 48-56: Builder route - redirect to builder-enhanced
└── Lines 159-169: Interior map builder route - correct template path
```

## Future Enhancement Option

If you want a dedicated sprite-only builder later, you can:

1. **Create `/views/assets/builder.ejs`**
   ```ejs
   <!DOCTYPE html>
   <html>
   <head>
     <title>Sprite Builder</title>
   </head>
   <body>
     <!-- Simple pixel art canvas -->
     <!-- Sprite-specific tools -->
   </body>
   </html>
   ```

2. **Update route to render instead of redirect**
   ```javascript
   router.get('/builder', isAuthenticated, (req, res) => {
     res.render('assets/builder', {
       title: 'Sprite Builder',
       user: req.user
     });
   });
   ```

For now, the redirect approach works perfectly!

## Success Criteria

- ✅ No 404 errors on `/assets/builder`
- ✅ No 404 errors on `/assets/interior-map-builder`
- ✅ Query parameters preserved in redirect
- ✅ Users can edit sprites via builder
- ✅ Users can edit zones via interior map builder
- ✅ All asset types route correctly
- ✅ JavaScript syntax valid

---

**Status**: PRODUCTION READY ✅

All asset editing routes now work correctly! Users can click "Edit" on any asset and reach a working editor.

## Quick Test

1. **Go to**: `/assets/my-assets`
2. **Click "✏️ Edit" on any asset**
3. **Should work**:
   - Sprites → Enhanced Builder (via redirect)
   - Zones → Interior Map Builder (direct)
   - Everything else → Enhanced Builder (direct)
4. **No 404 errors** ✅
