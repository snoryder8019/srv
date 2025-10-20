# Claude Talk - Roku Voice Assistant Setup

## Overview

Your Claude Talk interface now supports:
- **Voice Input** via browser microphone
- **Roku Display** with wavelength visualization
- **Real-time WebSocket** communication
- **Sentiment-based visual feedback**

## Architecture

```
Phone/Browser (Mic) --> Express Server --> Claude API
                              ↓
                     WebSocket Broadcast
                              ↓
                    Roku/TV Display (Browser)
```

## Endpoints

### 1. Main Chat Interface
**URL:** `http://your-server:3000/claudeTalk`

Features:
- Text chat with Claude
- Voice input via microphone button (🎤)
- Session management
- Model selection

### 2. Roku Display Interface
**URL:** `http://your-server:3000/claudeTalk/display`

Features:
- Full-screen waveform visualization
- Sentiment-based color changes
- Real-time response display
- Auto-reconnect on disconnect

### 3. Voice Input API
**Endpoint:** `POST /claudeTalk/voice`

Accepts audio file (WebM format) and returns Claude's response.

## Setup Instructions

### Step 1: Access the Main Interface

Open on your phone or computer:
```
http://your-server-ip:3000/claudeTalk
```

### Step 2: Setup Roku/TV Display

1. Open your Roku's web browser or cast this URL to your TV:
   ```
   http://your-server-ip:3000/claudeTalk/display
   ```

2. The display will show:
   - Animated waveform at the top
   - Status indicator (top-right)
   - Response text in large font

### Step 3: Use Voice Input

1. Click the **🎤 microphone button** in the main interface
2. Browser will ask for microphone permission - **Allow it**
3. Button turns red (⏹️) when recording
4. Speak your message
5. Click again to stop recording
6. Voice is processed and response appears on both:
   - Your phone/browser
   - The Roku display

### Step 4: Multiple Devices

You can have:
- Multiple phones/browsers sending voice input
- Multiple Roku displays showing responses
- All connected via WebSocket

## Features Explained

### Waveform Visualization

The waveform changes based on Claude's sentiment:

- **Green/Blue** (Happy responses) → 400-500 Hz
- **Yellow/Orange** (Neutral) → 500-600 Hz
- **Red/Purple** (Negative/Errors) → 600-700 Hz

### Voice Input Flow

1. **Record** → Browser captures microphone audio
2. **Upload** → Audio sent to `/claudeTalk/voice` endpoint
3. **Process** → Server receives audio (transcription placeholder for now)
4. **Claude** → Processes input and generates response
5. **Broadcast** → Response sent to all connected displays via WebSocket
6. **Display** → Waveform updates + text appears

## Current Limitations

### Voice Transcription
The voice endpoint currently uses a placeholder transcription:
```javascript
const transcript = "[Voice input - transcription coming soon]";
```

To add real transcription, integrate one of:
- **OpenAI Whisper API** (recommended)
- **Google Cloud Speech-to-Text**
- **AssemblyAI**
- **Deepgram**

Example with OpenAI Whisper:
```javascript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(audioBuffer) {
  const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
  const transcription = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
  });
  return transcription.text;
}
```

## Testing

### Test Voice Input

1. Go to `http://localhost:3000/claudeTalk`
2. Click the microphone button
3. Say: "Hello Claude, what is 2 plus 2?"
4. Stop recording
5. Check the response

### Test Roku Display

1. Open `http://localhost:3000/claudeTalk/display` in a second browser tab
2. In the first tab, send a message (text or voice)
3. Watch the display update with:
   - New waveform color
   - Response text

### Test WebSocket Connection

Open browser console on the display page:
```javascript
// You should see:
WebSocket connected
Received: { type: 'init', waveform: {...} }
```

## Network Setup for Roku

### Option 1: Same Local Network

If your server and Roku are on the same network:
```
Roku Browser → http://192.168.1.x:3000/claudeTalk/display
```

### Option 2: Public Server (Linode)

Your server is already public, so Roku can access:
```
Roku Browser → https://yourdomain.com/claudeTalk/display
```

Make sure:
1. Apache is proxying WebSocket connections
2. SSL is configured for `wss://` connections

### Option 3: Casting

Cast the display URL to your TV using:
- Chromecast
- AirPlay
- Roku Screen Mirroring

## Customization

### Change Waveform Colors

Edit in [routes/claudeTalk/index.js](madladslab/routes/claudeTalk/index.js:372-375):

```javascript
function sentimentToColor(sentiment) {
  const hue = sentiment * 280;
  return `hsl(${hue}, 80%, 60%)`;
}
```

### Adjust Frequency Range

Edit in [routes/claudeTalk/index.js](madladslab/routes/claudeTalk/index.js:361-368):

```javascript
currentWaveform = {
  frequency: 300 + (sentimentValue * 400), // Change range here
  amplitude: 0.3 + (Math.abs(sentimentValue - 0.5) * 0.4),
  color: sentimentToColor(sentimentValue)
};
```

### Add Text-to-Speech

To make Roku speak the responses, add to the display page:

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'response' && data.text) {
    const utterance = new SpeechSynthesisUtterance(data.text);
    speechSynthesis.speak(utterance);
  }
};
```

## Troubleshooting

### Microphone Not Working

1. Check browser permissions (look for camera icon in address bar)
2. Use HTTPS (required for mic access on some browsers)
3. Try a different browser (Chrome/Edge recommended)

### Display Not Updating

1. Check WebSocket connection in browser console
2. Verify server logs show "Roku display connected"
3. Refresh the display page
4. Check firewall rules for WebSocket port

### WebSocket Connection Issues

If using Apache proxy, ensure config includes:
```apache
ProxyPass /claudeTalk/ws ws://localhost:3000/claudeTalk/ws
ProxyPass /claudeTalk http://localhost:3000/claudeTalk
```

## Next Steps

### Add Real Transcription

Install OpenAI SDK:
```bash
cd /srv/madladslab
npm install openai
```

Update voice endpoint in [routes/claudeTalk/index.js](madladslab/routes/claudeTalk/index.js:91-126)

### Add MCP Tools

Enable Claude to execute commands, search images, etc.:

```javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: history,
  tools: [
    {
      name: 'execute_command',
      description: 'Execute a shell command',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        }
      }
    }
  ]
});
```

### Add Image Display

Enhance the display to show images from Claude's responses.

## URLs Quick Reference

| Interface | URL | Purpose |
|-----------|-----|---------|
| Main Chat | `/claudeTalk` | Type or speak to Claude |
| Roku Display | `/claudeTalk/display` | Full-screen visualization |
| Voice API | `POST /claudeTalk/voice` | Upload audio files |
| Sessions API | `GET /claudeTalk/sessions` | List active sessions |
| WebSocket | `ws://host/claudeTalk/ws` | Real-time updates |

## Example Usage

```bash
# Test voice endpoint with curl
curl -X POST http://localhost:3000/claudeTalk/voice \
  -F "audio=@voice.webm" \
  -F "sessionId=test"

# Check active sessions
curl http://localhost:3000/claudeTalk/sessions

# Get session history
curl http://localhost:3000/claudeTalk/session/test
```

---

**Have fun talking to Claude on your Roku!** 🎤📺🤖
