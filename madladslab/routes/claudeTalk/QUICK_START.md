# 🚀 Claude Talk Roku - Quick Start Guide

## The Problem
Your server is on **Linode** (remote), and your Roku is on your **home network**. They can't discover each other automatically because they're on different networks.

## ✅ Simple Solution

### Step 1: Get the Display URL

1. Open on your phone/computer:
   ```
   http://your-server:3000/claudeTalk
   ```

2. Click the **"📱 Get URL"** button

3. You'll see the display URL (example):
   ```
   http://your-server:3000/claudeTalk/display
   ```

### Step 2: Open on Your Roku

**Option A: Type Manually**
1. Open a web browser on your Roku (install one from Roku Channel Store if needed)
2. Type the URL shown above
3. Display loads automatically!

**Option B: Use QR Code**
1. Click **"📷 Show QR"** button
2. Scan with your phone camera
3. Open the link on your phone
4. You can now see the URL and copy it to your Roku

### Step 3: Use Voice Input

1. On your phone at `/claudeTalk`, click the **🎤** microphone
2. Speak your command
3. It appears on your Roku TV with animated waveforms!
4. Roku speaks the response

## 🎯 Complete Flow

```
Phone/Computer                     Roku TV
──────────────                     ───────

Open /claudeTalk
                                   Open browser
Click "Get URL"                    Type display URL
                                   (/claudeTalk/display)

                                   ✅ Connected!
                                   Shows waveform

Click 🎤
Speak: "What time is it?"
                                   Displays: "Listening..."
                                   Shows: "The current time is..."
                                   Speaks response 🔊
```

## 📺 Roku Browser Options

Your Roku needs a web browser. Install one from Roku Channel Store:

**Recommended:**
- **Web Browser X** - Free, works well
- **Poprism Web Browser** - Free alternative
- **POWR Browser** - Another option

**To Install:**
1. Press Home on Roku remote
2. Go to "Streaming Channels"
3. Search "Web Browser"
4. Install any browser app

## 🎤 Voice Commands to Try

Once connected:
- "What time is it?"
- "Tell me a joke"
- "Set the display to energetic mode"
- "What's the weather in New York?"
- "Make the display calm"

## 💡 Pro Tips

### Bookmark the Display
On your Roku browser, bookmark the display URL for easy access later!

### Multiple Displays
Open the display URL on multiple devices:
- Roku TV in living room
- Tablet as second display
- Another Roku in bedroom
All will sync in real-time!

### Phone as Remote
Keep `/claudeTalk` open on your phone as the "remote control" - use voice input from anywhere in your home.

## 🔧 Troubleshooting

### "Can't find the display URL"
Click **"📱 Get URL"** button - it shows the exact URL and copies it to your clipboard

### "Roku browser crashes"
Some older Rokus have limited browser support. Try:
- Different browser app
- Simpler display (we can make a lightweight version)
- Use a tablet instead

### "Voice not working"
Make sure you're using Chrome, Edge, or Safari (Firefox doesn't support Web Speech API)

### "No audio on Roku"
Check Roku volume and ensure Text-to-Speech is supported by your browser

## 📱 Mobile-First Workflow

**Best Practice:**
1. Keep `/claudeTalk` open on your phone (for voice input)
2. Keep `/claudeTalk/display` open on Roku (for visual output)
3. Speak into phone → See on TV!

## 🎊 That's It!

You now have a working voice assistant:
- ✅ Voice input from phone
- ✅ Visual display on Roku
- ✅ Claude AI responses
- ✅ Text-to-speech output
- ✅ Real-time sync

**No complex setup needed - just two URLs!**

---

## URLs You Need

Main Interface (Phone):
```
http://your-server:3000/claudeTalk
```

Display (Roku):
```
http://your-server:3000/claudeTalk/display
```

That's all you need to remember! 🎤📺✨
