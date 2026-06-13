# Admin Live Dashboard Updates

## Overview
The admin live dashboard has been updated with comprehensive MongoDB database usage analytics and Linode server metrics integration.

## New Features

### 1. MongoDB Database Usage Analytics

**Location:** `/admin/live-dashboard`

**Features:**
- Real-time database storage analysis
- Collection-level statistics (storage size, document count, index size)
- Visual breakdown of top collections by storage usage
- Highlights "grubby" collections taking up excessive space
- Identifies empty collections wasting storage
- Shows index overhead for optimization opportunities

**API Endpoint:** `GET /admin/api/database/usage`

**Standalone Script:** `node scripts/analyze-db-usage.js`

#### Database Metrics Displayed:
- **Total Size**: Combined storage + index size
- **Data Size**: Actual document data size
- **Index Size**: Total index overhead
- **Total Documents**: Document count across all collections

#### Collection Details Table:
- Collection name
- Document count
- Data size
- Storage size
- Index size
- Total size (storage + indexes)
- Percentage of total database

#### Recommendations:
The analysis script automatically identifies:
- Empty collections wasting storage
- Collections with excessive index overhead
- Large collections that may need archiving
- Optimization opportunities

### 2. Linode Server Metrics

**Location:** `/admin/live-dashboard`

**Features:**
- Server plan type and specifications
- Region and status information
- Network I/O metrics (bandwidth in/out) over 24 hours
- Disk I/O metrics over 24 hours
- Real-time charts showing I/O trends

**API Endpoint:** `GET /admin/api/linode/metrics`

**Configuration Required:**
Add these environment variables to your `.env` file:
```bash
LINODE_API_TOKEN=your_linode_api_token_here
LINODE_ID=your_linode_instance_id_here
```

#### Metrics Displayed:
- **Plan Type**: Linode plan (e.g., "g6-nanode-1", "g6-dedicated-2")
- **Region**: Data center location
- **Status**: Instance status (running, stopped, etc.)
- **Network I/O**: Inbound/outbound traffic charts (Mbps)
- **Disk I/O**: Disk operations and swap usage charts (blocks/s)

## Usage

### Accessing the Dashboard
Navigate to: `https://your-domain.com/admin/live-dashboard`

### Manual Refresh
Each section has a "Refresh" button to manually update the data.

### Running Database Analysis Standalone
```bash
cd /srv/ps
node scripts/analyze-db-usage.js
```

This will output a detailed console report with:
- Database overview statistics
- Top 10 largest collections
- Recommendations for optimization

## Implementation Details

### Files Modified:
1. **[/srv/ps/routes/admin/index.js](/srv/ps/routes/admin/index.js)** - Added new API endpoints
   - `GET /admin/api/database/usage` - Database usage analysis
   - `GET /admin/api/linode/metrics` - Linode server metrics

2. **[/srv/ps/views/admin/live-dashboard.ejs](/srv/ps/views/admin/live-dashboard.ejs)** - Updated dashboard UI
   - Added database storage usage section
   - Added Linode server metrics section
   - Added interactive charts for I/O visualization

### Files Created:
1. **[/srv/ps/scripts/analyze-db-usage.js](/srv/ps/scripts/analyze-db-usage.js)** - Database analysis utility
   - Analyzes MongoDB collection sizes
   - Provides optimization recommendations
   - Can be run standalone or imported as a module

## Security Notes

- All endpoints require admin authentication (`isAdmin` middleware)
- Linode API token is stored securely in environment variables
- Database analysis runs with existing database connection permissions

## Performance Considerations

- Database usage analysis queries all collections (may be slow with many collections)
- Linode metrics are cached by Linode's API (typically 5-minute intervals)
- Dashboard auto-refreshes system metrics every 5 seconds (not DB/Linode metrics)

## Troubleshooting

### Database Usage Not Loading
- Check that MongoDB connection is active
- Verify user has permissions to run `collStats` command
- Check browser console for errors

### Linode Metrics Not Available
- Verify `LINODE_API_TOKEN` is set in `.env`
- Verify `LINODE_ID` is set in `.env`
- Check that API token has read permissions for Linode instances
- Check server logs for API errors

### Getting Your Linode Credentials

**API Token:**
1. Log in to Linode Cloud Manager
2. Go to Profile → API Tokens
3. Create a Personal Access Token with "Read Only" access to Linodes

**Linode ID:**
```bash
curl -H "Authorization: Bearer $LINODE_API_TOKEN" \
  https://api.linode.com/v4/linode/instances
```
Look for your instance and note the `id` field.

## Example Output

### Database Analysis (Console)
```
================================================================================
DATABASE OVERVIEW
================================================================================
Database Name: projectStringborne
Total Collections: 18
Total Documents: 167
Data Size: 147.43 KB
Storage Size: 4.55 MB
Index Size: 836 KB
Total Size: 5.37 MB

================================================================================
TOP 10 LARGEST COLLECTIONS
================================================================================
Collection              Documents    Storage      Indexes      Total        % of DB
planetChunks            0            4.04 MB      32 KB        4.07 MB      75.85%
activityTokens          17           36 KB        216 KB       252 KB       4.58%
...
================================================================================
RECOMMENDATIONS
================================================================================
🗑️  planetChunks: Empty collection with 4.04 MB storage - consider dropping
⚠️  activityTokens: Index size exceeds storage size - consider reviewing indexes
```

## Future Enhancements

Potential additions:
- Historical database growth tracking
- Automated cleanup for empty collections
- Index optimization suggestions
- Bandwidth usage alerts
- Linode billing/cost estimates
- Database query performance metrics
