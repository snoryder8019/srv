# News Scraping with Images & API Fallback

## Overview

The SNA news system now includes:
1. **Image extraction** from all news sources
2. **NewsAPI.org fallback** when scraping fails
3. **Error handling** with graceful degradation

## Features Added

### Image Support
All news articles now include images (when available):
- Images are extracted from article cards
- Multiple fallback selectors for maximum compatibility
- Images displayed on both homepage and full news page
- Graceful handling: images hide if they fail to load (`onerror` handler)

### Data Structure
Each news article now returns:
```javascript
{
  title: "Article headline",
  url: "https://...",
  image: "https://..." || null,  // NEW
  source: "CNN",
  description: "..." // From NewsAPI fallback
}
```

## NewsAPI.org Integration

### What is NewsAPI.org?
A professional news aggregation API that provides:
- Reliable access to major news sources
- Pre-scraped article data with images
- 100 requests/day on free tier
- More sources available

### Setup Instructions

#### 1. Get API Key (FREE)
1. Visit: https://newsapi.org
2. Click "Get API Key"
3. Sign up for free account
4. Copy your API key

#### 2. Configure Environment Variable
Add to your `.env` file or set as environment variable:

```bash
NEWS_API_KEY=your_api_key_here
```

Or in your server startup:
```bash
export NEWS_API_KEY=your_api_key_here
node app.js
```

Or in package.json scripts:
```json
{
  "scripts": {
    "start": "NEWS_API_KEY=your_key node app.js"
  }
}
```

#### 3. Verify Setup
The fallback is automatic. To test:
```javascript
// In newsScrapers.js, the fallback activates when:
// 1. Scraping returns 0 results
// 2. Scraping throws an error
```

### How It Works

```javascript
// 1. Try scraping first (free, no API limits)
const scrapedNews = await scrapeSource();

// 2. If scraping fails or returns empty
if (scrapedNews.length === 0) {
  // Fallback to NewsAPI (requires key)
  return await getNewsAPIFallback('cnn');
}
```

### Supported Sources via NewsAPI

| Source | Web Scraping | NewsAPI Fallback |
|--------|-------------|------------------|
| CNN | ✅ | ✅ `cnn` |
| Fox News | ✅ | ✅ `fox-news` |
| BBC | ✅ | ✅ `bbc-news` |
| Reuters | ✅ | ✅ `reuters` |
| AP News | ✅ | ✅ `associated-press` |

### Advantages of NewsAPI Fallback

#### Pros:
- **More reliable** - Less likely to break when sites change
- **Better images** - Curated, high-quality images
- **Additional metadata** - Descriptions, publish dates
- **Performance** - JSON API faster than HTML parsing
- **No scraping issues** - No rate limiting or blocking

#### Cons:
- **API limits** - 100 requests/day on free tier
- **Requires signup** - Need API key
- **Costs money** - For production use (>100 req/day)

## Alternative APIs

If you need more reliability, consider these alternatives:

### 1. NewsData.io
- Free tier: 200 requests/day
- More sources available
- Similar to NewsAPI
- https://newsdata.io

### 2. GNews API
- Free tier: 100 requests/day
- Clean API structure
- https://gnews.io

### 3. MediaStack
- Free tier: 500 requests/month
- Historical news available
- https://mediastack.com

### 4. The Guardian API
- Free tier: 5,000 requests/day
- BBC-specific but reliable
- https://open-platform.theguardian.com

## Current Implementation

### Without API Key (Default)
```
User requests news
   ↓
Scrape website HTML (cheerio)
   ↓
Extract headlines, images, URLs
   ↓
Return data
```

### With API Key (Fallback Mode)
```
User requests news
   ↓
Try scraping first
   ↓
   ├─ Success? → Return scraped data
   └─ Failure? → Use NewsAPI fallback
```

## Image Extraction Details

### How Images Are Extracted

```javascript
const extractImage = ($el) => {
  // 1. Direct img tag
  let img = $el.find('img').first().attr('src');

  // 2. Parent/sibling container
  if (!img) {
    img = $el.closest('article, div').find('img').first().attr('src');
  }

  // 3. Lazy-loaded images
  if (!img) {
    img = $el.find('img').first().attr('data-src') ||
          $el.find('img').first().attr('data-lazy-src');
  }

  return img || null;
};
```

### Image Display

**Homepage Cards:**
- 180px height
- Cover fit (maintains aspect ratio)
- Displays above headline
- Hides on error

**Full News Page:**
- 200px height
- Cover fit
- Positioned above article title
- Hides on error

## Performance Considerations

### Caching Recommendation
To avoid hitting API limits, consider caching:

```javascript
// Example: Cache for 15 minutes
const cache = {
  data: null,
  timestamp: null,
  TTL: 15 * 60 * 1000 // 15 minutes
};

export const getCNNNews = async () => {
  // Check cache first
  if (cache.data && Date.now() - cache.timestamp < cache.TTL) {
    return cache.data;
  }

  // Fetch fresh data
  const data = await fetchNews();
  cache.data = data;
  cache.timestamp = Date.now();
  return data;
};
```

## Testing

### Test Image Extraction
Visit homepage:
```
http://localhost:3000
```
You should see news cards with images (if available)

### Test API Fallback
1. Set invalid selectors in scraper (force failure)
2. Set NEWS_API_KEY environment variable
3. Restart server
4. Check that news still loads via API

### Monitor in Console
The scrapers log to console:
```
CNN scraper error: [error]  // Scraping failed
NewsAPI fallback error: [error]  // API also failed
```

## Cost Analysis

### Free Scraping (Current Default)
- **Cost**: $0
- **Reliability**: ~80-90%
- **Rate limits**: None (be respectful)
- **Images**: Hit or miss

### NewsAPI Free Tier
- **Cost**: $0
- **Requests**: 100/day
- **Reliability**: ~99%
- **Images**: High quality

### NewsAPI Paid
- **Cost**: $449/month
- **Requests**: 250,000/month
- **Reliability**: 99.9%
- **Support**: Priority

## Recommendation

For development/personal use:
- ✅ **Use scraping by default** (no API key needed)
- ✅ **Set up NewsAPI fallback** for reliability (free tier)

For production:
- Consider paid NewsAPI tier
- Implement caching to reduce API calls
- Monitor scraping success rates
- Have fallback ready

## Environment Variables Summary

```bash
# Optional - enables NewsAPI fallback
NEWS_API_KEY=your_key_here

# Future: Add other API keys here
# NEWSDATA_API_KEY=...
# GNEWS_API_KEY=...
```

## Troubleshooting

### Images not showing
1. Check browser console for CORS errors
2. Some news sites block image hotlinking
3. Images might be lazy-loaded (not captured)
4. Try NewsAPI fallback for better images

### Scraping returns no results
1. News site may have changed HTML structure
2. Update selectors in newsScrapers.js
3. Fallback to NewsAPI if configured
4. Check console for error messages

### API fallback not working
1. Verify NEWS_API_KEY is set correctly
2. Check API quota at newsapi.org dashboard
3. Ensure environment variable is loaded
4. Restart server after setting variable

## Future Improvements

- [ ] Add caching layer (Redis/memory)
- [ ] Implement multiple API fallbacks
- [ ] Add admin panel toggle for API vs scraping
- [ ] Track success rates per source
- [ ] Automatic selector updates
- [ ] Image proxy/CDN for reliability
- [ ] RSS feed fallback option
