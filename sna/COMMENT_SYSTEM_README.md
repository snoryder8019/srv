# Comment System Documentation

## Overview

A complete comment system has been added to all news articles across the SNA application, allowing users to engage with news content.

## Features

### 1. Comment Bubbles on Every Article Card
- **Homepage**: Comment bubbles on all 5 top headline cards
- **News Page**: Comment bubbles on all news cards from all sources
- **Real-time Count**: Shows number of comments per article
- **Interactive**: Hover effect with color transition

### 2. Comment Modal
- Beautiful modal popup when clicking comment bubble
- Shows article title and source
- Displays all existing comments
- Allows posting new comments (when logged in)

### 3. Authentication Integration
- **Not Logged In**: Shows login prompt with "Login with Google" button
- **Logged In**: Shows comment textarea and post button
- **User Info**: Comments show username and timestamp

### 4. API Endpoints

#### Get Comments
```
GET /api/v1/comments/:articleUrl
```
Returns all comments for a specific article.

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "id": "1234567890",
      "articleUrl": "https://...",
      "articleTitle": "...",
      "articleSource": "CNN",
      "userId": "...",
      "userEmail": "user@example.com",
      "userName": "John Doe",
      "commentText": "Great article!",
      "createdAt": "2025-10-14T...",
      "likes": 0
    }
  ]
}
```

#### Post Comment (Requires Auth)
```
POST /api/v1/comments
Content-Type: application/json

{
  "articleUrl": "https://...",
  "articleTitle": "Article title",
  "articleSource": "CNN",
  "commentText": "My comment here"
}
```

#### Delete Comment (Owner or Admin)
```
DELETE /api/v1/comments/:commentId
```

#### Get All Comments (Admin Only)
```
GET /api/v1/comments
```

## File Structure

```
sna/
├── api/v1/
│   ├── models/
│   │   └── Comment.js          # Comment model definition
│   └── ep/
│       ├── comments.js         # Comment API routes
│       └── index.js            # Updated with comments route
├── views/
│   ├── index.ejs               # Homepage with comment bubbles
│   ├── news.ejs                # News page with comment bubbles
│   └── components/
│       ├── newsCard.ejs        # Updated with comment bubble
│       ├── newsSection.ejs     # Passes image to cards
│       └── commentSystem.ejs   # Modal, styles, and JavaScript
└── COMMENT_SYSTEM_README.md
```

## UI Components

### Comment Bubble
```html
<button class="comment-bubble">
  <svg><!-- Chat icon --></svg>
  <span class="comment-count">0</span>
</button>
```

**Features:**
- Chat bubble icon (SVG)
- Live comment count
- Hover effects (gray → purple gradient)
- Positioned bottom-right of each card

### Comment Modal

**Structure:**
1. **Header**: Title + Close button
2. **Article Info**: Source badge + article title
3. **Login Prompt** (if not logged in)
   - Or **Comment Form** (if logged in)
4. **Comments List**: All existing comments

## Styling

### Color Scheme
- **Bubble Default**: `#f0f0f0` (light gray)
- **Bubble Hover**: `#667eea` (purple gradient)
- **Modal Overlay**: `rgba(0,0,0,0.6)`
- **Primary Action**: `#667eea` (purple)
- **Success**: `#51cf66` (green)

### Animations
- **Modal Fade In**: 0.3s fade
- **Modal Slide Up**: 0.3s slide + opacity
- **Bubble Hover**: 0.3s scale + color

### Responsive Design
- Modal width: 90% max 600px
- Max height: 80vh with scroll
- Mobile-friendly touch targets

## Data Storage

Currently uses **in-memory storage** (resets on server restart).

### Upgrading to Database

To persist comments, update `comments.js`:

```javascript
// Replace commentsStore with database queries
import Comment from '../models/Comment.js';

router.post('/', async (req, res) => {
  const comment = new Comment(req.body);
  await comment.save();
  // ...
});
```

## User Flow

### Unauthenticated User
```
Click comment bubble
   ↓
Modal opens
   ↓
See "Login to comment" prompt
   ↓
Click "Login with Google"
   ↓
Redirect to Google OAuth
   ↓
Return authenticated
   ↓
Can now post comments
```

### Authenticated User
```
Click comment bubble
   ↓
Modal opens
   ↓
See comment form + existing comments
   ↓
Type comment
   ↓
Click "Post Comment"
   ↓
Comment appears in list
   ↓
Count updates on all cards
```

## JavaScript Functions

### `openCommentModal(url, title, source)`
Opens the modal for a specific article.

### `closeCommentModal()`
Closes the modal and clears the form.

### `loadComments(articleUrl)`
Fetches and displays all comments for an article.

### `submitComment()`
Posts a new comment to the API.

### `loadCommentCount(articleUrl)`
Updates the comment count bubble.

## Security

### Authentication
- Uses `req.user` from session
- Only logged-in users can comment
- User identity verified server-side

### Input Validation
- Comment text required
- Article URL required
- HTML escaped to prevent XSS

### Authorization
- Users can delete their own comments
- Admins can delete any comment
- Unauthorized requests return 401/403

## Performance

### Optimization Strategies

1. **Lazy Load Counts**
   - Counts load on page load
   - Only for visible articles

2. **Modal Content**
   - Comments load when modal opens
   - Not loaded for every article upfront

3. **Caching (Future)**
   - Cache comment counts for 5 minutes
   - Cache comment lists per article
   - Invalidate on new comments

## Example Usage

### In View Templates

**Homepage cards already include:**
```ejs
<button class="comment-bubble"
        onclick="openCommentModal('<%= url %>', '<%= title %>', '<%= source %>')"
        data-article-url="<%= url %>">
  <svg>...</svg>
  <span class="comment-count" data-url="<%= url %>">0</span>
</button>
```

**News cards (via newsCard.ejs):**
```ejs
<%- include('./components/newsCard.ejs', {
  title: article.title,
  url: article.url,
  image: article.image,
  source: article.source
}) %>
```

### Adding to New Pages

1. Include comment system at bottom:
```ejs
<%- include('./components/commentSystem.ejs') %>
```

2. Add comment bubble to cards:
```ejs
<button class="comment-bubble"
        onclick="openCommentModal(...)"
        data-article-url="...">
  <!-- icon + count -->
</button>
```

3. Pass `user` variable in route:
```javascript
res.render('page', { user: req.user });
```

## Customization

### Change Colors
Edit `commentSystem.ejs` CSS:
```css
.comment-bubble:hover {
  background: #your-color;
}
```

### Change Icon
Replace SVG in bubble template:
```html
<svg><!-- Your custom icon --></svg>
```

### Add Features
- Like/upvote buttons
- Reply threads
- Comment editing
- Rich text editor
- Emoji support
- Mention system (@username)

## Testing

### Manual Testing

1. **As Unauthenticated User:**
   - Click comment bubble → Should show login prompt
   - Click login → Should redirect to OAuth

2. **As Authenticated User:**
   - Click comment bubble → Should show comment form
   - Post comment → Should appear in list
   - Count should update

3. **Multiple Articles:**
   - Each article has separate comments
   - Counts are article-specific

### API Testing

```bash
# Get comments
curl http://localhost:3000/api/v1/comments/https%3A%2F%2Fexample.com%2Farticle

# Post comment (requires auth cookie)
curl -X POST http://localhost:3000/api/v1/comments \
  -H "Content-Type: application/json" \
  -d '{"articleUrl":"...","commentText":"Test"}'
```

## Future Enhancements

- [ ] Database persistence (MongoDB/PostgreSQL)
- [ ] Comment moderation (admin approval)
- [ ] Report/flag inappropriate comments
- [ ] Nested replies/threads
- [ ] Like/upvote system
- [ ] Real-time updates (WebSocket)
- [ ] Email notifications
- [ ] Comment search
- [ ] User profiles with comment history
- [ ] Rich text/markdown support
- [ ] Image/GIF support in comments
- [ ] @mentions and notifications

## Troubleshooting

### Comments not appearing
- Check browser console for errors
- Verify `/api/v1/comments` endpoints working
- Check if `req.user` is populated

### Count not updating
- Verify `data-url` attribute matches article URL
- Check URL encoding in API call
- Clear browser cache

### Modal not opening
- Check JavaScript console for errors
- Verify `commentSystem.ejs` is included
- Check for JavaScript conflicts

### Can't post comments
- Verify user is logged in
- Check authentication middleware
- Verify POST route is working
- Check request body format

## Notes

- Comments are article-specific (keyed by URL)
- Same article across different pages shares comments
- In-memory storage clears on restart
- Consider adding database before production
