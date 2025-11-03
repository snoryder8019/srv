# Sync Indicator Moved to Debug Panel

## Change Summary

The sync indicator has been moved from a standalone floating element in the bottom-right corner into the **Tester Debug Panel** under the "View Sync" section.

## What Changed

### Before
- Sync indicator was a separate fixed-position element at `bottom: 10px; right: 10px`
- Required separate z-index management (was set to 10200)
- Always visible in bottom-right corner

### After
- Sync indicator is now integrated into the tester debug panel
- Located at the top of the "View Sync" section
- Only visible when debug panel is expanded
- Maintains all the same functionality (status dot, details, map info, refresh button)

## Files Modified

### 1. `/srv/ps/public/javascripts/tester-toolbar.js`
**Lines 144-152:** Added sync indicator HTML inside the "View Sync" section

```javascript
<div class="debug-section">
  <h4>View Sync</h4>
  <!-- Sync Indicator (moved from bottom-right corner) -->
  <div id="syncIndicator" style="background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(74, 222, 128, 0.4); ...">
    <div id="syncStatus" style="width: 8px; height: 8px; ..."></div>
    <div id="syncDetails" style="color: #00ff00; ...">Loading...</div>
    <div id="mapDetails" style="color: #888; ...">--</div>
    <button id="syncRefreshBtn" ...>⟳</button>
  </div>
  ...
</div>
```

### 2. `/srv/ps/views/universe/galactic-map.ejs`
**Lines 33-35:** Removed standalone sync indicator div and hover styles

```html
<!-- Before -->
<div id="syncIndicator" style="position: fixed; bottom: 10px; right: 10px; z-index: 10200; ...">
  ...
</div>

<!-- After -->
<!-- Sync Indicator moved inside Tester Debug Panel -->
```

## Benefits

1. **Better Organization**: All debug/sync information is now in one place
2. **Less UI Clutter**: Removed floating element from main view
3. **Cleaner Z-Index**: No longer need to manage separate z-index for sync indicator
4. **Terminal Theme Consistency**: Sync indicator now uses the same green-on-black terminal styling as the debug panel

## Functionality Preserved

All sync indicator functionality remains intact:
- ✅ Status dot (green/yellow/red with glow)
- ✅ Sync details text (game state status)
- ✅ Map details (asset count, coordinates)
- ✅ Refresh button (⟳)
- ✅ Auto-update via `setupSyncIndicator()` function
- ✅ All JavaScript event handlers still work (IDs unchanged)

## How to See Changes

**Hard refresh your browser:**
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

Then:
1. Open the tester debug panel (click "Debug Panel" button)
2. Look at the "View Sync" section
3. Sync indicator is now the first element in that section

## Technical Notes

- The element IDs remain unchanged (`syncIndicator`, `syncStatus`, `syncDetails`, `mapDetails`, `syncRefreshBtn`)
- All JavaScript functions that update the sync indicator continue to work without modification
- The `setupSyncIndicator()` function in galactic-map.ejs still operates normally
- Inline styles are used to maintain the terminal aesthetic (green text, glowing status dot)

## Related Documentation

- [Tester Toolbar Terminal Theme](/srv/ps/docs/TESTER_TOOLBAR_TERMINAL_THEME.md)
- [Tester Toolbar Sync Features](/srv/ps/docs/TESTER_TOOLBAR_SYNC.md)
- [UI Layering Fix](/srv/ps/docs/UI_LAYERING_FIX.md)
