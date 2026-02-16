# Bucket Upload - Subdirectory Targeting Feature

## Overview
The bucket upload manager now allows you to target specific subdirectories when uploading files, giving you full control over where your assets are stored.

## How It Works

### Subdirectory Selector
When you select a bucket, a dropdown menu appears in the upload zone that shows:
- **Root (no subdirectory)** - Upload directly to the bucket root
- All existing subdirectories for that bucket (e.g., `graffiti-tv`, `images`, `videos`, etc.)

### Using the Feature

1. **Select a Bucket**
   - Click on any bucket in the left sidebar (e.g., `madladslab`, `graffiti-tv`, `ps`)

2. **Choose Target Subdirectory**
   - Look for the "Upload to:" dropdown in the upload zone
   - Select where you want files to go:
     - Choose "Root (no subdirectory)" to upload to the bucket root
     - Or select any existing subdirectory (e.g., `graffiti-tv`)

3. **Upload Files**
   - Drag & drop files OR click to browse
   - Files will be uploaded to your selected location

### Example Scenarios

**Scenario 1: Upload to graffiti-tv subdirectory**
```
1. Select bucket: madladslab
2. Dropdown shows: Root, graffiti-tv, images, videos...
3. Select: graffiti-tv
4. Upload files → They go to madladslab/graffiti-tv/
```

**Scenario 2: Upload to bucket root**
```
1. Select bucket: ps
2. Keep dropdown on: Root (no subdirectory)
3. Upload files → They go to ps/ (root)
```

## Technical Details

### Frontend Changes
- **View**: [/srv/madladslab/views/bucketUpload/index.ejs](bucketUpload/index.ejs)
  - Added `<select id="upload-subdirectory-select">` to upload zone

- **JavaScript**: [/srv/madladslab/public/javascripts/bucketManager.js](public/javascripts/bucketManager.js)
  - Added `updateSubdirectorySelector()` function to populate dropdown
  - Modified `selectDirectory()` to call `updateSubdirectorySelector()`
  - Updated `handleFiles()` to use selected subdirectory from dropdown

### Backend (Already Supported)
The upload API at `/api/v1/bucket/upload` already supported subdirectories via the `subdirectory` form field. This feature just adds the UI control for it.

## Benefits

1. **Organized Storage**: Upload directly to the right folder without manual file moves
2. **Flexible Workflows**: Switch between subdirectories without navigating away
3. **Clear Visibility**: See all available subdirectories at a glance
4. **No Extra Clicks**: Select and upload in one smooth workflow

## URL Structure

When you upload to a subdirectory, files are accessible at:
```
https://[bucket-name].[region].linodeobjects.com/[subdirectory]/[filename]
```

Example:
```
https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv/my-video.webm
```

## Notes

- The dropdown only shows existing subdirectories
- To create a new subdirectory, use the "Create Subdirectory" button in the sidebar
- The currently selected tree item (bucket or subdirectory) is used as the default selection in the dropdown
- Changing the dropdown doesn't navigate to that directory - it only affects where files are uploaded

---

**Status**: Live and functional at https://www.madladslab.com/bucketUpload
