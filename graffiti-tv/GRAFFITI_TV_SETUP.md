# Graffiti Pasta TV - Linode Bucket Media Cycling

## Overview
Graffiti Pasta TV automatically cycles through videos and images from your `graffiti-tv` Linode bucket - perfect for displaying your restaurant's street art, food photos, and promotional content!

## How It Works

1. **API Endpoint**: `/api/media` - Returns list of media URLs from the bucket
2. **Client-Side Carousel**: Automatically cycles through videos and images
   - Videos play until completion, then auto-advance
   - Images display for 15 seconds each
   - Seamlessly loops through all media

## Adding Media to the Carousel

### Option 1: Add URLs Directly (Easiest)
Edit [/srv/graffiti-tv/routes/api.js](graffiti-tv/routes/api.js) and add your media URLs to the `mediaItems` array:

```javascript
const mediaItems = [
  {
    url: `${baseUrl}/1762625082358-ae18de361ad77063.soprano`,
    type: 'video',
  },
  {
    url: `${baseUrl}/your-image-file.jpg`,
    type: 'image',
  },
  // Add more items here...
];
```

### Option 2: Upload via Bucket Upload Interface
1. Navigate to your bucket upload interface
2. Select bucket: `graffiti-tv`
3. Upload videos or images
4. The public URLs will be automatically available at:
   `https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/[filename]`

### Supported Formats

**Videos:**
- .mp4
- .webm
- .mov
- .avi
- .soprano (custom format)

**Images:**
- .jpg / .jpeg
- .png
- .gif
- .webp
- .svg

## Configuration

### Change Display Duration
Edit [/srv/graffiti-tv/views/index.ejs](graffiti-tv/views/index.ejs:720):
```javascript
const MEDIA_DURATION = 15000; // 15 seconds for images (in milliseconds)
```

### Fallback Content
If no media is found, the system falls back to a default YouTube live stream.

## Quick Start

### 1. Install Dependencies
```bash
cd /srv/graffiti-tv
npm install
```

### 2. Scan Your Bucket (Optional)
See what's already in your graffiti-tv bucket:
```bash
npm run scan-bucket
```
This will output a ready-to-paste `mediaItems` array!

### 3. Add Your Media URLs
Edit [routes/api.js](graffiti-tv/routes/api.js:19) and add your media:
```javascript
const mediaItems = [
  {
    url: `${baseUrl}/1762625082358-ae18de361ad77063.soprano`,
    type: 'video',
  },
  {
    url: `${baseUrl}/my-graffiti-art.jpg`,
    type: 'image',
  },
  // Add more...
];
```

### 4. Start Server (in tmux)
```bash
cd /srv/graffiti-tv
npm start
```

### 5. Test It
Visit http://localhost:3001 (or your configured port)
Check browser console for media loading logs

## Features Preserved

All the awesome graffiti-tv features remain intact:
- Psychedelic background animations
- Top news ticker
- Sidebar fake ads
- Stock ticker
- Bottom scroller
- Glitch effects
- Screen shake
- Mobile responsive design
- IDIOCRACY aesthetic!

## Base URL
All media is served from:
`https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/`

## Example URLs
```
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/1762625082358-ae18de361ad77063.soprano
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/my-graffiti-video.mp4
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/street-art.jpg
```
