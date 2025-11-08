# Video Format Fix - File Extension Issue

## Problem Identified

Your `.soprano` file extension issue has been fixed!

### The Issue
- File: `1762625082358-ae18de361ad77063.soprano`
- Problem: `.soprano` is not a standard video format
- Cause: Video trimmer was preserving original file extensions
- Result: Browsers couldn't play the file

### Root Cause

The video trimmer was creating filenames like:
```javascript
formData.append('video', trimmedBlob, `trimmed-${videoFile.name}`);
```

If the original file was `myvideo.soprano`, the trimmed version would also be `.soprano`.

## Fixes Applied

### 1. Video Trimmer (Client-Side)
**File**: `/srv/madladslab/public/javascripts/videoTrimmer.js`

**Before**:
```javascript
formData.append('video', trimmedBlob, filename || `trimmed-${videoFile.name}`);
```

**After**:
```javascript
// Generate proper filename with .webm extension (MediaRecorder output format)
const baseFilename = filename || videoFile.name.replace(/\.[^/.]+$/, '');
const trimmedFilename = `trimmed-${baseFilename}.webm`;
formData.append('video', trimmedBlob, trimmedFilename);
// Send unique filename with .webm extension
formData.append('filename', `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webm`);
```

**Result**: All trimmed videos now save as `.webm` (the actual format MediaRecorder produces)

### 2. Graffiti TV API (Temporary Support)
**File**: `/srv/graffiti-tv/routes/linode-api.js`

Added `.soprano` to supported video extensions so existing files work:
```javascript
const videoExts = ['mp4', 'webm', 'mov', 'avi', 'ogv', 'mkv', 'm4v', 'soprano'];
```

**Note**: This is temporary. `.soprano` files should be re-uploaded as `.webm` or `.mp4`.

## Going Forward

### When Trimming/Uploading Videos:
✅ New uploads will be `.webm` automatically
✅ Standard format, works in all modern browsers
✅ Proper MIME type detection

### Recommended Formats:
- **Best**: `.mp4` (H.264) - Universal support
- **Good**: `.webm` (VP8/VP9) - Modern browsers
- **Avoid**: Custom extensions like `.soprano`

### Converting Existing `.soprano` Files

If you have `.soprano` files, convert them:

**Option 1: Re-trim the original video**
- Open in video trimmer
- Will automatically save as `.webm`

**Option 2: Use ffmpeg**
```bash
ffmpeg -i input.soprano -c:v libx264 -c:a aac output.mp4
```

**Option 3: Just re-upload**
- Download the `.soprano` file
- Upload it again (will detect proper format)

## Why This Matters

### Browser Compatibility
- `.mp4` → ✅ All browsers
- `.webm` → ✅ Modern browsers
- `.soprano` → ❌ No browser support

### Video Element Support
Standard formats work with HTML5 `<video>` tag:
```html
<video src="file.mp4" autoplay></video> ✅
<video src="file.webm" autoplay></video> ✅
<video src="file.soprano" autoplay></video> ❌
```

## Current Status

✅ Video trimmer fixed - saves as `.webm`
✅ Graffiti TV supports `.soprano` temporarily
✅ All future uploads will use correct extensions

### Your Current File
`https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/1762625082358-ae18de361ad77063.soprano`

**Will now be recognized as video** and should play on Graffiti TV!

However, for best compatibility, consider re-uploading as:
- `1762625082358-ae18de361ad77063.mp4` or
- `1762625082358-ae18de361ad77063.webm`

---

**Status**: Fixed ✅
**Next Videos**: Will automatically use `.webm` format
