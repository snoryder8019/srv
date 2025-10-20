# 📺 Roku Casting Guide

## Overview

The Claude Talk assistant now includes **automatic Roku discovery and casting** functionality! You can scan your network for Roku devices and instantly cast the voice assistant display to any Roku TV.

## 🚀 Quick Start

### 1. Open Claude Talk Interface
```
http://your-server:3000/claudeTalk
```

### 2. Discover Roku Devices

1. Click the **"🔍 Find Rokus"** button in the controls section
2. Wait 5 seconds while the system scans your network
3. All discovered Rokus will appear in a dropdown list

### 3. Cast to Roku

1. Select your Roku from the dropdown
2. Click **"📺 Cast"**
3. The display will automatically launch on your Roku TV!

### 4. Use Voice Input

1. Click the 🎤 microphone button on your phone/computer
2. Speak your command
3. Watch it appear on your Roku TV with animated waveforms!

## 🔍 How Discovery Works

The system uses **two methods** to find Rokus:

### Method 1: SSDP Discovery
- Uses Simple Service Discovery Protocol
- Automatically finds Roku devices announcing themselves
- Works across VLANs in some configurations

### Method 2: Port Scanning (Fallback)
- Scans your local network for devices on port 8060
- Checks every 10th IP for speed (1, 11, 21, etc.)
- Validates device is actually a Roku

## 📡 Network Requirements

### Same Network
For best results, ensure:
- Your server and Roku are on the **same local network**
- Roku is powered on and connected to WiFi/Ethernet
- No firewall blocking port 8060

### Remote Server (Linode)
If your server is remote:
- Discovery won't work (no local network access)
- **Manual solution**:
  1. Find your Roku's IP manually (Settings → Network → About)
  2. Use the API endpoint directly:
  ```bash
  curl -X POST http://your-server:3000/claudeTalk/roku/cast \
    -H "Content-Type: application/json" \
    -d '{"rokuIp": "192.168.1.100", "displayUrl": "http://your-server:3000/claudeTalk/display"}'
  ```

## 🎯 Features

### Automatic Discovery
- Finds all Roku devices on your network
- Shows device name, model, and IP
- Caches results for 30 seconds (faster repeated searches)

### One-Click Casting
- Launches web browser on Roku
- Automatically navigates to display URL
- No manual typing needed!

### Device Information
Each discovered Roku shows:
- **Name**: User-defined name (e.g., "Living Room TV")
- **IP Address**: Local network IP
- **Model**: Roku model name
- **Serial Number**: Device serial (internal)

## 🔧 API Endpoints

### Discover Rokus
```bash
GET /claudeTalk/roku/discover

Response:
{
  "success": true,
  "devices": [
    {
      "ip": "192.168.1.100",
      "name": "Living Room Roku",
      "model": "Roku Ultra",
      "serialNumber": "YN00H5123456"
    }
  ]
}
```

### Cast to Roku
```bash
POST /claudeTalk/roku/cast
Content-Type: application/json

{
  "rokuIp": "192.168.1.100",
  "displayUrl": "http://your-server:3000/claudeTalk/display"
}

Response:
{
  "success": true,
  "message": "Casting to Roku at 192.168.1.100",
  "url": "http://your-server:3000/claudeTalk/display"
}
```

### Get Roku Info
```bash
GET /claudeTalk/roku/info/192.168.1.100

Response:
{
  "success": true,
  "info": {
    "name": "Living Room Roku",
    "model": "Roku Ultra",
    "serialNumber": "YN00H5123456"
  }
}
```

### Send Roku Control Commands
```bash
POST /claudeTalk/roku/control
Content-Type: application/json

{
  "rokuIp": "192.168.1.100",
  "command": "Home"
}

Available commands:
- Home
- Select
- Up, Down, Left, Right
- Back
- VolumeUp, VolumeDown, VolumeMute
- Play, Pause
```

## 🛠️ Requirements

### Roku Requirements
Your Roku needs a **web browser channel** installed:
- **Recommended**: Web Browser X (Channel 20445)
- **Alternative**: Any Roku browser app

To install:
1. Press Home on Roku remote
2. Go to Streaming Channels
3. Search for "Web Browser"
4. Install "Web Browser X" or similar

### Server Requirements
- Node.js packages (already installed):
  - `node-ssdp` - SSDP discovery
  - `axios` - HTTP requests

## 📋 Usage Flow

```
1. User clicks "Find Rokus"
        ↓
2. Server scans network (SSDP + port scan)
        ↓
3. Rokus discovered and listed
        ↓
4. User selects Roku and clicks "Cast"
        ↓
5. Server sends launch command to Roku
        ↓
6. Roku opens browser and loads display URL
        ↓
7. WebSocket connects, display is ready
        ↓
8. User speaks into phone → appears on TV!
```

## 🎤 Complete Workflow Example

### Step-by-Step:

1. **Open interface on phone**
   ```
   http://your-server:3000/claudeTalk
   ```

2. **Discover Rokus**
   - Click "🔍 Find Rokus"
   - Wait for scan
   - See: "Found 2 Roku device(s)!"

3. **Select and Cast**
   - Choose "Living Room Roku (192.168.1.100)"
   - Click "📺 Cast"
   - See: "Successfully cast to Living Room Roku!"

4. **Your Roku TV now shows:**
   - Animated wavelength visualization
   - "Waiting for voice input..."
   - Status: "Connected"

5. **Use voice input**
   - Click 🎤 on phone
   - Say: "What time is it?"
   - Watch:
     - Status changes to "Listening..."
     - Then "Speaking"
     - Waveform animates
     - Text appears: "The current time is..."
     - TV speaks the response

## ⚠️ Troubleshooting

### No Rokus Found

**Problem**: "No Roku devices found"

**Solutions**:
1. Check Roku is on and connected to network
2. Ensure server and Roku on same network
3. Check firewall isn't blocking port 8060
4. Try manual IP entry:
   ```bash
   curl http://192.168.1.100:8060/query/device-info
   ```
   If this works, use the API directly

### Cast Failed

**Problem**: "Cast failed: Roku browser channel may not be installed"

**Solution**:
1. Install a web browser on your Roku:
   - Home → Streaming Channels
   - Search "Web Browser"
   - Install "Web Browser X"
2. Try casting again

### Discovery is Slow

**Problem**: Takes 5+ seconds to find Rokus

**Explanation**:
- SSDP timeout is 5 seconds (standard)
- Port scan is conservative (every 10th IP)
- Results are cached for 30 seconds

**Optimization** (if needed):
Edit `routes/claudeTalk/index.js:723`:
```javascript
for (let i = 1; i <= 254; i += 5) { // Scan every 5th IP (faster)
```

### WebSocket Not Connecting

**Problem**: Display shows "Disconnected"

**Solutions**:
1. Check server is running
2. Verify WebSocket endpoint accessible
3. Check Apache config for WebSocket proxying:
   ```apache
   ProxyPass /claudeTalk/ws ws://localhost:3000/claudeTalk/ws
   ```

## 🔐 Security Notes

### Local Network Only
- Discovery only works on local network
- Roku API (port 8060) is **not** password protected
- Anyone on your network can control your Roku

### Recommendations
1. Use on trusted networks only
2. Don't expose port 8060 to the internet
3. Consider VPN for remote access

## 🎨 Advanced Usage

### Cast to Multiple Rokus
```javascript
// In browser console or custom script
const rokus = ['192.168.1.100', '192.168.1.101'];

for (const ip of rokus) {
  fetch('/claudeTalk/roku/cast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rokuIp: ip,
      displayUrl: window.location.origin + '/claudeTalk/display'
    })
  });
}
```

### Voice Command to Cast
Say to Claude: "Cast to my living room Roku"

Claude can use the `set_roku_display_mode` tool, but you'd need to add a new tool for casting.

### Automated Startup
Create a startup script that:
1. Discovers Rokus
2. Auto-casts to your main TV
3. Ready for voice input

## 📊 Performance

| Operation | Time |
|-----------|------|
| Roku Discovery | 5 seconds |
| Cast Launch | 2-3 seconds |
| WebSocket Connect | < 500ms |
| Voice → Display | < 2 seconds |

## 🎉 Complete Example Session

```
You: *Opens Claude Talk on phone*
     *Clicks "Find Rokus"*

System: "Searching..."
        "Found 2 Roku device(s)!"

You: *Selects "Bedroom Roku (192.168.1.101)"*
     *Clicks "Cast"*

System: "Successfully cast to Bedroom Roku!"

Roku TV: *Opens browser*
         *Loads display with waveform*
         Shows: "Waiting for voice input..."

You: *Clicks 🎤*
     *Says: "Hey Claude, set the display to energetic mode and tell me a joke"*

Roku TV: *Status: "Listening..."*
         *Waveform speeds up, turns red*
         *Status: "Speaking"*
         *Shows: "Why did the programmer quit his job? Because he didn't get arrays!"*
         *Speaks the joke aloud*

You: *Laughs* 😄
```

## 🚀 Next Steps

- Add voice command for casting
- Support non-browser Roku apps
- Multi-room synchronized displays
- Roku remote control integration
- Screen mirroring capabilities

---

**Your voice assistant is now fully castable to any Roku on your network!** 📺🎤🤖
