# Tester & Debug System - Complete Guide

## Overview

Professional testing infrastructure for the Stringborn Universe, providing comprehensive debugging tools, real-time chat, bug reporting, and multiplayer monitoring for all testers.

---

## Components

### 1. Tester Toolbar
### 2. Global Chat System
### 3. Ship Info Pane
### 4. Bug Ticket System
### 5. Screenshot Capture
### 6. User Role System

---

## 1. Tester Toolbar

**File:** [/srv/ps/public/javascripts/tester-toolbar.js](../public/javascripts/tester-toolbar.js)

### Features

- **Bottom-positioned status bar** (24px height)
- **Compact monospace design** matching admin debug style
- **Dynamic stacking** above admin debug bar when both present
- **Real-time metrics**:
  - Character name and location coordinates
  - FPS (frames per second)
  - PING (network latency in ms)
  - Online player count
- **Action buttons**:
  - 🐛 Debug panel toggle
  - 💬 Global chat toggle
  - 📊 Screenshot capture
  - 📋 Bug report system
- **Mobile responsive** with progressive disclosure
- **Socket.IO integration** for real-time updates

### Visual Design

```
[TESTER] ScooterMcBooter • LOC: 4471,464 • FPS: 60 • PING: 23ms [🐛] [💬] [📊] [📋]
```

- **Font:** 'Courier New', monospace at 10-11px
- **Color:** Purple theme (#a78bfa)
- **Height:** 24px
- **Position:** Fixed bottom with dynamic offset for admin bar
- **Layout:** Three sections (services, resources, actions)

### Debug Panel

When 🐛 button clicked:
- Character ID and name
- Current location (x, y)
- Docking status (docked/undocked)
- Socket connection status
- Online player count
- FPS monitoring
- Network latency

### Mobile Responsiveness

**Tablet (768px):**
- Flex wrapping for narrow screens
- Vertical stacking of sections

**Mobile (375px):**
- Hide PING metric (progressive disclosure)
- Reduced padding/gaps
- Maintain touch-friendly button sizes (16px min)

### Integration

```javascript
// In galactic-map.ejs or other views

// Initialize after Socket.IO connects
socket.on('connect', () => {
  const characterObj = map.currentCharacter;

  window.testerToolbar = new TesterToolbar(userObj, characterObj);
  window.testerToolbar.connectSocket(socket);
  window.testerToolbar.connectMap(map);
});
```

### Positioning Logic

```javascript
// Auto-detects admin debug bar height
const adminDebug = document.querySelector('.admin-debug');
if (adminDebug) {
  const height = adminDebug.offsetHeight;
  document.documentElement.style.setProperty('--admin-debug-height', `${height}px`);
  document.body.classList.add('has-admin-debug');
}

// ResizeObserver for dynamic updates
const observer = new ResizeObserver(entries => {
  for (let entry of entries) {
    const height = entry.target.offsetHeight;
    document.documentElement.style.setProperty('--admin-debug-height', `${height}px`);
  }
});
observer.observe(adminDebug);
```

---

## 2. Global Chat System

**Files:**
- [/srv/ps/public/javascripts/global-chat.js](../public/javascripts/global-chat.js)
- [/srv/ps/public/stylesheets/global-chat.css](../public/stylesheets/global-chat.css)

### Features

- **Real-time chat** via Socket.IO
- **Floating window** (400x500px, bottom-left)
- **Message types**:
  - User messages (blue highlight)
  - Own messages (purple highlight, right-aligned)
  - System messages (centered with icon)
- **Online player count** display
- **Auto-scroll** to latest message
- **100 message history** preserved
- **Mobile responsive**
- **Security**: HTML escaping for all messages

### Socket Events

**Send:**
```javascript
socket.emit('chatMessage', {
  user: username,
  characterName: character.name,
  message: text,
  userId: user._id
});
```

**Receive:**
```javascript
socket.on('chatMessage', ({ user, characterName, message, userId, timestamp }) => {
  // Append message to chat window
});

socket.on('characterJoined', ({ characterName }) => {
  // System message: "ScooterMcBooter joined the universe"
});

socket.on('characterLeft', ({ characterName }) => {
  // System message: "ScooterMcBooter left the universe"
});

socket.on('onlineCount', (count) => {
  // Update online player count
});
```

### Usage

```javascript
const globalChat = initGlobalChat(socket, user, character);

// Toggle chat window
globalChat.toggleChat();

// Programmatically send message
globalChat.sendMessage("Hello universe!");
```

### Integration

```html
<!-- Add to view -->
<link rel="stylesheet" href="/stylesheets/global-chat.css">
<script src="/javascripts/global-chat.js"></script>

<script>
  const socket = io();
  const user = <%- JSON.stringify(user) %>;
  const character = <%- JSON.stringify(character) %>;

  window.globalChat = initGlobalChat(socket, user, character);
</script>
```

---

## 3. Ship Info Pane

**Files:**
- [/srv/ps/public/javascripts/ship-info-pane.js](../public/javascripts/ship-info-pane.js)
- [/srv/ps/public/stylesheets/ship-info-pane.css](../public/stylesheets/ship-info-pane.css)

### Features

- **Slide-in panel** from right side
- **Click any character** on map to view details
- **Character info**:
  - Name, level, species, class
  - All 5 stats (STR, INT, AGI, FAITH, TECH)
- **Ship info**:
  - Ship name and class
  - Hull health with color-coded bar
- **Location info**:
  - Current coordinates
  - Docking status
  - Zone/asset name
- **Real-time updates** via Socket.IO

### Usage

```javascript
const infoPane = initShipInfoPane(socket);

// Show specific character
infoPane.show(characterId);

// Hide pane
infoPane.hide();

// Update from Socket.IO event
socket.on('characterUpdate', (character) => {
  infoPane.updateCharacter(character);
});
```

### Hull Health Display

```javascript
const hullPercent = (character.ship.hull / character.ship.maxHull) * 100;

// Color coding:
// > 75%: Green
// 50-75%: Yellow
// 25-50%: Orange
// < 25%: Red
```

---

## 4. Bug Ticket System

**Files:**
- [/srv/ps/api/v1/tickets/index.js](../api/v1/tickets/index.js)
- Integrated into tester toolbar

### Ticket Types

- **Bug Report** - Something is broken
- **Feedback** - General feedback
- **Feature Request** - Request new feature
- **UI/UX Issue** - Interface problem

### Severity Levels

- **Low** - Minor issue, low priority
- **Medium** - Affects usability
- **High** - Major issue, needs attention
- **Critical** - Blocks testing, urgent

### Ticket Data Captured

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  characterId: ObjectId,
  type: String,              // Type from above
  severity: String,          // Severity from above
  title: String,
  description: String,
  status: String,            // open, in-progress, resolved, closed
  location: {
    x: Number,
    y: Number,
    zone: String
  },
  context: {
    url: String,
    userAgent: String,
    screenResolution: String
  },
  screenshot: String,        // Base64 or file path
  comments: [{
    userId: ObjectId,
    username: String,
    text: String,
    createdAt: Date
  }],
  createdAt: Date,
  updatedAt: Date,
  resolvedAt: Date,
  resolvedBy: ObjectId
}
```

### API Endpoints

```
POST   /api/v1/tickets              - Create ticket
GET    /api/v1/tickets              - Get all tickets (admin)
GET    /api/v1/tickets/my           - Get user's tickets
GET    /api/v1/tickets/:id          - Get single ticket
PATCH  /api/v1/tickets/:id/status   - Update status (admin)
POST   /api/v1/tickets/:id/comments - Add comment
```

### Usage

```javascript
// From tester toolbar button
document.getElementById('submit-ticket').addEventListener('click', async () => {
  const ticketData = {
    type: document.getElementById('ticket-type').value,
    severity: document.getElementById('ticket-severity').value,
    title: document.getElementById('ticket-title').value,
    description: document.getElementById('ticket-description').value,
    screenshot: includeScreenshot ? screenshotData : null
  };

  const response = await fetch('/api/v1/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticketData)
  });

  // Show success message
});
```

---

## 5. Screenshot Capture

**Library:** html2canvas v1.4.1

### Features

- **Full page capture** with one click
- **Automatic download** as PNG
- **Optional attachment** to tickets
- **Notification** on successful capture
- **Exclude elements** (optional, e.g., hide debug toolbars)

### Integration

```html
<!-- Add to view head -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

### Usage

```javascript
// From tester toolbar
async function captureScreenshot() {
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      logging: false
    });

    // Convert to blob
    canvas.toBlob((blob) => {
      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      a.click();

      // Or attach to ticket
      const reader = new FileReader();
      reader.onloadend = () => {
        screenshotData = reader.result; // Base64
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Screenshot failed:', error);
  }
}
```

---

## 6. User Role System

**File:** [/srv/ps/plugins/passport/auth.js](../plugins/passport/auth.js)

### Roles

- **tester** - Default role for all users, full testing access
- **admin** - Full administrative access
- **player** - Standard player (future use)

### Database Update

All users assigned `userRole: 'tester'`:
- scoot (m.scott.wallace@gmail.com)
- scootermcboot (snoryder8019@gmail.com)
- Kusinagi5 (travis.c.wallace@gmail.com)
- mcluvin (mtm92077@gmail.com)
- jonus350 (jonus350@gmail.com)

### New User Registration

```javascript
// In auth.js
const newUser = new User({
  username,
  email,
  password: hashedPassword,
  userRole: 'tester',  // Auto-assigned
  hasCompletedWelcome: false,
  hasCompletedIntro: false
});
```

### Role Checking

```javascript
// Middleware
function requireTester(req, res, next) {
  if (req.user && (req.user.userRole === 'tester' || req.user.userRole === 'admin')) {
    return next();
  }
  res.status(403).send('Tester access required');
}

// In views
<% if (user && user.userRole === 'tester') { %>
  <link rel="stylesheet" href="/stylesheets/tester-toolbar.css">
  <script src="/javascripts/tester-toolbar.js"></script>
<% } %>
```

---

## Socket.IO Integration

### Server-Side Events

**File:** [/srv/ps/plugins/socket/index.js](../plugins/socket/index.js)

```javascript
// Player registry
const onlinePlayers = new Map();

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // Character join
  socket.on('characterJoin', ({ characterId, characterName, userId, location, assetId }) => {
    onlinePlayers.set(socket.id, {
      socketId: socket.id,
      characterId,
      characterName,
      userId,
      location,
      assetId,
      joinedAt: new Date()
    });

    // Broadcast to all
    io.emit('characterJoined', { characterName });
    io.emit('onlinePlayers', Array.from(onlinePlayers.values()));
    io.emit('onlineCount', onlinePlayers.size);
  });

  // Chat message
  socket.on('chatMessage', ({ user, characterName, message, userId }) => {
    io.emit('chatMessage', {
      user,
      characterName,
      message,
      userId,
      timestamp: new Date()
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = onlinePlayers.get(socket.id);
    if (player) {
      onlinePlayers.delete(socket.id);
      io.emit('characterLeft', { characterName: player.characterName });
      io.emit('onlineCount', onlinePlayers.size);
    }
  });
});
```

### Client-Side Integration

```javascript
const socket = io();

// Wait for connection before initializing
socket.on('connect', () => {
  console.log('✅ Socket.IO connected:', socket.id);

  // Initialize toolbar
  window.testerToolbar = new TesterToolbar(userObj, characterObj);
  window.testerToolbar.connectSocket(socket);
  window.testerToolbar.connectMap(map);

  // Initialize chat
  window.globalChat = initGlobalChat(socket, userObj, characterObj);

  // Join universe
  socket.emit('characterJoin', {
    characterId: characterObj._id,
    characterName: characterObj.name,
    userId: userObj._id,
    location: characterObj.location,
    assetId: characterObj.location.assetId
  });
});

// Listen for players
socket.on('onlinePlayers', (playersList) => {
  // Render all players on map
  playersList.forEach(player => {
    map.addPlayerMarker(player);
  });
});
```

---

## Character ID Field Reference

**Important:** Character IDs have different field names in different contexts:

| Source | Field Name | Example Value | Usage |
|--------|------------|---------------|-------|
| MongoDB | `_id` | `ObjectId("68f1...")` | Database primary key |
| API Response | `_id` | `"68f1c6271db390295144f032"` | Character object |
| Socket.IO Emit | `characterId` | `"68f1c6271db390295144f032"` | Network transmission |
| Socket.IO Receive | `characterId` | `"68f1c6271db390295144f032"` | Player registry |
| Map Object | `_id` | `"68f1c6271db390295144f032"` | Current character |
| Characters Array | `characterId` | `"68f1c6271db390295144f032"` | Online players |

### Comparison Logic

```javascript
// When comparing Socket.IO data with current character
const isCurrentPlayer =
  character.characterId === this.currentCharacter?._id ||
  character.characterId === this.currentCharacter?.characterId;
```

---

## Testing Workflow

### Setup (One-Time)

1. **Set user role to tester** (already done for existing users)
2. **Install html2canvas** (already included via CDN)
3. **Verify Socket.IO** running on server

### Testing Checklist

#### Tester Toolbar
- [ ] Positioned at bottom of screen
- [ ] Stacks above admin debug when both present
- [ ] Location displays correctly
- [ ] FPS displays correctly
- [ ] PING displays correctly
- [ ] Compact view shows metrics inline
- [ ] Mobile responsive on all screen sizes

#### Global Chat
- [ ] Toggle button opens/closes chat
- [ ] Input focuses when opening
- [ ] Messages send via Socket.IO
- [ ] Messages appear for all connected users
- [ ] System messages show for player joins/leaves
- [ ] Online count displays correctly
- [ ] Message history preserved
- [ ] Auto-scroll to latest message

#### Ship Info Pane
- [ ] Click player marker to view info
- [ ] Displays all character stats
- [ ] Shows ship health with color bar
- [ ] Location and docking status correct
- [ ] Updates in real-time

#### Bug Tickets
- [ ] Can open ticket form
- [ ] All fields work correctly
- [ ] Screenshot can be attached
- [ ] Ticket saves to database
- [ ] Admin can view tickets
- [ ] Comments can be added

#### Player Rendering
- [ ] Current player renders (green glow)
- [ ] Other players render (color-coded)
- [ ] No double-rendering
- [ ] Players visible when joining
- [ ] Players update when moving

---

## Performance Metrics

### Expected
- **Socket.IO connection:** <1 second
- **Message send latency:** <100ms
- **Toolbar initialization:** <500ms
- **Map rendering:** 60 FPS
- **PING to server:** <50ms

### Monitoring

```javascript
// FPS tracking
let lastTime = performance.now();
let frameCount = 0;

function trackFPS() {
  frameCount++;
  const now = performance.now();
  const delta = now - lastTime;

  if (delta >= 1000) {
    const fps = Math.round((frameCount * 1000) / delta);
    testerToolbar.updateFPS(fps);
    frameCount = 0;
    lastTime = now;
  }

  requestAnimationFrame(trackFPS);
}
trackFPS();

// Latency tracking
let pingStart = Date.now();
socket.emit('ping');
socket.on('pong', () => {
  const latency = Date.now() - pingStart;
  testerToolbar.updatePing(latency);
});
```

---

## Common Issues & Solutions

### Issue: Toolbar not showing
**Solution:** Verify user has `userRole: 'tester'` in database
```javascript
mongosh projectStringborne --eval "db.users.updateOne({email: 'user@email.com'}, {$set: {userRole: 'tester'}})"
```

### Issue: Location shows "--"
**Solution:** Initialize toolbar AFTER Socket.IO connects
```javascript
socket.on('connect', () => {
  window.testerToolbar = new TesterToolbar(userObj, characterObj);
});
```

### Issue: Players not visible on map
**Solution:** Check character ID comparison logic
```javascript
const isCurrentPlayer =
  character.characterId === this.currentCharacter?._id ||
  character.characterId === this.currentCharacter?.characterId;
```

### Issue: Chat messages not appearing
**Solution:** Verify Socket.IO event names match server/client
```javascript
// Server
io.emit('chatMessage', data);

// Client
socket.on('chatMessage', (data) => { ... });
```

---

## File Summary

### Created Files
- `/srv/ps/public/javascripts/tester-toolbar.js` - Toolbar component
- `/srv/ps/public/javascripts/global-chat.js` - Chat system
- `/srv/ps/public/javascripts/ship-info-pane.js` - Ship info UI
- `/srv/ps/public/stylesheets/tester-toolbar.css` - Toolbar styling
- `/srv/ps/public/stylesheets/global-chat.css` - Chat styling
- `/srv/ps/public/stylesheets/ship-info-pane.css` - Ship info styling
- `/srv/ps/api/v1/tickets/index.js` - Ticket API
- `/srv/ps/scripts/add-user-roles.js` - Database migration

### Modified Files
- `/srv/ps/plugins/socket/index.js` - Socket.IO events
- `/srv/ps/plugins/passport/auth.js` - User roles
- `/srv/ps/views/universe/galactic-map.ejs` - Toolbar integration
- `/srv/ps/public/javascripts/galactic-map-optimized.js` - Character ID fix

---

**Status:** ✅ Complete and Functional
**Ready For:** Team Testing
**Next Steps:** Integrate into all game views

---

**Quick Reference:** [TESTER_QUICK_REFERENCE.md](TESTER_QUICK_REFERENCE.md)
**Testing Guide:** [GLOBAL_CHAT_TESTING.md](GLOBAL_CHAT_TESTING.md)
