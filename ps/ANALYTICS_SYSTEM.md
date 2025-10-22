# Analytics & Achievement System

A comprehensive user behavior tracking and achievement system for the Stringborn Universe platform.

## Overview

This system tracks user actions, provides deep analytics insights, and rewards users with achievements based on their activities.

## Features

### 1. User Behavior Tracking
- Automatic tracking of all major user actions
- Page view analytics
- Asset creation, submission, and voting tracking
- Suggestion and collaboration tracking
- Character creation and zone exploration tracking

### 2. Admin Analytics Dashboard
- Platform-wide statistics
- User activity metrics
- Daily active user charts
- Asset approval statistics
- Achievement distribution
- Top users leaderboard

### 3. Achievement System
- 15+ achievements across multiple categories
- Real-time achievement unlocking
- Progress tracking towards next achievements
- Achievement display on user profiles

### 4. User Profile Analytics
- Personal statistics dashboard
- Achievement showcase
- Progress bars for next achievements
- Activity history

## Components

### Backend

#### Models
- **`UserAnalytics.js`** - Core analytics model with methods for:
  - `trackAction()` - Track any user action
  - `updateUserStats()` - Update user statistics
  - `checkAchievements()` - Check and award achievements
  - `getUserAnalytics()` - Get user-specific analytics
  - `getPlatformAnalytics()` - Get platform-wide analytics

#### Middleware
- **`analyticsTracker.js`** - Tracking middleware for:
  - Page views
  - API calls
  - Asset operations
  - Character actions
  - Zone visits

#### Routes
- **`/admin`** - Admin dashboard with analytics
- **`/admin/api/analytics`** - Platform analytics API
- **`/admin/api/analytics/user/:userId`** - User-specific analytics
- **`/admin/api/track-action`** - Track custom actions
- **`/profile`** - User profile with achievements
- **`/api/v1/profile/analytics`** - User analytics API

### Frontend

#### Views
- **`admin/dashboard.ejs`** - Admin analytics dashboard
- **`profile.ejs`** - User profile with achievements

#### Scripts
- **`analytics-client.js`** - Client-side tracking for:
  - Page loads/unloads
  - Click tracking
  - Custom events
  - Time on page

## Tracked Actions

### Asset Actions
- `asset_created` - User creates a new asset
- `asset_submitted` - User submits asset for approval
- `vote_cast` - User votes on an asset
- `suggestion_made` - User makes a suggestion

### Character Actions
- `character_created` - User creates a character

### Navigation Actions
- `page_view` - User views a page
- `zone_visited` - User visits a zone
- `login` - User logs in
- `logout` - User logs out

## Achievements

### Creation Achievements
- **First Steps** - Create your first asset
- **Creative Mind** - Create 5 assets
- **Master Creator** - Create 10 assets
- **Creative Genius** - Create 25 assets

### Contribution Achievements
- **Contributor** - Submit your first asset
- **Prolific Contributor** - Submit 10 assets

### Voting Achievements
- **Community Member** - Cast your first vote
- **Active Voter** - Cast 25 votes
- **Democracy Champion** - Cast 100 votes

### Collaboration Achievements
- **Helpful Hand** - Make your first suggestion
- **Collaborative Spirit** - Make 10 suggestions

### Character Achievements
- **Character Builder** - Create your first character
- **Character Master** - Create 5 characters

### Exploration Achievements
- **Explorer** - Visit 5 different zones
- **Galactic Tourist** - Visit 20 different zones

## Usage

### Tracking Actions (Server-Side)

```javascript
import { UserAnalytics } from './api/v1/models/UserAnalytics.js';

// Track a user action
await UserAnalytics.trackAction(userId, 'asset_created', {
  assetId: '12345',
  assetType: 'character'
});
```

### Using Tracking Middleware

```javascript
import { trackAssetCreated } from './middlewares/analyticsTracker.js';

// In your route handler
const asset = await Asset.create(assetData);
await trackAssetCreated(req.user._id, asset._id, assetType);
```

### Client-Side Tracking

```javascript
// Track custom events
window.analytics.track('custom_event', {
  category: 'engagement',
  action: 'button_click',
  label: 'start_game'
});
```

### Getting Analytics Data

```javascript
// Get platform analytics (admin only)
const analytics = await UserAnalytics.getPlatformAnalytics(30); // Last 30 days

// Get user analytics
const userAnalytics = await UserAnalytics.getUserAnalytics(userId);
```

## Database Collections

### users
Enhanced with:
- `stats` - Object containing user statistics
  - `totalActions`
  - `assetsCreated`
  - `assetsSubmitted`
  - `votesCast`
  - `suggestionsMade`
  - `pageViews`
  - `logins`
  - `charactersCreated`
  - `zonesVisited`
  - `pagesByType`
- `achievements` - Array of unlocked achievements
- `lastActive` - Last activity timestamp

### userActions
Tracks all user actions:
- `userId` - User who performed the action
- `actionType` - Type of action
- `metadata` - Additional action data
- `timestamp` - When the action occurred
- `sessionId` - Session identifier

## Indexes

For optimal performance:
```javascript
// userActions indexes
{ userId: 1, timestamp: -1 }
{ actionType: 1, timestamp: -1 }

// users indexes
{ lastActive: -1 }
```

## Initialization

To initialize analytics for existing users:

```bash
node scripts/initialize-user-analytics.js
```

## Admin Dashboard Features

### Overview Cards
- Total users
- Active users (customizable time range)
- New users
- Total actions
- Average actions per user

### Charts & Visualizations
- Daily active users (line chart)
- Actions by type breakdown
- Top active users leaderboard
- Asset statistics (by status)
- Achievement distribution

### Time Filters
- Last 7 days
- Last 30 days
- Last 90 days

## User Profile Features

### Statistics Display
- Assets created count
- Assets submitted count
- Votes cast
- Suggestions made
- Characters created
- Zones visited

### Achievement Showcase
- Visual grid of all achievements
- Locked/unlocked states
- Unlock dates
- Achievement icons and descriptions

### Progress Tracking
- Progress bars for next achievements
- Current progress vs. requirements
- Visual percentage indicators

## Performance Considerations

1. **Fire-and-Forget Tracking** - Analytics tracking doesn't block request processing
2. **Indexed Queries** - Database indexes on frequently queried fields
3. **Aggregation Pipeline** - Efficient MongoDB aggregation for analytics
4. **Client-Side Batching** - Actions batched and sent every 5 seconds
5. **SendBeacon API** - Reliable tracking even on page unload

## Future Enhancements

- [ ] Login streak tracking
- [ ] Time-based achievements (daily/weekly)
- [ ] Social achievements (referrals, collaborations)
- [ ] Leaderboards
- [ ] Achievement badges on forum/chat
- [ ] Analytics export (CSV/JSON)
- [ ] Custom date range filters
- [ ] Cohort analysis
- [ ] Funnel analysis
- [ ] A/B testing framework

## Security

- Admin routes protected with `isAdmin` middleware
- User analytics only accessible by user or admin
- All tracking requires authentication
- XSS protection in achievement names/descriptions
- Rate limiting on tracking endpoints (recommended)

## API Endpoints

### Admin Endpoints
- `GET /admin` - Dashboard view
- `GET /admin/api/analytics?days=30` - Platform analytics
- `GET /admin/api/analytics/user/:userId` - User analytics
- `POST /admin/api/track-action` - Track custom action

### User Endpoints
- `GET /profile` - User profile view
- `GET /api/v1/profile/analytics` - Current user analytics

## Testing

```bash
# Test analytics tracking
curl -X POST http://localhost:3399/admin/api/track-action \
  -H "Content-Type: application/json" \
  -d '{"actionType":"test_action","metadata":{"test":true}}'

# Get platform analytics (requires admin auth)
curl http://localhost:3399/admin/api/analytics?days=30

# Get user profile analytics (requires user auth)
curl http://localhost:3399/api/v1/profile/analytics
```

## Troubleshooting

### Achievements not unlocking
1. Check that user stats are being updated
2. Verify achievement conditions in `UserAnalytics.checkAchievements()`
3. Ensure tracking middleware is properly integrated

### Analytics not showing
1. Check MongoDB connection
2. Verify userActions collection exists and has data
3. Check for JavaScript errors in browser console
4. Ensure user is authenticated

### Performance issues
1. Verify database indexes are created
2. Check MongoDB query performance
3. Consider increasing flush interval for client-side tracking
4. Review aggregation pipeline efficiency

## License

Part of the Stringborn Universe platform.
