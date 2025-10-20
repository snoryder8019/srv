# Back Office Management System

A comprehensive staff management platform for restaurant/bar operations with role-based access control.

## Features

### 1. **Onboarding**
- New hire packet management
- Document completion tracking
- Digital signatures
- Automated status updates

### 2. **Training**
- Interactive training modules
- Video and image content support
- Quiz assessments with scoring
- Progress tracking
- Certification management
- Role-based module assignment

### 3. **Communication**
- Team-wide social network
- Announcements and updates
- Comments and reactions
- Pinned posts (manager+)
- Department-specific feeds
- Read status tracking

### 4. **Recipes & Menu**
- Full recipe management (kitchen & bar)
- Ingredient lists with quantities
- Step-by-step instructions with images
- **Role-based visibility:**
  - Chefs/Bartenders: See full recipes
  - Servers: See menu items with ingredients only
- Allergen and dietary info
- Cost and pricing management

### 5. **Tasks**
- Opening/closing duty checklists
- Step-by-step task instructions
- Photo upload for accountability
- Timestamped completions
- Manager verification
- Task history tracking

## User Roles

### Staff
- View assigned training modules
- Complete tasks with photo uploads
- Access recipes (menu view)
- Read team communications
- Complete onboarding

### Manager
- All staff permissions
- Create/manage training modules
- Create/manage recipes
- Create/assign tasks
- Verify task completions
- Pin important posts
- Manage department employees

### Admin
- All manager permissions
- Assign manager roles (admin-only)
- System-wide access
- View all departments
- Full employee management

## API Endpoints

### Employees
- `GET /backOffice/api/employees` - List all employees (manager+)
- `POST /backOffice/api/employees` - Create employee (manager+)
- `POST /backOffice/api/employees/:id/assign-manager` - Assign manager role (admin only)

### Onboarding
- `GET /backOffice/api/onboarding/:employeeId` - Get onboarding packet
- `POST /backOffice/api/onboarding` - Create onboarding packet (manager+)
- `PUT /backOffice/api/onboarding/:id/document/:index` - Update document

### Training
- `GET /backOffice/api/training/modules` - Get assigned modules
- `GET /backOffice/api/training/modules/:id` - Get module details
- `POST /backOffice/api/training/modules` - Create module (manager+)
- `POST /backOffice/api/training/modules/:id/start` - Start module
- `POST /backOffice/api/training/modules/:id/quiz` - Submit quiz

### Communication
- `GET /backOffice/api/feed` - Get team feed
- `POST /backOffice/api/feed` - Create post
- `POST /backOffice/api/feed/:id/comment` - Add comment
- `POST /backOffice/api/feed/:id/reaction` - Add reaction
- `POST /backOffice/api/feed/:id/pin` - Toggle pin (manager+)

### Recipes
- `GET /backOffice/api/recipes` - List recipes (filtered by role)
- `GET /backOffice/api/recipes/:id` - Get recipe (filtered by role)
- `POST /backOffice/api/recipes` - Create recipe (manager+)
- `PUT /backOffice/api/recipes/:id` - Update recipe (manager+)

### Tasks
- `GET /backOffice/api/tasks` - Get assigned tasks
- `POST /backOffice/api/tasks` - Create task (manager+)
- `POST /backOffice/api/tasks/:id/complete` - Complete task
- `GET /backOffice/api/tasks/:id/completions` - Get completions (manager+)
- `POST /backOffice/api/tasks/completions/:id/verify` - Verify completion (manager+)

### File Upload
- `POST /backOffice/api/upload` - Upload image/PDF
  - Form data: `file` (required), `folder` (optional)
  - Supports: JPG, PNG, GIF, WEBP, PDF
  - Max size: 10MB
  - Returns: `{ success, url, filename, size, mimetype }`

## Database Models

### Employee
- User reference
- Role (staff/manager/admin)
- Position & department
- Hire date & status
- Onboarding completion
- Training modules completed

### OnboardingPacket
- Employee reference
- Document list with completion tracking
- Signatures & file uploads
- Status (pending/in-progress/completed)

### TrainingModule
- Title, description, category
- Sections with content, videos, images
- Quiz questions with correct answers
- Target roles
- Passing score

### TrainingProgress
- Employee & module reference
- Progress percentage
- Quiz attempts & scores
- Completion date

### Communication
- Author, title, content
- Type & priority
- Target audience
- Comments & reactions
- Pinned status
- Read tracking

### Recipe
- Name, description, category
- Ingredients with quantities
- Instructions with images
- Visibility setting (full/menu-only)
- Allergens, dietary info
- Cost & pricing

### Task
- Title, description, type
- Department & assigned roles
- Step-by-step instructions
- Photo requirements

### TaskCompletion
- Task & user reference
- Steps completed with photos
- Timestamps & verification

## Image Upload (Linode Object Storage)

The system supports image uploads to Linode Object Storage (S3-compatible).

### Setup

1. Install AWS SDK:
```bash
npm install @aws-sdk/client-s3
```

2. Set environment variables:
```bash
LINODE_BUCKET_NAME=your-bucket-name
LINODE_BUCKET_REGION=us-east-1  # or your region
LINODE_ACCESS_KEY=your-access-key
LINODE_SECRET_KEY=your-secret-key
```

3. Uncomment the implementation in `/srv/madladslab/lib/linodeStorage.js`

### Usage

```javascript
// Frontend example
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('folder', 'tasks'); // optional: training, recipes, onboarding, etc.

const response = await fetch('/backOffice/api/upload', {
  method: 'POST',
  body: formData
});

const { url } = await response.json();
// Use the URL in your documents
```

## Views

- `/backOffice/` - Redirects to role-based dashboard
- `/backOffice/admin` - Admin dashboard
- `/backOffice/manager` - Manager dashboard
- `/backOffice/staff` - Staff dashboard
- `/backOffice/training` - Training modules
- `/backOffice/recipes` - Recipes & menu
- `/backOffice/tasks` - Task management
- `/backOffice/feed` - Team communication feed

## Middleware

All routes require authentication and active employee status. Additional role requirements:
- `requireManager` - Manager or Admin only
- `requireAdmin` - Admin only

## Getting Started

1. Ensure user authentication is working (`req.user` available)
2. Create employee records for users
3. Assign roles (staff/manager/admin)
4. Configure Linode Object Storage (optional)
5. Access `/backOffice` to view role-based dashboard

## Next Steps

To fully activate this system:

1. **Create sample data:**
   - Add employee records
   - Create training modules
   - Add recipes
   - Define tasks

2. **Implement file upload:**
   - Configure Linode credentials
   - Test image uploads

3. **Build additional views:**
   - Individual training module view
   - Recipe detail pages
   - Task detail pages
   - Onboarding flow

4. **Add features:**
   - Email notifications
   - Mobile app support
   - Advanced analytics
   - Schedule management

## Support

For questions or issues, refer to the main application documentation or contact the development team.
