# UI Layering Fix - Z-Index Hierarchy

## Issue

Debug bars (admin and tester toolbars) were covering:
- Chat window (bottom-left)
- Sync indicator (bottom-right)

This made it impossible to interact with these UI elements.

## Root Cause

Incorrect z-index hierarchy:

### Before (Broken)
```
Layer 10: Sync Indicator (z-index: 150) ❌ COVERED
Layer 9:  Ship Info Pane (z-index: 1000)
Layer 8:  Chat Window (z-index: 1000) ❌ COVERED
Layer 7:  Tester Toolbar (z-index: 9998) ⬅️ BLOCKING
Layer 6:  Admin Status Bar (z-index: 9999) ⬅️ BLOCKING
Layer 5:  Modals (z-index: 10000)
```

## Solution

Fixed z-index hierarchy to ensure proper layering:

### After (Fixed)
```
Layer 10: Modals (z-index: 10000-10001) - Highest priority
Layer 9:  Sync Indicator (z-index: 10200) ✅ VISIBLE
Layer 8:  Chat Window (z-index: 10100) ✅ VISIBLE
Layer 7:  Ship Info Pane (z-index: 1000)
Layer 6:  Tester Toolbar (z-index: 9998)
Layer 5:  Admin Status Bar (z-index: 9999)
Layer 4:  Map Controls (z-index: 100-200)
Layer 3:  Canvas and Content (z-index: 1-10)
```

## Changes Made

### 1. Chat Window
**File:** [/srv/ps/public/stylesheets/global-chat.css](file:///srv/ps/public/stylesheets/global-chat.css#L14)

```css
/* Before */
z-index: 1000;

/* After */
z-index: 10100; /* Above tester toolbar (9998) and admin bar (9999) */
```

### 2. Sync Indicator
**File:** [/srv/ps/views/universe/galactic-map.ejs](file:///srv/ps/views/universe/galactic-map.ejs#L34)

```html
<!-- Before -->
z-index: 150;

<!-- After -->
z-index: 10200; /* Above all toolbars and chat */
```

## Complete Z-Index Map

| Element | Z-Index | Position | Purpose |
|---------|---------|----------|---------|
| **Sync Indicator** | 10200 | Bottom-right | Game state sync status |
| **Tester Notifications** | 10001 | Bottom-right | Toast messages |
| **Chat Window** | 10100 | Bottom-left | Global chat |
| **Ticket Modal** | 10000 | Center (overlay) | Bug reports |
| **Inventory Modal** | 10000 | Full screen | Inventory management |
| **Admin Status Bar** | 9999 | Bottom | Admin debug info |
| **Tester Toolbar** | 9998 | Bottom | Tester debug tools |
| **Asset Builder Modal** | 9999 | Center | Asset creation |
| **Ship Info Pane** | 1000 | Top-right | Other player info |
| **Map Controls Panel** | 200 | Top-right | Map settings |
| **Controls** | 100 | Top-right | Zoom, reset buttons |
| **Canvas** | 1 | Full screen | Main map |

## Visual Layout

```
┌─────────────────────────────────────────────────┐
│ [Controls]               [Ship Info] [Settings] │ z: 100-1000
│                                                  │
│                                                  │
│             GALACTIC MAP CANVAS                  │ z: 1
│                                                  │
│                                                  │
│                                                  │
│                                                  │
│ [Chat]                         [Sync Indicator] │ z: 10100/10200
├─────────────────────────────────────────────────┤
│ ADMIN STATUS BAR (if admin)                     │ z: 9999
├─────────────────────────────────────────────────┤
│ TESTER TOOLBAR (if tester)                      │ z: 9998
└─────────────────────────────────────────────────┘
```

## Verification

### Chat Window Should Be:
- ✅ Visible in bottom-left corner
- ✅ Above both debug bars
- ✅ Clickable and interactive
- ✅ Draggable/closeable

### Sync Indicator Should Be:
- ✅ Visible in bottom-right corner
- ✅ Above all debug bars
- ✅ Showing sync status
- ✅ Hoverable for details

### Debug Bars Should:
- ✅ Stack at the bottom (admin on bottom, tester above)
- ✅ Be below chat and sync indicator
- ✅ Not block any interactive UI

## Testing

**To verify the fix:**

1. **Open galactic map** as a tester user
2. **Look for these elements:**
   - Bottom-left: Chat window (should be clickable)
   - Bottom-right: Sync indicator (should be visible)
   - Bottom: Two debug bars (stacked)

3. **Test interactions:**
   - Click chat window → Should open/close
   - Hover sync indicator → Should show details
   - Click debug bar buttons → Should work

4. **Hard refresh** to load new CSS:
   - Press `Ctrl + Shift + R` (Windows/Linux)
   - Press `Cmd + Shift + R` (Mac)

## Responsive Behavior

### Mobile (< 768px)
- Chat window becomes narrower
- Sync indicator stays in bottom-right
- Debug bars remain at bottom

### Small Mobile (< 480px)
- Chat height reduces to 350px
- Some chat features hidden
- Sync indicator font size adjusts
- Debug bars compress

## Future Improvements

Consider:
1. **Draggable chat** - Allow users to reposition
2. **Collapsible debug bars** - Minimize when not in use
3. **Z-index variables** - Use CSS custom properties
4. **Layout manager** - Detect conflicts automatically
5. **User preferences** - Remember positions/states

## Affected Files

### Modified
- [/srv/ps/public/stylesheets/global-chat.css](file:///srv/ps/public/stylesheets/global-chat.css#L14)
- [/srv/ps/views/universe/galactic-map.ejs](file:///srv/ps/views/universe/galactic-map.ejs#L34)

### Reference Files (Not Modified)
- [/srv/ps/public/stylesheets/tester-toolbar.css](file:///srv/ps/public/stylesheets/tester-toolbar.css) - z-index: 9998
- [/srv/ps/public/stylesheets/status-bar.css](file:///srv/ps/public/stylesheets/status-bar.css) - z-index: 9999
- [/srv/ps/public/stylesheets/ship-info-pane.css](file:///srv/ps/public/stylesheets/ship-info-pane.css) - z-index: 1000

## Related Issues

This fix resolves:
- Chat window being inaccessible ✅
- Sync indicator being hidden ✅
- UI elements stacking incorrectly ✅

## Summary

✅ **Chat window** - Moved to z-index 10100 (was 1000)
✅ **Sync indicator** - Moved to z-index 10200 (was 150)
✅ **All UI elements** - Now properly layered and accessible

**Hard refresh your browser to see the changes!**
