# Graffiti Pasta TV - Quick Reference

## Add Media in 3 Steps

### Step 1: Upload to Linode Bucket
Upload your video/image to: `madladslab` bucket, `graffiti-tv/` folder

Your file will be available at:
```
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/YOUR-FILENAME
```

### Step 2: Update Media List
Edit `/srv/graffiti-tv/routes/api.js` (line ~19):
```javascript
const mediaItems = [
  {
    url: `${baseUrl}/YOUR-FILENAME.mp4`,
    type: 'video', // or 'image'
  },
];
```

### Step 3: Restart Server
```bash
# In your graffiti-tv tmux session
# Ctrl+C to stop, then:
npm start
```

## Useful Commands

### Scan your bucket
```bash
cd /srv/graffiti-tv
npm run scan-bucket
```
Copy the output and paste into `routes/api.js`!

### Check what's running
```bash
tmux list-sessions
tmux attach -t graffiti-tv
```

### View server logs
Check the tmux session where graffiti-tv is running

## File Locations

- **Main page**: `/srv/graffiti-tv/views/index.ejs`
- **API routes**: `/srv/graffiti-tv/routes/api.js`
- **Server config**: `/srv/graffiti-tv/bin/www`
- **Package info**: `/srv/graffiti-tv/package.json`

## Media Settings

- **Image duration**: 15 seconds (configurable in `index.ejs:720`)
- **Video duration**: Plays until end, then auto-advances
- **Carousel**: Auto-loops through all media

## Supported Formats

**Videos**: mp4, webm, mov, avi, soprano
**Images**: jpg, jpeg, png, gif, webp, svg

## Troubleshooting

**Media not loading?**
- Check browser console (F12)
- Verify URL is correct: `https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/FILENAME`
- Make sure file is public-read in Linode

**API not responding?**
- Check server is running: `tmux list-sessions`
- Test API: `curl http://localhost:3001/api/media`

**Need to add more media?**
Just edit `routes/api.js` and add to the `mediaItems` array!
