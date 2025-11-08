# ScapeMan Web Scraper - Setup Documentation

## Overview
ScapeMan is a web scraping utility integrated into the MadLadsLab application. It provides a user-friendly interface for scraping, analyzing, and extracting structured data from websites.

## Features

### 1. Quick Scrape
- Simple URL scraping with configurable options
- Extract metadata (title, description, Open Graph tags, etc.)
- Extract page content (headings, paragraphs, main text)
- Extract links and images
- Support for relative URL resolution

### 2. Custom Extraction
- Use CSS selectors to extract specific data
- JSON-based selector configuration
- Support for single and multiple element extraction

### 3. Content Analysis
- SEO analysis (title, meta tags, heading structure)
- Accessibility analysis (alt tags, ARIA labels, semantic HTML)
- Performance analysis (script count, stylesheet count, etc.)
- General content statistics (word count, links, images)

### 4. Results Management
- View results in multiple formats (Raw JSON, Formatted, Metadata)
- Copy results to clipboard
- Download results as JSON
- Tabbed interface for easy navigation

### 5. Local Apps Browser
- Browse all applications from /srv (based on start-all-services.sh)
- Scan each app's public directory for assets
- View images with thumbnails
- Browse stylesheets, scripts, and other assets
- Click to copy asset URL or open in new tab
- Categorized tabs (Images, Stylesheets, Scripts, Other)
- File size display for all assets

## Installation

The following dependencies are required:
- `axios` - For HTTP requests (already installed)
- `cheerio` - For HTML parsing and manipulation (v1.0.0-rc.12 for Node 18 compatibility)

To install dependencies:
```bash
cd /srv/madladslab
npm install cheerio@1.0.0-rc.12
```

**Note:** Using `cheerio@1.0.0-rc.12` instead of the latest version for Node.js v18.19.1 compatibility. The latest cheerio requires Node 20+.

## Running the Service

The madladslab application runs in a tmux session for consistency with other /srv services:

```bash
# Check service status
./service-control.sh status

# Restart service (picks up new changes)
./service-control.sh restart madladslab

# View logs in tmux
tmux attach -t madladslab

# Detach from tmux: Ctrl+B, then D
```

## File Structure

```
madladslab/
├── routes/
│   └── scrapeman/
│       └── index.js          # Route handlers and API endpoints
├── views/
│   └── scrapeman/
│       └── index.ejs          # Web interface
└── lib/
    └── scraper.js             # Core scraping utilities
```

## API Endpoints

### POST /scrapeman/api/scrape
Scrape a URL with basic options.

**Request Body:**
```json
{
  "url": "https://example.com",
  "options": {
    "includeMetadata": true,
    "includeContent": true,
    "includeLinks": false,
    "includeImages": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "statusCode": 200,
    "scrapedAt": "2025-11-07T15:45:00.000Z",
    "metadata": { ... },
    "content": { ... }
  }
}
```

### POST /scrapeman/api/extract
Extract structured data using CSS selectors.

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "selectors": {
    "title": "h1",
    "paragraphs": "p",
    "prices": ".price"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "title": "Page Title",
    "paragraphs": ["Paragraph 1", "Paragraph 2"],
    "prices": ["$10.99", "$20.99"]
  }
}
```

### POST /scrapeman/api/analyze
Analyze content for SEO, accessibility, or performance.

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "analysisType": "seo"
}
```

### POST /scrapeman/api/metadata
Extract only metadata from a URL (faster than full scrape).

**Request Body:**
```json
{
  "url": "https://example.com"
}
```

### GET /scrapeman/api/local-apps
Get a list of all local /srv applications.

**Response:**
```json
{
  "success": true,
  "apps": [
    {
      "name": "madladslab",
      "port": 3000,
      "dir": "/srv/madladslab",
      "url": "http://localhost:3000"
    },
    ...
  ]
}
```

### POST /scrapeman/api/scan-app
Scan an app's public directory for images and assets.

**Request Body:**
```json
{
  "appDir": "/srv/madladslab"
}
```

**Response:**
```json
{
  "success": true,
  "assets": {
    "images": [
      {
        "name": "logo.png",
        "path": "images/logo.png",
        "fullPath": "/srv/madladslab/public/images/logo.png",
        "size": 6307,
        "modified": "2024-10-13T17:27:19.585Z"
      }
    ],
    "stylesheets": [...],
    "scripts": [...],
    "other": [...]
  }
}
```

## Usage Examples

### Example 1: Basic Scraping
1. Navigate to `/scrapeman` (admin only)
2. Enter a URL in the "Quick Scrape" panel
3. Select desired options (metadata, content, links, images)
4. Click "Scrape URL"
5. View results in the tabs below

### Example 2: Custom Data Extraction
1. Navigate to `/scrapeman`
2. Enter a URL in the "Custom Extraction" panel
3. Define CSS selectors in JSON format:
```json
{
  "productName": ".product-title",
  "price": ".product-price",
  "description": ".product-description",
  "reviews": ".review-text"
}
```
4. Click "Extract Data"
5. Download or copy the results

### Example 3: Browse Local Apps Assets
1. Navigate to `/scrapeman`
2. Scroll to the "Local Apps Browser" section
3. Click on any app card (e.g., "ps (Stringborne)", "madladslab", etc.)
4. Browse assets by category:
   - **Images tab**: View thumbnails of all images
   - **Stylesheets tab**: Browse CSS files
   - **Scripts tab**: Browse JavaScript files
   - **Other tab**: Fonts, JSON, etc.
5. Click any asset to:
   - **Click OK**: Copy the asset URL to clipboard
   - **Click Cancel**: Open asset in new tab

### Example 4: Programmatic Usage
```javascript
import { scrapeUrl, extractStructuredData } from './lib/scraper.js';

// Scrape a URL
const result = await scrapeUrl('https://example.com', {
  includeMetadata: true,
  includeContent: true,
  includeLinks: true
});

// Extract specific data
const html = '<html>...</html>';
const data = await extractStructuredData(html, {
  title: 'h1',
  author: '.author-name',
  date: '.publish-date'
});
```

## Security Considerations

1. **Rate Limiting**: Consider implementing rate limiting to prevent abuse
2. **URL Validation**: URLs are validated before scraping to prevent SSRF attacks
3. **Timeout**: Default 10-second timeout prevents hanging requests
4. **Admin Only**: The interface is restricted to admin users only
5. **User Agent**: Uses a standard browser user agent to avoid blocking
6. **Local Apps Browser**: Directory scanning is restricted to /srv/* paths only for security

## Future Enhancements

- [ ] Add authentication support for scraping protected pages
- [ ] Implement proxy support for IP rotation
- [ ] Add scheduled scraping jobs
- [ ] Store scraping history in database
- [ ] Add pagination support for multi-page scraping
- [ ] Implement screenshot capture
- [ ] Add JavaScript rendering support (Puppeteer/Playwright)
- [ ] Export results in multiple formats (CSV, XML, etc.)
- [ ] Add data transformation/cleaning utilities
- [ ] Implement webhooks for scraping completion notifications

## Troubleshooting

### Issue: "Module not found: cheerio"
**Solution:** Run `npm install cheerio` in the madladslab directory

### Issue: "Request timeout"
**Solution:** Increase timeout in scraper options or check target website availability

### Issue: "Cannot scrape HTTPS sites"
**Solution:** Ensure SSL certificates are properly configured on the server

### Issue: "Empty results"
**Solution:** Check CSS selectors are correct, some sites may block scrapers

## Access

- **URL:** `/scrapeman`
- **Permission:** Admin users only (controlled by `req.user.isAdmin`)
- **Navigation:** Available in the Admin section of the footer navigation

## Support

For issues or questions, contact the development team or check the main application documentation.
