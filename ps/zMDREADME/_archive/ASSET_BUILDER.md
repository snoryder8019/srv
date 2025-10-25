# Asset Builder System

A comprehensive asset creation, approval, and voting system for the Planetary Scapes game.

## Features

### For Authenticated Users
- **Asset Builder** (`/assets`)
  - Create game assets with pixel art editor
  - Upload 3 types of images:
    - Pixel Art (from editor or upload)
    - Fullscreen Artwork (main display)
    - Index Card (thumbnail/card view)
  - Save drafts
  - Submit for admin approval
  - Edit rejected assets
  - Track submission status

### For Admins
- **Approval Interface** (`/admin/assets`)
  - Review pending asset submissions
  - View all uploaded images
  - Approve or reject assets
  - Add notes for users
  - Track statistics (pending, approved, rejected)

### For Community
- **Voting Page** (`/assets/voting`)
  - Browse approved assets
  - Vote for favorites
  - See vote counts
  - Public access (login required to vote)

## Routes

### View Routes
- `GET /assets` - Asset builder page (authenticated)
- `GET /assets/voting` - Community voting page (public)
- `GET /admin/assets` - Admin approval interface (admin only)

### API Routes

#### User Asset APIs
- `GET /api/v1/assets` - Get user's assets
- `GET /api/v1/assets/:id` - Get specific asset
- `POST /api/v1/assets` - Create new asset
- `PUT /api/v1/assets/:id` - Update asset
- `DELETE /api/v1/assets/:id` - Delete asset
- `POST /api/v1/assets/:id/submit` - Submit for approval
- `GET /api/v1/assets/approved/list` - Get approved assets
- `POST /api/v1/assets/:id/vote` - Vote for asset
- `DELETE /api/v1/assets/:id/vote` - Remove vote

#### Admin APIs
- `GET /admin/api/assets/pending` - Get pending assets
- `GET /admin/api/assets/stats` - Get statistics
- `POST /admin/api/assets/:id/approve` - Approve asset
- `POST /admin/api/assets/:id/reject` - Reject asset

## Database Schema

### Assets Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // Creator
  title: String,
  description: String,
  assetType: String,             // 'character', 'zone', 'item', etc.
  status: String,                // 'draft', 'pending', 'approved', 'rejected'
  images: {
    pixelArt: String,            // File path
    fullscreen: String,          // File path
    indexCard: String            // File path
  },
  pixelData: Object,             // Raw pixel editor data
  votes: Number,
  voters: [ObjectId],
  adminNotes: String,
  createdAt: Date,
  updatedAt: Date,
  approvedAt: Date,
  approvedBy: ObjectId
}
```

## File Structure

### Models
- `/srv/ps/api/v1/models/Asset.js` - Asset model with CRUD operations

### Routes
- `/srv/ps/routes/assets/index.js` - View routes
- `/srv/ps/api/v1/assets/index.js` - API routes
- `/srv/ps/routes/admin/index.js` - Admin routes (updated)

### Views
- `/srv/ps/views/assets/builder.ejs` - Asset builder UI
- `/srv/ps/views/assets/voting.ejs` - Voting page
- `/srv/ps/views/admin/assets.ejs` - Admin approval interface

### Client Scripts
- `/srv/ps/public/javascripts/pixel-editor.js` - Pixel editor component
- `/srv/ps/public/javascripts/asset-builder.js` - Asset builder logic
- `/srv/ps/public/javascripts/voting.js` - Voting page logic
- `/srv/ps/public/javascripts/admin-assets.js` - Admin approval logic

### Styles
- `/srv/ps/public/stylesheets/asset-builder.css` - Complete styling

### Configuration
- `/srv/ps/plugins/multer/config.js` - File upload configuration
- `/srv/ps/config/database.js` - Added assets collection

## Pixel Editor

The pixel editor provides:
- Grid sizes: 16x16, 32x32, 64x64
- Color picker
- Drawing tools
- Clear and Fill functions
- Export to PNG
- Touch support for mobile
- Save/load functionality

## Workflow

1. **User creates asset**
   - Uses pixel editor and/or uploads images
   - Saves as draft (can edit later)
   - Submits for approval

2. **Admin reviews**
   - Views all pending submissions
   - Reviews images and details
   - Approves or rejects with notes

3. **Community votes**
   - Approved assets appear on voting page
   - Users vote for favorites
   - Assets ranked by vote count

## File Uploads

- Location: `/srv/ps/uploads/assets/`
- Max size: 10MB per file
- Allowed types: JPEG, PNG, GIF, WebP
- Naming: `{userId}_{timestamp}_{fieldname}_{filename}`

## Security

- Authentication required for asset creation
- Admin role required for approvals
- File type validation
- File size limits
- User ownership verification
- One vote per user per asset

## Usage

1. **Start the server** (ensure it's running)
2. **Login** to create assets
3. **Navigate to `/assets`** to build
4. **Use pixel editor** or upload images
5. **Submit for approval**
6. **Admins review at `/admin/assets`**
7. **Community votes at `/assets/voting`**

## Future Enhancements

- Image processing/optimization
- Asset categories/filtering
- Search functionality
- Leaderboards
- Integration with game systems
- Asset versioning
- Batch approval
- Export approved assets to game database
