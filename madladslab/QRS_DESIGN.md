# QRS (QR Code System) - Complete Design Document

## Overview

QRS is a comprehensive QR code management system with dynamic tracking, analytics, and customization features. It allows users to create, manage, and track QR codes with detailed analytics.

## Features

### Core Features
1. **Static & Dynamic QR Codes**
   - Static: Traditional QR codes with fixed content
   - Dynamic: Trackable QR codes with short URLs that can be updated

2. **QR Code Customization**
   - Custom colors (foreground/background)
   - Multiple sizes and margins
   - Error correction levels (L, M, Q, H)
   - Logo embedding support
   - Multiple export formats (PNG, SVG)

3. **Content Types**
   - URL
   - Plain text
   - Email
   - Phone/SMS
   - WiFi credentials
   - vCard contact
   - Location
   - Calendar event

4. **Analytics & Tracking**
   - Total scans
   - Unique scans (session-based)
   - Geographic location tracking
   - Device type detection
   - Browser/OS detection
   - Time-based analytics
   - UTM parameter tracking
   - Referrer tracking

5. **Organization**
   - Categories (marketing, event, product, menu, contact, payment, social, other)
   - Tags for flexible organization
   - Status management (active, paused, archived, expired)
   - Expiration dates

## Architecture

### Database Models

#### QRCode Model
Location: `/srv/madladslab/api/v1/models/qrs/QRCode.js`

**Schema:**
```javascript
{
  name: String,
  description: String,
  content: String,  // The actual content/URL in the QR code
  contentType: Enum,  // url, text, email, phone, etc.
  shortCode: String,  // Unique 6-char code for dynamic QRs
  shortUrl: String,  // Full short URL (e.g., domain.com/q/abc123)
  destinationUrl: String,  // Where the QR redirects (for dynamic)
  isDynamic: Boolean,
  customization: {
    foregroundColor: String,
    backgroundColor: String,
    logo: String,
    size: Number,
    margin: Number,
    errorCorrectionLevel: String
  },
  category: String,
  tags: [String],
  status: Enum,  // active, paused, archived, expired
  expiresAt: Date,
  createdBy: ObjectId (User ref),
  stats: {
    totalScans: Number,
    uniqueScans: Number,
    lastScannedAt: Date
  },
  metadata: Map
}
```

**Key Methods:**
- `generateShortCode()` - Static method to create unique 6-char codes
- `recordScan(isUnique)` - Update scan statistics
- `isValid()` - Check if QR code is active and not expired

#### QRScan Model
Location: `/srv/madladslab/api/v1/models/qrs/QRScan.js`

**Schema:**
```javascript
{
  qrCode: ObjectId (QRCode ref),
  scannedAt: Date,
  userId: ObjectId (User ref, optional),
  sessionId: String,
  fingerprint: String,  // SHA256 hash of user agent + IP
  location: {
    ip: String,
    country: String,
    region: String,
    city: String,
    latitude: Number,
    longitude: Number,
    timezone: String
  },
  device: {
    type: Enum,  // mobile, tablet, desktop, unknown
    os: String,
    osVersion: String,
    browser: String,
    browserVersion: String,
    userAgent: String
  },
  referrer: String,
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },
  metadata: Map
}
```

**Key Methods:**
- `getStatsByQRCode(qrCodeId, dateFrom, dateTo)` - Aggregate analytics
- `isUniqueScan(qrCodeId, sessionId)` - Check if scan is unique

### API Endpoints

Base URL: `/api/v1/qrs`

#### QR Code Management

**GET /api/v1/qrs**
- List all QR codes for authenticated user
- Query params: `status`, `category`, `search`, `page`, `limit`, `sortBy`, `sortOrder`
- Returns: Paginated list of QR codes

**GET /api/v1/qrs/:id**
- Get single QR code details
- Requires: User must own the QR code

**POST /api/v1/qrs**
- Create new QR code
- Body: `name`, `description`, `content`, `contentType`, `isDynamic`, `destinationUrl`, `customization`, `category`, `tags`, `expiresAt`
- Auto-generates `shortCode` for dynamic QR codes

**PUT /api/v1/qrs/:id**
- Update QR code (name, description, destination URL, customization, etc.)
- Cannot change: `content` (for static), `shortCode`, `isDynamic`

**DELETE /api/v1/qrs/:id**
- Delete QR code and all associated scans

#### QR Code Generation

**GET /api/v1/qrs/:id/image**
- Generate QR code image
- Query params: `format` (png or svg)
- Returns: Image file with proper content-type

#### Analytics

**GET /api/v1/qrs/:id/analytics**
- Get detailed analytics for a QR code
- Query params: `dateFrom`, `dateTo`
- Returns: Total scans, unique scans, breakdowns by country/device/time

**GET /api/v1/qrs/analytics/overview**
- Get overview analytics for all user's QR codes
- Returns: Total QR codes, active count, total scans, top QR codes

#### Batch Operations

**POST /api/v1/qrs/batch**
- Create multiple QR codes at once
- Body: `{ qrCodes: [...] }`
- Returns: Created QR codes and any errors

### Routes (Frontend)

Base URL: `/qrs`

**GET /qrs**
- Dashboard with list of QR codes and stats
- Requires authentication

**GET /qrs/create**
- Form to create new QR code
- (View needs to be created)

**GET /qrs/:id**
- View single QR code with preview and recent scans
- (View needs to be created)

**GET /qrs/:id/analytics**
- Detailed analytics page with charts
- (View needs to be created)

**GET /qrs/qr.png** (Legacy)
- Quick QR code generator
- Query params: `text`, `size`, `margin`

**GET /qrs/qr.svg** (Legacy)
- Quick QR code generator (SVG)
- Query params: `text`, `size`, `margin`

### Short URL Handler

Base URL: `/q`

**GET /q/:shortCode**
- Redirect to destination URL
- Tracks scan with:
  - Device info (parsed from User-Agent)
  - IP geolocation (needs integration)
  - Session fingerprinting
  - UTM parameters
  - Referrer
- Updates QR code statistics
- Handles invalid/expired QR codes

## Setup Instructions

### 1. Install Dependencies

```bash
cd /srv/madladslab
npm install ua-parser-js
```

### 2. Environment Variables

Add to `.env`:
```
BASE_URL=https://yourdomain.com
DB_URL=mongodb://localhost:27017/madladslab
```

### 3. Database Indexes

The models automatically create indexes on startup. Ensure MongoDB is running.

### 4. Optional: IP Geolocation

For production, integrate an IP geolocation service:
- MaxMind GeoIP2
- ipapi.co
- ip-api.com

Update `/srv/madladslab/routes/q/index.js` to populate location data.

## Usage Examples

### Create a Static QR Code (API)

```javascript
POST /api/v1/qrs
{
  "name": "My Website",
  "content": "https://example.com",
  "contentType": "url",
  "isDynamic": false,
  "category": "marketing"
}
```

### Create a Dynamic QR Code (API)

```javascript
POST /api/v1/qrs
{
  "name": "Campaign Landing Page",
  "description": "Summer 2025 Campaign",
  "destinationUrl": "https://example.com/summer-sale",
  "contentType": "url",
  "isDynamic": true,
  "category": "marketing",
  "tags": ["campaign", "summer"],
  "customization": {
    "foregroundColor": "#FF0000",
    "size": 512
  }
}
```

Response includes `shortCode` and `shortUrl`:
```javascript
{
  "shortCode": "aB3xY9",
  "shortUrl": "https://yourdomain.com/q/aB3xY9",
  "content": "https://yourdomain.com/q/aB3xY9",  // This is what's in the QR code
  "destinationUrl": "https://example.com/summer-sale",  // This is where it redirects
  ...
}
```

### Update Destination URL

```javascript
PUT /api/v1/qrs/:id
{
  "destinationUrl": "https://example.com/winter-sale"
}
```

The QR code stays the same, but now redirects to the new URL!

### Get Analytics

```javascript
GET /api/v1/qrs/:id/analytics?dateFrom=2025-01-01&dateTo=2025-12-31
```

Returns:
```javascript
{
  "qrCode": {
    "id": "...",
    "name": "Campaign Landing Page",
    "status": "active"
  },
  "stats": {
    "total": 1234,
    "unique": 567,
    "byCountry": [
      { "_id": "USA", "count": 800 },
      { "_id": "Canada", "count": 234 }
    ],
    "byDevice": [
      { "_id": "mobile", "count": 900 },
      { "_id": "desktop", "count": 334 }
    ],
    "byHour": [
      { "_id": 0, "count": 45 },
      { "_id": 1, "count": 23 },
      ...
    ]
  },
  "recentScans": [...]
}
```

## Frontend Views TODO

The following views need to be created:

1. **Create QR Code Form** (`/views/qrs/create.ejs`)
   - Form with all QR code options
   - Live preview of QR code
   - Color pickers for customization

2. **QR Code Detail View** (`/views/qrs/detail.ejs`)
   - Display QR code image
   - Show short URL (if dynamic)
   - Quick stats
   - Recent scans table
   - Edit/Delete actions

3. **Analytics Dashboard** (`/views/qrs/analytics.ejs`)
   - Charts for scans over time
   - Device type pie chart
   - Geographic map
   - Top referrers

## Security Considerations

1. **Authentication**: All API endpoints require authentication
2. **Authorization**: Users can only access their own QR codes
3. **Rate Limiting**: Consider adding rate limiting to prevent abuse
4. **Session Security**: Sessions use fingerprinting to track unique scans
5. **URL Validation**: Validate destination URLs to prevent XSS
6. **Short Code Uniqueness**: Automatically generates unique 6-character codes

## Performance Optimizations

1. **Indexes**: Database indexes on frequently queried fields
2. **Async Tracking**: Scan tracking doesn't block redirects
3. **Cached Stats**: QR code stats cached in document
4. **Lean Queries**: Use `.lean()` for read-only operations

## Future Enhancements

1. **Bulk Import/Export**: CSV import for batch creation
2. **QR Code Templates**: Pre-designed templates
3. **API Rate Limiting**: Per-user API quotas
4. **Webhook Notifications**: Alert on scan milestones
5. **A/B Testing**: Multiple destinations with split traffic
6. **Password Protection**: Require password to access QR destination
7. **Schedule URLs**: Change destination URL on schedule
8. **White Labeling**: Custom domains for short URLs

## File Structure

```
/srv/madladslab/
├── api/
│   └── v1/
│       ├── ep/
│       │   └── qrs.js                 # API endpoints
│       └── models/
│           └── qrs/
│               ├── QRCode.js          # QR code model
│               └── QRScan.js          # Scan tracking model
├── routes/
│   ├── qrs/
│   │   └── index.js                   # Frontend routes
│   └── q/
│       └── index.js                   # Short URL redirects
└── views/
    └── qrs/
        ├── index.ejs                  # Dashboard (✓ Complete)
        ├── create.ejs                 # Create form (TODO)
        ├── detail.ejs                 # QR code detail (TODO)
        └── analytics.ejs              # Analytics dashboard (TODO)
```

## Testing

### Test QR Code Scanning

1. Create a dynamic QR code via API
2. Generate the QR image: `/api/v1/qrs/:id/image?format=png`
3. Scan with phone or visit short URL: `/q/:shortCode`
4. Check analytics: `/api/v1/qrs/:id/analytics`

### Test Legacy Generator

```
/qrs/qr.png?text=https://example.com&size=512
```

## Support

For issues or questions:
- Check server logs in `/srv/madladslab/logs/`
- MongoDB logs for database issues
- Browser console for frontend errors
