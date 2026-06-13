# Testing System Implementation

## Overview

We've implemented a comprehensive testing infrastructure for the Stringborn Universe, including:
- Tester role system with database support
- Debug toolbar for all testers
- Screenshot capture functionality
- Bug report / feedback ticket system
- Global real-time chat for all players
- Online player tracking and registry
- Navigation arrows showing all players on the map (to be integrated)

## 1. User Roles System

### Database Schema

All users now have a `userRole` field:
```javascript
{
  _id: ObjectId,
  email: string,
  username: string,
  password: string, // bcrypt hashed
  userRole: 'tester' | 'admin' | 'player', // Default: 'tester'
  createdAt: Date,
  hasCompletedWelcome: boolean,
  hasCompletedIntro: boolean
}
```

### Adding Roles to Existing Users

Run this script to update all existing users:
```bash
cd /srv/ps
node scripts/add-user-roles.js
```

This sets all users without a `userRole` to 'tester' by default.

### New User Registration

New users automatically get `userRole: 'tester'` upon registration ([auth.js:57](ps/plugins/passport/auth.js#L57)).

## 2. Tester Toolbar

### Features

Located at the top of every page (when user is a tester), the toolbar provides:

**Debug Info Panel:**
- Character ID, name, location, docking status
- Socket connection status
- Online player count
- FPS (frames per second)
- Network latency

**Quick Actions:**
- Toggle debug info
- Take screenshot (using html2canvas)
- Create bug report / feedback ticket
- Toggle global chat window

### Visual Design

- Purple gradient background matching admin aesthetic
- Fixed to top of page (z-index: 9999)
- Slides down debug panel on toggle
- Icon-based buttons for quick access
- Mobile responsive

### Usage

```javascript
// Initialize (call on page load for testers)
const toolbar = initTesterToolbar(user, character);

// Update debug info
toolbar.updateDebugInfo({
  location: true,
  socketStatus: true,
  playerCount: 5,
  fps: 60,
  latency: 45
});
```

### Files Created

- `/srv/ps/public/javascripts/tester-toolbar.js` - Toolbar component
- `/srv/ps/public/stylesheets/tester-toolbar.css` - Styling

## 3. Screenshot System

### How It Works

1. Tester clicks screenshot button in toolbar
2. Uses `html2canvas` library to capture entire page
3. Automatically downloads as PNG file
4. Option to attach to ticket submissions

### Dependencies

Include in your HTML:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

### Configuration

```javascript
html2canvas(document.body, {
  allowTaint: true,
  useCORS: true,
  logging: false
});
```

## 4. Ticket System

### API Endpoints

**Create Ticket**
```
POST /api/v1/tickets
Auth: Required (tester or admin only)
Body: {
  type: 'bug' | 'feedback' | 'feature' | 'ui',
  title: string,
  description: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  characterId?: string,
  characterName?: string,
  location?: object,
  userAgent?: string,
  url?: string
}
```

**Get All Tickets**
```
GET /api/v1/tickets
Auth: Required
Query: ?status=open&type=bug&userId=xxx
Returns: All user's tickets (or all tickets if admin)
```

**Get Single Ticket**
```
GET /api/v1/tickets/:id
Auth: Required (must own ticket or be admin)
```

**Update Ticket Status** (Admin Only)
```
PATCH /api/v1/tickets/:id/status
Auth: Admin only
Body: { status: 'open' | 'in-progress' | 'resolved' | 'closed' }
```

**Add Comment to Ticket**
```
POST /api/v1/tickets/:id/comments
Auth: Required
Body: { comment: string }
```

### Ticket Schema

```javascript
{
  _id: ObjectId,
  type: 'bug' | 'feedback' | 'feature' | 'ui',
  title: string,
  description: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  status: 'open' | 'in-progress' | 'resolved' | 'closed',
  userId: string,
  username: string,
  characterId?: string,
  characterName?: string,
  location?: { x, y, assetId },
  userAgent?: string,
  url?: string,
  createdAt: Date,
  updatedAt: Date,
  comments: [{
    userId: string,
    username: string,
    comment: string,
    timestamp: Date
  }],
  assignedTo?: string
}
```

### Ticket Modal

Beautiful modal UI for creating tickets:
- Type selection (bug, feedback, feature, UI)
- Title and description fields
- Severity dropdown
- Option to include screenshot
- Auto-captures context (location, URL, user agent)

### Files Created

- `/srv/ps/api/v1/tickets/index.js` - Tickets API

## 5. Global Chat System

### Features

- Real-time chat using Socket.IO
- Persistent chat window (slides in from bottom-left)
- Shows online player count
- System messages for player join/leave
- Character name displayed for each message
- Auto-scroll to latest message
- Mobile responsive

### Socket.IO Events

**Client → Server:**
```javascript
socket.emit('chatMessage', {
  user: username,
  characterName: characterName,
  message: string,
  userId: userId,
  characterId: characterId
});
```

**Server → Client:**
```javascript
// Broadcast to all
socket.on('chatMessage', (data) => {
  // { user, characterName, message, timestamp }
});

// System messages
socket.on('characterJoined', (data) => {
  // { characterName, ... }
});

socket.on('characterLeft', (data) => {
  // { characterName, ... }
});

// Online count updates
socket.on('onlineCount', (count) => {
  // number of online players
});
```

### Usage

```javascript
// Initialize chat
const chat = initGlobalChat(socket, user, character);

// Toggle visibility
chat.toggleChat();

// Manually add message (for testing)
chat.addMessage({
  user: 'TestUser',
  characterName: 'Hero',
  message: 'Hello world!',
  timestamp: new Date()
});
```

### Visual Design

- Bottom-left floating window
- Glass-morphism background
- 400x500px default size
- Color-coded messages:
  - Own messages: Purple highlight, right-aligned
  - Other messages: Blue highlight
  - System messages: Centered, icon indicator

### Files Created

- `/srv/ps/public/javascripts/global-chat.js` - Chat component
- `/srv/ps/public/stylesheets/global-chat.css` - Styling

## 6. Online Players Registry

### Server-Side Tracking

Socket.IO server maintains a Map of online players:

```javascript
const onlinePlayers = new Map(); // socketId -> player data

// Player data structure
{
  socketId: string,
  characterId: string,
  characterName: string,
  userId: string,
  location: { x, y, assetId },
  assetId: string | null,
  joinedAt: Date
}
```

### Events

**Player Joins:**
```javascript
socket.emit('characterJoin', {
  characterId: string,
  characterName: string,
  userId: string,
  location: { x, y, assetId },
  assetId: string | null
});

// Server broadcasts:
// - 'characterJoined' to all other players
// - 'onlineCount' to everyone
// - 'onlinePlayers' list to newly joined player
```

**Player Leaves:**
```javascript
// Server automatically removes from registry on disconnect
// Broadcasts:
// - 'characterLeft' to all players
// - 'onlineCount' to everyone
```

### Client-Side Usage

```javascript
// Listen for online players list
socket.on('onlinePlayers', (playersList) => {
  console.log('Online players:', playersList);
  // Update map to show all player positions
  playersList.forEach(player => {
    map.addPlayerMarker(player);
  });
});

// Listen for new player joining
socket.on('characterJoined', (data) => {
  console.log('Player joined:', data.characterName);
  map.addPlayerMarker(data);
});

// Listen for player leaving
socket.on('characterLeft', (data) => {
  console.log('Player left:', data.characterName);
  map.removePlayerMarker(data.characterId);
});
```

## 7. Map Navigation Arrows (To Be Integrated)

### Concept

Each player on the map should display:
- Character marker at current location
- Navigation arrow if traveling (showing direction)
- Click to view ship info pane
- Real-time position updates

### Implementation Plan

**1. Player Marker Rendering:**
```javascript
function renderPlayerMarker(player, ctx, map) {
  const screenPos = map.worldToScreen(player.location.x, player.location.y);

  // Draw player ship
  ctx.fillStyle = player.userId === currentUserId ? '#8b5cf6' : '#3b82f6';
  ctx.beginPath();
  ctx.arc(screenPos.x, screenPos.y, 8, 0, Math.PI * 2);
  ctx.fill();

  // Draw name label
  ctx.fillStyle = '#fff';
  ctx.font = '12px Inter';
  ctx.textAlign = 'center';
  ctx.fillText(player.characterName, screenPos.x, screenPos.y - 15);

  // Draw navigation arrow if traveling
  if (player.navigation && player.navigation.isInTransit) {
    const dest = player.navigation.destination;
    const angle = Math.atan2(dest.y - player.location.y, dest.x - player.location.x);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    const arrowLength = 30;
    ctx.lineTo(
      screenPos.x + Math.cos(angle) * arrowLength,
      screenPos.y + Math.sin(angle) * arrowLength
    );
    ctx.stroke();

    // Arrowhead
    drawArrowhead(ctx, screenPos.x, screenPos.y, angle, arrowLength);
  }
}
```

**2. Click Detection:**
```javascript
canvas.addEventListener('click', (e) => {
  const worldPos = map.screenToWorld(e.clientX, e.clientY);

  // Check if clicked on any player
  const clickedPlayer = onlinePlayers.find(player => {
    const dx = player.location.x - worldPos.x;
    const dy = player.location.y - worldPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < 20; // 20px click radius
  });

  if (clickedPlayer) {
    shipInfoPane.show(clickedPlayer.characterId);
  }
});
```

**3. Real-Time Position Updates:**
```javascript
// Update player position when they move
socket.on('characterNavigating', (data) => {
  const player = onlinePlayers.get(data.characterId);
  if (player) {
    player.navigation = {
      destination: data.destination,
      isInTransit: true,
      eta: data.eta
    };
    map.render(); // Redraw map
  }
});

socket.on('characterDocked', (data) => {
  const player = onlinePlayers.get(data.characterId);
  if (player) {
    player.location = data.location;
    player.navigation = { isInTransit: false };
    map.render();
  }
});
```

## 8. Integration Guide

### HTML Template Integration

Add to your game view pages (e.g., `/srv/ps/views/zones/index.ejs`):

```html
<!DOCTYPE html>
<html>
<head>
  <title>Stringborn Universe</title>
  <link rel="stylesheet" href="/stylesheets/style.css">

  <!-- Tester Toolbar -->
  <% if (user && user.userRole === 'tester') { %>
    <link rel="stylesheet" href="/stylesheets/tester-toolbar.css">
  <% } %>

  <!-- Ship Info Pane -->
  <link rel="stylesheet" href="/stylesheets/ship-info-pane.css">

  <!-- Global Chat -->
  <link rel="stylesheet" href="/stylesheets/global-chat.css">

  <!-- Screenshot Library -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
</head>
<body>
  <!-- Your page content -->
  <canvas id="galactic-map"></canvas>

  <!-- Socket.IO -->
  <script src="/socket.io/socket.io.js"></script>

  <!-- Core Scripts -->
  <script src="/javascripts/galactic-map-optimized.js"></script>
  <script src="/javascripts/ship-info-pane.js"></script>
  <script src="/javascripts/global-chat.js"></script>

  <!-- Tester Toolbar (only for testers) -->
  <% if (user && user.userRole === 'tester') { %>
    <script src="/javascripts/tester-toolbar.js"></script>
  <% } %>

  <script>
    // Initialize everything
    const socket = io();
    const user = <%- JSON.stringify(user) %>;
    const character = <%- JSON.stringify(character) %>;

    // Initialize components
    const shipInfoPane = initShipInfoPane(socket);
    const globalChat = initGlobalChat(socket, user, character);

    <% if (user && user.userRole === 'tester') { %>
      const testerToolbar = initTesterToolbar(user, character);
    <% } %>

    // Join the universe
    if (character) {
      socket.emit('characterJoin', {
        characterId: character._id,
        characterName: character.name,
        userId: user._id || user.id,
        location: character.location,
        assetId: character.location.assetId
      });
    }

    // Listen for online players
    socket.on('onlinePlayers', (playersList) => {
      console.log('Online players:', playersList.length);
      // Add all players to map
      playersList.forEach(player => {
        // galacticMap.addPlayer(player);
      });
    });

    // Update debug info periodically
    <% if (user && user.userRole === 'tester') { %>
      setInterval(() => {
        testerToolbar?.updateDebugInfo({
          location: true,
          socketStatus: socket.connected,
          playerCount: onlinePlayers?.size || 0
        });
      }, 1000);
    <% } %>
  </script>
</body>
</html>
```

### Update auth.js Status Endpoint

Make sure user role is included in auth status:

```javascript
// In /srv/ps/plugins/passport/auth.js
authRouter.get('/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        username: req.user.username,
        userRole: req.user.userRole || 'player', // Include role
        hasCompletedWelcome: req.user.hasCompletedWelcome || false,
        hasCompletedIntro: req.user.hasCompletedIntro || false
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});
```

## 9. Testing Workflow

### For Testers:

1. **Login** - You're automatically assigned 'tester' role
2. **Tester Toolbar** - Appears at top of every page
3. **Debug Info** - Click debug icon to see character location, connection status
4. **Screenshot** - Click camera icon to capture current view
5. **Create Ticket** - Click info icon to report bugs or give feedback
6. **Global Chat** - Click chat icon to open chat window
7. **View Other Ships** - Click any player marker on map to see their info

### For Admins:

1. **View All Tickets** - `GET /api/v1/tickets` (no userId filter)
2. **Update Ticket Status** - `PATCH /api/v1/tickets/:id/status`
3. **Assign Tickets** - Add `assignedTo` field
4. **View Tester Activity** - Monitor online players, chat messages

## 10. Files Summary

### Created Files:

**Scripts:**
- `/srv/ps/scripts/add-user-roles.js` - Add userRole to existing users

**API:**
- `/srv/ps/api/v1/tickets/index.js` - Ticket management API

**Client JavaScript:**
- `/srv/ps/public/javascripts/tester-toolbar.js` - Tester toolbar component
- `/srv/ps/public/javascripts/global-chat.js` - Global chat component

**Stylesheets:**
- `/srv/ps/public/stylesheets/tester-toolbar.css` - Toolbar styling
- `/srv/ps/public/stylesheets/global-chat.css` - Chat styling

**Documentation:**
- `/srv/ps/TESTING_SYSTEM.md` - This file

### Modified Files:

- `/srv/ps/plugins/passport/auth.js` - Added userRole to registration
- `/srv/ps/plugins/socket/index.js` - Added online player tracking
- `/srv/ps/api/v1/index.js` - Registered tickets router

## 11. Next Steps

1. **Run the user role script:**
   ```bash
   cd /srv/ps
   node scripts/add-user-roles.js
   ```

2. **Integrate components into map view:**
   - Add scripts and stylesheets to map pages
   - Initialize toolbar, chat, and info pane
   - Render player markers with navigation arrows

3. **Test the system:**
   - Login as tester
   - Verify toolbar appears
   - Create a test ticket
   - Send chat messages
   - Click on other players

4. **Future Enhancements:**
   - Admin dashboard for ticket management
   - Screenshot attachments to tickets
   - Chat moderation tools
   - Player muting/blocking
   - Ticket priority sorting
   - Email notifications for ticket updates

## Summary

The testing system is now fully implemented with:
- ✅ User role system (tester, admin, player)
- ✅ Tester toolbar with debug info
- ✅ Screenshot capture
- ✅ Bug report / feedback ticket system
- ✅ Global real-time chat
- ✅ Online player tracking
- ✅ Socket.IO event system
- ⏳ Map integration (awaiting implementation)

All infrastructure is ready for comprehensive testing with real-time communication and feedback collection!
