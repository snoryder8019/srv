# Graffiti Pasta TV

A vibrant digital display for your pasta restaurant that cycles through media from your Linode bucket.

## Quick Start

```bash
cd /srv/graffiti-tv
npm install
npm start
```

Visit http://localhost:3001

## How It Works

The system **automatically fetches** all media from your Linode bucket `madladslab/graffiti-tv/` folder.

- No manual URL configuration needed
- Just upload files to your bucket
- They appear automatically on the TV

## Uploading Media

### Option 1: Via Bucket Upload Interface
1. Go to your bucket upload interface
2. Select bucket: `madladslab`
3. Subfolder: `graffiti-tv`
4. Upload your MP4 videos or JPG/PNG images

### Option 2: Direct Linode Upload
Upload to: `madladslab` bucket → `graffiti-tv/` folder

## Supported Formats

**Videos**: mp4, webm, mov, avi, ogv, mkv, m4v
**Images**: jpg, jpeg, png, gif, webp, svg, bmp

## Media Behavior

- **Videos**: Play until completion, then auto-advance
- **Images**: Display for 15 seconds, then auto-advance
- **Loop**: Cycles through all media continuously

## Fallback

If bucket is empty, displays YouTube stream until you add content.

## API Endpoints

- `GET /api/linode/media` - Fetches all media from graffiti-tv bucket
- `GET /api/media` - Manual media list (for custom URLs)

## Display Content

- **Top Ticker**: Restaurant news and specials
- **Main Screen**: Your cycling media
- **Sidebar**: Daily specials and menu items
- **Menu Ticker**: Pasta dishes with prices
- **Bottom Scroller**: Restaurant info

## Commands

```bash
npm start          # Start server
npm run list-media # Check what's in database
npm run scan-bucket # Scan Linode bucket (requires .env)
```

## Environment

Uses .env from `/srv/madladslab/.env`:
- LINODE_ACCESS
- LINODE_SECRET

## Customization

### Change Image Display Time
Edit `/srv/graffiti-tv/views/index.ejs` line 720:
```javascript
const MEDIA_DURATION = 15000; // milliseconds
```

### Update Menu Items
Edit `/srv/graffiti-tv/views/index.ejs`:
- Sidebar specials (line ~555)
- Menu ticker (line ~615)
- Top/bottom scrollers (line ~515 and ~690)

## Tech Stack

- Express.js server
- EJS templates
- AWS SDK for Linode S3
- Auto-cycling media player
- Responsive design

## Files

- `app.js` - Main server
- `routes/linode-api.js` - Direct Linode bucket access
- `routes/api.js` - Manual media list
- `views/index.ejs` - Main display template

---

**Graffiti Pasta TV** - Where Street Art Meets Italian Tradition 🍝🎨
