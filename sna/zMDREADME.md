# Some News Article (SNA) - zMDREADME

## Overview

**Some News Article** is a multi-source news aggregation platform that scrapes headlines from major news outlets and displays them in a unified interface. Users can view news from CNN, Fox News, BBC, AP News, and Reuters, with a commenting system for authenticated users.

## Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB Atlas
- **Authentication**: Passport.js (Google OAuth, Facebook OAuth, Local Strategy)
- **Web Scraping**: Cheerio
- **HTTP Client**: Axios, node-fetch
- **Templating**: EJS
- **Email**: Nodemailer (Gmail SMTP)
- **API Fallback**: NewsAPI.org

## Key Features

### News Aggregation
- **Multi-Source Scraping**: Scrapes headlines from 5 major news sources
  - CNN (cnn.com)
  - Fox News (foxnews.com)
  - BBC News (bbc.com/news)
  - Associated Press (apnews.com)
  - Reuters (reuters.com)
- **Image Extraction**: Automatically extracts article images with multiple fallback selectors
- **NewsAPI Fallback**: Falls back to NewsAPI.org if web scraping fails
- **Real-time Updates**: Fetches fresh headlines on each page load

### Comment System
- **Article Comments**: Users can comment on any news article
- **User Attribution**: Comments linked to authenticated user (Google/Facebook/Local)
- **Like System**: Basic like counter for comments
- **Admin Moderation**: Admins can delete any comment; users can delete their own
- **MongoDB Storage**: Comments stored in `comments` collection

### Admin Panel
- **Dashboard**: Admin-only access at `/admin`
- **News Management**: View and manage news sources at `/admin/news`
- **Model Management**: Database model inspection at `/admin/models`
- **User Management**: User administration at `/admin/users`
- **Settings**: Configuration at `/admin/settings`

### Authentication
- **Google OAuth**: Primary authentication method
- **Facebook OAuth**: Secondary social login
- **Local Strategy**: Username/password authentication
- **Shared Config**: Uses Passport.js configuration from madladslab
- **Admin Verification**: Admin-only routes check `user.isAdmin`

## Project Structure

```
/srv/sna/
├── app.js                      # Main application file
├── package.json                # Dependencies and scripts
├── .env                        # Environment variables
├── routes/
│   ├── index.js               # Main routes (homepage, news page)
│   └── admin/
│       └── index.js           # Admin panel routes
├── api/
│   └── v1/
│       ├── index.js           # API router
│       ├── ep/
│       │   ├── news.js        # News API endpoints
│       │   ├── comments.js    # Comment API endpoints
│       │   ├── blogs.js       # Blog endpoints
│       │   └── brands.js      # Brand endpoints
│       └── models/
│           ├── Comment.js     # Comment model
│           ├── Blog.js        # Blog model
│           └── Brand.js       # Brand model
├── services/
│   └── newsScrapers.js        # News scraping logic for all sources
├── views/
│   ├── index.ejs              # Homepage
│   ├── news.ejs               # Multi-source news page
│   ├── admin.ejs              # Admin panel
│   ├── adminDashboard.ejs     # Admin dashboard
│   ├── adminNews.ejs          # Admin news management
│   ├── adminModels.ejs        # Admin model management
│   └── components/
│       ├── newsSection.ejs    # News section component
│       ├── newsCard.ejs       # Individual news card
│       ├── commentSystem.ejs  # Comment system component
│       ├── simpleCommentModal.ejs # Comment modal
│       └── adminSidebar.ejs   # Admin sidebar navigation
└── plugins/
    └── passport/
        └── passport.js        # Shared Passport.js configuration
```

## Database Schema

### Collection: `comments`

```javascript
{
  articleUrl: String,        // URL of the news article
  articleTitle: String,      // Title of the article
  articleSource: String,     // Source (CNN, Fox, BBC, etc.)
  userId: String,            // User ID from authentication
  userEmail: String,         // User's email
  userName: String,          // Display name
  commentText: String,       // Comment content
  createdAt: Date,          // Timestamp
  likes: Number             // Like count (default: 0)
}
```

### Collection: `blogs` (placeholder)
- Blog post management system (minimal implementation)

### Collection: `brands` (placeholder)
- Brand management system (minimal implementation)

## API Endpoints

### News API (`/api/v1/news`)

```
GET /api/v1/news          # Get all news from all sources
GET /api/v1/news/cnn      # Get CNN news only
GET /api/v1/news/fox      # Get Fox News only
GET /api/v1/news/bbc      # Get BBC news only
GET /api/v1/news/ap       # Get Associated Press news only
GET /api/v1/news/reuters  # Get Reuters news only
```

**Response Format**:
```json
{
  "success": true,
  "source": "CNN",
  "data": [
    {
      "title": "Headline text",
      "url": "https://...",
      "image": "https://...",
      "source": "CNN"
    }
  ],
  "timestamp": "2025-10-22T..."
}
```

### Comments API (`/api/v1/comments`)

```
GET /api/v1/comments/:articleUrl    # Get comments for article (public)
POST /api/v1/comments               # Add comment (requires auth)
DELETE /api/v1/comments/:commentId  # Delete comment (owner or admin)
GET /api/v1/comments                # Get all comments (admin only)
```

**POST Body**:
```json
{
  "articleUrl": "https://...",
  "articleTitle": "Article title",
  "articleSource": "CNN",
  "commentText": "User comment text"
}
```

## Configuration

### Environment Variables (`.env`)

```env
# Google OAuth
GGLAPI=your_google_api_key_here
GGLSEC=your_google_oauth_secret_here
GGLCID=your_google_client_id_here.apps.googleusercontent.com

# Session
SESHSEC=your_session_secret_here

# MongoDB
DB_URL=your_mongodb_connection_string_here
DB_NAME=your_database_name_here
MON_USER=your_mongodb_username_here
MON_PASS=your_mongodb_password_here

# Email (Gmail)
GMAIL_USER=your_gmail_address_here
GMAIL_PASS=your_gmail_app_password_here

# NewsAPI.org (fallback)
NEWS_API_KEY=your_news_api_key_here

# Server
PORT=3010
```

### Port Configuration

- **Port**: 3010 (configured in `.env`)
- **Note**: README.md says port 3004, but `.env` says 3010
- **Domain**: somenewsarticle.com

## News Scraping System

### How It Works

1. **Primary Method**: Cheerio web scraping
   - Fetches HTML from news source
   - Parses with Cheerio (jQuery-like syntax)
   - Extracts headlines, URLs, and images
   - Returns top 10 unique articles per source

2. **Image Extraction**: Multi-level fallback
   - Searches for `<img>` within article container
   - Checks parent/sibling images
   - Checks data attributes (`data-src`, `data-lazy-src`)
   - Constructs absolute URLs if relative

3. **NewsAPI Fallback**: If scraping fails
   - Falls back to NewsAPI.org API
   - Requires `NEWS_API_KEY` environment variable
   - Free tier: 100 requests/day
   - Returns structured article data

4. **Parallel Fetching**: Uses `Promise.all()`
   - Fetches all 5 sources simultaneously
   - Improves performance
   - Returns combined results

### Scraper Functions

- `getCNNNews()` - Scrapes CNN homepage
- `getFoxNews()` - Scrapes Fox News homepage
- `getBBCNews()` - Scrapes BBC News
- `getAPNews()` - Scrapes Associated Press
- `getReutersNews()` - Scrapes Reuters
- `getAllNews()` - Fetches all sources in parallel

## Routes

### Public Routes

```
GET /              # Homepage with top headlines
GET /news          # Full multi-source news page
GET /login         # Login page (Passport.js)
GET /logout        # Logout
GET /register      # Registration page
```

### Admin Routes (require `isAdmin: true`)

```
GET /admin              # Main admin panel
GET /admin/dashboard    # Admin dashboard
GET /admin/news         # News management
GET /admin/models       # Database model inspection
GET /admin/users        # User management
GET /admin/settings     # Configuration
```

## Authentication Flow

1. **User Login**: Via Google, Facebook, or Local strategy
2. **Session Creation**: Express-session with MongoDB store
3. **User Object**: Stored in `req.user` by Passport.js
4. **Admin Check**: Routes verify `req.user.isAdmin === true`
5. **Comment Attribution**: User info automatically added to comments

## Integration with MadLabs Ecosystem

### Shared Resources

- **MongoDB Database**: Connects to same Atlas cluster as madladslab
- **Database Name**: Uses `test` database (different from `madLadsLab`)
- **Authentication**: Shares Passport.js configuration from `/srv/madladslab/plugins/passport/`
- **Google OAuth**: Same client ID as madladslab ecosystem

### Monitoring

- **Service Monitor**: Tracked by madladslab service monitoring daemon
- **Port**: 3010 (should be updated in context files)
- **Tmux Session**: `sna_session`

## Installation

```bash
cd /srv/sna
npm install
```

## Running the Service

### Development
```bash
npm start
```

### Production (tmux)
```bash
tmux new-session -d -s sna_session -c /srv/sna "npm start"
```

### Check Status
```bash
tmux capture-pane -t sna_session -p | tail -20
```

### Stop Service
```bash
tmux kill-session -t sna_session
```

## Features in Detail

### Homepage (`/`)
- Displays top headline from each source
- Source logos/branding
- Click to read full article (external link)
- Authentication status displayed
- Link to full news page

### News Page (`/news`)
- Multi-column layout showing all sources
- 10 headlines per source
- Article images (when available)
- Comment button for each article
- Filter by source
- Real-time scraping (no caching)

### Comment System
- **Authentication Required**: Must be logged in to comment
- **Comment Modal**: Pops up when clicking comment button
- **User Display**: Shows username and timestamp
- **Edit/Delete**: Users can delete own comments; admins can delete any
- **Like System**: Basic like counter (frontend only, not persisted)

### Admin Panel
- **Dashboard**: Overview of system stats
- **News Management**:
  - View all scraped news
  - Test individual scrapers
  - Check NewsAPI status
- **Model Management**:
  - View all MongoDB models
  - Inspect schemas
  - Query collections
- **User Management**: View and manage users
- **Settings**: Configuration options

## Documentation

### Related Files
- `/srv/sna/NEWS_API_SETUP.md` - News scraping and NewsAPI setup guide
- `/srv/sna/COMMENT_SYSTEM_README.md` - Comment system documentation
- `/srv/sna/ADMIN_PANEL_README.md` - Admin panel features
- `/srv/sna/MONGODB_COMMENTS_SETUP.md` - MongoDB comment storage
- `/srv/sna/SIMPLE_COMMENTS_WORKING.md` - Working comment implementation
- `/srv/sna/TEST_COMMENTS.md` - Testing documentation

## Known Issues

### Port Mismatch
- **Issue**: `.env` says port 3010, but README.md and some docs say 3004
- **Solution**: Verify actual running port and update documentation

### NewsAPI Rate Limits
- **Issue**: Free tier limited to 100 requests/day
- **Impact**: May fail if scraping fails frequently
- **Solution**: Primary reliance on web scraping; NewsAPI as backup only

### Scraping Fragility
- **Issue**: News sites change HTML structure frequently
- **Impact**: Scrapers may break without notice
- **Solution**: Multiple selector fallbacks; NewsAPI backup

## Troubleshooting

### Service Won't Start
1. Check MongoDB connection string in `.env`
2. Verify Google OAuth credentials
3. Check port 3010 isn't already in use: `lsof -i :3010`
4. Check tmux session: `tmux ls | grep sna`

### No News Appearing
1. Check scraper logs for errors
2. Test individual scrapers via API endpoints
3. Verify NEWS_API_KEY if scraping fails
4. Check network/firewall blocking news sites

### Comments Not Saving
1. Verify MongoDB connection
2. Check user is authenticated
3. Verify `comments` collection exists
4. Check browser console for errors

### Admin Panel Not Accessible
1. Verify user has `isAdmin: true` in MongoDB
2. Check authentication is working
3. Verify session management is configured

## Future Enhancements

- **Caching**: Cache scraped news for 15-30 minutes
- **Search**: Search across all news sources
- **Bookmarks**: Save articles for later
- **Notifications**: Alert users when certain topics appear
- **RSS Feeds**: Provide RSS feeds per source
- **Comment Threading**: Nested replies to comments
- **Upvote/Downvote**: Persistent voting system
- **User Profiles**: View user comment history

## Contact

For issues or questions:
- **Email**: scott@madladslab.com
- **Domain**: https://somenewsarticle.com
- **Admin Panel**: https://somenewsarticle.com/admin

## Last Updated

2025-10-22

---

**Status**: Active
**Version**: 1.0.0
**License**: Internal use only - MadLabs Lab 2025
