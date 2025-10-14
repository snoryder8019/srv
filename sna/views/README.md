# SNA Views Directory

This directory contains all EJS templates for the Some News Article application.

## View Structure

### Main Views

- **[index.ejs](index.ejs)** - Homepage displaying CNN headlines with link to multi-source news
  - Shows authentication status
  - Displays latest CNN headlines in a styled list
  - Links to `/news` for comprehensive multi-source view

- **[news.ejs](news.ejs)** - Multi-source news aggregator page
  - Displays news from CNN, Fox News, BBC, AP, and Reuters
  - Responsive grid layout with color-coded source badges
  - Smooth scroll navigation between sources
  - Full standalone HTML document with embedded CSS

- **[admin.ejs](admin.ejs)** - Admin panel for managing models
  - Displays all database models
  - Add/Edit/Delete operations
  - Requires admin authentication

- **[error.ejs](error.ejs)** - Error page template
  - Displays error messages
  - Simple, clean error display

### Component Views

Located in `components/` subdirectory:

- **[components/newsCard.ejs](components/newsCard.ejs)** - Individual news article card
  - Props: `title`, `url`, `source`
  - Color-coded source badge
  - Hover effects for better UX

- **[components/newsSection.ejs](components/newsSection.ejs)** - News section by source
  - Props: `source`, `articles` (array)
  - Displays all articles from a single news source
  - Responsive grid layout
  - Shows article count

### Scripts

- **[scriptsAdmin/index.ejs](scriptsAdmin/index.ejs)** - Client-side scripts for admin panel

## Routes

- `/` - Main homepage (renders `index.ejs`)
- `/news` - Multi-source news page (renders `news.ejs`)
- `/admin` - Admin panel (renders `admin.ejs`)

## API Endpoints

All news data is also available via REST API:

- `GET /api/v1/news` - All news from all sources
- `GET /api/v1/news/cnn` - CNN only
- `GET /api/v1/news/fox` - Fox News only
- `GET /api/v1/news/bbc` - BBC only
- `GET /api/v1/news/ap` - AP News only
- `GET /api/v1/news/reuters` - Reuters only

## News Sources

The application scrapes news from:

1. **CNN** - https://www.cnn.com
2. **Fox News** - https://www.foxnews.com
3. **BBC** - https://www.bbc.com/news
4. **Associated Press** - https://apnews.com
5. **Reuters** - https://www.reuters.com

## Styling

Views use inline CSS with:
- Modern gradient backgrounds
- Responsive design (mobile-first)
- Smooth transitions and hover effects
- Color-coded news sources
- Clean, readable typography

## Data Flow

```
User Request → Route Handler → News Scraper Service → View Template → HTML Response
```

## Future Enhancements

- Add caching for news data
- Implement real-time updates
- Add search/filter functionality
- Save favorite articles
- Share functionality
