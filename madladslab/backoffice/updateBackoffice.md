# updateBackoffice.md

**madLadsLab Restaurant POS & Admin Backoffice**

## Overview
Multi-tenant restaurant management system with POS, training, inventory, recipes, and team administration.

## Core Features
- **POS System** – Point of sale, orders, payments, receipts
- **Inventory Management** – Stock tracking, suppliers, variance reports
- **Recipe Management** – Standardized recipes, cost analysis, COGS
- **Team Panel** – Scheduling, payroll, performance, certifications
- **Training System** – Course management, completion tracking, compliance
- **Admin Dashboard** – Analytics, reporting, audits, system config

## Permission Hierarchy
```
Brand (root)
└── Restaurant (location)
    ├── Owner (full control, financials)
    ├── HR (hiring, payroll, compliance)
    ├── AD (general manager override)
    ├── GM (daily operations, scheduling)
    ├── Manager (shift ops, inventory, team)
    ├── Trainer (training modules, staff development)
    ├── Employee (clock in/out, tasks, performance)
    ├── Applicant (limited, job application only)
    ├── Visitor (menu/info only, read-only public)
    └── Non-Auth Guest (public website, no login)
```

## Architecture
- **Routes:** `/backoffice/*` (protected by role middleware)
- **Models:** Brand, Restaurant, User (with role/permissions), POS Order, Inventory, Recipe, Team, Training
- **Auth:** JWT + role-based access control (RBAC)
- **Frontend:** EJS templates + Vue/React components (TBD)
- **Database:** MongoDB collections (users, orders, inventory, recipes, teams, training_modules)

## Planned Modules (Phase 1)
1. Authentication & RBAC
2. Brand & Restaurant Management
3. User Management (roles, permissions, teams)
4. POS Core (orders, payments, receipts)
5. Inventory (stock, suppliers, variance)
6. Recipes (ingredients, costing, COGS)
7. Training (modules, tracking, compliance)
8. Team Panel (scheduling, payroll, performance)
9. Reporting & Analytics

## Execution Plan (Layer-by-Layer)

### Layer 1: Auth & RBAC
**Files to Create:**
- `/srv/madladslab/models/User.js` – User schema with role, restaurant, permissions
- `/srv/madladslab/models/Role.js` – Role definitions (Brand, Owner, HR, AD, GM, Manager, Trainer, Employee, Applicant, Visitor, Guest)
- `/srv/madladslab/middleware/authMiddleware.js` – JWT validation, role check, permission enforcement
- `/srv/madladslab/utils/permissions.js` – Permission matrix (role → allowed actions)

**Tasks:**
- [ ] Define User model (email, passwordHash, role, restaurantId, permissions)
- [ ] Create Role enum (BRAND_ADMIN, OWNER, HR, AD, GM, MANAGER, TRAINER, EMPLOYEE, APPLICANT, VISITOR, GUEST)
- [ ] Build JWT auth flow (login, refresh, logout)
- [ ] Implement RBAC middleware (authenticate → check role → enforce permissions)
- [ ] Create permission checker utility (hasPermission(user, action, resource))

---

### Layer 2: Models (MongoDB Schemas)
**Files to Create:**
- `/srv/madladslab/models/Brand.js` – Brand (parent org)
- `/srv/madladslab/models/Restaurant.js` – Restaurant (location, address, hours, manager)
- `/srv/madladslab/models/User.js` – User (already in Layer 1, extend with role details)
- `/srv/madladslab/models/POSOrder.js` – Order (items, total, payment, timestamp)
- `/srv/madladslab/models/Inventory.js` – Stock (item, quantity, location, reorder level)
- `/srv/madladslab/models/Recipe.js` – Recipe (name, ingredients, instructions, cost)
- `/srv/madladslab/models/Team.js` – Team (schedule, payroll, attendance)
- `/srv/madladslab/models/TrainingModule.js` – Training (course, progress, completion)

**Tasks:**
- [ ] Brand schema (name, logo, headquarters, contact)
- [ ] Restaurant schema (brandId, name, address, phone, hours, managerId)
- [ ] User schema (email, passwordHash, name, role, restaurantId, hireDate, status)
- [ ] POSOrder schema (restaurantId, items[], total, paymentMethod, timestamp, userId)
- [ ] Inventory schema (restaurantId, itemName, quantity, unit, location, reorderLevel, supplier)
- [ ] Recipe schema (restaurantId, name, ingredients[], instructions, cookTime, cogs, status)
- [ ] Team schema (restaurantId, userId[], schedules[], payroll[], certifications[])
- [ ] TrainingModule schema (restaurantId, title, content, requiredRole, completedBy[], status)

---

### Layer 3: Routes & Controllers
**Files to Create:**
- `/srv/madladslab/routes/backoffice/index.js` – Main backoffice router
- `/srv/madladslab/routes/backoffice/auth.js` – Auth routes (login, logout, refresh)
- `/srv/madladslab/routes/backoffice/pos.js` – POS routes (create order, view, refund)
- `/srv/madladslab/routes/backoffice/inventory.js` – Inventory routes (list, add, update, variance)
- `/srv/madladslab/routes/backoffice/recipes.js` – Recipe routes (CRUD, costing)
- `/srv/madladslab/routes/backoffice/team.js` – Team routes (schedule, payroll, performance)
- `/srv/madladslab/routes/backoffice/training.js` – Training routes (modules, progress, compliance)
- `/srv/madladslab/routes/backoffice/admin.js` – Admin routes (reports, analytics, user mgmt)

**Tasks:**
- [ ] POST /backoffice/auth/login → verify credentials, return JWT
- [ ] POST /backoffice/auth/logout → invalidate token
- [ ] POST /backoffice/pos/orders → create order (authMiddleware, roleCheck)
- [ ] GET /backoffice/pos/orders → list orders (filtered by restaurant, role)
- [ ] GET /backoffice/inventory → list stock (by restaurant)
- [ ] POST /backoffice/inventory → add item (Manager+ only)
- [ ] PUT /backoffice/inventory/:id → update stock
- [ ] GET /backoffice/recipes → list recipes
- [ ] POST /backoffice/recipes → create (Manager+ only)
- [ ] GET /backoffice/team/schedule → view shifts
- [ ] POST /backoffice/team/schedule → assign shift (GM+ only)
- [ ] GET /backoffice/training → list modules
- [ ] POST /backoffice/training/:moduleId/complete → mark complete (Employee+)
- [ ] GET /backoffice/admin/reports → analytics (Owner+ only)

---

### Layer 4: Views & Frontend
**Files to Create:**
- `/srv/madladslab/views/backoffice/layout.ejs` – Main backoffice layout
- `/srv/madladslab/views/backoffice/login.ejs` – Login page
- `/srv/madladslab/views/backoffice/dashboard.ejs` – Role-based dashboard
- `/srv/madladslab/views/backoffice/pos.ejs` – POS interface
- `/srv/madladslab/views/backoffice/inventory.ejs` – Stock management
- `/srv/madladslab/views/backoffice/recipes.ejs` – Recipe CRUD
- `/srv/madladslab/views/backoffice/team.ejs` – Team/scheduling panel
- `/srv/madladslab/views/backoffice/training.ejs` – Training dashboard
- `/srv/madladslab/views/backoffice/admin.ejs` – Admin panel (reports, user mgmt)

**Tasks:**
- [ ] Build login form + auth flow
- [ ] Create role-specific dashboard views (hide/show features by role)
- [ ] POS order entry + order history
- [ ] Inventory table + add/edit modals
- [ ] Recipe list + cost calculator
- [ ] Team schedule view + shift assignment
- [ ] Training module list + progress tracker
- [ ] Admin analytics + user management

---

### Layer 5: Integration & Testing
**Files to Create:**
- `/srv/madladslab/tests/backoffice.test.js` – Unit tests
- `/srv/madladslab/utils/seedData.js` – Test data generator

**Tasks:**
- [ ] Test auth flow (login, role validation, permission checks)
- [ ] Test POS order creation & retrieval
- [ ] Test inventory operations
- [ ] Test recipe COGS calculations
- [ ] Test team scheduling
- [ ] Test training completion tracking
- [ ] E2E: User login → POS order → inventory deduction → training module

---

## Status
- 🔄 **Ready for VS Code / Claude Ext Implementation**
- Use this plan as your checklist while building
- Each layer builds on the previous (complete Layer 1 auth before Layer 2 models, etc.)
- Test as you go — start with Layer 1 auth, then expand
