# Testing Instructions - Voice to Display

## Current Status
Server is running with enhanced debugging. The display page now shows a debug log in the bottom-left corner that will help diagnose connection issues.

## URLs You Need

### Main Voice Interface (Simplified)
```
http://your-server:3000/claudeTalk/voice
```
- Large microphone button
- Simple, focused interface for voice input

### Display (for Roku/TV)
```
http://your-server:3000/claudeTalk/display
```
- Shows waveform visualization
- Displays transcripts and Claude responses
- Text-to-speech output
- **NEW**: Debug log in bottom-left corner

### Original Chat Interface
```
http://your-server:3000/claudeTalk
```
- Full chat interface with voice button

## Testing Steps

### Step 1: Open Display and Check Connection

1. Open the display URL in your browser (Chrome, Edge, or Safari)
2. Look at the **bottom-left corner** - you should see a debug log showing:
   ```
   Script started
   Creating Socket.IO connection to /claudeTalk-display
   Socket object created
   ✅ Connected to server!
   ```

3. Look at the **top-right corner** - status should show "Connected" with green border

4. The waveform should be animating (sine wave)

### Step 2: Test Voice Input

1. Open `/claudeTalk/voice` on your phone or computer
2. Click the large microphone button (turns red and pulses)
3. Speak something like "What time is it?"
4. Click the microphone again to stop recording

### Step 3: Verify Display Updates

On the display page, you should see:

1. **"🎤 Listening..."** message appears
2. **"You said: [your speech]"** appears in large text
3. After ~2-5 seconds, Claude's response appears
4. You should HEAR the response via text-to-speech

## Troubleshooting

### If Debug Log Shows "Connection Error"

Check the error message in the debug log. Common issues:
- Network connectivity between devices
- Firewall blocking WebSocket connections
- Server not running

### If Status Shows "Disconnected"

1. Check server logs:
   ```bash
   tail -f /tmp/server.log
   ```

2. Look for:
   ```
   ✅ Roku display connected via Socket.IO
   ```

3. If you don't see that message, the browser isn't connecting

### If No Debug Log Appears

1. Open browser console (F12)
2. Check for JavaScript errors
3. Verify Socket.IO library loaded:
   ```
   http://your-server:3000/socket.io/socket.io.js
   ```

### If Voice Doesn't Show on Display

Server logs will show:
```
📡 Broadcasting to X displays: user_speech
```

If it shows "0 displays", the display isn't connected to Socket.IO.

## What Success Looks Like

**Display Page:**
- Status: "Connected" (green)
- Waveform animating smoothly
- Debug log: "✅ Connected to server!"

**When You Speak:**
1. Display shows: "🎤 Listening..."
2. Display shows: "You said: [your words]"
3. Display shows: Claude's response
4. You hear the response spoken aloud

**Server Logs:**
```
📡 Broadcasting to 1 displays: listening
📡 Broadcasting to 1 displays: user_speech
📡 Broadcasting to 1 displays: response
✅ Roku display connected via Socket.IO
```

## Quick Debug Commands

```bash
# Check if server is running
ps aux | grep "node ./bin/www"

# View live server logs
tail -f /tmp/server.log

# Test display page loads
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/claudeTalk/display
# Should return: 200

# Test Socket.IO library loads
curl -s http://localhost:3000/socket.io/socket.io.js | head -5
# Should show Socket.IO v4.8.1 header
```

## Next Steps

1. **Open display page** - Check debug log and status
2. **Send a voice command** - Test the full flow
3. **Report back** - Share what you see in the debug log and status

The debug log will tell us exactly where the connection is failing (if it fails).
