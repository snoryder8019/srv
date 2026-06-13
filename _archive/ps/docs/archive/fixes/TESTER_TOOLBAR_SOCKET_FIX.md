# Tester Toolbar Socket Dependency Fix

## Issue

The tester toolbar was not appearing on the galactic map page because its initialization was dependent on a successful Socket.IO connection.

### Root Cause

In [/srv/ps/views/universe/galactic-map.ejs](/srv/ps/views/universe/galactic-map.ejs), the tester toolbar initialization was inside the `socket.on('connect')` event handler:

```javascript
socket.on('connect', () => {
  // Initialize tester toolbar
  if (typeof TesterToolbar !== 'undefined') {
    window.testerToolbar = new TesterToolbar(userObj, characterObj);
    window.testerToolbar.connectSocket(socket);
    window.testerToolbar.connectMap(map);
  }
});
```

**Problem:** If the socket fails to connect (which it was), this code never runs, so the toolbar is never created.

## Solution

Moved the tester toolbar initialization **outside** the socket connect handler so it initializes immediately when the page loads:

```javascript
// Initialize tester toolbar immediately (don't wait for socket)
const characterObj = map.currentCharacter;
if (typeof TesterToolbar !== 'undefined') {
  window.testerToolbar = new TesterToolbar(userObj, characterObj);
  window.testerToolbar.connectMap(map);
}

// Wait for Socket.IO to connect before connecting socket to components
socket.on('connect', () => {
  console.log('✅ Socket.IO connected:', socket.id);

  // Connect tester toolbar to socket once connected
  if (window.testerToolbar) {
    window.testerToolbar.connectSocket(socket);
    window.testerToolbar.updateDebugInfo({ socketStatus: true });
  }

  // ... other socket-dependent initializations
});
```

## What Changed

### Before
1. Socket.IO tries to connect
2. If socket connects → Tester toolbar initializes ✓
3. If socket fails → Tester toolbar never initializes ✗

### After
1. Tester toolbar initializes immediately ✓
2. Socket.IO tries to connect
3. If socket connects → Socket features activate ✓
4. If socket fails → Toolbar still works (shows "Disconnected" status) ✓

## Benefits

✅ Tester toolbar always appears, even when socket is disconnected
✅ Socket status is properly displayed in the toolbar ("Connected" or "Disconnected")
✅ All toolbar features that don't require socket work immediately
✅ Socket features activate automatically when connection succeeds

## Components Still Dependent on Socket

The following components still require a socket connection to initialize (which is correct):

- **Global Chat** - Requires socket for real-time messaging
- **Ship Info Pane** - Requires socket for real-time ship data

These components will initialize once the socket connects.

## Testing

After this fix, you should see:

1. **Tester toolbar appears** at the bottom of the screen immediately on page load
2. **Debug panel** can be opened and shows:
   - Socket status: "Disconnected" (red) until socket connects
   - Character info, map info, sync status all work
3. **When socket connects** (if/when fixed):
   - Socket status changes to "Connected" (green)
   - Global chat and ship info pane initialize
   - Real-time features activate

## How to See Changes

**Hard refresh your browser:**
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

The tester toolbar should now appear at the bottom of the screen, even if the socket shows "Disconnected".

## Related Files

- [/srv/ps/views/universe/galactic-map.ejs](/srv/ps/views/universe/galactic-map.ejs) - Lines 459-475
- [/srv/ps/public/javascripts/tester-toolbar.js](/srv/ps/public/javascripts/tester-toolbar.js)

## Related Issues

This fix also helps diagnose the socket connection issue, because now we can:
1. See the tester toolbar
2. Open the debug panel
3. See "Socket: Disconnected" status
4. Use the debug tools to help troubleshoot why the socket isn't connecting
