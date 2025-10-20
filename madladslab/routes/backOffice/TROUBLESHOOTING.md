# Back Office - Troubleshooting

## Common Issues & Solutions

### "Schema hasn't been registered for user"

**Problem**: Mongoose can't find the User model when populating Employee references.

**Solution**: This has been fixed! A User mongoose model was created at `/srv/madladslab/api/v1/models/User.js` that wraps the existing MongoDB `users` collection.

**What was done**:
1. Created a Mongoose User schema that points to the existing 'users' collection
2. Imported the User model in `/srv/madladslab/api/v1/ep/backOffice.js`
3. This allows Employee.populate('userId') to work correctly

**If you still see this error**:
- Restart your Node.js server to reload the models
- Make sure the User model import exists at the top of `backOffice.js`

### "Access denied. Employee status required."

**Cause**: You haven't created your employee profile yet.

**Solution**:
1. Make sure you're logged in (visit `/auth`)
2. Go to `/backOffice/setup`
3. Fill out position and department
4. Submit the form

### "Unauthorized. Please log in."

**Cause**: You're not authenticated.

**Solution**: Visit `/auth` and log in with Google, Facebook, or local credentials.

### Can't access `/backOffice/admin`

**Cause**: You're not an admin.

**Solution**:
- First user to complete setup automatically becomes admin
- If you're not the first user, ask an existing admin to:
  1. Visit `/backOffice/admin/employees`
  2. Click "Promote to Manager" on your account
  3. Note: Only admins can promote to manager, and this gives manager-level access

### Employee not showing in list

**Possible causes**:
1. **Setup not completed**: User visited `/backOffice` but didn't complete `/backOffice/setup`
2. **Status inactive**: Check the status column - it should be "active"
3. **Database connection**: Check MongoDB connection

**Solution**:
- Have the user visit `/backOffice/setup` and complete the form
- Admin can activate/deactivate from `/backOffice/admin/employees`

### Redirect loop on `/backOffice`

**Cause**: Employee record exists but middleware is failing.

**Debug steps**:
1. Check browser console for errors
2. Check server logs for mongoose errors
3. Verify User model is imported in `backOffice.js`

### Image upload not working

**Cause**: Linode Object Storage not configured.

**Solution**:
- The system will use placeholder URLs until Linode is configured
- To enable real uploads:
  ```bash
  npm install @aws-sdk/client-s3
  ```
- Set environment variables:
  ```bash
  LINODE_BUCKET_NAME=your-bucket
  LINODE_BUCKET_REGION=us-east-1
  LINODE_ACCESS_KEY=your-key
  LINODE_SECRET_KEY=your-secret
  ```
- Uncomment the implementation in `/srv/madladslab/lib/linodeStorage.js`

### Can't promote staff to manager

**Cause**: Only admins can promote to manager.

**Solution**: Log in with an admin account to promote users.

### "displayName" is undefined

**Cause**: Some users may have `displayName` set, others may have separate `firstName`/`lastName`.

**Solution**: The User model includes a virtual `name` field that falls back to:
1. `displayName` (Google/Facebook users)
2. `firstName + lastName` (Local users)
3. `email` (fallback)

This is automatically handled by the model.

## Server Restart Required

After making these changes, restart your server:

```bash
# If using npm
npm restart

# If using pm2
pm2 restart all

# If running directly
# Kill the process and start again
node app.js
```

## Verification Steps

1. **Test User Model**:
   ```javascript
   // In Node REPL or a test file
   import User from './api/v1/models/User.js';
   const user = await User.findOne({});
   console.log(user); // Should show user data
   ```

2. **Test Employee Creation**:
   - Login
   - Visit `/backOffice/setup`
   - Fill form and submit
   - Should redirect to dashboard

3. **Test Populate**:
   ```javascript
   import Employee from './api/v1/models/gpc/Employee.js';
   const emp = await Employee.findOne().populate('userId');
   console.log(emp.userId); // Should show user data, not just ID
   ```

## Database Check

If issues persist, check your MongoDB:

```bash
mongosh

use your_database_name

# Check users collection
db.users.findOne()

# Check employees collection
db.employees.findOne()

# Check if user _id matches employee userId
db.employees.aggregate([
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "user"
    }
  }
])
```

## Contact Support

If you're still having issues:
1. Check the server logs for detailed error messages
2. Verify MongoDB is running and connected
3. Ensure all dependencies are installed (`npm install`)
4. Make sure you've restarted the server after the changes

For more help, see:
- [Getting Started Guide](./GETTING_STARTED.md)
- [Full Documentation](./README.md)
