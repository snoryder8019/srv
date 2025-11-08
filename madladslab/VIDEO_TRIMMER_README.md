# Video Trimmer Tool

A browser-based video trimming tool integrated into the Bucket Upload Manager. Trim large video files before uploading to save bandwidth and storage.

## 🎯 Features

- ✅ **Client-Side Trimming** - No server processing required
- ✅ **Interactive Timeline** - Drag handles to set start/end points
- ✅ **Live Preview** - See exactly what you're trimming
- ✅ **Quick Presets** - First 30s, Last 30s, Middle 60s, etc.
- ✅ **Direct Upload** - Trim and upload to bucket in one step
- ✅ **Mobile Responsive** - Works on phones, tablets, desktops
- ✅ **Large File Support** - Up to 500MB videos

## 📍 Access

**URL:** `https://madladslab.com/bucketUpload/trim`

**From Main Upload Page:** Click "✂️ Trim Videos" button in the directory tree panel

## 🎬 Supported Formats

- **Input:** MP4, MOV, WebM, AVI (any browser-supported video)
- **Output:** WebM (VP9 codec)
- **Max Size:** 500MB

## 🛠️ How to Use

### 1. **Select Video**
- Click upload zone or drag & drop video file
- File loads in preview player
- Timeline appears with full duration

### 2. **Set Trim Points**

**Method A - Drag Handles:**
- Drag blue start handle (left)
- Drag blue end handle (right)
- Purple section shows what will be kept

**Method B - Type Time:**
- Enter start time in seconds
- Enter end time in seconds
- Updates automatically

**Method C - Quick Presets:**
- First 30 seconds
- First 1 minute
- Last 30 seconds
- Middle 1 minute

### 3. **Choose Upload Options**
- **Bucket:** Select destination (madladslab, acm, sna, etc.)
- **Subdirectory:** Optional folder (e.g., "videos", "clips")
- **Filename:** Optional custom name (auto-generated if blank)

### 4. **Trim & Upload**
- Click "✂️ Trim & Upload to Bucket"
- Confirm the trim selection
- Watch progress bar
- Redirects to main upload page when complete

## 📊 Interface Layout

```
┌────────────────────────────────────────┐
│ ✂️ Video Trimmer    [← Back to Uploads]│
├────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐│
│ │   [Video Preview Player]            ││
│ └─────────────────────────────────────┘│
│                                         │
│ File: video.mp4 | Duration: 5:30       │
│ Size: 45.2MB    | Resolution: 1920×1080│
│                                         │
│ Trim Video                              │
│ ├────────████████────────┤ Timeline    │
│ │        ↑      ↑        │             │
│ │      Start   End       │             │
│                                         │
│ Start: 1:00  End: 3:30  Duration: 2:30 │
│                                         │
│ [Start Time] [End Time] [Quick Select] │
│                                         │
│ [Reset] [✂️ Trim & Upload to Bucket]   │
│                                         │
│ Bucket: [madladslab ▼]                 │
│ Subdirectory: [clips]                  │
│ Filename: [my-trimmed-video]           │
└────────────────────────────────────────┘
```

## ⚙️ Technical Details

### Client-Side Processing
- Uses **HTML5 Canvas** + **MediaRecorder API**
- No server-side ffmpeg required
- Processes entirely in browser
- Output: WebM format (VP9 video codec)

### Performance
- **30 FPS** recording
- **2.5 Mbps** bitrate
- Maintains original resolution
- Preserves audio track

### Browser Compatibility
- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari (limited codec support)
- ❌ IE11 (not supported)

## 🎯 Use Cases

### Before Uploading Large Videos
```
Original: 5-minute video, 150MB
Trimmed: 30-second clip, 9MB
Savings: 141MB (94% reduction)
```

### Social Media Clips
- Trim highlights from long recordings
- Extract key moments
- Create preview clips

### Tutorial Sections
- Split long tutorials into chapters
- Remove intro/outro
- Focus on specific segments

### Event Coverage
- Cut down full event videos
- Extract highlights
- Create shareable moments

## 📁 File Organization

Trimmed videos are saved with metadata:
- **Tags:** `["trimmed", "video"]`
- **Title:** `"Trimmed: [original-name]"`
- **Description:** `"Trimmed from [start]s to [end]s"`

Example bucket path:
```
madladslab/
  └── clips/
      └── 1699999999-abc123def.webm
```

## 🔒 Limitations

### File Size
- **Max Input:** 500MB
- **Min Duration:** 0.1 seconds
- **Output:** Depends on trim length

### Format Conversion
- Input: Any browser-supported video
- Output: Always WebM (VP9)
- For other formats, use desktop software

### Processing Time
- Depends on:
  - Video resolution
  - Trim duration
  - Device performance
- Typical: 1-2x realtime
- Example: 30s video = 30-60s processing

## 🚀 Workflow Examples

### Example 1: Trim Product Demo
```
1. Upload 10-minute product demo
2. Trim to best 2-minute section
3. Upload to: madladslab/products/demo.webm
4. Use URL in website
```

### Example 2: Event Highlight Reel
```
1. Load 2-hour event recording
2. Use Quick Select: "Middle 1 minute"
3. Fine-tune with drag handles
4. Upload to: acm/events/highlight.webm
```

### Example 3: Tutorial Chapters
```
1. Load full tutorial video
2. Trim: 0:00 - 5:00 (Introduction)
3. Upload to: twww/tutorials/chapter1.webm
4. Repeat for other chapters
```

## 💡 Tips

### For Best Results
- Use Chrome/Edge for best codec support
- Trim before uploading to save bandwidth
- Use descriptive filenames
- Organize in subdirectories

### Quick Trimming
- Use Quick Select presets first
- Fine-tune with drag handles
- Check preview before uploading

### Large Files
- Consider trimming in segments
- Split long videos into chapters
- Upload to different subdirectories

## 🔗 Integration

### From Main Upload Page
- Button in directory tree: "✂️ Trim Videos"
- Opens trimmer in same window
- Returns to main page after upload

### Direct Link
- `/bucketUpload/trim`
- Requires admin authentication
- Same permissions as bucket manager

## 📝 Notes

- Trimming is **non-destructive** (original file unchanged)
- Output format is **WebM** (widely supported)
- **No server processing** = faster, more scalable
- Works **offline** after page load
- **Mobile-friendly** with touch controls

---

## 🆘 Troubleshooting

### "File too large!"
- Maximum 500MB input file
- Try compressing video first
- Or trim in multiple passes

### "Please select a video file"
- Only video files accepted
- Check file extension
- Try different browser

### Slow Processing
- Depends on video length and resolution
- Lower resolution = faster processing
- Try shorter trim duration

### Audio Not Included
- Check browser support for audio track
- Some browsers have codec limitations
- Try Chrome/Edge for best results

---

**Created:** November 8, 2025
**Version:** 1.0.0
**Part of:** Linode Bucket Upload Manager
