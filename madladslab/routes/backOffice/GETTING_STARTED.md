# Back Office - Getting Started

## Quick Start Guide

### Step 1: Login
First, make sure you have a user account in the system. Visit `/auth` to log in.

### Step 2: Create Your Employee Profile
After logging in, visit:
```
/backOffice/setup
```

Fill out the form with:
- **Position**: Your job title (e.g., Bartender, Server, Chef)
- **Department**: kitchen, bar, floor, management, or other

**Important**: The first user to complete setup automatically becomes an **Admin**!

### Step 3: Access Your Dashboard
Once setup is complete, you'll be redirected to your role-based dashboard:

- **Staff**: `/backOffice/staff` - View training, tasks, recipes
- **Manager**: `/backOffice/manager` - Manage team, verify tasks
- **Admin**: `/backOffice/admin` - Full system access

## For Admins

### Managing Employees

Visit `/backOffice/admin/employees` to:
- View all employees
- Promote staff to managers
- Activate/deactivate accounts

### Adding New Employees

Have new employees:
1. Log in to the system
2. Visit `/backOffice/setup`
3. Complete their employee profile

They'll start as **staff** by default. You can promote them to **manager** from the employee management page.

### Role Permissions

**Staff:**
- View assigned training modules
- Complete tasks with photos
- View recipes (menu view only for servers)
- Read team communications
- Complete onboarding

**Manager:**
- All staff permissions
- Create training modules
- Manage recipes
- Create and assign tasks
- Verify task completions
- Pin posts

**Admin:**
- All manager permissions
- Promote staff to manager
- System-wide access
- Manage all departments

## Features Available

### 1. Training
- Create interactive modules with videos and quizzes
- Track employee progress
- Automated certification

### 2. Recipes & Menu
- Kitchen recipes (full details for chefs)
- Bar recipes (cocktails for bartenders)
- Menu view (servers see ingredients only)

### 3. Tasks
- Opening/closing checklists
- Photo accountability
- Timestamped completions
- Manager verification

### 4. Communication
- Team feed with posts
- Comments and reactions
- Pinned announcements
- Department-specific feeds

### 5. Onboarding
- New hire packets
- Document tracking
- Progress monitoring

## URLs to Remember

- **Setup**: `/backOffice/setup` (first-time only)
- **Dashboard**: `/backOffice` (auto-redirects based on role)
- **Admin Dashboard**: `/backOffice/admin`
- **Employee Management**: `/backOffice/admin/employees` (admin only)
- **Training**: `/backOffice/training`
- **Recipes**: `/backOffice/recipes`
- **Tasks**: `/backOffice/tasks`
- **Team Feed**: `/backOffice/feed`

## API Documentation

Full API reference available in [README.md](./README.md)

## Troubleshooting

**"Access denied. Employee status required."**
- Visit `/backOffice/setup` to create your employee profile

**Can't access admin features**
- Only admins can access these features
- Contact your system admin to promote your account

**No employees showing up**
- Make sure users have completed the setup process at `/backOffice/setup`
- Check that their accounts are marked as "active"

## Image Uploads

The system supports image uploads for:
- Training materials
- Task completion photos
- Recipe images
- Onboarding documents

### To Enable Linode Storage:

1. Install AWS SDK:
```bash
npm install @aws-sdk/client-s3
```

2. Set environment variables:
```bash
LINODE_BUCKET_NAME=your-bucket-name
LINODE_BUCKET_REGION=us-east-1
LINODE_ACCESS_KEY=your-access-key
LINODE_SECRET_KEY=your-secret-key
```

3. Uncomment the implementation in `/srv/madladslab/lib/linodeStorage.js`

Until configured, uploads will use placeholder URLs.

## Next Steps

1. **Create your first admin account** - Visit `/backOffice/setup`
2. **Have your team create profiles** - Send them to `/backOffice/setup`
3. **Start creating content**:
   - Add training modules
   - Upload recipes
   - Create task checklists
   - Post team announcements

## Support

For detailed feature documentation, see [README.md](./README.md)

---

**Ready to get started?** Visit `/backOffice/setup` now!
