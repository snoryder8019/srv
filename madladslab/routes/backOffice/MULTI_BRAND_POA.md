# Multi-Brand Backoffice System - Plan of Action

## Overview
Restructure the backoffice system to support multiple brands/businesses, allowing authenticated users to create or join brands, with role-based permissions per brand.

---

## Current Architecture Issues

1. **Single-tenant design**: Current system assumes one business with employees
2. **User.isBackoffice**: String field ('admin', 'manager', 'staff') doesn't support multiple brands
3. **No brand isolation**: All employees, tasks, recipes, etc. are shared globally
4. **Landing page**: `/backoffice` redirects to setup/dashboard without brand context

---

## Target Architecture

### Multi-Brand Structure
- **Brand**: Top-level entity representing a business/organization
- **User**: Can belong to multiple brands with different roles per brand
- **Employee**: Links User + Brand + Role (one per user per brand)
- **All backoffice data**: Scoped to a specific brand

### User Flow
1. User visits `/backoffice` (authenticated)
2. If no brands: Show "Create Your Brand" setup page
3. If 1 brand: Auto-select and redirect to dashboard
4. If multiple brands: Show brand selector
5. Dashboard and all features filtered by active brand

---

## Database Schema Changes

### 1. New Brand Model
```javascript
// /srv/madladslab/api/v1/models/gpc/Brand.js
{
  name: String (required, unique),
  slug: String (required, unique, URL-friendly),
  description: String,
  logo: String (URL),
  industry: String (enum: ['restaurant', 'retail', 'service', 'tech', 'other']),
  settings: {
    departments: [String], // Custom departments for this brand
    currency: String,
    timezone: String,
    businessHours: Object
  },
  owner: ObjectId (ref: 'User'), // Creator/primary admin
  status: String (enum: ['active', 'suspended', 'archived']),
  subscription: {
    plan: String (enum: ['free', 'pro', 'enterprise']),
    expiresAt: Date
  },
  createdAt: Date,
  updatedAt: Date
}
```

### 2. Updated User Model
```javascript
// /srv/madladslab/api/v1/models/User.js
{
  // ... existing fields ...

  // REMOVE: isBackoffice (String) - no longer used

  // ADD: Brand associations with permissions
  backoffice: {
    brands: [{
      brandId: ObjectId (ref: 'Brand'),
      role: String (enum: ['admin', 'manager', 'staff']),
      status: String (enum: ['active', 'inactive']),
      joinedAt: Date
    }],
    activeBrandId: ObjectId (ref: 'Brand'), // Last selected brand
    lastAccessedAt: Date
  }
}
```

### 3. Updated Employee Model
```javascript
// /srv/madladslab/api/v1/models/gpc/Employee.js
{
  // ADD: Brand reference
  brandId: ObjectId (ref: 'Brand', required: true),

  userId: ObjectId (ref: 'User', required: true),
  role: String (enum: ['staff', 'manager', 'admin']),
  position: String,
  department: String, // Now brand-specific
  hireDate: Date,
  status: String,
  onboardingCompleted: Boolean,
  trainingModulesCompleted: [ObjectId],
  assignedBy: ObjectId (ref: 'User'),

  // UNIQUE INDEX: (userId + brandId) - one employee record per user per brand
}
```

### 4. All Other Backoffice Collections
Add `brandId` field to:
- **OnboardingPacket**: `brandId` (required)
- **TrainingModule**: `brandId` (required)
- **TrainingProgress**: `brandId` (required)
- **Communication** (posts): `brandId` (required)
- **Recipe**: `brandId` (required)
- **Task**: `brandId` (required)
- **TaskCompletion**: `brandId` (required)

---

## Implementation Plan

### Phase 1: Database & Models (Foundational)

#### Step 1.1: Create Brand Model
- [ ] Create `/srv/madladslab/api/v1/models/gpc/Brand.js`
- [ ] Add indexes: slug (unique), owner, status
- [ ] Add validation: slug format, name length

#### Step 1.2: Update User Model
- [ ] Add `backoffice` object with brands array and activeBrandId
- [ ] Keep `isBackoffice` temporarily for backwards compatibility
- [ ] Add migration helper method to convert old isBackoffice to new structure

#### Step 1.3: Update Employee Model
- [ ] Add `brandId` field (required, ref: 'Brand')
- [ ] Add compound unique index: `{ userId: 1, brandId: 1 }`
- [ ] Update existing indexes to include brandId

#### Step 1.4: Update All Backoffice Models
- [ ] Add `brandId` to: OnboardingPacket, TrainingModule, TrainingProgress, Communication, Recipe, Task, TaskCompletion
- [ ] Add indexes: `{ brandId: 1, ... }` on all collections
- [ ] Update existing queries in `/srv/madladslab/api/v1/ep/backOffice.js`

---

### Phase 2: API & Business Logic

#### Step 2.1: Brand Management Functions
Create new file: `/srv/madladslab/api/v1/ep/brands.js`

```javascript
// Brand CRUD
- createBrand(data, ownerId)
- getBrand(brandId)
- getBrandBySlug(slug)
- getUserBrands(userId)
- updateBrand(brandId, updates)
- deleteBrand(brandId)

// Brand membership
- addUserToBrand(userId, brandId, role)
- removeUserFromBrand(userId, brandId)
- updateUserBrandRole(userId, brandId, role)
- getUserBrandRole(userId, brandId)
- setActiveBrand(userId, brandId)
```

#### Step 2.2: Update Backoffice Functions
Update `/srv/madladslab/api/v1/ep/backOffice.js`:
- Add `brandId` parameter to all functions
- Filter all queries by `brandId`
- Update Employee functions to handle per-brand roles

Example:
```javascript
// OLD
export async function getAllEmployees(filters = {}) {
  return await Employee.find(filters);
}

// NEW
export async function getAllEmployees(brandId, filters = {}) {
  return await Employee.find({ brandId, ...filters });
}
```

---

### Phase 3: Middleware & Permissions

#### Step 3.1: Update Middleware
Update `/srv/madladslab/routes/backOffice/index.js`:

```javascript
// NEW: Extract and validate brand context
async function requireBrand(req, res, next) {
  const brandSlug = req.params.brandSlug || req.query.brand || req.session.activeBrandSlug;

  if (!brandSlug) {
    return res.redirect('/backoffice/brands');
  }

  const brand = await getBrandBySlug(brandSlug);
  if (!brand) {
    return res.status(404).send('Brand not found');
  }

  req.brand = brand;
  req.session.activeBrandSlug = brandSlug;
  next();
}

// UPDATE: Check brand-specific employee status
async function requireEmployee(req, res, next) {
  if (!req.user || !req.brand) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const employee = await getEmployeeByUserAndBrand(req.user._id, req.brand._id);
  if (!employee || employee.status !== 'active') {
    return res.status(403).json({ error: "Not an active employee of this brand" });
  }

  req.employee = employee;
  next();
}

// UPDATE: Check brand-specific role
function requireManager(req, res, next) {
  if (!req.employee || !['manager', 'admin'].includes(req.employee.role)) {
    return res.status(403).json({ error: "Manager or admin access required" });
  }
  next();
}
```

---

### Phase 4: Routes & URL Structure

#### Step 4.1: New Brand Routes
Add to `/srv/madladslab/routes/backOffice/index.js`:

```javascript
// Landing page - brand selection/setup
router.get('/', requireAuth, async (req, res) => {
  const brands = await getUserBrands(req.user._id);

  if (brands.length === 0) {
    return res.render('backOffice/brand-setup', { user: req.user });
  } else if (brands.length === 1) {
    return res.redirect(`/backoffice/${brands[0].slug}/dashboard`);
  } else {
    return res.render('backOffice/brand-selector', { user: req.user, brands });
  }
});

// Create new brand
router.post('/brands/create', requireAuth, async (req, res) => {
  const brand = await createBrand(req.body, req.user._id);
  await addUserToBrand(req.user._id, brand._id, 'admin');
  res.redirect(`/backoffice/${brand.slug}/dashboard`);
});

// Brand settings
router.get('/:brandSlug/settings', requireAuth, requireBrand, requireEmployee, requireAdmin, async (req, res) => {
  res.render('backOffice/brand-settings', { user: req.user, brand: req.brand });
});
```

#### Step 4.2: Update All Routes
Change from:
```
/backoffice/admin
/backoffice/feed
/backoffice/tasks
```

To:
```
/backoffice/:brandSlug/admin
/backoffice/:brandSlug/feed
/backoffice/:brandSlug/tasks
```

Apply `requireBrand` middleware to all brand-scoped routes.

---

### Phase 5: Views & UI

#### Step 5.1: Brand Landing Page
Create `/srv/madladslab/views/backOffice/brand-setup.ejs`:
- Welcome message for authenticated users
- Form to create first brand
  - Brand name (required)
  - Industry dropdown
  - Description (optional)
  - Logo upload (optional)
- "Create Brand" button

#### Step 5.2: Brand Selector
Create `/srv/madladslab/views/backOffice/brand-selector.ejs`:
- List all user's brands with cards
- Show role badge per brand (admin, manager, staff)
- "Select" button to activate brand
- "+ Create New Brand" button

#### Step 5.3: Brand Settings Page
Create `/srv/madladslab/views/backOffice/brand-settings.ejs`:
- Brand profile (name, logo, description)
- Departments configuration
- User management (invite, remove, change roles)
- Subscription/billing info
- Danger zone (archive brand)

#### Step 5.4: Update All Existing Views
- Add brand context to navigation/header
- Update all form submissions to include brandSlug
- Update all API calls to include brandId filter
- Add brand switcher dropdown in header (if user has multiple brands)

---

### Phase 6: Data Migration

#### Step 6.1: Migration Script
Create `/srv/madladslab/scripts/migrate-to-multi-brand.js`:

```javascript
// 1. Create default brand for existing data
const defaultBrand = await createBrand({
  name: 'Default Brand',
  slug: 'default',
  industry: 'restaurant',
  owner: firstAdminUser._id
});

// 2. Migrate User.isBackoffice to User.backoffice.brands
const users = await User.find({ isBackoffice: { $ne: null } });
for (const user of users) {
  user.backoffice = {
    brands: [{
      brandId: defaultBrand._id,
      role: user.isBackoffice,
      status: 'active',
      joinedAt: new Date()
    }],
    activeBrandId: defaultBrand._id
  };
  await user.save();
}

// 3. Add brandId to all employees
await Employee.updateMany({}, { $set: { brandId: defaultBrand._id } });

// 4. Add brandId to all other collections
await OnboardingPacket.updateMany({}, { $set: { brandId: defaultBrand._id } });
await TrainingModule.updateMany({}, { $set: { brandId: defaultBrand._id } });
// ... etc for all collections

// 5. Create indexes
await Employee.collection.createIndex({ userId: 1, brandId: 1 }, { unique: true });
// ... etc
```

#### Step 6.2: Run Migration
```bash
node /srv/madladslab/scripts/migrate-to-multi-brand.js
```

---

## Testing Plan

### Unit Tests
- [ ] Brand CRUD operations
- [ ] User-brand association functions
- [ ] Permission checking with brand context
- [ ] Employee lookup per brand

### Integration Tests
- [ ] Brand creation flow
- [ ] Multi-brand user switching
- [ ] Brand-scoped data isolation
- [ ] Cross-brand permission denial

### Manual Tests
- [ ] Create brand as new user
- [ ] Join existing brand (if invite system added)
- [ ] Switch between brands
- [ ] Access control (staff can't access admin pages)
- [ ] Data visibility (can't see other brand's data)

---

## Rollout Strategy

### Stage 1: Database (No Downtime)
1. Deploy updated models with brandId (allow null temporarily)
2. Run migration script to populate brandId fields
3. Verify data integrity

### Stage 2: API (Backwards Compatible)
1. Update API functions to accept brandId parameter
2. Keep old function signatures working (use default brand)
3. Add new brand management endpoints

### Stage 3: Routes (Breaking Change)
1. Update all routes to use `:brandSlug` pattern
2. Add redirects from old URLs to new URLs (use activeBrand)
3. Deploy new middleware

### Stage 4: UI (Final)
1. Deploy brand setup/selector pages
2. Update all existing views
3. Remove old `isBackoffice` field references
4. Announce multi-brand feature to users

---

## Future Enhancements

### Phase 7+: Advanced Features
- [ ] Brand invitations (email invite system)
- [ ] Brand transfer (change owner)
- [ ] Brand templates (industry-specific setups)
- [ ] Brand analytics dashboard
- [ ] Multi-brand reporting (aggregate view for users with multiple brands)
- [ ] Brand white-labeling (custom domains, colors, logos)
- [ ] Brand API keys (for integrations)
- [ ] Brand webhooks (for automation)

---

## File Checklist

### New Files
- [ ] `/srv/madladslab/api/v1/models/gpc/Brand.js`
- [ ] `/srv/madladslab/api/v1/ep/brands.js`
- [ ] `/srv/madladslab/views/backOffice/brand-setup.ejs`
- [ ] `/srv/madladslab/views/backOffice/brand-selector.ejs`
- [ ] `/srv/madladslab/views/backOffice/brand-settings.ejs`
- [ ] `/srv/madladslab/scripts/migrate-to-multi-brand.js`

### Modified Files
- [ ] `/srv/madladslab/api/v1/models/User.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/Employee.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/OnboardingPacket.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/TrainingModule.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/TrainingProgress.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/Communication.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/Recipe.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/Task.js`
- [ ] `/srv/madladslab/api/v1/models/gpc/TaskCompletion.js`
- [ ] `/srv/madladslab/api/v1/ep/backOffice.js`
- [ ] `/srv/madladslab/routes/backOffice/index.js`
- [ ] All `/srv/madladslab/views/backOffice/**/*.ejs` files

---

## Database Notation Examples

### Collection: brands
```javascript
{
  _id: ObjectId("..."),
  name: "Awesome Restaurant",
  slug: "awesome-restaurant",
  description: "A family-owned Italian restaurant",
  logo: "https://cdn.madladslab.com/brands/awesome-restaurant/logo.png",
  industry: "restaurant",
  settings: {
    departments: ["kitchen", "bar", "floor", "management"],
    currency: "USD",
    timezone: "America/New_York",
    businessHours: { ... }
  },
  owner: ObjectId("user123"),
  status: "active",
  subscription: {
    plan: "pro",
    expiresAt: ISODate("2026-01-01")
  },
  createdAt: ISODate("2025-01-01"),
  updatedAt: ISODate("2025-01-15")
}
```

### Collection: users (updated)
```javascript
{
  _id: ObjectId("user123"),
  email: "john@example.com",
  displayName: "John Doe",
  // ... other fields ...

  backoffice: {
    brands: [
      {
        brandId: ObjectId("brand1"),
        role: "admin",
        status: "active",
        joinedAt: ISODate("2025-01-01")
      },
      {
        brandId: ObjectId("brand2"),
        role: "staff",
        status: "active",
        joinedAt: ISODate("2025-02-01")
      }
    ],
    activeBrandId: ObjectId("brand1"),
    lastAccessedAt: ISODate("2025-11-07")
  }
}
```

### Collection: employees (updated)
```javascript
{
  _id: ObjectId("emp123"),
  brandId: ObjectId("brand1"), // NEW - links to specific brand
  userId: ObjectId("user123"),
  role: "manager",
  position: "Kitchen Manager",
  department: "kitchen",
  hireDate: ISODate("2025-01-15"),
  status: "active",
  onboardingCompleted: true,
  trainingModulesCompleted: [ObjectId("mod1"), ObjectId("mod2")],
  assignedBy: ObjectId("adminUser"),
  createdAt: ISODate("2025-01-15"),
  updatedAt: ISODate("2025-02-01")
}

// Unique constraint: (userId + brandId)
// Same user can be employee in multiple brands
```

### Collection: tasks (updated)
```javascript
{
  _id: ObjectId("task123"),
  brandId: ObjectId("brand1"), // NEW - all tasks scoped to brand
  title: "Clean the grills",
  description: "Deep clean all grills at end of shift",
  department: "kitchen",
  targetRole: "staff",
  recurring: true,
  schedule: { ... },
  // ... rest of fields
}
```

### All Other Collections
Similar pattern - add `brandId: ObjectId` field to:
- onboarding_packets
- training_modules
- training_progress
- communications
- recipes
- task_completions

---

## Query Pattern Examples

### Before (Single-Tenant)
```javascript
// Get all employees
const employees = await Employee.find({ status: 'active' });

// Get all tasks for user's department
const tasks = await Task.find({ department: employee.department });
```

### After (Multi-Brand)
```javascript
// Get all employees for a brand
const employees = await Employee.find({
  brandId: req.brand._id,
  status: 'active'
});

// Get all tasks for user's department in their current brand
const tasks = await Task.find({
  brandId: req.brand._id,
  department: employee.department
});
```

---

## Security Considerations

1. **Brand Isolation**: All queries MUST include brandId filter
2. **Permission Checks**: Verify user has access to brand before any operation
3. **Cross-Brand Access**: Explicitly deny accessing data from another brand
4. **Admin Scope**: Admin role is per-brand, not global (unless user is owner of multiple brands)
5. **Data Export**: When exporting, only include data for brands user has access to

---

## Performance Considerations

1. **Indexes**: Add compound indexes with brandId as first field
2. **Caching**: Cache brand info per user session
3. **Lazy Loading**: Don't fetch all brands upfront, only when needed
4. **Pagination**: Implement pagination for large brand lists

---

## Success Metrics

- [ ] Zero cross-brand data leaks in testing
- [ ] Migration completes without data loss
- [ ] All existing features work with brand context
- [ ] Users can create and switch brands seamlessly
- [ ] API response times remain under 200ms for brand queries

---

**Status**: Ready for Implementation
**Estimated Time**: 3-5 days for full implementation + testing
**Priority**: High - Enables multi-tenant SaaS model
