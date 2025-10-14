# MongoDB Comment System - Complete Setup

## Summary

The comment system has been **fully integrated with MongoDB**! All comments are now persisted to your MongoDB database.

## What Was Updated

### 1. Comment Model ([Comment.js](api/v1/models/Comment.js))
- Updated to use ModelHelper (same as Blog/Brand models)
- Stores in `comments` collection in MongoDB
- Fields: articleUrl, articleTitle, articleSource, userId, userEmail, userName, commentText, createdAt, likes

### 2. Comment API Routes ([comments.js](api/v1/ep/comments.js))
Completely rewritten to use MongoDB instead of in-memory storage:

```javascript
// Before: In-memory
const commentsStore = {};

// After: MongoDB
import Comment from '../models/Comment.js';
const commentModel = new Comment();
await commentModel.create(data);
```

**All 4 endpoints now use MongoDB:**
- ✅ `GET /api/v1/comments/:articleUrl` - Get comments for article
- ✅ `POST /api/v1/comments` - Create new comment (requires auth)
- ✅ `DELETE /api/v1/comments/:commentId` - Delete comment (owner/admin)
- ✅ `GET /api/v1/comments` - Get all comments (admin only)

## MongoDB Collection Structure

**Collection Name:** `comments`

**Document Schema:**
```json
{
  "_id": ObjectId("..."),
  "articleUrl": "https://www.cnn.com/article",
  "articleTitle": "Breaking News Article",
  "articleSource": "CNN",
  "userId": "user123",
  "userEmail": "user@example.com",
  "userName": "John Doe",
  "commentText": "Great article!",
  "createdAt": ISODate("2025-10-14T..."),
  "likes": 0
}
```

## How It Works

### Data Flow

```
User clicks comment bubble
   ↓
Frontend: openCommentModal()
   ↓
Frontend: loadComments() → GET /api/v1/comments/:url
   ↓
Backend: Comment.getAll({ articleUrl })
   ↓
MongoDB: db.comments.find({ articleUrl: "..." })
   ↓
Returns comments to frontend
   ↓
Display in modal
```

### Creating Comments

```
User types comment → clicks Post
   ↓
Frontend: submitComment() → POST /api/v1/comments
   ↓
Backend: Comment.create(data)
   ↓
MongoDB: db.comments.insertOne(...)
   ↓
Returns new comment
   ↓
Frontend: Reload comments + update count
```

## Testing

### 1. Verify MongoDB Connection
```javascript
// Should already be working if Blog/Brand models work
const db = getDb();
console.log('Connected to:', db.databaseName);
```

### 2. Test Comment Creation
```bash
# Post a comment (requires authentication)
curl -X POST http://localhost:3000/api/v1/comments \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "articleUrl": "https://www.cnn.com/test",
    "articleTitle": "Test Article",
    "articleSource": "CNN",
    "commentText": "This is a test comment"
  }'
```

### 3. Verify in MongoDB
```bash
# Connect to mongo shell
mongosh

# Use your database
use your_database_name

# View comments
db.comments.find().pretty()

# Count comments
db.comments.countDocuments()

# Find comments for specific article
db.comments.find({ articleUrl: "https://www.cnn.com/test" })
```

### 4. Test via UI
1. Open homepage: `http://localhost:3000`
2. Click any comment bubble
3. Login with Google (if not logged in)
4. Post a comment
5. Refresh page - comment should persist!

## Query Examples

### Get all comments for an article
```javascript
const commentModel = new Comment();
const comments = await commentModel.getAll({
  articleUrl: "https://www.cnn.com/article"
});
```

### Get comment by ID
```javascript
const comment = await commentModel.getById(commentId);
```

### Create new comment
```javascript
const newComment = await commentModel.create({
  articleUrl: "...",
  articleTitle: "...",
  articleSource: "CNN",
  userId: user.id,
  userName: user.name,
  commentText: "Great article!",
  createdAt: new Date(),
  likes: 0
});
```

### Delete comment
```javascript
await commentModel.deleteById(commentId);
```

## Database Indexes (Recommended)

For better performance, create indexes:

```javascript
// In MongoDB shell or Compass
db.comments.createIndex({ articleUrl: 1 });
db.comments.createIndex({ userId: 1 });
db.comments.createIndex({ createdAt: -1 });

// Compound index for common queries
db.comments.createIndex({ articleUrl: 1, createdAt: -1 });
```

## Advantages of MongoDB Storage

✅ **Persistent** - Comments survive server restarts
✅ **Scalable** - Can handle millions of comments
✅ **Queryable** - Find comments by user, article, date, etc.
✅ **Relational** - Can join with user data
✅ **Indexed** - Fast lookups with proper indexes
✅ **Backup-able** - Regular MongoDB backups

## Admin Features

### View All Comments (Admin Only)
```
GET /api/v1/comments
```
Returns ALL comments from ALL articles (requires admin role)

### Delete Any Comment (Admin)
Admins can delete any user's comment:
```javascript
// In comments.js
if (comment.userId !== userId && !user.isAdmin) {
  return res.status(403); // Not admin = can't delete
}
```

## User Permissions

| Action | Unauthenticated | Authenticated | Admin |
|--------|-----------------|---------------|-------|
| View comments | ✅ | ✅ | ✅ |
| Post comment | ❌ | ✅ | ✅ |
| Delete own comment | ❌ | ✅ | ✅ |
| Delete any comment | ❌ | ❌ | ✅ |
| View all comments API | ❌ | ❌ | ✅ |

## Frontend Integration

The comment system is already integrated on:
- ✅ Homepage (`/`) - All 5 top headline cards
- ✅ News page (`/news`) - All article cards

**Comment counts load automatically:**
```javascript
// On page load
document.addEventListener('DOMContentLoaded', async () => {
  const commentBubbles = document.querySelectorAll('.comment-bubble');
  for (const bubble of commentBubbles) {
    await loadCommentCount(articleUrl);
  }
});
```

## Troubleshooting

### Comments not saving
1. Check MongoDB connection:
   ```javascript
   const db = getDb();
   console.log('DB connected:', !!db);
   ```

2. Check console for errors:
   ```
   Error creating comment: ...
   ```

3. Verify user is authenticated:
   ```javascript
   console.log('User:', req.user);
   ```

### Comments not appearing after refresh
1. Check if data is in MongoDB:
   ```bash
   db.comments.find()
   ```

2. Check API response:
   ```bash
   curl http://localhost:3000/api/v1/comments/[encoded-url]
   ```

3. Check browser console for fetch errors

### Count not updating
1. Verify `data-article-url` matches exactly
2. Check URL encoding in fetch call
3. Ensure `loadCommentCount()` is called after post

## Migration from In-Memory (If needed)

If you had comments in the old in-memory system and need to migrate:

```javascript
// Run this once to migrate (if needed)
const oldComments = commentsStore; // Old in-memory data

for (const [articleUrl, comments] of Object.entries(oldComments)) {
  for (const comment of comments) {
    const commentModel = new Comment();
    await commentModel.create({
      ...comment,
      createdAt: new Date(comment.createdAt)
    });
  }
}
```

## Next Steps

### Optional Enhancements
- [ ] Add comment likes/upvotes
- [ ] Add comment replies (nested)
- [ ] Add comment editing
- [ ] Add real-time updates (Socket.io)
- [ ] Add comment moderation queue
- [ ] Add email notifications
- [ ] Add mention system (@username)
- [ ] Add rich text editor

### Performance Optimizations
- [ ] Create MongoDB indexes (shown above)
- [ ] Add caching layer (Redis)
- [ ] Implement pagination for many comments
- [ ] Add comment count caching

## Summary

Your comment system is now **fully integrated with MongoDB**!

- Comments persist across restarts ✅
- All CRUD operations use database ✅
- User authentication required ✅
- Admin controls available ✅
- Working on homepage & news pages ✅

Test it out by posting a comment, restarting your server, and seeing the comment still there!
