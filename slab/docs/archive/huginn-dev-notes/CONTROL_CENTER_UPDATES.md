# Control Center Updates — v2.0

## 🎨 What Changed

The Control Center has been completely redesigned to provide an unobstructed view of the beautiful 3D Huginn orb animation while still displaying messages in an accessible, compact format.

### Before & After

**Before:**
- ❌ Messages covered the center of the screen
- ❌ Blocked view of 3D animation
- ❌ Full-screen cards took over the display
- ❌ No TTS on control center

**After:**
- ✅ Messages in compact side panel (right side)
- ✅ Clear center view of 3D animation
- ✅ Accordion-style collapsible list
- ✅ TTS on every message
- ✅ Easy expand/collapse controls

## 🎯 New Features

### 1. **Side Panel Messages**
Messages now appear in a sleek side panel on the right side of the screen (420px wide). This keeps your beautiful Huginn orb animation visible at all times!

- **Location:** Right edge of screen
- **Width:** 420px
- **Behavior:** Slides in when messages arrive
- **Toggle:** Click "Messages" button in toolbar to show/hide

### 2. **Accordion-Style Compact List**
Each message appears as a compact, collapsible card:

**Collapsed State (default):**
- Shows message type badge (ALERT, TEXT, CODE)
- Shows preview (first 60 characters)
- Shows timestamp
- Shows speaker icon 🔊

**Expanded State:**
- Shows full message content
- Supports markdown formatting
- Auto-scrollable for long messages

**Controls:**
- **Click card header** → Expand/collapse individual message
- **Expand All button** → Expand all messages at once
- **Collapse All button** → Collapse all messages
- **Auto-expand:** Alert messages auto-expand on arrival

### 3. **Text-to-Speech (TTS)**
Every message now has a speaker icon 🔊 for instant audio playback!

**Features:**
- Click speaker icon to hear message read aloud
- Green pulsing animation while speaking
- Click again to stop
- Voice selection in toolbar (Lessac, Ryan, SLT)
- Automatic markdown cleaning (removes code blocks, links, etc.)
- Falls back to browser speech synthesis if Piper TTS unavailable

**Voice Options:**
- **Lessac** — Female voice (default)
- **Ryan** — Male voice
- **SLT** — Female voice (alternative)

### 4. **Message Type Colors**
Messages are color-coded by type with a left border stripe:

- 🟣 **Purple** — Alert messages (important notifications)
- 🟢 **Green** — Text messages (standard info)
- 🔵 **Blue** — Code messages (snippets, technical)

## 🎮 How to Use

### Opening the Control Center

Navigate to: `https://slab.madladslab.com/superadmin/control-center`

You'll see:
1. **Center:** The beautiful 3D Huginn orb with particles, lightning, and runes
2. **Right side:** Compact message list (hidden until first message arrives)
3. **Bottom toolbar:** Controls and voice selection

### Toolbar Controls

**Left side:**
- **Messages** — Toggle message panel visibility (active by default)
- **Expand All** — Expand all collapsed messages
- **Collapse All** — Collapse all expanded messages
- **Clear** — Remove all messages and reset

**Right side:**
- **Voice dropdown** — Select TTS voice (Lessac, Ryan, SLT)
- **Item counter** — Shows total message count

### Interacting with Messages

**To read a message:**
1. Click the message header to expand
2. Read the full content
3. Click header again to collapse

**To hear a message:**
1. Click the 🔊 speaker icon
2. Listen to TTS playback
3. Click again to stop

**To manage messages:**
- Use "Expand All" to see everything at once
- Use "Collapse All" to minimize and see list overview
- Use "Clear" to remove all messages

## 📱 Responsive Design

The side panel automatically:
- Adjusts to screen size
- Scrolls when messages overflow
- Maintains animation visibility
- Hides on mobile (< 768px) to prevent blocking

## 🔧 Technical Details

### File Updated
`/srv/slab/views/superadmin/control-center.ejs`

### Key Changes

**CSS:**
- Side panel: `position: fixed; right: 0; width: 420px`
- Compact cards with border-left color coding
- Accordion states: `.collapsed` and `.expanded`
- Smooth transitions and animations

**JavaScript:**
- `toggleCard(cardId)` — Toggle individual card
- `expandAll()` — Expand all cards
- `collapseAll()` — Collapse all cards
- `speakCard(bodyId)` — TTS playback
- `setVoice(voice)` — Change TTS voice
- Auto-expand for alert messages

### TTS Endpoint
Uses existing TTS endpoint: `/admin/tts`

Payload:
```json
{
  "text": "Text to speak",
  "voice": "lessac"  // or "ryan", "slt"
}
```

## 🚀 Testing

Send a test webhook:

```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "**Test Message**\n\nThis is a test of the new accordion-style message list with TTS!",
    "type": "alert"
  }'
```

Then:
1. Open Control Center
2. See message appear in side panel
3. Click message header to expand/collapse
4. Click 🔊 icon to hear it spoken
5. Enjoy the unobstructed 3D animation! ✨

## 📊 Message Behavior

### Alert Messages
- Type: `"alert"`
- Color: Purple border
- Behavior: **Auto-expands** on arrival
- Use for: Important notifications, system alerts

### Text Messages
- Type: `"text"`
- Color: Green border
- Behavior: Starts collapsed
- Use for: Standard information, status updates

### Code Messages
- Type: `"code"`
- Color: Blue border
- Behavior: Starts collapsed, monospace font
- Use for: Code snippets, technical data

## 🎯 Voice-to-Text (STT)

As requested, **Voice-to-Text remains ONLY on the Huginn Chat page** (`/superadmin/huginn`).

- ✅ TTS: Available on Control Center (for listening)
- ❌ STT: Not on Control Center (display-only mode)
- ✅ STT: Available on Huginn Chat (for voice input)

This separation makes sense:
- **Control Center** = Display and listen mode
- **Huginn Chat** = Input and conversation mode

## ✨ Summary

The redesigned Control Center gives you:
1. **Clear view** of the stunning 3D Huginn orb
2. **Compact messages** in a side panel
3. **TTS on every message** for accessibility
4. **Easy accordion controls** for quick scanning
5. **Beautiful animations** without obstruction

**Your 3D animation is now the star of the show!** 🌟

---

**Updated:** April 5, 2026
**Version:** 2.0
