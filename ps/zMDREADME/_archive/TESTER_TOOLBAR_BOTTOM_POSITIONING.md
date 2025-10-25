# Tester Toolbar - Bottom Positioning with Admin Stacking

## What Changed

The tester toolbar has been repositioned from the **top** of the screen to the **bottom**, matching the style and design of the admin debug bar. When both bars are present, they stack properly with the tester toolbar appearing above the admin bar.

## Implementation Details

### 1. CSS Positioning Update

**File:** [tester-toolbar.css:3-17](../ps/public/stylesheets/tester-toolbar.css#L3-L17)

```css
.tester-toolbar {
  position: fixed;
  bottom: var(--admin-debug-height, 0px); /* Dynamic positioning */
  left: 0;
  right: 0;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.95), rgba(99, 102, 241, 0.95));
  border-top: 2px solid rgba(168, 85, 247, 0.5);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  z-index: 9998;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex;
  flex-direction: column;
  transition: bottom 0.3s ease; /* Smooth transition */
}
```

**Key Changes:**
- Changed `top: 0` to `bottom: var(--admin-debug-height, 0px)`
- Changed `border-bottom` to `border-top`
- Changed `box-shadow: 0 4px` to `box-shadow: 0 -4px` (shadow upward)
- Added `transition: bottom 0.3s ease` for smooth repositioning
- Added `display: flex; flex-direction: column` for layout

### 2. Debug Panel Layout Update

**File:** [tester-toolbar.css:85-98](../ps/public/stylesheets/tester-toolbar.css#L85-L98)

```css
.tester-debug-info {
  background: rgba(15, 23, 42, 0.95);
  border-bottom: 1px solid rgba(168, 85, 247, 0.3);
  padding: 1rem 1.5rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  max-height: 300px;
  overflow-y: auto;
  order: -1; /* Place above the header */
}
```

**Key Changes:**
- Changed `border-top` to `border-bottom`
- Added `order: -1` to make debug panel appear above header when expanded
- Now expands **upward** instead of downward

### 3. JavaScript Dynamic Stacking

**File:** [tester-toolbar.js:20-63](../ps/public/javascripts/tester-toolbar.js#L20-L63)

#### Method: `adjustForAdminDebug()`

Detects if the admin status bar is present and adjusts positioning:

```javascript
adjustForAdminDebug() {
  const adminStatusBar = document.getElementById('admin-status-bar');

  if (adminStatusBar && adminStatusBar.style.display !== 'none') {
    const adminHeight = adminStatusBar.offsetHeight;

    // Set CSS variable for positioning
    document.documentElement.style.setProperty('--admin-debug-height', `${adminHeight}px`);

    // Add class to body
    document.body.classList.add('has-admin-debug');

    console.log(`📊 Admin status bar detected (${adminHeight}px), tester toolbar stacked above`);

    // Watch for size changes
    this.watchAdminBarChanges();
  } else {
    document.documentElement.style.setProperty('--admin-debug-height', '0px');
    console.log('📊 No admin status bar, tester toolbar at bottom');
  }
}
```

#### Method: `watchAdminBarChanges()`

Uses ResizeObserver to detect when admin bar expands/collapses:

```javascript
watchAdminBarChanges() {
  const adminStatusBar = document.getElementById('admin-status-bar');
  if (!adminStatusBar) return;

  // Use ResizeObserver to detect size changes
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const newHeight = entry.target.offsetHeight;
        document.documentElement.style.setProperty('--admin-debug-height', `${newHeight}px`);
        console.log(`📊 Admin status bar resized to ${newHeight}px`);
      }
    });

    resizeObserver.observe(adminStatusBar);
    this.adminBarObserver = resizeObserver;
  }
}
```

## Visual Layout

### Scenario 1: Tester Only (No Admin Bar)

```
┌─────────────────────────────────────┐
│                                     │
│         Main Content Area           │
│                                     │
│                                     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   [TESTER] username  [🐛][📷][ℹ️][💬]  │ ← Purple bar at bottom
└─────────────────────────────────────┘
```

### Scenario 2: Tester + Admin Bar

```
┌─────────────────────────────────────┐
│                                     │
│         Main Content Area           │
│                                     │
│                                     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   [TESTER] username  [🐛][📷][ℹ️][💬]  │ ← Purple bar above admin
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Services: ●●● CPU: 45% MEM: 67% [⚙️] │ ← Admin bar at bottom
└─────────────────────────────────────┘
```

### Scenario 3: Debug Panel Expanded (Tester Only)

```
┌─────────────────────────────────────┐
│                                     │
│         Main Content Area           │
│                                     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Character        Connection         │
│  ID: 67890       Socket: Connected  │
│  Location: (x,y)  Players: 3        │
│                                     │
│  Performance                        │
│  FPS: 60         Latency: 23ms     │ ← Debug panel
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   [TESTER] username  [🐛][📷][ℹ️][💬]  │ ← Purple header bar
└─────────────────────────────────────┘
```

### Scenario 4: Both Bars + Admin Expanded

```
┌─────────────────────────────────────┐
│         Main Content Area           │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   [TESTER] username  [🐛][📷][ℹ️][💬]  │ ← Tester bar
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Services Status                    │
│  ✓ madladslab    ✓ MongoDB         │
│  ✓ ps            ✓ Game State      │
│                                     │
│  System Resources                   │
│  CPU: 45% (8 cores)                │
│  Memory: 67% (5.2GB / 8GB)         │ ← Admin expanded
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Services: ●●● CPU: 45% MEM: 67% [⚙️] │ ← Admin header bar
└─────────────────────────────────────┘
```

## How It Works

1. **On Toolbar Initialization:**
   - Constructor calls `adjustForAdminDebug()`
   - Checks if `#admin-status-bar` exists and is visible
   - Measures admin bar height
   - Sets CSS variable `--admin-debug-height` on root element

2. **CSS Variable Usage:**
   - `.tester-toolbar` uses `bottom: var(--admin-debug-height, 0px)`
   - If variable is `0px` → toolbar sits at screen bottom
   - If variable is `60px` → toolbar sits 60px above bottom (stacked above admin)

3. **Dynamic Adjustment:**
   - ResizeObserver watches admin bar for size changes
   - When admin bar expands (compact → expanded), ResizeObserver fires
   - JavaScript updates `--admin-debug-height` variable
   - CSS transition smoothly animates toolbar position

4. **Smooth Transitions:**
   - CSS `transition: bottom 0.3s ease` creates smooth movement
   - No jarring jumps when admin bar changes size

## Z-Index Layers

```
10000+ → Modals (ticket modal)
9999  → Admin status bar (when present)
9998  → Tester toolbar
...   → Regular content
```

## Browser Compatibility

- **ResizeObserver**: Supported in all modern browsers (Chrome 64+, Firefox 69+, Safari 13.1+)
- **CSS Variables**: Supported in all modern browsers
- **Fallback**: If ResizeObserver not available, toolbar still positions correctly on initial load

## Testing

### For Regular Testers (No Admin Access)

1. Log in as tester
2. Navigate to galactic map
3. **Expected:** Purple toolbar at bottom of screen
4. Click debug button (🐛)
5. **Expected:** Debug panel expands upward

### For Admin Testers (Both Bars)

1. Log in as admin who is also a tester
2. Navigate to galactic map
3. **Expected:**
   - Purple tester toolbar stacked above admin bar
   - Admin bar at very bottom
4. Click expand on admin bar
5. **Expected:**
   - Tester toolbar smoothly moves up
   - Admin bar expands below it
6. Check browser console for:
   ```
   📊 Admin status bar detected (Xpx), tester toolbar stacked above
   📊 Admin status bar resized to Xpx
   ```

## Benefits of This Design

1. **Familiar Position**: Matches user expectation of debug/status bars being at bottom
2. **Non-Intrusive**: Doesn't cover important top navigation
3. **Smart Stacking**: Automatically adjusts when admin bar present
4. **Smooth Animation**: No jarring jumps when bars change size
5. **Same Style**: Both bars use same purple gradient aesthetic
6. **Expandable**: Debug panel expands upward without covering content

## Files Modified

1. [/srv/ps/public/stylesheets/tester-toolbar.css](../ps/public/stylesheets/tester-toolbar.css)
   - Changed positioning from top to bottom
   - Inverted border and shadow directions
   - Added flex layout for proper debug panel stacking

2. [/srv/ps/public/javascripts/tester-toolbar.js](../ps/public/javascripts/tester-toolbar.js)
   - Added `adjustForAdminDebug()` method
   - Added `watchAdminBarChanges()` method with ResizeObserver
   - Automatic detection and adjustment on init

## Console Messages

When toolbar initializes, you'll see one of these messages:

- `📊 Admin status bar detected (60px), tester toolbar stacked above`
- `📊 No admin status bar, tester toolbar at bottom`

When admin bar changes size:

- `📊 Admin status bar resized to 180px`

These help with debugging and understanding the stacking behavior.

## Future Enhancements

Potential improvements:

1. **Drag to Resize**: Allow user to drag toolbar height
2. **Collapse Animation**: Slide-up animation when hiding debug panel
3. **Remember State**: Save debug panel open/closed state to localStorage
4. **Quick Toggle**: Add keyboard shortcut (e.g., `Ctrl+Shift+D`) to toggle debug panel
5. **Detach Mode**: Allow toolbar to be detached and become a floating window

## Summary

✅ **Toolbar moved to bottom** - No longer at top of screen
✅ **Smart stacking** - Automatically positions above admin bar
✅ **Dynamic adjustment** - Responds to admin bar size changes
✅ **Smooth transitions** - Animated repositioning
✅ **Same style maintained** - Purple gradient, glass-morphism effect
✅ **Debug panel expands upward** - Doesn't cover content below

The tester toolbar is now positioned at the bottom of the screen with intelligent stacking behavior when the admin status bar is present!
