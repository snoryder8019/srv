# Graffiti Pasta TV - Updates Summary

## Content Changes (Removed Idiocracy/Brawndo References)

### Updated to Pasta Restaurant Theme

**Title**: Now shows "GRAFFITI PASTA" instead of "GRAFFITI TV - IDIOCRACY EDITION"

**Tagline**: Changed from "POPFUNK GRAFFITI RULES THE STREETS!" to "WHERE STREET ART MEETS ITALIAN TRADITION!"

**Sponsor Message**: Changed from "BRAWNDO - IT'S GOT WHAT PLANTS CRAVE!" to "AUTHENTIC ITALIAN CUISINE WITH AN URBAN TWIST"

### Top Ticker Updates
Now shows restaurant-relevant messages:
- Fresh pasta daily
- Wine pairing specials
- Daily specials
- Live music events
- Wood-fired pizza promotions

### Sidebar Specials (formerly "Fake Ads")
Updated to show real restaurant offerings:
- Daily Special: Truffle Pasta ($24.99)
- Wine Pairing: Half Off Bottles
- Fresh Pasta: Made in House
- Graffiti Night: Live Art + Food
- Negroni Special: $5 Happy Hour
- Aperol Spritz
- Carbonara
- Pizza Night

### Menu Ticker (formerly "Stock Ticker")
Now displays pasta menu items with prices:
- Carbonara - $19.99
- Amatriciana - $18.99
- Cacio e Pepe - $17.99
- Graffiti Special - $24.99 (NEW!)
- Truffle Pasta - $26.99
- Bolognese - $21.99
- Arrabbiata - $16.99

### Bottom Scroller
Updated messages:
- Street art meets Italian tradition
- Handmade pasta daily
- Extensive wine selection
- Happy hour 4-7PM
- Live music Fridays
- Authentic Italian flavors
- Reservations welcome
- Graffiti art gallery

## Media Cycling System

### Current Status
- **Empty media array**: Since no MP4/WebM videos added yet, falls back to YouTube stream
- **Ready for media**: System is set up to cycle through your bucket content

### To Add Your Media

Edit `/srv/graffiti-tv/routes/api.js` (line 14):

```javascript
const mediaItems = [
  { url: `${baseUrl}/your-video.mp4`, type: 'video' },
  { url: `${baseUrl}/your-food-photo.jpg`, type: 'image' },
  // Add more...
];
```

### Supported Formats
- **Videos**: mp4, webm, mov, avi, ogv
- **Images**: jpg, jpeg, png, gif, webp, svg

**Note**: `.soprano` files need to be converted to standard video formats (mp4/webm) for browser compatibility

## All Visual Effects Preserved
- Psychedelic background animations
- Rainbow scrolling tickers
- Glitch effects
- Screen shake
- Border pulse effects
- Mobile responsive design

## Next Steps

1. **Add your media**: Upload MP4 videos or JPG/PNG images to your Linode bucket
2. **Update API**: Add the URLs to `routes/api.js`
3. **Restart**: Restart the graffiti-tv server
4. **Enjoy**: Watch your content cycle on the TV display!

## Quick Commands

```bash
# Install dependencies
cd /srv/graffiti-tv
npm install

# Scan your bucket to see what's available
npm run scan-bucket

# Start server (in tmux)
npm start
```

## Base URL for Media
```
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/
```
