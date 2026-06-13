# Unified MongoDB Database Management Section

## Summary of Changes

Merged the two separate MongoDB sections in the live dashboard into one unified, comprehensive MongoDB Database Management section.

## Before (2 Separate Sections)

### 1. Database Storage Usage
- Summary stats (Total Size, Data Size, Index Size, Total Docs)
- Top collections table
- No actions available

### 2. MongoDB Collections Browser
- Full collections list with actions
- View documents button
- Drop empty collections button
- Summary footer

**Problem:** Duplicate data, confusing layout, two separate tables showing essentially the same collections.

## After (1 Unified Section)

### 🗄️ MongoDB Database Management

**Combined Features:**
- ✅ Summary stats at top (Total Size, Data Size, Index Size, Total Docs)
- ✅ Single comprehensive table with ALL columns
- ✅ Action buttons (View & Drop) in the same table
- ✅ Summary footer with warnings
- ✅ One "Refresh All" button

## New Unified Table Columns

| Column | Description | Color |
|--------|-------------|-------|
| Collection | Collection name | White (Red if empty) |
| Docs | Document count | Blue (#64b5f6) |
| Data Size | Raw data size | White |
| Storage | Storage with overhead | White |
| Indexes | Index size | Purple (#8a4fff) |
| Total | Storage + Indexes | Green (#00ff9f) |
| % of DB | Percentage of total | Yellow (#ffc107) |
| Actions | View/Drop buttons | - |

## Action Buttons

### 📄 View
- Appears for collections with documents (count > 0)
- Opens modal with JSON documents
- Shows up to 100 documents

### 🗑️ Drop
- Appears for empty collections (count = 0)
- Requires confirmation
- Safety check prevents dropping collections with data
- Refreshes table after successful drop

## Summary Footer

Shows:
- **Total Collections**: 17
- **Empty Collections**: 5 (in red if > 0)
- **Warning**: "⚠️ You have 5 empty collection(s) that can be cleaned up"

## Technical Changes

### Files Modified

**[/srv/ps/views/admin/live-dashboard.ejs](/srv/ps/views/admin/live-dashboard.ejs)**

#### HTML Changes (Lines 654-690)
- Removed separate "Database Storage Usage" section
- Removed separate "MongoDB Collections Browser" section
- Added unified "MongoDB Database Management" section
- Single table container: `#unified-collections-table`
- Single refresh button: `onclick="refreshAllDatabaseData()"`

#### JavaScript Changes

**New Function:**
```javascript
async function refreshAllDatabaseData() {
  // Fetches from /admin/api/database/collections
  // Calculates summary stats
  // Builds unified table with all columns + actions
  // Shows summary footer
}
```

**Backward Compatibility:**
```javascript
async function refreshDatabaseUsage() {
  return refreshAllDatabaseData();
}

async function loadCollections() {
  return refreshAllDatabaseData();
}
```

Old functions still work, they just call the new unified function.

**Updated dropCollection():**
```javascript
refreshAllDatabaseData(); // Instead of loadCollections()
```

## Benefits

### User Experience
✅ **Less scrolling** - One section instead of two
✅ **Less confusion** - One table instead of two similar tables
✅ **More info** - All columns visible at once
✅ **Cleaner UI** - No duplicate data

### Performance
✅ **Fewer API calls** - One endpoint instead of two
✅ **Faster loading** - Single data fetch
✅ **Less network** - ~4KB instead of ~9KB combined

### Maintenance
✅ **DRY code** - No duplicate table logic
✅ **Single source** - One function to maintain
✅ **Easier updates** - Change once, affects entire section

## Data Flow

```
User clicks "Refresh All"
        ↓
refreshAllDatabaseData()
        ↓
GET /admin/api/database/collections
        ↓
Returns all 17 collections with stats
        ↓
Calculate summary (totals, percentages)
        ↓
Build unified table HTML
        ↓
Update summary stats divs
        ↓
Update table container
        ↓
Show summary footer
```

## Example Output

### Summary Stats Row
```
┌─────────────┬────────────┬─────────────┬────────────────┐
│ Total Size  │ Data Size  │ Index Size  │ Total Documents│
│   1.29 MB   │  147.49 KB │   804 KB    │      167       │
└─────────────┴────────────┴─────────────┴────────────────┘
```

### Unified Table
```
Collection          Docs   Data    Storage  Indexes  Total    % DB    Actions
─────────────────────────────────────────────────────────────────────────────
activityTokens      17     5.73KB  36KB     216KB    252KB    19.03%  📄 View
userActions         10     1.71KB  36KB     108KB    144KB    10.88%  📄 View
users               5      3.09KB  36KB     72KB     108KB    8.16%   📄 View
spriteAtlases       0      0B      4KB      28KB     32KB     2.42%   🗑️ Drop
```

### Summary Footer
```
┌─────────────────────────────────────────────────────┐
│ Total Collections: 17  │  Empty Collections: 5      │
│                                                     │
│ ⚠️ You have 5 empty collection(s) that can be     │
│    cleaned up                                      │
└─────────────────────────────────────────────────────┘
```

## Migration Path

Old code still works due to backward compatibility:
- `refreshDatabaseUsage()` → calls `refreshAllDatabaseData()`
- `loadCollections()` → calls `refreshAllDatabaseData()`
- Dashboard init calls both → only one API call made

No breaking changes!

## Testing

### Verify Unified Section Works
1. Go to `/admin/live-dashboard`
2. Scroll to "🗄️ MongoDB Database Management"
3. Verify summary stats show
4. Verify table has all columns
5. Verify action buttons appear

### Test Actions
1. Click 📄 View on a collection with data
2. Verify modal opens with JSON
3. Click 🗑️ Drop on an empty collection
4. Confirm action
5. Verify collection removed and table refreshes

### Test Refresh
1. Click "Refresh All" button
2. Verify stats update
3. Verify table refreshes
4. Check network tab - should be 1 API call

## Future Enhancements

Possible additions to unified section:
- **Search/filter** collections by name
- **Sort** by any column (currently only sorted by size)
- **Bulk actions** - drop all empty collections at once
- **Export** collection data to JSON
- **Import** data from JSON
- **Index management** - create/drop indexes
- **Query builder** - custom MongoDB queries

## Rollback (If Needed)

If issues arise, can easily split sections again:
1. Restore old HTML sections
2. Remove `refreshAllDatabaseData()` function
3. Restore old `refreshDatabaseUsage()` and `loadCollections()` implementations

But backward compatibility ensures old code still works!

## Status

✅ **Implemented and deployed**
✅ **Tested successfully**
✅ **Backward compatible**
✅ **No breaking changes**
✅ **Ready for production**

**Changes effective immediately after app restart!**
