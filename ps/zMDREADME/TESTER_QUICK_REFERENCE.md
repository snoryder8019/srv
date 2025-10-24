# Tester Quick Reference Card

## Accessing the Galactic Map

**URL Format:**
```
http://ps.madladslab.com/universe/galactic-map?character=YOUR_CHARACTER_ID
```

**Example:**
```
http://ps.madladslab.com/universe/galactic-map?character=68f1c6271db390295144f032
```

## Tester Toolbar (Bottom of Screen)

The tester toolbar appears at the bottom of the screen with real-time metrics:

```
[TESTER] YourCharacter • LOC: 4471,464 • FPS: 60 • PING: 23ms [🐛] [💬] [📊] [📋]
```

### Toolbar Buttons:

| Button | Function | Shortcut |
|--------|----------|----------|
| 🐛 | Toggle debug panel | Click to expand/collapse |
| 💬 | Toggle global chat | Click to open/close chat |
| 📊 | View analytics | Opens analytics dashboard |
| 📋 | View logs | Shows system logs |

### Quick Metrics (Always Visible):

- **LOC:** Your current location (x, y) - Updates every second
- **FPS:** Frames per second - Real-time performance
- **PING:** Server latency in milliseconds - Updates every 3 seconds

## Debug Panel (Expanded View)

Click the 🐛 button to expand the debug panel. You'll see:

### Character Info:
- Name, ID, Level
- Current location coordinates
- Home hub information
- Ship details

### Performance Metrics:
- FPS (frames per second)
- PING (server latency)
- Memory usage
- Active connections

### Map Info:
- Zoom level
- Visible area
- Loaded assets
- Online players count

## Global Chat

Click the 💬 button to open the global chat window.

### Sending Messages:
1. Click 💬 to open chat
2. Type your message in the input field
3. Press **Enter** to send
4. Your message appears for all online players

### Chat Features:
- **Real-time messaging** - All players see your messages instantly
- **System notifications** - See when players join/leave
- **Online count** - Shows how many players are online
- **Message history** - Up to 100 recent messages saved
- **Auto-scroll** - Always shows latest message

### Chat Window Sections:

```
┌─────────────────────────────────────┐
│ 💬 Global Chat    [3 online]    [×] │ ← Header
├─────────────────────────────────────┤
│ [System] Geno entered the universe  │
│ [14:32:15] ScooterMcBooter:         │
│   Hello, universe!                  │ ← Messages
│ [14:32:18] Geno:                    │
│   Hi there!                         │
├─────────────────────────────────────┤
│ Type a message...              [➤]  │ ← Input
└─────────────────────────────────────┘
```

## Tester Accounts

### Available Test Accounts:

| Username | Character | Location |
|----------|-----------|----------|
| scootermcboot | ScooterMcBooter | (4471, 464) |
| scootermcboot | Geno | (4472, 466) |

## Multiplayer Testing

### Seeing Other Players:

When multiple testers are online, you'll see:

- **Your ship:** Green glowing triangle pointing in your direction
- **Other players:** Color-coded triangles based on String Domain
- **Player names:** Displayed below each ship
- **Movement:** Ships move in real-time as players navigate

### Player Ship Colors:

| String Domain | Color |
|---------------|-------|
| Time String | Blue (#3B82F6) |
| Death String | Red (#EF4444) |
| Spatial String | Purple (#A855F7) |
| Truth String | Green (#10B981) |
| Language String | Yellow (#F59E0B) |
| Music String | Pink (#EC4899) |

## Common Tasks

### 1. Test Chat with Another Player:

```
Step 1: Open two browser windows/tabs
Step 2: Log in as different testers in each
Step 3: Navigate to galactic map in both
Step 4: Open chat (💬 button) in both
Step 5: Send messages from each player
Step 6: Verify messages appear in both windows
```

### 2. Check Your Location:

```
Option 1: Look at toolbar - LOC: x,y
Option 2: Click 🐛 to expand debug panel
Option 3: Look under "Character Location"
```

### 3. Measure Server Performance:

```
Look at toolbar PING metric
- Good: <50ms (green)
- Fair: 50-100ms (yellow)
- Poor: >100ms (red)
```

### 4. Test Player Visibility:

```
Step 1: Have another tester join the map
Step 2: Look for their ship on your map
Step 3: Move around - verify they see you move
Step 4: Send chat message - verify they receive it
```

### 5. Report a Bug:

```
Step 1: Click 🐛 to open debug panel
Step 2: Screenshot the panel
Step 3: Check browser console (F12)
Step 4: Copy any error messages
Step 5: Report with screenshots and console logs
```

## Browser Console Commands

Open browser console (F12) and try these commands:

### Check Socket.IO Status:
```javascript
console.log('Socket connected:', socket.connected);
console.log('Socket ID:', socket.id);
```

### Check Global Chat:
```javascript
console.log('Global chat:', window.globalChat);
window.globalChat.toggleChat(); // Open/close chat
```

### Check Map:
```javascript
console.log('Map object:', map);
console.log('Current character:', map.currentCharacter);
console.log('Online players:', map.characters);
```

### Send Test Chat Message:
```javascript
socket.emit('chatMessage', {
  user: 'Tester',
  characterName: 'Test Character',
  message: 'Test message',
  userId: 'test123'
});
```

## Expected Console Messages

### On Page Load:
```
✅ Socket.IO connected: qv2KqUyRf6nVuctpAAAB
📡 Emitting characterJoin: ScooterMcBooter {x: 4471, y: 464}
📡 Received online players: 2 [Array]
✅ Map characters updated: 2 [Array]
```

### When Another Player Joins:
```
[System message in chat] Geno entered the universe
[Map updates to show new player]
```

### When Sending Chat Message:
```
[Global Chat] Message sent: Hello, universe!
[Message appears in chat window]
```

## Troubleshooting

### Issue: Location shows "--"

**Fix:**
1. Refresh the page
2. Check Socket.IO is connected (console should show ✅)
3. Verify character has location data

### Issue: FPS shows "--"

**Fix:**
1. Wait 2-3 seconds for FPS monitor to start
2. Check that map is rendering (you should see stars)
3. Refresh if still not showing

### Issue: PING shows "--"

**Fix:**
1. Check Socket.IO is connected
2. Wait 3 seconds for first ping
3. Check network connectivity

### Issue: Chat doesn't open

**Fix:**
1. Check browser console for errors
2. Verify global chat is initialized: `console.log(window.globalChat)`
3. Try refreshing the page

### Issue: Other players not visible

**Fix:**
1. Check browser console: `console.log(map.characters)`
2. Verify other players are actually online
3. Check Socket.IO connection
4. Refresh the page

### Issue: Messages not sending

**Fix:**
1. Check Socket.IO is connected: `console.log(socket.connected)`
2. Try sending manually: `socket.emit('chatMessage', {text: 'test'})`
3. Check server logs for errors

## Server Status Check

To check if the ps service is running:

```bash
tmux ls                              # List all sessions
tmux capture-pane -t ps_session -p  # View ps service logs
```

**Expected output:**
```
🚀 Stringborn Universe server listening on port 3399
✅ Connected to MongoDB: projectStringborne
```

## Performance Benchmarks

### Expected Performance:

| Metric | Good | Fair | Poor |
|--------|------|------|------|
| FPS | 60 | 30-59 | <30 |
| PING | <50ms | 50-100ms | >100ms |
| Load Time | <2s | 2-5s | >5s |
| Chat Latency | <100ms | 100-300ms | >300ms |

## Keyboard Shortcuts

| Key | Function |
|-----|----------|
| Enter | Send chat message (when chat input focused) |
| Esc | Close chat window |
| F12 | Open browser console |

## Mobile Testing

### Responsive Breakpoints:

- **Desktop:** >768px - Full toolbar with all metrics
- **Tablet:** 375-768px - Compact toolbar, hide less important metrics
- **Mobile:** <375px - Essential metrics only (LOC, FPS)

### Mobile-Specific Features:

- Touch-friendly button sizes (minimum 16px)
- Vertical stacking of debug sections
- Auto-focus input when opening chat
- On-screen keyboard support

## Admin vs Tester Toolbars

### Visual Differences:

| Feature | Admin | Tester |
|---------|-------|--------|
| Color | Green (#34d399) | Purple (#a78bfa) |
| Position | Bottom (default) | Bottom (stacks above admin) |
| Metrics | Server stats | Character stats |
| Buttons | Server controls | Debug tools |

### When Both Are Present:

```
┌─────────────────────────────────────┐
│ Browser Window                       │
│                                      │
│                                      │
│                                      │
│        (Galactic Map)                │
│                                      │
│                                      │
├─────────────────────────────────────┤
│ [TESTER] Purple toolbar              │ ← Tester (on top)
├─────────────────────────────────────┤
│ [ADMIN] Green toolbar                │ ← Admin (on bottom)
└─────────────────────────────────────┘
```

## Documentation Links

- **Full Testing Guide:** [GLOBAL_CHAT_TESTING.md](GLOBAL_CHAT_TESTING.md)
- **Debug Fixes:** [MULTIPLAYER_DEBUG_FIXES.md](MULTIPLAYER_DEBUG_FIXES.md)
- **Completed Features:** [COMPLETED_FEATURES_SUMMARY.md](COMPLETED_FEATURES_SUMMARY.md)
- **Quick Start:** [QUICK_START.md](../QUICK_START.md)

## Support

**Issues or Questions?**

1. Check browser console for errors (F12)
2. Check server logs: `tmux capture-pane -t ps_session -p`
3. Review testing documentation
4. Report bugs with screenshots and console logs

---

**Quick Tip:** Press F12 to open browser console and see real-time Socket.IO messages. This is the best way to debug any issues!

**Last Updated:** 2025-10-23
**System Status:** ✅ All features operational
