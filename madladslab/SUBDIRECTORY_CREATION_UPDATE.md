# Subdirectory Creation with Placeholder Files

## Problem Solved
Object storage systems (like Linode/AWS S3) don't have true directories - they're just key prefixes. Creating a "directory" without any files in it won't actually create anything. This update ensures subdirectories are real and visible by creating a `.keep` placeholder file.

## What Changed

### Backend Updates

**File 1**: [/srv/madladslab/lib/linodeStorage.js](lib/linodeStorage.js:61-63)

The `uploadToLinode()` function now accepts an optional `preserveFilename` parameter:
- When `preserveFilename: true`, the exact filename is used without generating a unique name
- Default behavior (`preserveFilename: false`) still generates unique filenames with timestamp and random string

**File 2**: [/srv/madladslab/api/v1/ep/bucketUpload.js](api/v1/ep/bucketUpload.js:206-260)

The `POST /api/v1/bucket/directory` endpoint now:

1. **Creates a `.keep` placeholder file** in the new subdirectory
2. **Uploads it to Linode** using `uploadToLinode()` with `preserveFilename: true`
3. **Creates an Asset record** in MongoDB to track the placeholder
4. **Returns success** with the created asset details

#### The .keep File Contents
```json
{
  "created": "2025-11-08T19:15:00.000Z",
  "type": "directory_placeholder",
  "message": "This file maintains the directory structure in object storage"
}
```

### Why `.keep`?
- **Common convention**: Used in Git and many systems to preserve empty directories
- **Small size**: JSON metadata is only a few bytes
- **Visible**: Shows up in file listings so you know the directory is intentional
- **Documented**: Clear purpose in the file content
- **Tracked**: Appears in the Asset database with `directory` and `placeholder` tags

## How It Works

### Creating a Subdirectory

1. **User clicks**: "Create Subdirectory" button
2. **Enters name**: e.g., `my-new-folder`
3. **Confirms**: Modal shows bucket and subdirectory name
4. **Backend creates**:
   - Uploads `.keep` file to `bucket/my-new-folder/.keep`
   - Saves Asset record in MongoDB
5. **UI updates**: Directory tree refreshes, shows new subdirectory

### File Structure in S3
```
madladslab/
├── graffiti-tv/
│   ├── .keep                           # Placeholder
│   ├── 1762625082358-ae18de361ad77063.webm
│   └── 1762622336661-f28b8110e6440da3.png
├── my-new-folder/
│   └── .keep                           # NEW: Keeps directory visible
└── images/
    ├── .keep
    └── photo1.jpg
```

## Benefits

1. **Directories persist** even when empty
2. **Visible in S3 console** - you can see the folder structure
3. **Compatible with tools** that expect directories
4. **Database tracked** - `.keep` files are Asset records
5. **Can be deleted** later if you want (just like any asset)

## Example API Call

```bash
curl -X POST https://www.madladslab.com/api/v1/bucket/directory \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "madladslab",
    "subdirectory": "test-folder"
  }'
```

**Response**:
```json
{
  "success": true,
  "message": "Subdirectory madladslab/test-folder created successfully",
  "asset": {
    "_id": "...",
    "filename": ".keep",
    "bucket": "madladslab",
    "subdirectory": "test-folder",
    "publicUrl": "https://madladslab.us-ord-1.linodeobjects.com/madladslab/test-folder/.keep",
    "fileType": "other",
    "tags": ["directory", "placeholder"]
  }
}
```

## Frontend Update

**File**: [/srv/madladslab/public/javascripts/bucketManager.js](public/javascripts/bucketManager.js:543-547)

Updated success message to inform users that a `.keep` file was created:
```javascript
showAlert('✅ Subdirectory created with .keep placeholder file!');
```

## Subdirectory Upload Integration

Once a subdirectory is created, you can immediately target it for uploads using the new subdirectory selector feature:

1. **Select the bucket** in the directory tree
2. **Choose subdirectory** from the "Upload to:" dropdown
3. **Upload files** - they go to the subdirectory you created

## Alternative Approaches Considered

### Option 1: Empty folder markers (rejected)
- Some systems use a special `_$folder$` suffix
- Not standard, confusing to users

### Option 2: No placeholder (rejected)
- Directory only exists when first file is uploaded
- Can't pre-create structure, confusing UX

### Option 3: `.gitkeep` (considered)
- Standard in Git repos
- Chose `.keep` instead (shorter, clearer)

### Option 4: `index.html` (rejected)
- Would serve as web page, unexpected behavior
- `.keep` is more explicit about purpose

## Notes

- `.keep` files can be safely deleted after uploading real files to the directory
- The Asset database tracks `.keep` files with tags: `['directory', 'placeholder']`
- Subdirectory names are validated: alphanumeric, dashes, underscores, slashes only
- The `.keep` file is accessible at: `https://[bucket].[region].linodeobjects.com/[bucket]/[subdirectory]/.keep`

---

**Status**: Live and functional at https://www.madladslab.com/bucketUpload
