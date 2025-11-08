# Graffiti Pasta TV - Deployment Status

## ✅ LIVE on https://graffititv.madladslab.com

### Server Status
- **Port**: 3008 (configured in Apache)
- **Process**: Running
- **API**: Working perfectly

### API Test Results
```bash
curl https://graffititv.madladslab.com/api/linode/media
```
Returns:
```json
{
  "success": true,
  "media": [
    {
      "url": "https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/1762622336661-f28b8110e6440da3.png",
      "type": "image",
      "size": 10886002
    },
    {
      "url": "https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/1762622361016-14f7573ff78968d5.png",
      "type": "image",
      "size": 3908625
    }
  ],
  "count": 2
}
```

### What's Working

✅ **Media Cycling**
- Automatically loads 2 PNG images from bucket
- Cycles every 15 seconds
- No YouTube dependency (only fallback if bucket empty)

✅ **Sidebar Scrolling**
- Smooth up/down animation
- 20-second cycle

✅ **Larger Container**
- 90% width (was 60%)
- 16:9 aspect ratio

✅ **Pasta Restaurant Theme**
- All Idiocracy/Brawndo references removed
- Menu items, specials, happy hour info
- Graffiti art + Italian cuisine branding

### Browser Console Output
When you visit https://graffititv.madladslab.com, you should see:
```
Fetching media from /api/linode/media...
API Response: {success: true, media: Array(2), count: 2}
✓ Loaded media items: 2
Media URLs: ['https://madladslab...png', 'https://madladslab...png']
```

### Current Bucket Contents
```
madladslab/graffiti-tv/
  ├── 1762622336661-f28b8110e6440da3.png (10.8 MB)
  └── 1762622361016-14f7573ff78968d5.png (3.9 MB)
```

### To Add More Media

Upload to Linode bucket:
- Bucket: `madladslab`
- Folder: `graffiti-tv/`
- Formats: mp4, webm, jpg, png, gif

Files appear automatically - no server restart needed!

### Known Issues (Non-Critical)

1. **Google Fonts Warning**: Harmless CORS warning, doesn't affect display
2. **Favicon 404**: No favicon set, doesn't affect functionality

### Server Management

**Check if running:**
```bash
lsof -i:3008
curl -s https://graffititv.madladslab.com/api/linode/media
```

**Restart server:**
```bash
lsof -ti:3008 | xargs kill -9
cd /srv/graffiti-tv
export GRAFFITI_TV_PORT=3008
npm start &
```

**View logs:**
```bash
tail -f /var/log/apache2/graffititv-error.log
```

### Apache Configuration
Location: `/etc/apache2/sites-available/madladslab-graffitiTV-ssl.conf`
- Proxies to localhost:3008
- SSL enabled
- WebSocket support configured

---

**STATUS: FULLY OPERATIONAL** 🍝🎨✨
