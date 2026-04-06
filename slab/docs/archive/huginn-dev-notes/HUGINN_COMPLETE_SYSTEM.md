# Huginn Complete System — Input/Output Flow

## 🎯 System Overview

Huginn is a two-part AI assistant system with **clear separation of input and output**:

```
┌─────────────────────────────────────┐
│  INPUT: /superadmin/huginn          │
│  - Text input (keyboard)            │
│  - Voice input (microphone)         │
│  - 3D orb visualization (sidebar)   │
│  - Auto-TTS toggle                  │
│  - Mobile responsive                │
└────────────┬────────────────────────┘
             │
             ▼
    ┌────────────────┐
    │  LLM Processing│
    │  (Huginn AI)   │
    └────────┬───────┘
             │
             ▼
┌─────────────────────────────────────┐
│  OUTPUT: /superadmin/control-center │
│  - Large 3D orb (center)            │
│  - Accordion message list (side)    │
│  - TTS on each message              │
│  - Animated floating cards          │
└─────────────────────────────────────┘
```

## ✨ Key Concept

**Huginn Chat** = Control Panel (Input Only)
**Control Center** = Display Screen (Output Only)

This separation allows you to:
- Use Huginn chat as an input device (like a keyboard/microphone)
- Use Control Center as a display device (like a monitor/speaker)
- Run Control Center on multiple displays simultaneously
- Control which displays receive the output

## 📱 Huginn Chat (`/superadmin/huginn`)

### Purpose
Input-only interface for communicating with Huginn AI.

### Features

**1. 3D Animated Orb (Sidebar)**
- Compact orb visualization (200px height)
- Shows status: THINKING, SPEAKING, IDLE
- Purple/Gold colors (green during TTS)
- Smooth animations synced with state

**2. Auto-TTS Toggle**
- Checkbox overlay on orb
- Persists in localStorage
- When enabled: Huginn responses auto-speak
- Purple highlight when active

**3. Text Input**
- Standard textarea
- Auto-resizing (up to 140px)
- Enter to send, Shift+Enter for new line
- Session management

**4. Voice Input (STT)**
- 🎤 Microphone button
- Web Speech API
- Converts speech to text
- Auto-submits after recognition

**5. Connected Displays List**
- Shows all active Control Center displays
- Select target for deployment
- "All Displays" option

**6. Mobile Responsive**
- Sidebar moves to top on mobile
- Orb height reduces to 150px
- Text adjusts for smaller screens
- Touch-friendly controls

### User Flow

1. Open `/superadmin/huginn`
2. See orb in sidebar + input box at bottom
3. Type message OR click 🎤 to speak
4. Orb shows "THINKING" while processing
5. Response appears on Control Center displays
6. Orb pulses when response is sent
7. If auto-TTS enabled: Orb shows "SPEAKING" and reads response aloud

### UI Layout

```
┌─────────────────────────────────────┐
│ Topbar (sLab logo, status)          │
├──────────┬──────────────────────────┤
│          │                          │
│  SIDEBAR │  CENTER INFO AREA        │
│          │                          │
│  ┌──────┤  "Huginn Control Panel"  │
│  │ Orb  │                           │
│  │      │  "Type or speak below.   │
│  │ [✓]  │   Responses appear on     │
│  │AUTO  │   Control Center."        │
│  └──────┤                           │
│          │                          │
│ Displays │                          │
│  • CC1   │                          │
│  • CC2   │                          │
│          │                          │
│ Deploy   │                          │
│  [All ▼] │                          │
│  [Clear] │                          │
│          │                          │
├──────────┴──────────────────────────┤
│ Session: [superadmin]  [New]        │
├─────────────────────────────────────┤
│ [Voice▼] [____________] 🎤 [Send]   │
└─────────────────────────────────────┘
```

## 🖥️ Control Center (`/superadmin/control-center`)

### Purpose
Output-only display for Huginn responses and webhook events.

### Features

**1. Large 3D Orb (Center Stage)**
- Full-screen orb visualization
- Particle effects, lightning, runes
- Purple/gold animated sphere
- Never blocked by messages

**2. Side Panel Messages**
- Right side panel (420px wide)
- Accordion-style compact list
- Newest messages at top
- Color-coded by type

**3. TTS on Every Message**
- 🔊 Speaker icon on each message
- Click to hear message read aloud
- Voice selection in toolbar
- Piper TTS with fallback to Web Speech

**4. Message Controls**
- Toggle panel on/off
- Expand/collapse all messages
- Clear all messages
- Auto-expand alerts

**5. Message Types**
- 🟣 Purple = Alert (auto-expands)
- 🟢 Green = Text
- 🔵 Blue = Code

### UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Topbar (status, connection info)                               │
├─────────────────────────────────────────┬──────────────────────┤
│                                         │  ┌────────────────┐  │
│                                         │  │ [ALERT] Message│←┐│
│                                         │  │ Preview...  🔊 ▼││
│            3D HUGINN ORB                │  └────────────────┘ ││
│        (center, full visibility)        │                     ││
│                                         │  ┌────────────────┐ ││
│      ✨ Particles  ⚡ Lightning          │  │ [TEXT] Another │ ││
│                                         │  │ message... 🔊 ▼││
│                                         │  └────────────────┘ ││
│                                         │                     ││
│                                         │  Side Panel         ││
│                                         │  (420px wide)       ││
│                                         │                     ││
├─────────────────────────────────────────┴──────────────────────┤
│ [Messages] [Expand All] [Collapse] [Clear] [Voice▼]  │ 5 items│
└────────────────────────────────────────────────────────────────┘
```

## 🔄 Complete Data Flow

### 1. User Input (Huginn Chat)

```javascript
// User types message
inputEl.value = "What is the weather today?"

// Orb enters thinking state
huginnOrb.setThinking()  // Shows "THINKING"

// Send to LLM
POST /superadmin/huginn/chat
{
  messages: [{ role: 'user', content: 'What is the weather today?' }],
  session: 'superadmin'
}
```

### 2. LLM Processing

```
Huginn LLM receives request
  ↓
Processes using deepseek-r1:7b
  ↓
Generates response
  ↓
Returns streamed response
```

### 3. Deploy to Control Center

```javascript
// Response received
var reply = "The weather today is sunny with a high of 75°F..."

// Deploy to Control Center via Socket.IO
socket.emit('deploy', {
  content: reply,
  type: 'alert',
  displayId: 'all'  // or specific display
})

// Orb pulses
huginnOrb.pulse()

// Auto-TTS if enabled
if (autoTTSEnabled) {
  speak(reply)  // TTS with orb animation
  huginnOrb.startSpeaking()  // Green color, "SPEAKING"
}
```

### 4. Display on Control Center

```javascript
// Control Center receives deploy event
socket.on('deploy', function(payload) {
  // Add message to side panel
  addCard(payload)  // Collapsed accordion card

  // Auto-expand if alert type
  if (payload.type === 'alert') {
    toggleCard(cardId)
  }

  // Pulse orb (if Control Center has one)
  if (window.huginnOrb) {
    window.huginnOrb.pulse()
  }
})
```

## 🎮 Usage Examples

### Example 1: Basic Chat

**Huginn Chat:**
1. Open `/superadmin/huginn`
2. Type: "Hello Huginn"
3. Press Enter
4. Orb shows "THINKING"

**Control Center:**
1. New alert card appears in side panel
2. Card auto-expands (type: alert)
3. Shows: "Hello! How can I help you today?"
4. Orb pulses once

### Example 2: Voice Input with Auto-TTS

**Huginn Chat:**
1. Open `/superadmin/huginn`
2. Enable "AUTO TTS" toggle
3. Click 🎤 microphone button
4. Speak: "What is quantum computing?"
5. Message auto-submits

**Huginn Chat (continued):**
- Orb shows "THINKING"
- Then "SPEAKING" (turns green)
- Orb pulses rhythmically as it speaks
- You hear Huginn's response through speakers

**Control Center:**
- Message appears in side panel
- If someone is watching the display, they see the text
- Orb pulses to indicate new message

### Example 3: Multiple Displays

**Huginn Chat:**
1. Connect 3 Control Center displays
2. Select specific display from dropdown
3. Type message
4. Only selected display receives the output

### Example 4: Webhook Trigger

**External System:**
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "🚨 Server CPU exceeded 90%!",
    "type": "alert"
  }'
```

**Huginn Chat:**
- Orb pulses (webhook received)

**Control Center:**
- Alert card appears
- Auto-expands
- Orb pulses
- If TTS button clicked, reads alert aloud

## 📊 State Management

### Huginn Chat Orb States

| State | Color | Status Label | When |
|-------|-------|--------------|------|
| IDLE | Purple/Gold | (hidden) | Default, waiting for input |
| THINKING | Purple/Gold (bright) | "THINKING" | Processing user message |
| SPEAKING | Purple/Green | "SPEAKING" | TTS playback active |
| PULSE | Flash bright | (hidden) | Webhook received or response sent |

### Control Center Orb States

| State | Color | When |
|-------|-------|------|
| IDLE | Purple/Gold | Default, no activity |
| PULSE | Flash bright | New message received |

## 🎨 Mobile Responsiveness

### Huginn Chat (Mobile)

**Changes on <768px:**
- Sidebar moves to top (horizontal layout)
- Orb height: 200px → 150px
- Info text font size reduced
- Session bar wraps
- Input bar padding reduced
- Mic button touch-optimized

**Layout:**
```
┌─────────────────────┐
│ Topbar              │
├─────────────────────┤
│ ┌─────┐             │
│ │ Orb │ [✓] AUTO    │
│ └─────┘             │
├─────────────────────┤
│ Info Area           │
│ "Type or speak..."  │
├─────────────────────┤
│ Session: [____]     │
│ [New]               │
├─────────────────────┤
│ [Voice▼]            │
│ [___________]       │
│ 🎤  [Send]          │
└─────────────────────┘
```

### Control Center (Mobile)

**Changes on <768px:**
- Message panel width: 420px → 100%
- Orb still visible in background
- Messages overlay orb (with transparency)

## 🔧 Technical Integration

### Socket.IO Namespaces

**`/huginn` namespace:**
- Used by both Huginn Chat and Control Center
- Events:
  - `join-huginn` — Huginn chat joins as operator
  - `join-control-center` — Display joins as viewer
  - `deploy` — Send message to displays
  - `deploy-ack` — Confirmation
  - `clear-display` — Clear all messages
  - `displays-updated` — List of connected displays

### Endpoints

**Huginn Chat:**
- `POST /superadmin/huginn/chat` — Send message to LLM
- `GET /superadmin/huginn/health` — Check LLM status

**Control Center:**
- `POST /huginn/webhook` — Receive external webhooks
- `GET /huginn/health` — Check Socket.IO status

**TTS:**
- `POST /admin/tts` — Generate speech audio (Piper)

## 🚀 Quick Start Guide

### Setup

1. **Start server:**
   ```bash
   cd /srv/slab && node bin/www.js
   ```

2. **Open Control Center** (on display/monitor):
   ```
   https://slab.madladslab.com/superadmin/control-center
   ```

3. **Open Huginn Chat** (on your device):
   ```
   https://slab.madladslab.com/superadmin/huginn
   ```

### Use

1. **Enable Auto-TTS** (optional):
   - Click "AUTO TTS" checkbox on Huginn chat orb
   - Turns purple when active

2. **Send message:**
   - Type in input box
   - OR click 🎤 and speak
   - Press Enter or click Send

3. **Watch Control Center:**
   - Response appears in side panel
   - Alert messages auto-expand
   - Orb pulses
   - Click 🔊 to hear message

## 📚 Related Documentation

- `/srv/slab/HUGINN_WEBHOOK_SETUP.md` — Webhook integration guide
- `/srv/slab/CONTROL_CENTER_UPDATES.md` — Control Center features
- `/srv/slab/HUGINN_CHAT_ORB_INTEGRATION.md` — Orb animation details
- `/srv/slab/HUGINN_QUICK_REFERENCE.md` — Quick commands

## ✅ System Checklist

- ✅ **Input** → Huginn Chat (text + voice)
- ✅ **Output** → Control Center (text + TTS)
- ✅ **Orb animations** → Synced with states
- ✅ **Auto-TTS** → Toggle on/off
- ✅ **Mobile responsive** → Huginn chat adapts
- ✅ **Multiple displays** → Select targets
- ✅ **Webhooks** → External integrations
- ✅ **Side panel** → Doesn't block orb view

## 🎯 Summary

**Perfect Separation:**
- 👨‍💻 **Huginn Chat** = Input device (keyboard/mic)
- 🖥️ **Control Center** = Output device (monitor/speaker)

**Clean Flow:**
```
You → Huginn Chat → LLM → Control Center → Audience
```

**Mobile Ready:**
- Responsive sidebar on Huginn chat
- Touch-optimized controls
- Works on phones/tablets

**Flexible:**
- Deploy to specific displays
- Multiple Control Centers simultaneously
- External webhook integrations

**Your Huginn system is complete!** 🎉✨

---

**Updated:** April 5, 2026
**Version:** 3.0 — Input/Output Separation
