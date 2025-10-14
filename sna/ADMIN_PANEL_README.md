# SNA Admin Panel Documentation

## Overview
A comprehensive admin panel for managing the Some News Article (SNA) application, with multi-source news aggregation and database model management.

## Admin Panel Features

### 1. Main Dashboard (`/admin`)
- **Dashboard Statistics**
  - Total models count
  - Active news sources (5 sources)
  - API endpoints count
  - System status monitoring

- **Quick Actions**
  - Add Model
  - Refresh News
  - View API
  - View Logs

- **Recent Activity Log**
  - Displays recent admin actions
  - Shows timestamps and status

### 2. Models Management (`/admin/models`)
- View all database models (Blog, Brand)
- See model fields and configurations
- Field type indicators
- Editable field badges
- Direct API endpoint links
- Add/View/Edit entries functionality

### 3. News Management (`/admin/news`)
- **Real-time monitoring** of all 5 news sources:
  - CNN
  - Fox News
  - BBC
  - AP News
  - Reuters

- **Per-source controls:**
  - Test scraper functionality
  - Refresh news data
  - View API endpoint
  - Live article count
  - Last updated timestamp
  - Status indicators (Active/Error)

### 4. Navigation Menu
- Dashboard
- Models Management
- News Management
- Users (placeholder)
- Settings (placeholder)
- Back to Site link

## Routes

### Admin Routes
- `GET /admin` - Main dashboard
- `GET /admin/legacy` - Legacy admin view (backwards compatible)
- `GET /admin/models` - Models management
- `GET /admin/news` - News source management
- `GET /admin/users` - User management (placeholder)
- `GET /admin/settings` - Settings (placeholder)

### Public Routes
- `GET /` - Homepage with top headlines from all sources
- `GET /news` - Full multi-source news page
- `GET /api/v1/news` - All news sources API
- `GET /api/v1/news/:source` - Single source API (cnn, fox, bbc, ap, reuters)

## Views Structure

### Admin Views
- **[adminDashboard.ejs](views/adminDashboard.ejs)** - Main admin dashboard
- **[adminModels.ejs](views/adminModels.ejs)** - Detailed models management
- **[adminNews.ejs](views/adminNews.ejs)** - News sources control panel
- **[admin.ejs](views/admin.ejs)** - Legacy admin view

### Public Views
- **[index.ejs](views/index.ejs)** - Homepage with top headlines grid
- **[news.ejs](views/news.ejs)** - Comprehensive multi-source news page

### Components
- **[components/adminSidebar.ejs](views/components/adminSidebar.ejs)** - Admin navigation sidebar
- **[components/newsCard.ejs](views/components/newsCard.ejs)** - Individual news card
- **[components/newsSection.ejs](views/components/newsSection.ejs)** - News section by source

### Scripts
- **[scriptsAdmin/dashboard.ejs](views/scriptsAdmin/dashboard.ejs)** - Dashboard interactivity
- **[scriptsAdmin/index.ejs](views/scriptsAdmin/index.ejs)** - Legacy admin scripts

## News Sources

### Integrated Sources
1. **CNN** - https://www.cnn.com
   - Color: Red (#cc0000)
   - API: `/api/v1/news/cnn`

2. **Fox News** - https://www.foxnews.com
   - Color: Navy (#003366)
   - API: `/api/v1/news/fox`

3. **BBC** - https://www.bbc.com/news
   - Color: Dark Red (#bb1919)
   - API: `/api/v1/news/bbc`

4. **AP News** - https://apnews.com
   - Color: Red (#d71920)
   - API: `/api/v1/news/ap`

5. **Reuters** - https://www.reuters.com
   - Color: Orange (#ff8000)
   - API: `/api/v1/news/reuters`

## Design Features

### Color Scheme
- Primary Gradient: Purple to Violet (#667eea to #764ba2)
- Success: Green (#51cf66)
- Warning: Yellow (#ffd43b)
- Danger: Red (#ff6b6b)
- Background: Light Gray (#f5f7fa)

### UI Elements
- Responsive grid layouts
- Smooth transitions and hover effects
- Color-coded news sources
- Card-based design system
- Mobile-first responsive design
- Gradient backgrounds
- Shadow effects for depth

## Security

### Admin Protection
- `isAdmin` middleware on all admin routes
- Checks `req.user.isAdmin === true`
- Returns 401 Unauthorized if not admin
- User authentication required

### Access Control
```javascript
async function isAdmin(req, res, next) {
    const user = req.user;
    if (user && user.isAdmin === true) {
        return next();
    } else {
        return res.status(401).send('Unauthorized');
    }
}
```

## API Documentation

### News API Endpoints

#### Get All News
```
GET /api/v1/news
```
Returns:
```json
{
  "success": true,
  "data": {
    "cnn": [...],
    "fox": [...],
    "bbc": [...],
    "ap": [...],
    "reuters": [...],
    "all": [...]
  },
  "timestamp": "2025-10-14T..."
}
```

#### Get Source-Specific News
```
GET /api/v1/news/:source
```
Sources: `cnn`, `fox`, `bbc`, `ap`, `reuters`

Returns:
```json
{
  "success": true,
  "source": "CNN",
  "data": [
    {
      "title": "Headline text",
      "url": "https://...",
      "source": "CNN"
    }
  ],
  "timestamp": "2025-10-14T..."
}
```

### Models API Endpoints

```
GET /api/v1/blogs
GET /api/v1/brands
```

## File Structure

```
sna/
├── routes/
│   ├── index.js          # Main routes with news integration
│   └── admin/
│       └── index.js      # Admin routes
├── api/
│   └── v1/
│       ├── index.js
│       └── ep/
│           ├── index.js
│           ├── news.js   # News API endpoints
│           ├── blogs.js
│           └── brands.js
├── services/
│   └── newsScrapers.js   # News scraping service
└── views/
    ├── index.ejs         # Homepage with top headlines
    ├── news.ejs          # Multi-source news page
    ├── adminDashboard.ejs
    ├── adminModels.ejs
    ├── adminNews.ejs
    ├── admin.ejs         # Legacy
    ├── error.ejs
    ├── components/
    │   ├── adminSidebar.ejs
    │   ├── newsCard.ejs
    │   └── newsSection.ejs
    └── scriptsAdmin/
        ├── index.ejs
        └── dashboard.ejs
```

## Usage

### Accessing Admin Panel
1. Login as admin user
2. Navigate to `/admin`
3. Use navigation to access different sections

### Managing News
1. Go to `/admin/news`
2. View status of all sources
3. Click "Test" to verify scraper
4. Click "Refresh" to update news
5. Click "View API" to see raw JSON data

### Managing Models
1. Go to `/admin/models`
2. View all database models
3. Click "Add Entry" to create new records
4. Click "View API" to see endpoint data

## Features Highlights

✅ Multi-source news aggregation (5 sources)
✅ Beautiful, responsive admin dashboard
✅ Real-time news scraping and monitoring
✅ Model management with field visualization
✅ Color-coded news sources
✅ RESTful API for all data
✅ Mobile-responsive design
✅ Smooth animations and transitions
✅ Error handling and status indicators
✅ Admin authentication and authorization

## Future Enhancements

- [ ] Caching for news data
- [ ] User management interface
- [ ] Settings configuration panel
- [ ] Activity logs page
- [ ] News scheduling/automation
- [ ] Search and filter functionality
- [ ] Export news data
- [ ] Email notifications
- [ ] Analytics dashboard
- [ ] Custom news source addition
