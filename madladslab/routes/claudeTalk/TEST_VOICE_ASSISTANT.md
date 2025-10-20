# Test Your Roku Voice Assistant

## Quick Test Guide

### 1. Open the Main Interface
Open in your browser (Chrome/Edge recommended):
```
http://your-server:3000/claudeTalk
```

### 2. Open Roku Display
In another browser tab/window or on your Roku/TV:
```
http://your-server:3000/claudeTalk/display
```

### 3. Test Voice Commands

Click the 🎤 microphone button and try these:

#### Basic Commands:
- "Hello Claude, what time is it?"
  - ✅ Tests the `get_current_time` tool

- "What's the weather in New York?"
  - ✅ Tests the `get_weather` tool

- "Search for information about Node.js"
  - ✅ Tests the `search_web` tool

#### Display Mode Commands:
- "Set the display to calm mode"
  - ✅ Changes waveform to slow, blue

- "Make the display energetic"
  - ✅ Changes waveform to fast, red

- "Set alert mode"
  - ✅ Changes waveform to pulsing, orange

#### Conversation:
- "Tell me a joke"
- "What is 2 + 2?"
- "Write a haiku about coding"

### 4. What You Should See

**On Main Interface:**
- Your voice transcription appears as user message
- Claude's response appears below
- Typing indicator while processing

**On Roku Display:**
- Status changes: "Listening..." → "Speaking" → "Ready"
- Waveform animates and changes color
- Response text appears in large font
- Audio plays Claude's response (if supported)

## Features to Test

### ✅ Voice Recognition
- Click mic → speak → see transcription
- Works in Chrome, Edge, Safari
- Requires HTTPS for remote access

### ✅ WebSocket Real-time Updates
- Multiple displays update simultaneously
- Instant waveform changes
- Status syncing

### ✅ Claude MCP Tools
- Time/date queries
- Weather information (simulated)
- Web search (simulated)
- Display mode control

### ✅ Text-to-Speech
- Roku speaks Claude's responses
- Adjustable rate, pitch, volume
- Status updates when speaking

### ✅ Sentiment Analysis
- Positive responses → Green/Blue waveform
- Neutral → Yellow/Orange
- Negative/errors → Red/Purple

## Troubleshooting

### Voice Recognition Not Working

**Issue:** "Speech recognition not supported"
- **Fix:** Use Chrome, Edge, or Safari browser
- Firefox doesn't support Web Speech API

**Issue:** No speech detected
- **Fix:** Check microphone permissions in browser
- Look for mic icon in address bar

**Issue:** Recognition stops immediately
- **Fix:** Speak clearly and promptly after clicking mic
- Try in a quieter environment

### Display Not Updating

**Issue:** "Disconnected" on Roku display
- **Fix:** Check WebSocket connection
- Refresh the display page
- Verify server is running

**Issue:** No waveform animation
- **Fix:** Check browser console for errors
- Try a different browser

### Claude Responses

**Issue:** Long response times
- **Fix:** Normal - Claude is processing
- Check internet connection
- Verify Anthropic API key is set

**Issue:** Error messages
- **Fix:** Check `ANTHROPIC_API_KEY` in .env
- Verify API key is valid and has credits

## Test Scenarios

### Scenario 1: Single User, Single Display
1. Open main interface on your phone
2. Open display on Roku/TV
3. Click mic, say "What time is it?"
4. See response on both devices
5. Hear response on Roku

### Scenario 2: Multiple Displays
1. Open display on 2+ devices (TVs, tablets)
2. Use main interface to send voice command
3. All displays update simultaneously
4. All displays speak the response

### Scenario 3: Tool Usage
1. Say "What's the weather in San Francisco?"
2. Claude uses `get_weather` tool
3. Response includes tool result
4. Display updates with result

### Scenario 4: Display Modes
1. Say "Make the display calm"
2. Waveform slows down, turns blue
3. Say "Now make it energetic"
4. Waveform speeds up, turns red

## Advanced Testing

### Test WebSocket with curl
```bash
# Send a test message
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "sessionId": "test"}'
```

### Check Active Sessions
```bash
curl http://localhost:3000/claudeTalk/sessions
```

### Monitor Server Logs
```bash
# In terminal where server is running, watch for:
# - "Voice input received"
# - "Transcription: [your text]"
# - "Executing tool: [tool_name]"
# - "Roku display connected"
```

### Browser Console
Open DevTools (F12) and look for:
```
Speech recognition supported
WebSocket connected
Received: {type: 'init', waveform: {...}}
Recognized: [your speech]
```

## Performance Benchmarks

| Action | Expected Time |
|--------|--------------|
| Voice recognition | < 2 seconds |
| Claude response | 2-5 seconds |
| WebSocket broadcast | < 100ms |
| TTS playback | 3-10 seconds |
| Display update | Instant |

## Common Voice Commands

### Information Queries
- "What time is it?"
- "Tell me the date"
- "What's the weather like?"
- "Search for [topic]"

### Display Control
- "Set calm mode"
- "Make it energetic"
- "Switch to alert mode"
- "Change the display"

### Conversation
- "Tell me a story"
- "Explain [concept]"
- "Help me with [task]"
- "What can you do?"

### Math & Logic
- "What is 25 times 17?"
- "Calculate the square root of 144"
- "If I have 10 apples..."

## Next Steps After Testing

### ✅ Everything Works
- Start using it regularly
- Customize waveform colors
- Add more MCP tools
- Integrate with smart home

### ⚠️ Some Issues
- Check error messages
- Review troubleshooting section
- Check server logs
- Verify API keys

### 🛠️ Want to Extend
- Add real weather API
- Integrate actual web search
- Add image display
- Connect to smart devices
- Add multiple language support

## Success Indicators

You'll know it's working when:
1. ✅ Mic button turns red when listening
2. ✅ Your speech appears as text
3. ✅ Claude responds intelligently
4. ✅ Roku display shows animated waveform
5. ✅ Roku speaks the response
6. ✅ Multiple displays sync perfectly
7. ✅ Tools execute (time, weather, etc.)
8. ✅ Display modes change on command

## Have Fun! 🎤📺🤖

Your voice-powered Roku assistant is ready to go!

Try saying: "Hey Claude, set the display to energetic mode and tell me what you can do!"
