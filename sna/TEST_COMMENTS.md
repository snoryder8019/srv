# Comment System Testing Guide

## Quick Test Steps

### 1. Start Your Server
```bash
npm start
# or
node app.js
```

### 2. Open Homepage
```
http://localhost:3000
```

### 3. Test Comment Bubbles

**You should see:**
- 5 headline cards (CNN, Fox, BBC, AP, Reuters)
- Each card has a gray chat bubble icon at the bottom right
- Bubble shows number (starts at 0)

**Test each bubble:**
1. Click CNN bubble → Modal should open
2. Click Fox bubble → Modal should open
3. Click BBC bubble → Modal should open
4. Click AP bubble → Modal should open
5. Click Reuters bubble → Modal should open

**Hover test:**
- Hover over any bubble → Should turn purple
- Icon should turn white

### 4. Test Modal (Not Logged In)

When you click a bubble, you should see:
- ✅ Modal appears with dark overlay
- ✅ Article title at top
- ✅ Source badge (colored)
- ✅ "Join the Conversation!" message
- ✅ "Login with Google" button
- ✅ "No comments yet" message

**Test:**
- Click X button → Modal closes
- Click outside modal → Modal closes
- Click "Login with Google" → Redirects to auth

### 5. Test Modal (Logged In)

After logging in:
- ✅ Comment textarea appears
- ✅ "Post Comment" button visible
- ✅ Your username shown on future comments

**Test posting:**
1. Type a comment
2. Click "Post Comment"
3. Comment appears in list
4. Count updates (0 → 1)
5. Close and reopen modal → Comment still there

### 6. Test MongoDB Persistence

```bash
# In terminal
mongosh

# Switch to your database
use your_database_name

# View comments
db.comments.find().pretty()

# You should see your comment!
```

**Restart server test:**
1. Post a comment
2. Restart your Node server
3. Refresh page
4. Click bubble → Comment still there!

### 7. Test on News Page

```
http://localhost:3000/news
```

**Should see:**
- All articles from all 5 sources
- Each article has comment bubble
- Bubbles work same as homepage

### 8. Test API Directly

**Get comments for an article:**
```bash
curl http://localhost:3000/api/v1/comments/[encoded-url]
```

**Post comment (need to be logged in):**
```bash
curl -X POST http://localhost:3000/api/v1/comments \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "articleUrl": "https://www.cnn.com/test",
    "articleTitle": "Test Article",
    "articleSource": "CNN",
    "commentText": "Test comment!"
  }'
```

## Troubleshooting

### Bubbles Not Appearing
✓ Check browser console for errors
✓ View page source - search for "comment-bubble"
✓ Verify commentSystem.ejs is being included

### Modal Not Opening
✓ Check browser console for "openCommentModal is not defined"
✓ Verify commentSystem.ejs is at bottom of page
✓ Check for JavaScript errors

### Can't Post Comments
✓ Make sure you're logged in (see "Login with Google")
✓ Check MongoDB is connected
✓ Check browser console for 401 errors
✓ Verify /api/v1/comments route exists

### Comments Not Saving
✓ Check MongoDB connection in terminal
✓ Run: `db.comments.find()`
✓ Check server logs for errors
✓ Verify Comment model is loaded

### Count Not Updating
✓ Check browser network tab
✓ Verify GET /api/v1/comments/:url returns data
✓ Check data-article-url attribute
✓ Ensure loadCommentCount() is called

## Browser Console Tests

Open browser console (F12) and run:

```javascript
// Test if function exists
typeof openCommentModal
// Should return: "function"

// Test if modal exists
document.getElementById('commentModal')
// Should return: <div id="commentModal"...>

// Test manual open
openCommentModal('https://test.com', 'Test Article', 'CNN')
// Should open modal

// Check if user data exists
typeof isLoggedIn
// Should return: "boolean"

console.log(isLoggedIn)
// true or false

console.log(currentUser)
// null or {email: "...", name: "..."}
```

## Expected Behavior Summary

| Action | Expected Result |
|--------|----------------|
| Click bubble | Modal opens |
| Modal overlay click | Modal closes |
| X button click | Modal closes |
| Not logged in | Shows login prompt |
| Logged in | Shows comment form |
| Post comment | Appears in list immediately |
| Refresh page | Comment persists |
| Multiple comments | All show in chronological order |
| Comment count | Updates on all cards |
| Hover bubble | Turns purple |
| Server restart | Comments still exist |

## Success Checklist

- [ ] All 5 bubbles clickable on homepage
- [ ] Modal opens/closes smoothly
- [ ] Login prompt shows when not authenticated
- [ ] Comment form shows when authenticated
- [ ] Can post comments successfully
- [ ] Comments appear in modal
- [ ] Counts update correctly
- [ ] Comments persist in MongoDB
- [ ] Comments survive server restart
- [ ] Bubbles work on /news page too
- [ ] Hover effects work
- [ ] Mobile responsive

## Video Test Script

1. **Fresh load** - Show clean homepage
2. **Hover test** - Hover each bubble (should turn purple)
3. **Click CNN** - Open modal, show login prompt
4. **Login** - Click login, authenticate
5. **Post comment** - Type and post "Great article!"
6. **Verify** - Comment appears with username
7. **Close/reopen** - Comment still there
8. **Second comment** - Post another, count goes to 2
9. **Different article** - Click Fox bubble, count is 0
10. **Restart server** - Comments persist!

## All Working? 🎉

If all tests pass, your comment system is fully functional with:
- ✅ MongoDB persistence
- ✅ User authentication
- ✅ Beautiful UI
- ✅ Working on all pages
- ✅ Real-time updates

## Next Steps

Optional enhancements:
- Add comment editing
- Add delete button for own comments
- Add likes/upvotes
- Add reply threading
- Add admin moderation
- Add real-time with Socket.io
