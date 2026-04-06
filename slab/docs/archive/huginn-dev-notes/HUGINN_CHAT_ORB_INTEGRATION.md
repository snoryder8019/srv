# Huginn Chat — 3D Orb Integration

## 🎨 Overview

The Huginn chat interface (`/superadmin/huginn`) now features a beautiful 3D animated orb that visualizes Huginn's state and synchronizes with text-to-speech playback.

## ✨ What's New

### 1. **3D Animated Orb** (Sidebar)
A compact Three.js orb visualization appears at the top of the sidebar, featuring:

**Visual Elements:**
- **Purple/Gold animated sphere** with shader effects
- **Glow shell** with pulsing rim light
- **Smooth rotations** and organic movements
- **Dynamic intensity** based on state

**States & Colors:**
- **IDLE** — Purple/Gold, gentle animation (default)
- **THINKING** — Brighter, faster animation (when processing)
- **SPEAKING** — Green accent, rhythmic pulsing (during TTS)

### 2. **Auto-TTS Toggle**
A checkbox overlay on the orb enables automatic text-to-speech for all Huginn responses.

**Location:** Top-right of orb container
**Label:** "AUTO TTS"
**Behavior:**
- Click to toggle on/off
- State persists in localStorage
- Purple highlight when active
- Auto-speaks every Huginn response when enabled

### 3. **Orb-Synced TTS**
The orb animates in perfect sync with speech playback:

**During Speech:**
- Orb color shifts to **green**
- Status label shows **"SPEAKING"**
- Rhythmic pulses synchronized with audio (150ms intervals)
- Amplitude varies randomly (0.6-1.0) for natural movement
- Orb "mouth movements" via vertex displacement

**After Speech:**
- Returns to idle state
- Color shifts back to gold
- Status clears automatically

### 4. **Webhook Reactions**
The orb pulses when webhook events are received:

**Triggers:**
- When you deploy a message to Control Center
- When webhook is successfully sent
- Quick intensity burst (1.2) then fade to normal

**Visual:**
- Bright flash animation
- 300ms duration
- Smooth lerp back to baseline

### 5. **Thinking State**
The orb shows when Huginn is processing your message:

**Triggers:**
- When you send a message
- Before typing indicator appears

**Visual:**
- Status: **"THINKING"**
- Increased intensity (0.8)
- Faster subtle animations

## 🎮 How to Use

### Open Huginn Chat
Navigate to: `https://slab.madladslab.com/superadmin/huginn`

You'll see:
1. **Sidebar:** 3D animated orb at top
2. **Auto-TTS toggle** (top-right of orb)
3. **Status label** (bottom of orb, shows when active)
4. **Connected displays** list below
5. **Chat area** on the right

### Enable Auto-TTS
1. Click the **"AUTO TTS"** checkbox on the orb
2. Checkbox becomes purple when active
3. All future Huginn responses will auto-speak

### Watch the Orb React
**When you send a message:**
- Orb shows **"THINKING"**
- Brighter animation

**When Huginn responds:**
- Orb pulses briefly
- If auto-TTS is on: Orb turns green and shows **"SPEAKING"**
- Orb pulses rhythmically with speech
- Returns to idle when done

**When you deploy to Control Center:**
- Orb pulses once (brief flash)

### Manual TTS
Even with auto-TTS off, you can still:
- Click the 🔊 **Speak** button on any message
- Orb will animate during playback
- Works the same as auto-TTS

## 🔧 Technical Details

### Orb Animation System

**Shader-Based Rendering:**
- Custom vertex shader for displacement
- Custom fragment shader for color/glow
- Real-time uniforms: `uTime`, `uIntensity`, `uSpeaking`

**Speaking Animation:**
```javascript
// Vertex displacement for "mouth movement"
float speakDisp = sin(position.y * 10.0 + uTime * 20.0) * uSpeaking * 0.08;
```

**Intensity Lerping:**
```javascript
orbIntensity += (targetIntensity - orbIntensity) * 0.02;
```

### TTS Integration

**Sync Mechanism:**
- Audio element created for each sentence
- Interval timer (150ms) triggers orb pulses during playback
- Random amplitude variation for natural look
- Cleanup on audio end/error

**Code Flow:**
```
User sends message
  → Orb: setThinking()
  → Fetch Huginn response
  → Response received
    → Orb: pulse()
    → If auto-TTS: trigger speak()
      → Orb: startSpeaking()
      → Audio plays with pulse intervals
      → Orb: speakPulse() every 150ms
      → Audio ends
      → Orb: stopSpeaking()
```

### Orb Control API

```javascript
window.huginnOrb = {
  pulse()           // Quick intensity burst
  startSpeaking()   // Enter speaking state (green)
  stopSpeaking()    // Exit speaking state
  speakPulse(amp)   // Trigger pulse with amplitude
  setIdle()         // Return to idle state
  setThinking()     // Show thinking state
  clearStatus()     // Hide status label
}
```

### State Management

**Auto-TTS State:**
- Stored in `localStorage` as `huginn-auto-tts`
- Boolean value (`'true'` or `'false'`)
- Persists across sessions
- Checkbox synced with state

**Orb States:**
```
IDLE (default)
  intensity: 0.5
  color: purple/gold
  status: hidden

THINKING
  intensity: 0.8
  color: purple/gold
  status: "THINKING"

SPEAKING
  intensity: 1.0
  color: purple/green
  status: "SPEAKING"
  pulsing: active
```

## 📊 Orb Behavior Matrix

| Event | Orb Reaction | Status | Duration |
|-------|-------------|---------|----------|
| User sends message | setThinking() | "THINKING" | Until response |
| Response received | pulse() | — | 300ms |
| Auto-TTS starts | startSpeaking() | "SPEAKING" | During audio |
| TTS playing | speakPulse() | "SPEAKING" | Every 150ms |
| TTS ends | stopSpeaking() | — | Immediate |
| Webhook deployed | pulse() | — | 300ms |
| Manual speak click | startSpeaking() | "SPEAKING" | During audio |
| Error | setIdle() | — | Immediate |

## 🎯 Key Features Summary

### Aligned with Control Center
- ✅ 3D orb visualization (compact sidebar version)
- ✅ TTS integration with sync
- ✅ Auto-TTS toggle
- ✅ Webhook reactions
- ✅ State indicators

### Huginn Chat Specific
- ✅ **Auto-TTS for responses** (toggle on/off)
- ✅ **Thinking state** (shows when processing)
- ✅ **Voice-to-Text** (mic button for voice input)
- ✅ **Deploy to Control Center** (send messages to displays)
- ✅ **Orb in sidebar** (doesn't block chat)

### Control Center Specific
- ✅ **Messages in side panel** (doesn't block orb)
- ✅ **Accordion message list**
- ✅ **TTS on each message**
- ✅ **Full-screen orb** (center stage)

## 🚀 Quick Test

### Test Auto-TTS

1. Open: `https://slab.madladslab.com/superadmin/huginn`
2. Click "AUTO TTS" checkbox on orb (should turn purple)
3. Send a message to Huginn
4. Watch:
   - Orb shows "THINKING"
   - Response appears
   - Orb pulses
   - Orb turns green and shows "SPEAKING"
   - Orb pulses rhythmically as it speaks
   - Orb returns to idle when done

### Test Webhook Pulse

```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Watch the orb pulse!",
    "type": "alert"
  }'
```

Then:
1. Watch the Huginn chat orb
2. Should see a quick pulse when webhook is sent
3. Control Center displays will show the message

## 📱 Responsive Design

**Sidebar Orb:**
- 200px height container
- Responsive canvas sizing
- Auto-adjusts to window resize
- Hidden on mobile (< 768px)

## 🎨 Visual Polish

**Smooth Transitions:**
- All state changes lerp smoothly
- No jarring jumps or snaps
- Organic, fluid movements

**Status Labels:**
- Fade in/out with opacity transition
- Small, unobtrusive text
- Only shows when active

**Color Shifts:**
- Purple/Gold (idle)
- Purple/Green (speaking)
- Smooth color interpolation

## 🔍 Troubleshooting

**Orb not visible:**
- Check browser console for Three.js errors
- Verify canvas element exists
- Check sidebar width (should be 240px)

**Auto-TTS not working:**
- Check localStorage value: `localStorage.getItem('huginn-auto-tts')`
- Verify TTS endpoint is accessible: `/admin/tts`
- Check browser audio permissions

**Orb not pulsing on webhooks:**
- Verify Socket.IO connection in browser console
- Check `deploy-ack` event is firing
- Confirm `window.huginnOrb` exists

**No speaking animation:**
- Check TTS audio is playing
- Verify `huginnOrb.startSpeaking()` is called
- Look for interval timer in console

## 📚 Files Updated

- **`/srv/slab/views/superadmin/huginn.ejs`** — Main Huginn chat view
  - Added Three.js orb visualization
  - Integrated auto-TTS toggle
  - Synced orb with TTS playback
  - Added webhook pulse reactions
  - Added thinking/speaking states

## 🌟 Summary

The Huginn chat now has:
1. **Beautiful 3D orb** in sidebar (compact, non-intrusive)
2. **Auto-TTS toggle** for hands-free listening
3. **Orb animations synced with speech** (realistic pulsing)
4. **Webhook pulse reactions** (visual feedback)
5. **State indicators** (THINKING, SPEAKING, IDLE)
6. **Perfect alignment** with Control Center design

**Your Huginn orb comes alive when it speaks!** 🎭✨

---

**Updated:** April 5, 2026
**Version:** 2.0
