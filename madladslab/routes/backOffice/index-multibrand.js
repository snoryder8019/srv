import express from "express";
import multer from "multer";
import { uploadToLinode, isLinodeConfigured } from "../../lib/linodeStorage.js";

// Brand management imports
import {
  createBrand,
  getBrand,
  getBrandBySlug,
  getUserBrands,
  updateBrand,
  addUserToBrand,
  removeUserFromBrand,
  updateUserBrandRole,
  setActiveBrand,
  getBrandEmployees,
  getEmployeeByUserAndBrand
} from "../../api/v1/ep/brandManagement.js";

// Backoffice imports (will need updating to accept brandId)
import {
  // Employee
  createEmployee,
  getEmployee,
  getEmployeeByUserId,
  getAllEmployees,
  updateEmployee,
  assignManagerRole,
  // Onboarding
  createOnboardingPacket,
  getOnboardingPacket,
  getEmployeeOnboarding,
  updateOnboardingDocument,
  // Training
  createTrainingModule,
  getTrainingModule,
  getAllTrainingModules,
  getTrainingModulesForEmployee,
  updateTrainingModule,
  startTrainingModule,
  updateTrainingProgress,
  submitQuiz,
  // Communication
  createPost,
  getAllPosts,
  getPost,
  addComment,
  addReaction,
  markPostAsRead,
  togglePinPost,
  // Recipes
  createRecipe,
  getRecipe,
  getAllRecipes,
  updateRecipe,
  // Tasks
  createTask,
  getTask,
  getAllTasks,
  getTasksForEmployee,
  updateTask,
  completeTask,
  getTaskCompletions,
  getEmployeeTaskHistory,
  verifyTaskCompletion
} from "../../api/v1/ep/backOffice.js";

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and PDFs only
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
  }
});

// ============ MIDDLEWARE ============

// Require authenticated user
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

// Extract and validate brand context from URL
async function requireBrand(req, res, next) {
  try {
    const brandSlug = req.params.brandSlug || req.query.brand;

    if (!brandSlug) {
      return res.redirect('/backoffice');
    }

    const brand = await getBrandBySlug(brandSlug);
    if (!brand) {
      return res.status(404).send('Brand not found');
    }

    if (brand.status !== 'active') {
      return res.status(403).send('This brand is no longer active');
    }

    req.brand = brand;

    // Store in session for convenience
    if (req.session) {
      req.session.activeBrandSlug = brandSlug;
    }

    next();
  } catch (error) {
    console.error('Error in requireBrand middleware:', error);
    return res.status(500).send('Error loading brand');
  }
}

// Require employee status for the current brand
async function requireEmployee(req, res, next) {
  if (!req.user || !req.brand) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const employee = await getEmployeeByUserAndBrand(req.user._id, req.brand._id);

    if (!employee) {
      return res.status(403).render('backOffice/no-access', {
        user: req.user,
        brand: req.brand,
        message: 'You are not an employee of this brand. Contact an administrator for access.'
      });
    }

    if (employee.status !== 'active') {
      return res.status(403).json({ error: "Your employee account is not active for this brand." });
    }

    req.employee = employee;
    next();
  } catch (error) {
    console.error("Error checking employee status:", error);
    return res.status(500).json({ error: "Error verifying employee status" });
  }
}

// Require manager or admin role for current brand
function requireManager(req, res, next) {
  if (!req.employee) {
    return res.status(403).json({ error: "Access denied." });
  }

  if (!['manager', 'admin'].includes(req.employee.role)) {
    return res.status(403).json({ error: "Manager or admin access required." });
  }

  next();
}

// Require admin role for current brand
function requireAdmin(req, res, next) {
  if (!req.employee) {
    return res.status(403).json({ error: "Access denied." });
  }

  if (req.employee.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required." });
  }

  next();
}

// ============ BRAND LANDING & SELECTION ROUTES ============

// Main landing page - brand setup or selector
router.get("/", requireAuth, async (req, res) => {
  try {
    const brands = await getUserBrands(req.user._id);

    if (brands.length === 0) {
      // No brands - show setup page
      return res.render("backOffice/brand-setup", {
        user: req.user,
        title: "Create Your Brand - Back Office"
      });
    } else if (brands.length === 1) {
      // Single brand - redirect directly
      return res.redirect(`/backoffice/${brands[0].slug}`);
    } else {
      // Multiple brands - show selector
      return res.render("backOffice/brand-selector", {
        user: req.user,
        brands,
        title: "Select Brand - Back Office"
      });
    }
  } catch (error) {
    console.error("Error loading backoffice landing:", error);
    res.status(500).send("Error loading page");
  }
});

// Create new brand
router.post("/brands/create", requireAuth, async (req, res) => {
  try {
    const { name, description, industry, departments } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Brand name is required" });
    }

    const brand = await createBrand({
      name,
      description,
      industry: industry || 'other',
      settings: {
        departments: departments ? departments.split(',').map(d => d.trim()) : ['kitchen', 'bar', 'floor', 'management', 'other']
      }
    }, req.user._id);

    res.redirect(`/backoffice/${brand.slug}`);
  } catch (error) {
    console.error("Error creating brand:", error);
    res.status(500).json({ error: error.message || "Error creating brand" });
  }
});

// Public info page - accessible to anyone
router.get("/info", async (req, res) => {
  try {
    const user = req.user || null;
    res.render("backOffice/info", {
      user: user,
      title: "Back Office - MadLadsLab"
    });
  } catch (error) {
    console.error("Error loading info page:", error);
    res.status(500).send("Error loading page");
  }
});

// ============ BRAND-SCOPED ROUTES ============

// Brand dashboard - redirects based on role
router.get("/:brandSlug", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const role = req.employee.role;

    if (role === 'admin') {
      return res.redirect(`/backoffice/${req.brand.slug}/admin`);
    } else if (role === 'manager') {
      return res.redirect(`/backoffice/${req.brand.slug}/manager`);
    } else {
      return res.redirect(`/backoffice/${req.brand.slug}/staff`);
    }
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Admin dashboard
router.get("/:brandSlug/admin", requireAuth, requireBrand, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employees = await getBrandEmployees(req.brand._id);
    const posts = await getAllPosts(null, 10); // TODO: Add brandId filter

    res.render("backOffice/admin/dashboard", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      employees,
      posts,
      title: `Admin Dashboard - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading admin dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Admin employee management
router.get("/:brandSlug/admin/employees", requireAuth, requireBrand, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employees = await getBrandEmployees(req.brand._id);

    res.render("backOffice/admin/employees", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      employees,
      title: `Employee Management - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading employee management:", error);
    res.status(500).send("Error loading page");
  }
});

// Manager dashboard
router.get("/:brandSlug/manager", requireAuth, requireBrand, requireEmployee, requireManager, async (req, res) => {
  try {
    const employees = await getAllEmployees({ department: req.employee.department }); // TODO: Add brandId
    const posts = await getAllPosts(req.employee.department, 10); // TODO: Add brandId

    res.render("backOffice/manager/dashboard", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      employees,
      posts,
      title: `Manager Dashboard - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading manager dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Staff dashboard
router.get("/:brandSlug/staff", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const onboarding = await getEmployeeOnboarding(req.employee._id);
    const trainingModules = await getTrainingModulesForEmployee(req.employee._id);
    const posts = await getAllPosts(req.employee.department, 10); // TODO: Add brandId
    const tasks = await getTasksForEmployee(req.employee.role, req.employee.department); // TODO: Add brandId
    const taskHistory = await getEmployeeTaskHistory(req.user._id, 5);

    res.render("backOffice/staff/dashboard", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      onboarding,
      trainingModules,
      posts,
      tasks,
      taskHistory,
      title: `Staff Dashboard - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading staff dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Communication/Feed page
router.get("/:brandSlug/feed", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const posts = await getAllPosts(req.employee.department, 50); // TODO: Add brandId

    res.render("backOffice/feed", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      posts,
      title: `Team Feed - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading feed:", error);
    res.status(500).send("Error loading feed");
  }
});

// Training page
router.get("/:brandSlug/training", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const trainingModules = await getTrainingModulesForEmployee(req.employee._id);

    res.render("backOffice/training", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      trainingModules,
      title: `Training - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading training:", error);
    res.status(500).send("Error loading training");
  }
});

// Recipes/Menu page
router.get("/:brandSlug/recipes", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const category = req.query.category || null;
    const recipes = await getAllRecipes(category, req.employee.role); // TODO: Add brandId

    res.render("backOffice/recipes", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      recipes,
      category,
      title: `Recipes & Menu - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading recipes:", error);
    res.status(500).send("Error loading recipes");
  }
});

// Tasks page
router.get("/:brandSlug/tasks", requireAuth, requireBrand, requireEmployee, async (req, res) => {
  try {
    const tasks = await getTasksForEmployee(req.employee.role, req.employee.department); // TODO: Add brandId
    const taskHistory = await getEmployeeTaskHistory(req.user._id, 20);

    res.render("backOffice/tasks", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      tasks,
      taskHistory,
      title: `Tasks - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading tasks:", error);
    res.status(500).send("Error loading tasks");
  }
});

// Brand settings
router.get("/:brandSlug/settings", requireAuth, requireBrand, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employees = await getBrandEmployees(req.brand._id);

    res.render("backOffice/brand-settings", {
      user: req.user,
      employee: req.employee,
      brand: req.brand,
      employees,
      title: `Brand Settings - ${req.brand.name}`
    });
  } catch (error) {
    console.error("Error loading brand settings:", error);
    res.status(500).send("Error loading page");
  }
});

// ============ API ROUTES ============
// Note: All API routes now require brand context

// Brand API routes
router.post("/api/brands/:brandId/update", requireAuth, async (req, res) => {
  try {
    // TODO: Verify user is admin of this brand
    const brand = await updateBrand(req.params.brandId, req.body);
    res.json(brand);
  } catch (error) {
    console.error("Error updating brand:", error);
    res.status(500).json({ error: error.message });
  }
});

// Employees API
router.get("/:brandSlug/api/employees", requireAuth, requireBrand, requireEmployee, requireManager, async (req, res) => {
  try {
    const employees = await getBrandEmployees(req.brand._id);
    res.json(employees);
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({ error: "Error fetching employees" });
  }
});

router.post("/:brandSlug/api/employees", requireAuth, requireBrand, requireEmployee, requireManager, async (req, res) => {
  try {
    const employee = await createEmployee({
      ...req.body,
      brandId: req.brand._id,
      assignedBy: req.user._id
    });
    res.status(201).json(employee);
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({ error: error.message });
  }
});

// TODO: Add all other API routes with brand context
// (Feed, Training, Recipes, Tasks, etc.)

// ============ IMAGE UPLOAD ROUTE ============

router.post("/:brandSlug/api/upload", requireAuth, requireBrand, requireEmployee, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const folder = `${req.brand.slug}/${req.body.folder || 'general'}`;

    if (isLinodeConfigured()) {
      const url = await uploadToLinode(req.file.buffer, req.file.originalname, folder);
      res.json({
        success: true,
        url: url,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } else {
      // Local development fallback
      const fs = await import('fs/promises');
      const path = await import('path');
      const crypto = await import('crypto');

      const timestamp = Date.now();
      const randomString = crypto.randomBytes(8).toString('hex');
      const extension = req.file.originalname.split('.').pop();
      const filename = `${timestamp}-${randomString}.${extension}`;

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', folder);
      await fs.mkdir(uploadDir, { recursive: true });

      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, req.file.buffer);

      const localUrl = `/uploads/${folder}/${filename}`;

      res.json({
        success: true,
        url: localUrl,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        message: "Development mode - file saved locally"
      });
    }
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: error.message || "Error uploading image" });
  }
});

export default router;
