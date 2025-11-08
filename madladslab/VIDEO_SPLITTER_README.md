# Video Splitter Tool

A browser-based video splitting tool for handling very large video files. Split videos into smaller segments that can then be trimmed individually using the Video Trimmer.

## 🎯 Purpose

The Video Trimmer has a **500MB file size limit**. The Video Splitter allows you to:
- Handle video files larger than 500MB (even multi-GB files)
- Split them into smaller segments (halves, thirds, fourths, fifths)
- Download segments individually
- Trim each segment using the Video Trimmer

## 📍 Access

**URL:** `https://madladslab.com/bucketUpload/split`

**From Main Upload Page:** Click "📹 Split Large Videos" button in the directory tree panel

**From Video Trimmer:** Click "Split it first →" link when you have a file larger than 500MB

## 🎬 How It Works

### 1. **Select Large Video**
- Click upload zone or drag & drop video file
- **No size limit** - handle multi-GB files
- File loads and displays metadata

### 2. **Choose Split Option**
Choose how many segments to create:
- **Halves** (2 segments) - For ~1GB files
- **Thirds** (3 segments) - For ~1.5GB files
- **Fourths** (4 segments) - For ~2GB files
- **Fifths** (5 segments) - For ~2.5GB+ files

### 3. **Preview Segments**
- See segment duration and estimated size
- Warning if any segment exceeds 500MB
- Each segment shows time range (e.g., "0:00 - 5:30")

### 4. **Process & Download**
- Click "Process & Download Segments"
- Each segment is processed client-side
- Downloads automatically (check Downloads folder)
- Files named: `original-name-segment-1.webm`, `original-name-segment-2.webm`, etc.

### 5. **Trim Segments**
- Go to Video Trimmer (`/bucketUpload/trim`)
- Load each segment individually
- Trim to desired length
- Upload to bucket

## 📊 Example Use Cases

### Example 1: 2GB Tutorial Video
```
Original: tutorial.mp4 (2GB, 60 minutes)

Split into Fourths:
├─ tutorial-segment-1.webm (500MB, 0:00-15:00)
├─ tutorial-segment-2.webm (500MB, 15:00-30:00)
├─ tutorial-segment-3.webm (500MB, 30:00-45:00)
└─ tutorial-segment-4.webm (500MB, 45:00-60:00)

Then trim each segment as needed!
```

### Example 2: 5GB Event Recording
```
Original: conference.mp4 (5GB, 3 hours)

Split into Fifths:
├─ conference-segment-1.webm (1GB, 0:00-36:00) ⚠️ Still too large
├─ conference-segment-2.webm (1GB, 36:00-72:00) ⚠️ Still too large
...

Split into more segments or compress first
```

## 🛠️ Technical Details

### Client-Side Processing
- Uses **HTML5 Canvas** + **MediaRecorder API**
- Same technology as Video Trimmer
- No server upload required
- Output: WebM format (VP9 codec)

### Performance
- **30 FPS** recording
- **2.5 Mbps** bitrate
- Maintains original resolution
- Preserves audio track

### Processing Time
- Approximately **realtime** (1-2x video duration)
- Example: 60-minute video = 60-120 minutes processing
- Depends on:
  - Video resolution
  - Device performance
  - Browser codec support

### Browser Compatibility
- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari (limited codec support)
- ❌ IE11 (not supported)

## 📁 Workflow

### Recommended Workflow for Large Files

1. **Split Video**
   - Go to `/bucketUpload/split`
   - Upload large file
   - Choose split option
   - Download all segments

2. **Trim Segments** (Optional)
   - Go to `/bucketUpload/trim`
   - Load each segment
   - Trim to desired length
   - Upload to bucket

3. **Organize in Bucket**
   - Create subdirectory (e.g., "conference-2025")
   - Upload all segments/trimmed clips
   - Add metadata (title, description, tags)

## ⚠️ Important Notes

### Segment Size Warning
If segments are **still over 500MB**, you'll see a warning (⚠️):
- Choose more segments (e.g., switch from halves to fourths)
- Or compress video first using desktop software
- Or split segments again after downloading

### Output Format
- Input: Any browser-supported video (MP4, MOV, WebM, AVI)
- Output: **Always WebM** (VP9 codec)
- For other formats, use desktop software (ffmpeg, Handbrake)

### File Organization
Segments are downloaded with sequential names:
```
original-video.mp4 (input)
  ↓
original-video-segment-1.webm
original-video-segment-2.webm
original-video-segment-3.webm
original-video-segment-4.webm
```

## 💡 Tips

### For Best Results
- Use Chrome/Edge for best codec support
- Split videos before any trimming
- Check segment sizes in preview
- Use descriptive original filenames

### Choosing Split Count
- **500MB-1GB file** → Halves (2 segments)
- **1GB-1.5GB file** → Thirds (3 segments)
- **1.5GB-2GB file** → Fourths (4 segments)
- **2GB+ file** → Fifths (5 segments) or more

### Segment Management
- Download all segments before closing page
- Keep original file as backup
- Name segments clearly for trimming later
- Upload segments to same bucket subdirectory

## 🔗 Integration

### Navigation
- **Main Upload Page** → "📹 Split Large Videos" button
- **Video Trimmer** → "Split it first →" link (when file too large)
- **Video Splitter** → "← Back to Uploads" link

### Complementary Tools
- **Video Splitter** → Handle large files (>500MB)
- **Video Trimmer** → Trim segments (<500MB)
- **Bucket Manager** → Upload and organize trimmed videos

## 🆘 Troubleshooting

### "Segment still exceeds 500MB"
- Choose more segments (e.g., fifths instead of thirds)
- Compress video first using desktop software
- Split segments again after downloading

### Slow Processing
- Close other browser tabs
- Lower video resolution using desktop software first
- Try shorter split counts (fewer segments = faster)

### Audio Missing
- Check browser codec support
- Try Chrome/Edge for best results
- Some browsers have audio limitations

### Browser Crashes
- File too large for available memory
- Try desktop software for very large files (>5GB)
- Close other applications

---

## 📋 Feature Comparison

| Feature | Splitter | Trimmer | Bucket Manager |
|---------|----------|---------|----------------|
| **File Size** | No limit | 500MB max | 100MB max |
| **Purpose** | Split large files | Trim videos | Upload files |
| **Output** | WebM segments | WebM trimmed | Any file type |
| **Processing** | Client-side | Client-side | Server upload |
| **Use Case** | >500MB videos | <500MB videos | Final upload |

---

**Created:** November 8, 2025
**Version:** 1.0.0
**Part of:** Linode Bucket Upload Manager
**Complements:** Video Trimmer Tool
