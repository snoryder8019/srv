# Activity Token System

**Version:** 1.0.0
**Date:** October 28, 2025
**Status:** Production Ready

## Overview

The Activity Token System is a session management solution designed to prevent duplicate character sessions, manage state consistency, and provide a smooth user experience with automatic session renewal capabilities.

## Purpose

- **Prevent Duplicates:** Ensures only one active session exists per character at any time
- **State Management:** Prevents state mismanagement by invalidating stale sessions
- **User Experience:** Provides "Keep Playing" functionality with automatic session extension
- **Security:** Token-based authentication with automatic expiration

## Architecture

### Components

1. **Token Utility** (`utilities/activityTokens.js`)
   - Token generation, validation, and renewal
   - Database operations for token management
   - Cleanup functions for expired tokens

2. **Middleware** (`middlewares/activityToken.js`)
   - Request validation
   - Automatic redirection on expired sessions
   - Token attachment to requests

3. **API Endpoints** (`api/v1/activity/`)
   - Token creation and renewal
   - Session validation
   - Character switching

4. **Client Monitor** (`public/javascripts/activity-monitor.js`)
   - Real-time session monitoring
   - "Keep Playing" popup UI
   - Automatic token renewal requests

5. **Cron Jobs** (`plugins/cron/index.js`)
   - Periodic cleanup of expired tokens (every 15 minutes)
   - Database index creation on startup

## Database Schema

### Collection: `activityTokens`

```javascript
{
  token: String,              // Unique token (64-char hex)
  userId: String,             // User ID who owns the session
  characterId: String,        // Active character ID
  createdAt: Date,            // When token was created
  expiresAt: Date,            // When token expires (20 min from creation)
  lastRenewedAt: Date,        // Last renewal timestamp
  active: Boolean,            // Whether token is currently valid
  renewalCount: Number,       // Number of times renewed
  invalidatedAt: Date,        // When token was invalidated (if applicable)
  invalidationReason: String, // Why token was invalidated
  userAgent: String,          // Optional: client user agent
  ipAddress: String           // Optional: client IP address
}
```

### Indexes

- `token` (unique)
- `characterId + active` (compound)
- `userId`
- `expiresAt`
- `createdAt`

## Token Lifecycle

### 1. Creation

When a user selects a character:

```javascript
POST /api/v1/characters/:id/set-active
→ Creates new activity token
→ Invalidates all existing tokens for this character
→ Sets activityToken cookie (20 min expiration)
→ Sets activeCharacterId cookie (20 min expiration)
```

**Duration:** 20 minutes
**Warning Threshold:** 18 minutes (2 minutes before expiration)

### 2. Validation

On every game page load and API request:

```javascript
// Middleware checks token validity
requireActivityToken middleware
→ Validates token from cookie
→ Checks expiration
→ Verifies character ownership
→ Redirects to /characters if invalid
```

### 3. Renewal

User clicks "Keep Playing" in popup:

```javascript
POST /api/v1/activity/token/renew
→ Extends expiration by 20 minutes
→ Updates cookie expiration
→ Increments renewal count
```

### 4. Expiration

When token expires:

```javascript
// Automatic cleanup via cron (every 15 minutes)
cleanupExpiredTokens()
→ Marks expired tokens as inactive
→ Deletes tokens older than 7 days
```

## API Reference

### Create Token

```http
POST /api/v1/activity/token/create
Content-Type: application/json

{
  "characterId": "507f1f77bcf86cd799439011"
}

Response:
{
  "success": true,
  "message": "Activity token created",
  "expiresAt": "2025-10-28T15:30:00.000Z",
  "characterId": "507f1f77bcf86cd799439011",
  "character": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Zara",
    "level": 5
  }
}
```

### Validate Token

```http
POST /api/v1/activity/token/validate

Response:
{
  "valid": true,
  "userId": "507f191e810c19729de860ea",
  "characterId": "507f1f77bcf86cd799439011",
  "expiresAt": "2025-10-28T15:30:00.000Z",
  "timeRemaining": 1200000,
  "shouldWarn": false
}
```

### Renew Token

```http
POST /api/v1/activity/token/renew

Response:
{
  "success": true,
  "message": "Activity token renewed",
  "expiresAt": "2025-10-28T15:50:00.000Z",
  "renewalCount": 1
}
```

### Get Token Status

```http
GET /api/v1/activity/token/status

Response:
{
  "hasToken": true,
  "active": true,
  "expiresAt": "2025-10-28T15:30:00.000Z",
  "timeRemaining": 900000,
  "shouldWarn": false,
  "characterId": "507f1f77bcf86cd799439011",
  "character": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Zara",
    "level": 5
  }
}
```

### Invalidate Token

```http
POST /api/v1/activity/token/invalidate

Response:
{
  "success": true,
  "message": "Activity token invalidated"
}
```

### Switch Character

```http
POST /api/v1/activity/character/switch
Content-Type: application/json

{
  "characterId": "507f1f77bcf86cd799439012"
}

Response:
{
  "success": true,
  "message": "Character switched",
  "expiresAt": "2025-10-28T15:30:00.000Z",
  "character": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "Nova",
    "level": 3
  }
}
```

## Client-Side Implementation

### Activity Monitor

The `ActivityMonitor` class runs on game pages (galactic map, system map):

```javascript
// Auto-initialized on page load
const monitor = new ActivityMonitor();
monitor.init();

// Checks token status every 30 seconds
// Shows popup when < 2 minutes remaining
// Handles renewal requests
// Redirects on expiration
```

### Keep Playing Popup

Automatically shown when session has < 2 minutes remaining:

- **Title:** "Session Expiring Soon"
- **Message:** Shows time remaining
- **Actions:**
  - "Keep Playing" - Renews session (+20 min)
  - "Return to Character Selection" - Logs out

### Toast Notifications

- Success: Green toast on renewal
- Error: Red toast on failure
- Auto-dismiss after 3 seconds

## Middleware Usage

### Protected Routes

Use `requireActivityToken` middleware on routes that need active sessions:

```javascript
import { requireActivityToken } from './middlewares/activityToken.js';

// Protect galactic map route
router.get('/universe/galactic-map-3d',
  requireActivityToken,
  (req, res) => {
    // req.activityToken contains validated token info
    res.render('universe/galactic-map-3d');
  }
);
```

### Optional Validation

Use `optionalActivityToken` for routes that adapt based on session:

```javascript
import { optionalActivityToken } from './middlewares/activityToken.js';

router.get('/dashboard',
  optionalActivityToken,
  (req, res) => {
    // req.activityToken is null if no valid session
    const hasActiveSession = !!req.activityToken;
    res.render('dashboard', { hasActiveSession });
  }
);
```

## Duplicate Prevention

### Problem Solved

Before activity tokens, users could:
- Open multiple tabs with same character
- Have conflicting state updates
- Experience race conditions in movement/actions

### Solution

1. **Single Token Per Character:** Only one active token allowed per character
2. **Automatic Invalidation:** Creating new session invalidates old ones
3. **Strict Validation:** All game actions require valid token
4. **Character Lock:** Token validates character ownership

### Edge Cases Handled

- Multiple browser tabs → Only newest session remains valid
- Browser refresh → Token persists via cookie
- Network interruption → Token validated on reconnect
- Server restart → Tokens persisted in MongoDB
- Token expiry during action → Graceful redirect to character selection

## Configuration

### Token Duration

```javascript
// utilities/activityTokens.js
const TOKEN_DURATION_MS = 20 * 60 * 1000;  // 20 minutes
const WARNING_THRESHOLD_MS = 18 * 60 * 1000;  // 18 minutes
```

### Check Interval

```javascript
// public/javascripts/activity-monitor.js
this.CHECK_INTERVAL_MS = 30000;  // Check every 30 seconds
this.WARNING_THRESHOLD_MS = 2 * 60 * 1000;  // Warn at 2 min remaining
```

### Cleanup Schedule

```javascript
// plugins/cron/index.js
// Runs every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await cleanupExpiredTokens();
});
```

## Testing

### Manual Testing Checklist

- [ ] Select character → Token created
- [ ] Play for 18 minutes → Popup appears
- [ ] Click "Keep Playing" → Session extended
- [ ] Wait for expiration → Redirected to character selection
- [ ] Open two tabs → Old tab becomes invalid
- [ ] Refresh page → Session persists
- [ ] Switch character → Old token invalidated
- [ ] Logout → Token invalidated

### API Testing

```bash
# Create token
curl -X POST http://localhost:3399/api/v1/activity/token/create \
  -H "Content-Type: application/json" \
  -d '{"characterId": "507f1f77bcf86cd799439011"}' \
  --cookie-jar cookies.txt

# Check status
curl http://localhost:3399/api/v1/activity/token/status \
  --cookie cookies.txt

# Renew token
curl -X POST http://localhost:3399/api/v1/activity/token/renew \
  --cookie cookies.txt

# Invalidate
curl -X POST http://localhost:3399/api/v1/activity/token/invalidate \
  --cookie cookies.txt
```

## Troubleshooting

### Token Not Created

**Problem:** Character selection doesn't create token
**Solution:** Check `/api/v1/characters/:id/set-active` endpoint logs

### Popup Not Appearing

**Problem:** Warning popup doesn't show
**Solution:**
1. Check browser console for errors
2. Verify `activity-monitor.js` loaded
3. Check token status: `/api/v1/activity/token/status`

### Constant Redirects

**Problem:** User redirected to character selection immediately
**Solution:**
1. Check cookie settings (httpOnly, secure, sameSite)
2. Verify token in cookies
3. Check MongoDB for active tokens

### Cleanup Not Running

**Problem:** Old tokens accumulating
**Solution:**
1. Check cron job status: `GET /admin/api/cron/status`
2. Verify cron initialized in `app.js`
3. Check server logs for cleanup messages

## Performance Considerations

### Database Impact

- Indexes on all query fields (minimal overhead)
- Cleanup runs every 15 minutes (low frequency)
- Validation queries use indexed fields (fast lookups)

### Client Impact

- Status check every 30 seconds (minimal bandwidth)
- Popup only shown once per session (no spam)
- Token stored in httpOnly cookie (no localStorage overhead)

### Server Impact

- Token validation cached in request object
- MongoDB connection pooling handles concurrent checks
- Cron cleanup batches operations

## Security Features

1. **HttpOnly Cookies:** Prevents XSS attacks
2. **Cryptographic Tokens:** 32-byte random hex (256-bit entropy)
3. **Expiration Enforcement:** Automatic invalidation
4. **Character Ownership:** Validated on every request
5. **CSRF Protection:** SameSite cookie attribute
6. **Unique Tokens:** Collision-resistant generation

## Future Enhancements

- [ ] Activity tracking (mouse/keyboard events)
- [ ] Configurable timeout per user preference
- [ ] Session analytics (average session length)
- [ ] Multi-device session management
- [ ] Token refresh without popup (background renewal)
- [ ] WebSocket-based real-time validation
- [ ] Rate limiting on renewal attempts

## Maintenance

### Weekly Tasks

- Review cleanup logs for anomalies
- Monitor token creation rate
- Check average session duration

### Monthly Tasks

- Analyze renewal patterns
- Review database indexes performance
- Update documentation if needed

## Related Systems

- **Character Session** (`middlewares/characterSession.js`) - Loads active character
- **Authentication** (`plugins/passport/`) - User login system
- **Socket.IO** - Real-time game events (future integration)

## Version History

### v1.0.0 (October 28, 2025)

- Initial implementation
- 20-minute token duration
- "Keep Playing" popup
- Cron-based cleanup
- Duplicate prevention
- Character selection integration

---

**Documentation Last Updated:** October 28, 2025
**Maintained By:** Development Team
**Questions:** See project README or submit issue
