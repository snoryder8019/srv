# Linode Bucket Upload Manager

A standalone tool for managing file uploads to Linode Object Storage with full CRUD operations, metadata editing, and directory management.

## 🎯 Features

### Core Functionality
- ✅ **Upload Files** - Drag & drop or click to browse (multi-file support)
- ✅ **Directory Tree** - Visual tree of all buckets matching `/srv` apps
- ✅ **Metadata Editing** - Title, description, tags, visibility
- ✅ **Asset Management** - View, search, filter, delete
- ✅ **Subdirectory Creation** - Organize files within buckets
- ✅ **Confirmation Alerts** - All destructive actions require confirmation
- ✅ **MongoDB Tracking** - All uploads tracked in Asset collection

### Bucket Structure
Files are organized by app (matching your `/srv` directory):
```
your-linode-bucket/
├── madladslab/      # Main site assets
├── acm/             # ACM Creative assets
├── sna/             # Some New Article assets
├── twww/            # World Wide Wallet assets
├── ps/              # Project Stringborne assets
├── graffiti-tv/     # Graffiti TV assets
├── nocometalworkz/  # NoCo Metal assets
├── sfg/             # SFG assets
├── madThree/        # MadThree assets
├── w2MongoClient/   # W2 Client assets
└── servers/         # Servers dashboard assets
```

## 🚀 Access

**URL:** `https://madladslab.com/bucketUpload`

**Access:** Admin users only (requires `user.isAdmin === true`)

**Navigation:** Admin footer → "🪣 Bucket Manager"

## 📁 File Structure

```
madladslab/
├── api/v1/
│   ├── models/
│   │   └── Asset.js ........................ MongoDB model
│   └── ep/
│       └── bucketUpload.js ................. API endpoints
├── routes/
│   └── bucketUpload/
│       └── index.js ........................ Route handler
├── views/
│   └── bucketUpload/
│       └── index.ejs ....................... Main UI
├── public/javascripts/
│   └── bucketManager.js .................... Client-side logic
└── lib/
    └── linodeStorage.js .................... Linode SDK wrapper
```

## 🔌 API Endpoints

All endpoints are prefixed with `/api/v1/bucket/`

### Upload
- `POST /upload` - Upload files (multipart/form-data)
  - Body: files[], bucket, subdirectory, visibility, tags

### Assets
- `GET /assets` - List assets with filters
  - Query: bucket, subdirectory, fileType, search, limit, skip
- `GET /asset/:id` - Get single asset
- `PUT /asset/:id` - Update metadata
- `DELETE /asset/:id` - Delete asset
- `POST /asset/:id/move` - Move to different directory

### Directories
- `GET /directories` - Get directory tree with file counts
- `POST /directory` - Create new subdirectory

### Stats
- `GET /stats` - Get storage statistics

## 📊 Asset Model Schema

```javascript
{
  filename: String,           // Generated unique name
  originalName: String,       // Original upload name
  bucket: String,             // madladslab, acm, sna, etc.
  subdirectory: String,       // Optional subdirectory
  bucketPath: String,         // Full path: bucket/subdir/filename
  publicUrl: String,          // Linode CDN URL

  fileType: String,           // image/video/object/document/other
  mimeType: String,           // image/jpeg, video/mp4, etc.
  size: Number,               // File size in bytes
  dimensions: {               // For images/videos
    width: Number,
    height: Number
  },

  // User-editable metadata
  title: String,
  description: String,
  tags: [String],

  // Optional linking to other MongoDB objects
  linkedTo: {
    model: String,            // 'Recipe', 'Brand', etc.
    id: ObjectId,
    field: String             // 'image', 'logo', etc.
  },

  visibility: String,         // public/private
  uploadedBy: ObjectId,       // User reference
  uploadedAt: Date,
  updatedAt: Date
}
```

## 🎨 UI Features

### Directory Tree (Left Panel)
- Hierarchical view of all buckets
- File counts per directory
- Click to select and view assets
- Create subdirectory button

### Asset Grid (Center Panel)
- **Upload Zone** - Drag & drop or click to browse
- **Search** - Real-time search across filenames, titles, descriptions, tags
- **Grid View** - Thumbnail preview for images, icons for other types
- **Infinite Scroll** - Pagination support

### Detail Panel (Right Panel)
- **Preview** - Image/video preview or file type icon
- **Metadata Editor**:
  - Title (optional)
  - Description (optional)
  - Tags (comma-separated)
  - Visibility (public/private)
- **Public URL** - Copy to clipboard button
- **File Info** - Type, size, mime type
- **Actions**:
  - Save Changes (with confirmation)
  - Delete Asset (with double confirmation)

## ⚠️ Confirmation Alerts

All destructive actions require user confirmation:

### Save Metadata
```
💾 Save changes to this asset?
[OK] [Cancel]
```

### Delete Asset
```
🗑️ Are you sure you want to DELETE this asset?

"filename.jpg"

This action CANNOT be undone!
[OK] [Cancel]
```

### Create Directory
```
📁 Create subdirectory "madladslab/images"?
[OK] [Cancel]
```

### Upload Files
```
✅ Uploaded 3 file(s) successfully!
```

### Error Alerts
```
❌ Error: Failed to upload file
```

## 🔧 Configuration

### Environment Variables

Required in `/srv/madladslab/.env`:

```bash
# Linode Object Storage (Chicago, IL - us-ord-1)
S3_LOCATION=your-bucket-name
LINODE_ACCESS=your-access-key
LINODE_SECRET=your-secret-key
```

### Supported File Types

**Images:** jpg, jpeg, png, gif, webp, svg
**Videos:** mp4, mov, webm, avi
**3D Objects:** obj, gltf, glb, fbx, dae
**Documents:** pdf

### File Size Limits

- Maximum: 100MB per file
- Enforced by multer middleware

## 🎯 Usage Examples

### Upload Files
1. Select a bucket from the tree (e.g., "madladslab")
2. Drag files onto the upload zone or click to browse
3. Files upload automatically
4. View uploaded files in the grid

### Edit Metadata
1. Click any asset card in the grid
2. Detail panel opens on the right
3. Edit title, description, tags, visibility
4. Click "Save Changes"
5. Confirm with alert popup

### Create Subdirectory
1. Click "+ Create Subdirectory" button
2. Select bucket from dropdown
3. Enter subdirectory name (e.g., "images", "videos", "logos")
4. Click "Create"
5. New directory appears in tree after first upload

### Delete Asset
1. Click asset to open detail panel
2. Click "🗑 Delete Asset" button
3. Confirm deletion in alert popup
4. Asset removed from bucket and database

### Search Assets
1. Type in search box (top right)
2. Searches across:
   - Original filename
   - Title
   - Description
   - Tags
3. Results update in real-time

## 🔐 Security

- ✅ **Authentication Required** - Must be logged in
- ✅ **Admin Only** - Only users with `isAdmin === true`
- ✅ **File Type Validation** - Server and client-side
- ✅ **Size Limits** - 100MB max per file
- ✅ **Unique Filenames** - Timestamp + random hash prevents collisions
- ✅ **XSS Prevention** - All inputs sanitized

## 📈 Statistics

Dashboard header shows:
- **Total Assets** - Count of all uploads
- **Storage Used** - Total bytes in human-readable format

Available via `/api/v1/bucket/stats`:
- Total assets
- Total size
- Breakdown by bucket
- Breakdown by file type

## 🐛 Troubleshooting

### "Linode Object Storage not configured"
- Check `.env` file has all three variables set
- Restart madladslab service
- Test with: `node test-linode-config.js`

### Upload fails
- Check file type is supported
- Verify file size is under 100MB
- Check Linode credentials are correct
- View browser console for errors

### Assets not loading
- Check network tab for API errors
- Verify bucket is selected in tree
- Check MongoDB connection

### Directory tree empty
- Ensure MongoDB is connected
- Upload a file to populate tree
- Check `/api/v1/bucket/directories` endpoint

## 🚦 Next Steps

1. **Set up Linode credentials** (see [LINODE_SETUP.md](LINODE_SETUP.md))
2. **Restart madladslab** service
3. **Login as admin** user
4. **Navigate to** `/bucketUpload`
5. **Select a bucket** and start uploading!

## 📝 Notes

- Files are stored in Linode Object Storage (Chicago region)
- MongoDB tracks all uploads in `Asset` collection
- Public URLs are CDN-backed for fast delivery
- Directory structure mirrors your `/srv` apps
- All admin actions require confirmation alerts
- Search is case-insensitive and searches all metadata fields

---

**Created:** November 8, 2025
**Version:** 1.0.0
**Author:** Claude + Your MadLabs Team
