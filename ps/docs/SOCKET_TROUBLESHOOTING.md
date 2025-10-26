# Socket.IO Troubleshooting Guide

## Current Status

Your tester toolbar shows:
```
Socket: Disconnected (red)
```

## Verified Working

✅ **PS Service**: Running on port 3399
✅ **Socket.IO Server**: Initialized and responding
✅ **Socket.IO Client Library**: Available at `/socket.io/socket.io.js`
✅ **Handshake Endpoint**: Working correctly

## Root Cause

The browser is likely **caching the old version** of the galactic map page that doesn't have the new Socket.IO connection code.

## Solutions

### Solution 1: Hard Refresh (FASTEST)

**Do this first:**

1. Open the galactic map: `https://ps.madladslab.com/universe/galactic-map`
2. **Hard refresh** to bypass cache:
   - **Windows/Linux**: Press `Ctrl + Shift + R`
   - **Mac**: Press `Cmd + Shift + R`
   - **Alternative**: Press `Ctrl + F5` (or `Cmd + F5`)

3. Open browser console (F12)
4. Look for:
   ```
   ✅ Socket.IO connected: abc123
   ```

### Solution 2: Clear Browser Cache

If hard refresh doesn't work:

**Chrome/Edge:**
1. Press `F12` to open DevTools
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

**Firefox:**
1. Press `Ctrl + Shift + Delete`
2. Check "Cache"
3. Click "Clear Now"
4. Reload the page

**Safari:**
1. Press `Cmd + Option + E` to empty caches
2. Reload the page

### Solution 3: Use Test Page

We created a dedicated Socket.IO test page:

**Visit:** `http://ps.madladslab.com/test-socket.html`

This page will:
- Test Socket.IO connection
- Show detailed connection logs
- Display real-time status
- Test ping/pong latency

**Expected output:**
```
🔌 Initializing Socket.IO...
✅ Socket.IO CONNECTED successfully!
   Socket ID: abc123
🏓 Ping/Pong test successful! Latency: 45ms
```

### Solution 4: Disable Cache in DevTools

**For persistent testing:**

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Check ☑️ **Disable cache**
4. Keep DevTools open
5. Reload the page

This prevents caching while DevTools is open.

## Verification Steps

### Step 1: Test Socket.IO Server

**Command:**
```bash
curl -s "http://localhost:3399/socket.io/?EIO=4&transport=polling"
```

**Expected response:**
```
0{"sid":"abc123","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000}
```

✅ If you see this, server is working!

### Step 2: Test Client Library

**Command:**
```bash
curl -s http://localhost:3399/socket.io/socket.io.js | head -5
```

**Expected response:**
```javascript
/*!
 * Socket.IO v4.8.1
 * (c) 2014-2024 Guillermo Rauch
 */
```

✅ If you see this, client library is available!

### Step 3: Check Browser Console

After hard refresh, open browser console (F12) and check for:

**Good signs:**
```
✅ Socket.IO connected: abc123
📡 Emitting characterJoin: Jon mclain
```

**Bad signs:**
```
❌ Socket.IO connection error: ...
⚠️  Socket.IO disconnected: transport close
```

### Step 4: Check Network Tab

1. Open DevTools (F12)
2. Go to **Network** tab
3. Reload page
4. Look for requests to `/socket.io/`

**Should see:**
- `GET /socket.io/?EIO=4&transport=polling` → Status 200
- `GET /socket.io/?EIO=4&transport=websocket` → Status 101 (WebSocket Upgrade)

**If you see 404:** Socket.IO server not running
**If you see CORS error:** Origin mismatch issue

## Common Issues

### Issue 1: Still Shows Disconnected After Hard Refresh

**Cause:** Browser still using cached version

**Solution:**
1. Close ALL browser tabs for `ps.madladslab.com`
2. Clear browser cache completely
3. Reopen in new tab
4. Or use incognito/private mode

### Issue 2: Connection Established Then Immediately Disconnects

**Logs show:**
```
✅ Socket.IO connected: abc123
⚠️  Socket.IO disconnected: transport close
```

**Possible causes:**
1. Server restarting
2. CORS issue
3. WebSocket blocked by firewall/proxy

**Solutions:**
1. Check if server is stable:
   ```bash
   tmux capture-pane -t ps_session -p | grep -i error
   ```

2. Check for CORS errors in browser console

3. Try polling-only transport (add to io config):
   ```javascript
   const socket = io({
     transports: ['polling'] // Force polling only
   });
   ```

### Issue 3: WebSocket Connection Failed

**Error:** `WebSocket connection to 'ws://...' failed`

**Cause:** Proxy, firewall, or HTTPS/WSS mismatch

**Solutions:**

1. **If on HTTPS**, use WSS:
   ```javascript
   const socket = io({
     transports: ['websocket', 'polling']
   });
   ```

2. **Disable WebSocket**, use polling only:
   ```javascript
   const socket = io({
     transports: ['polling']
   });
   ```

3. **Check proxy settings** - Some proxies block WebSocket

### Issue 4: No Socket Logs in Console

**Cause:** Code not executing (likely tester role check failing)

**Check if user is tester:**
```javascript
// In browser console
console.log(document.body.innerHTML.includes('userRole'));
```

**Verify in database:**
```bash
# Check user role
mongosh projectStringborne --eval "db.users.findOne({_id: ObjectId('68f1170f6550fbd59b47dc1a')}, {username: 1, userRole: 1})"
```

## Debug Commands

### Browser Console Commands

**Check if socket exists:**
```javascript
typeof socket !== 'undefined' ? 'Socket exists' : 'Socket not defined'
```

**Manually connect:**
```javascript
if (typeof socket !== 'undefined') {
  socket.connect();
}
```

**Check connection state:**
```javascript
if (typeof socket !== 'undefined') {
  console.log('Connected:', socket.connected);
  console.log('ID:', socket.id);
}
```

**Enable debug mode:**
```javascript
localStorage.debug = 'socket.io-client:*';
location.reload();
```

### Server-Side Commands

**Check active connections:**
```bash
tmux capture-pane -t ps_session -p | grep "user connected\|user disconnected" | tail -10
```

**Monitor Socket.IO events:**
```bash
tmux capture-pane -t ps_session -p | grep -i "socket\|character" | tail -20
```

**Check port 3399:**
```bash
lsof -i :3399
```

## Files to Check

### 1. Galactic Map Page
[/srv/ps/views/universe/galactic-map.ejs](file:///srv/ps/views/universe/galactic-map.ejs#L432-L469)

**Look for:**
```javascript
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10
});
```

### 2. Socket.IO Server
[/srv/ps/plugins/socket/index.js](file:///srv/ps/plugins/socket/index.js)

**Check CORS config:**
```javascript
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});
```

### 3. Server Startup
[/srv/ps/bin/www](file:///srv/ps/bin/www#L29-L30)

**Verify initialization:**
```javascript
var io = initSockets(server);
app.set("io", io);
```

## Quick Fix Checklist

- [ ] Hard refresh browser (Ctrl+Shift+R)
- [ ] Clear browser cache
- [ ] Check browser console for errors
- [ ] Visit test page: `http://ps.madladslab.com/test-socket.html`
- [ ] Verify PS service running: `tmux has-session -t ps_session`
- [ ] Check Socket.IO endpoint: `curl http://localhost:3399/socket.io/socket.io.js`
- [ ] Try incognito/private mode
- [ ] Close all tabs and reopen

## Expected Behavior

### When Working Correctly

**Tester Toolbar:**
```
Socket: Connected (green)
Players: 1
Latency: 45ms
```

**Browser Console:**
```
✅ Socket.IO connected: H-D-kLqeelz2nLKRAAAI
📡 Emitting characterJoin: Jon mclain {x: 3876, y: 4908}
📡 Received online players: 1 [{...}]
✅ Map characters updated: 1
```

**Server Logs:**
```
🔌 A user connected: H-D-kLqeelz2nLKRAAAI
Character joined: 68f1ca411db390295144f033 at asset: null
```

## Still Not Working?

If you've tried everything above and it's still not working:

1. **Restart PS service:**
   ```bash
   tmux kill-session -t ps_session
   tmux new-session -d -s ps_session -c /srv/ps "npm run dev"
   ```

2. **Wait 5 seconds** for service to start

3. **Hard refresh browser** (Ctrl+Shift+R)

4. **Check test page:** `http://ps.madladslab.com/test-socket.html`

If test page works but galactic map doesn't, the issue is specific to that page's code/caching.

## Summary

🔧 **Most likely cause:** Browser caching old page version
✅ **Quick fix:** Hard refresh (Ctrl+Shift+R)
🧪 **Test page:** `http://ps.madladslab.com/test-socket.html`
📊 **Server status:** Working correctly

**Try the hard refresh first - it should fix it immediately!**
