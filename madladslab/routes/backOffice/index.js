import express from "express";
import multer from "multer";
import { uploadToLinode, isLinodeConfigured } from "../../lib/linodeStorage.js";
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
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// Require employee status (any backoffice role)
async function requireEmployee(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }

  try {
    const employee = await getEmployeeByUserId(req.user._id);
    if (!employee) {
      // Redirect to setup if no employee record exists
      return res.redirect('/backOffice/setup');
    }
    if (employee.status !== 'active') {
      return res.status(403).json({ error: "Access denied. Your employee account is not active." });
    }

    // Verify the user's isBackoffice matches their employee role
    if (req.user.isBackoffice !== employee.role) {
      console.warn(`User ${req.user._id} isBackoffice mismatch. User: ${req.user.isBackoffice}, Employee: ${employee.role}`);
    }

    req.employee = employee;
    next();
  } catch (error) {
    console.error("Error checking employee status:", error);
    return res.status(500).json({ error: "Error verifying employee status" });
  }
}

// Require manager or admin
function requireManager(req, res, next) {
  if (!req.user || !req.user.isBackoffice) {
    return res.status(403).json({ error: "Access denied." });
  }

  if (req.user.isBackoffice !== 'manager' && req.user.isBackoffice !== 'admin') {
    return res.status(403).json({ error: "Manager or admin access required." });
  }

  next();
}

// Require admin only
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isBackoffice) {
    return res.status(403).json({ error: "Access denied." });
  }

  if (req.user.isBackoffice !== 'admin') {
    return res.status(403).json({ error: "Admin access required." });
  }

  next();
}

// ============ VIEW ROUTES ============

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

// Setup/Registration - for first-time users to become employees
router.get("/setup", requireAuth, async (req, res) => {
  try {
    // Check if user is already an employee
    const existingEmployee = await getEmployeeByUserId(req.user._id);
    if (existingEmployee) {
      return res.redirect('/backOffice');
    }

    // Check if there are any admins - if not, this user can become the first admin
    const employees = await getAllEmployees();
    const hasAdmin = employees.some(emp => emp.role === 'admin');

    res.render("backOffice/setup", {
      user: req.user,
      canBeAdmin: !hasAdmin,
      title: "Back Office Setup"
    });
  } catch (error) {
    console.error("Error loading setup page:", error);
    res.status(500).send("Error loading setup page");
  }
});

// Process setup form
router.post("/setup", requireAuth, async (req, res) => {
  try {
    // Check if user is already an employee
    const existingEmployee = await getEmployeeByUserId(req.user._id);
    if (existingEmployee) {
      return res.redirect('/backOffice');
    }

    const { position, department, role } = req.body;

    // Validate required fields
    if (!position || !department) {
      return res.status(400).json({ error: "Position and department are required" });
    }

    // Check if this is the first employee - they become admin
    const employees = await getAllEmployees();
    const hasAdmin = employees.some(emp => emp.role === 'admin');

    let assignedRole = 'staff'; // Default role
    if (!hasAdmin) {
      assignedRole = 'admin'; // First user becomes admin
    } else if (role === 'manager' || role === 'admin') {
      // Only existing admins can assign manager/admin roles
      return res.status(403).json({ error: "Contact an admin to assign manager or admin roles" });
    }

    // Create employee record
    const employee = await createEmployee({
      userId: req.user._id,
      position,
      department,
      role: assignedRole,
      status: 'active'
    });

    res.redirect('/backOffice');
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({ error: error.message || "Error creating employee record" });
  }
});

// Main dashboard - redirects based on role
router.get("/", requireAuth, requireEmployee, async (req, res) => {
  try {
    const role = req.employee.role;

    if (role === 'admin') {
      return res.redirect('/backOffice/admin');
    } else if (role === 'manager') {
      return res.redirect('/backOffice/manager');
    } else {
      return res.redirect('/backOffice/staff');
    }
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Admin dashboard
router.get("/admin", requireAuth, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employees = await getAllEmployees();
    const posts = await getAllPosts(null, 10);

    res.render("backOffice/admin/dashboard", {
      user: req.user,
      employee: req.employee,
      employees,
      posts,
      title: "Admin Dashboard - Back Office"
    });
  } catch (error) {
    console.error("Error loading admin dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Admin employee management
router.get("/admin/employees", requireAuth, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employees = await getAllEmployees();
    const allUsers = await getAllEmployees(); // You might want to get all users, not just employees

    res.render("backOffice/admin/employees", {
      user: req.user,
      employee: req.employee,
      employees,
      title: "Employee Management - Back Office"
    });
  } catch (error) {
    console.error("Error loading employee management:", error);
    res.status(500).send("Error loading page");
  }
});

// Manager dashboard
router.get("/manager", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const employees = await getAllEmployees({ department: req.employee.department });
    const posts = await getAllPosts(req.employee.department, 10);

    res.render("backOffice/manager/dashboard", {
      user: req.user,
      employee: req.employee,
      employees,
      posts,
      title: "Manager Dashboard - Back Office"
    });
  } catch (error) {
    console.error("Error loading manager dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Staff dashboard
router.get("/staff", requireAuth, requireEmployee, async (req, res) => {
  try {
    const onboarding = await getEmployeeOnboarding(req.employee._id);
    const trainingModules = await getTrainingModulesForEmployee(req.employee._id);
    const posts = await getAllPosts(req.employee.department, 10);
    const tasks = await getTasksForEmployee(req.employee.role, req.employee.department);
    const taskHistory = await getEmployeeTaskHistory(req.user._id, 5);

    res.render("backOffice/staff/dashboard", {
      user: req.user,
      employee: req.employee,
      onboarding,
      trainingModules,
      posts,
      tasks,
      taskHistory,
      title: "Staff Dashboard - Back Office"
    });
  } catch (error) {
    console.error("Error loading staff dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// Communication/Feed page
router.get("/feed", requireAuth, requireEmployee, async (req, res) => {
  try {
    const posts = await getAllPosts(req.employee.department, 50);

    res.render("backOffice/feed", {
      user: req.user,
      employee: req.employee,
      posts,
      title: "Team Feed - Back Office"
    });
  } catch (error) {
    console.error("Error loading feed:", error);
    res.status(500).send("Error loading feed");
  }
});

// Training page
router.get("/training", requireAuth, requireEmployee, async (req, res) => {
  try {
    const trainingModules = await getTrainingModulesForEmployee(req.employee._id);

    res.render("backOffice/training", {
      user: req.user,
      employee: req.employee,
      trainingModules,
      title: "Training - Back Office"
    });
  } catch (error) {
    console.error("Error loading training:", error);
    res.status(500).send("Error loading training");
  }
});

// Recipes/Menu page
router.get("/recipes", requireAuth, requireEmployee, async (req, res) => {
  try {
    const category = req.query.category || null;
    const recipes = await getAllRecipes(category, req.employee.role);

    res.render("backOffice/recipes", {
      user: req.user,
      employee: req.employee,
      recipes,
      category,
      title: "Recipes & Menu - Back Office"
    });
  } catch (error) {
    console.error("Error loading recipes:", error);
    res.status(500).send("Error loading recipes");
  }
});

// Tasks page
router.get("/tasks", requireAuth, requireEmployee, async (req, res) => {
  try {
    const tasks = await getTasksForEmployee(req.employee.role, req.employee.department);
    const taskHistory = await getEmployeeTaskHistory(req.user._id, 20);

    res.render("backOffice/tasks", {
      user: req.user,
      employee: req.employee,
      tasks,
      taskHistory,
      title: "Tasks - Back Office"
    });
  } catch (error) {
    console.error("Error loading tasks:", error);
    res.status(500).send("Error loading tasks");
  }
});

// ============ API ROUTES - EMPLOYEES ============

router.get("/api/employees", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const employees = await getAllEmployees();
    res.json(employees);
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({ error: "Error fetching employees" });
  }
});

router.post("/api/employees", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const employee = await createEmployee({
      ...req.body,
      assignedBy: req.user._id
    });
    res.status(201).json(employee);
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/employees/:id", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const employee = await updateEmployee(req.params.id, req.body);
    res.json(employee);
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/employees/:id/assign-manager", requireAuth, requireEmployee, requireAdmin, async (req, res) => {
  try {
    const employee = await assignManagerRole(req.user._id, req.params.id);
    res.json(employee);
  } catch (error) {
    console.error("Error assigning manager role:", error);
    res.status(400).json({ error: error.message });
  }
});

// ============ API ROUTES - ONBOARDING ============

router.get("/api/onboarding/:employeeId", requireAuth, requireEmployee, async (req, res) => {
  try {
    const onboarding = await getEmployeeOnboarding(req.params.employeeId);
    res.json(onboarding);
  } catch (error) {
    console.error("Error fetching onboarding:", error);
    res.status(500).json({ error: "Error fetching onboarding" });
  }
});

router.post("/api/onboarding", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const packet = await createOnboardingPacket({
      ...req.body,
      assignedBy: req.user._id
    });
    res.status(201).json(packet);
  } catch (error) {
    console.error("Error creating onboarding packet:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/onboarding/:id/document/:index", requireAuth, requireEmployee, async (req, res) => {
  try {
    const packet = await updateOnboardingDocument(
      req.params.id,
      parseInt(req.params.index),
      req.body
    );
    res.json(packet);
  } catch (error) {
    console.error("Error updating onboarding document:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ API ROUTES - TRAINING ============

router.get("/api/training/modules", requireAuth, requireEmployee, async (req, res) => {
  try {
    const modules = await getTrainingModulesForEmployee(req.employee._id);
    res.json(modules);
  } catch (error) {
    console.error("Error fetching training modules:", error);
    res.status(500).json({ error: "Error fetching training modules" });
  }
});

router.get("/api/training/modules/:id", requireAuth, requireEmployee, async (req, res) => {
  try {
    const module = await getTrainingModule(req.params.id);
    res.json(module);
  } catch (error) {
    console.error("Error fetching training module:", error);
    res.status(500).json({ error: "Error fetching training module" });
  }
});

router.post("/api/training/modules", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const module = await createTrainingModule({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(module);
  } catch (error) {
    console.error("Error creating training module:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/training/modules/:id/start", requireAuth, requireEmployee, async (req, res) => {
  try {
    const progress = await startTrainingModule(req.employee._id, req.params.id);
    res.json(progress);
  } catch (error) {
    console.error("Error starting training module:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/training/modules/:id/quiz", requireAuth, requireEmployee, async (req, res) => {
  try {
    const result = await submitQuiz(req.employee._id, req.params.id, req.body.answers);
    res.json(result);
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ API ROUTES - COMMUNICATION ============

router.get("/api/feed", requireAuth, requireEmployee, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const posts = await getAllPosts(req.employee.department, limit);
    res.json(posts);
  } catch (error) {
    console.error("Error fetching feed:", error);
    res.status(500).json({ error: "Error fetching feed" });
  }
});

router.post("/api/feed", requireAuth, requireEmployee, async (req, res) => {
  try {
    const post = await createPost({
      ...req.body,
      authorId: req.user._id
    });
    res.status(201).json(post);
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/feed/:id/comment", requireAuth, requireEmployee, async (req, res) => {
  try {
    const post = await addComment(req.params.id, req.user._id, req.body.content);
    res.json(post);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/feed/:id/reaction", requireAuth, requireEmployee, async (req, res) => {
  try {
    const post = await addReaction(req.params.id, req.user._id, req.body.emoji);
    res.json(post);
  } catch (error) {
    console.error("Error adding reaction:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/feed/:id/pin", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const post = await togglePinPost(req.params.id);
    res.json(post);
  } catch (error) {
    console.error("Error toggling pin:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ API ROUTES - RECIPES ============

router.get("/api/recipes", requireAuth, requireEmployee, async (req, res) => {
  try {
    const category = req.query.category || null;
    const recipes = await getAllRecipes(category, req.employee.role);
    res.json(recipes);
  } catch (error) {
    console.error("Error fetching recipes:", error);
    res.status(500).json({ error: "Error fetching recipes" });
  }
});

router.get("/api/recipes/:id", requireAuth, requireEmployee, async (req, res) => {
  try {
    const recipe = await getRecipe(req.params.id, req.employee.role);
    res.json(recipe);
  } catch (error) {
    console.error("Error fetching recipe:", error);
    res.status(500).json({ error: "Error fetching recipe" });
  }
});

router.post("/api/recipes", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const recipe = await createRecipe({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(recipe);
  } catch (error) {
    console.error("Error creating recipe:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/recipes/:id", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const recipe = await updateRecipe(req.params.id, req.body, req.user._id);
    res.json(recipe);
  } catch (error) {
    console.error("Error updating recipe:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ API ROUTES - TASKS ============

router.get("/api/tasks", requireAuth, requireEmployee, async (req, res) => {
  try {
    const tasks = await getTasksForEmployee(req.employee.role, req.employee.department);
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Error fetching tasks" });
  }
});

router.post("/api/tasks", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const task = await createTask({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(task);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/tasks/:id/complete", requireAuth, requireEmployee, async (req, res) => {
  try {
    const completion = await completeTask(
      req.params.id,
      req.user._id,
      req.body.stepsCompleted,
      req.body.notes
    );
    res.json(completion);
  } catch (error) {
    console.error("Error completing task:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/tasks/:id/completions", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const completions = await getTaskCompletions(
      req.params.id,
      req.query.startDate,
      req.query.endDate
    );
    res.json(completions);
  } catch (error) {
    console.error("Error fetching task completions:", error);
    res.status(500).json({ error: "Error fetching task completions" });
  }
});

router.post("/api/tasks/completions/:id/verify", requireAuth, requireEmployee, requireManager, async (req, res) => {
  try {
    const completion = await verifyTaskCompletion(req.params.id, req.user._id);
    res.json(completion);
  } catch (error) {
    console.error("Error verifying task completion:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ IMAGE UPLOAD ROUTE (Linode Bucket) ============

router.post("/api/upload", requireAuth, requireEmployee, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const folder = req.body.folder || 'general'; // training, tasks, recipes, onboarding, etc.

    if (isLinodeConfigured()) {
      // Upload to Linode Object Storage
      const url = await uploadToLinode(req.file.buffer, req.file.originalname, folder);
      res.json({
        success: true,
        url: url,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } else {
      // Linode not configured, save locally for development
      console.warn('Linode Object Storage not configured. Saving file locally for development.');

      const fs = await import('fs/promises');
      const path = await import('path');
      const crypto = await import('crypto');

      // Generate unique filename
      const timestamp = Date.now();
      const randomString = crypto.randomBytes(8).toString('hex');
      const extension = req.file.originalname.split('.').pop();
      const filename = `${timestamp}-${randomString}.${extension}`;

      // Create directory if it doesn't exist
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', folder);
      await fs.mkdir(uploadDir, { recursive: true });

      // Save file
      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, req.file.buffer);

      const localUrl = `/uploads/${folder}/${filename}`;
      console.log(`[Local Upload] Saved to: ${filePath}`);

      res.json({
        success: true,
        url: localUrl,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        message: "Development mode - file saved locally. Configure Linode for production."
      });
    }
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: error.message || "Error uploading image" });
  }
});

export default router;
