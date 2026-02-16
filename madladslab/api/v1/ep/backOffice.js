import User from "../models/User.js";
import Employee from "../models/gpc/Employee.js";
import OnboardingPacket from "../models/gpc/OnboardingPacket.js";
import TrainingModule from "../models/gpc/TrainingModule.js";
import TrainingProgress from "../models/gpc/TrainingProgress.js";
import Communication from "../models/gpc/Communication.js";
import Recipe from "../models/gpc/Recipe.js";
import Task from "../models/gpc/Task.js";
import TaskCompletion from "../models/gpc/TaskCompletion.js";

// ============ EMPLOYEE MANAGEMENT ============

export async function createEmployee(data) {
  const employee = new Employee(data);
  await employee.save();

  // Sync User.isBackoffice with Employee.role (for backward compatibility)
  // In multi-brand, this tracks the "most recent" role
  await User.findByIdAndUpdate(
    data.userId,
    { $set: { isBackoffice: data.role || 'staff' } }
  );

  return await employee.populate('userId assignedBy');
}

export async function getEmployee(employeeId) {
  return await Employee.findById(employeeId).populate('userId assignedBy trainingModulesCompleted');
}

export async function getEmployeeByUserId(userId, brandId = null) {
  const query = { userId };
  if (brandId) {
    query.brandId = brandId;
  }
  return await Employee.findOne(query).populate('userId assignedBy trainingModulesCompleted');
}

export async function getAllEmployees(filters = {}) {
  const query = { ...filters };
  return await Employee.find(query)
    .populate('userId assignedBy')
    .sort({ createdAt: -1 });
}

export async function getEmployeesByBrand(brandId, filters = {}) {
  const query = { brandId, ...filters };
  return await Employee.find(query)
    .populate('userId assignedBy')
    .sort({ createdAt: -1 });
}

export async function updateEmployee(employeeId, updates) {
  const employee = await Employee.findByIdAndUpdate(
    employeeId,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('userId assignedBy');

  // Sync User.isBackoffice if role changed
  if (updates.role) {
    await User.findByIdAndUpdate(
      employee.userId._id,
      { $set: { isBackoffice: updates.role } }
    );
  }

  // Sync User.isBackoffice if status changed to inactive (remove role)
  if (updates.status === 'inactive') {
    await User.findByIdAndUpdate(
      employee.userId._id,
      { $set: { isBackoffice: null } }
    );
  }

  return employee;
}

export async function assignManagerRole(adminId, employeeId, brandId = null) {
  // Build query for admin check - if brandId provided, check admin within that brand
  const adminQuery = { userId: adminId, role: 'admin' };
  if (brandId) {
    adminQuery.brandId = brandId;
  }

  const admin = await Employee.findOne(adminQuery);
  if (!admin) {
    throw new Error('Only admins can assign manager roles');
  }

  const employee = await Employee.findByIdAndUpdate(
    employeeId,
    { $set: { role: 'manager', assignedBy: adminId } },
    { new: true }
  ).populate('userId assignedBy');

  // Sync User.isBackoffice with new manager role
  await User.findByIdAndUpdate(
    employee.userId._id,
    { $set: { isBackoffice: 'manager' } }
  );

  return employee;
}

// ============ ONBOARDING ============

export async function createOnboardingPacket(data) {
  const packet = new OnboardingPacket(data);
  await packet.save();
  return await packet.populate('employeeId assignedBy');
}

export async function getOnboardingPacket(packetId) {
  return await OnboardingPacket.findById(packetId).populate('employeeId assignedBy');
}

export async function getEmployeeOnboarding(employeeId) {
  return await OnboardingPacket.findOne({ employeeId }).populate('employeeId assignedBy');
}

export async function updateOnboardingDocument(packetId, documentIndex, updates) {
  const packet = await OnboardingPacket.findById(packetId);
  if (!packet) {
    throw new Error('Onboarding packet not found');
  }

  Object.assign(packet.documents[documentIndex], updates);

  // Check if all required documents are completed
  const allComplete = packet.documents
    .filter(doc => doc.required)
    .every(doc => doc.completed);

  if (allComplete && packet.status !== 'completed') {
    packet.status = 'completed';
    packet.completionDate = new Date();

    // Update employee onboarding status
    await Employee.findByIdAndUpdate(packet.employeeId, {
      onboardingCompleted: true,
      onboardingCompletedDate: new Date()
    });
  }

  await packet.save();
  return packet;
}

// ============ TRAINING ============

export async function createTrainingModule(data) {
  const module = new TrainingModule(data);
  await module.save();
  return module;
}

export async function getTrainingModule(moduleId) {
  return await TrainingModule.findById(moduleId).populate('createdBy');
}

export async function getAllTrainingModules(filters = {}, brandId = null) {
  const query = { active: true, ...filters };
  if (brandId) {
    query.brandId = brandId;
  }
  return await TrainingModule.find(query)
    .populate('createdBy')
    .sort({ category: 1, title: 1 });
}

export async function getTrainingModulesForEmployee(employeeId, brandId = null) {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }

  // Build query for modules - filter by brand if provided
  const moduleQuery = {
    active: true,
    $or: [
      { targetRoles: employee.role },
      { targetRoles: 'all' }
    ]
  };
  if (brandId) {
    moduleQuery.brandId = brandId;
  }

  // Get modules that target this employee's role or "all"
  const modules = await TrainingModule.find(moduleQuery).sort({ category: 1, title: 1 });

  // Get progress for each module
  const modulesWithProgress = await Promise.all(
    modules.map(async (module) => {
      const progressQuery = { employeeId, moduleId: module._id };
      if (brandId) {
        progressQuery.brandId = brandId;
      }
      const progress = await TrainingProgress.findOne(progressQuery);

      return {
        ...module.toObject(),
        progress: progress || { status: 'not-started', progress: 0 }
      };
    })
  );

  return modulesWithProgress;
}

export async function updateTrainingModule(moduleId, updates) {
  return await TrainingModule.findByIdAndUpdate(
    moduleId,
    { $set: updates },
    { new: true, runValidators: true }
  );
}

export async function startTrainingModule(employeeId, moduleId, brandId = null) {
  const query = { employeeId, moduleId };
  if (brandId) {
    query.brandId = brandId;
  }
  let progress = await TrainingProgress.findOne(query);

  if (!progress) {
    progress = new TrainingProgress({
      employeeId,
      moduleId,
      brandId,
      status: 'in-progress',
      progress: 0
    });
  } else {
    progress.status = 'in-progress';
  }

  await progress.save();
  return progress;
}

export async function updateTrainingProgress(employeeId, moduleId, progressPercentage, brandId = null) {
  const query = { employeeId, moduleId };
  if (brandId) {
    query.brandId = brandId;
  }
  return await TrainingProgress.findOneAndUpdate(
    query,
    {
      $set: {
        progress: progressPercentage,
        status: progressPercentage >= 100 ? 'completed' : 'in-progress',
        brandId
      }
    },
    { new: true, upsert: true }
  );
}

export async function submitQuiz(employeeId, moduleId, answers, brandId = null) {
  const module = await TrainingModule.findById(moduleId);
  if (!module) {
    throw new Error('Training module not found');
  }

  // Calculate score
  let correctAnswers = 0;
  module.quiz.forEach((question, index) => {
    if (answers[index] === question.correctAnswer) {
      correctAnswers++;
    }
  });

  const score = (correctAnswers / module.quiz.length) * 100;
  const passed = score >= module.passingScore;

  // Update progress
  const query = { employeeId, moduleId };
  if (brandId) {
    query.brandId = brandId;
  }
  let progress = await TrainingProgress.findOne(query);
  if (!progress) {
    progress = new TrainingProgress({ employeeId, moduleId, brandId });
  }

  progress.quizAttempts.push({
    attemptDate: new Date(),
    score,
    passed,
    answers
  });

  if (passed) {
    progress.status = 'completed';
    progress.progress = 100;
    progress.completionDate = new Date();

    // Add to employee's completed modules
    await Employee.findByIdAndUpdate(employeeId, {
      $addToSet: { trainingModulesCompleted: moduleId }
    });
  } else {
    progress.status = 'failed';
  }

  await progress.save();
  return { score, passed, progress };
}

// ============ COMMUNICATION ============

export async function createPost(data) {
  const post = new Communication(data);
  await post.save();
  return await post.populate('authorId');
}

export async function getAllPosts(targetAudience = null, limit = 50, brandId = null) {
  const query = targetAudience
    ? { targetAudience: { $in: [targetAudience, 'all'] } }
    : {};

  if (brandId) {
    query.brandId = brandId;
  }

  return await Communication.find(query)
    .populate('authorId comments.userId reactions.userId')
    .sort({ pinned: -1, createdAt: -1 })
    .limit(limit);
}

export async function getPost(postId) {
  return await Communication.findById(postId)
    .populate('authorId comments.userId reactions.userId');
}

export async function addComment(postId, userId, content) {
  const post = await Communication.findById(postId);
  if (!post) {
    throw new Error('Post not found');
  }

  post.comments.push({ userId, content });
  await post.save();
  return await post.populate('authorId comments.userId');
}

export async function addReaction(postId, userId, emoji) {
  const post = await Communication.findById(postId);
  if (!post) {
    throw new Error('Post not found');
  }

  // Remove existing reaction from this user if any
  post.reactions = post.reactions.filter(
    r => r.userId.toString() !== userId.toString()
  );

  // Add new reaction
  post.reactions.push({ userId, emoji });
  await post.save();
  return post;
}

export async function markPostAsRead(postId, userId) {
  return await Communication.findByIdAndUpdate(
    postId,
    { $addToSet: { readBy: userId } },
    { new: true }
  );
}

export async function togglePinPost(postId) {
  const post = await Communication.findById(postId);
  if (!post) {
    throw new Error('Post not found');
  }

  post.pinned = !post.pinned;
  await post.save();
  return post;
}

// ============ RECIPES & MENU ============

export async function createRecipe(data) {
  const recipe = new Recipe(data);
  await recipe.save();
  return await recipe.populate('createdBy lastUpdatedBy');
}

export async function getRecipe(recipeId, userRole) {
  const recipe = await Recipe.findById(recipeId).populate('createdBy lastUpdatedBy');
  if (!recipe) {
    throw new Error('Recipe not found');
  }

  // If user is staff and recipe is menu-only visibility, hide full details
  if (userRole === 'staff' && recipe.visibility === 'menu-only') {
    return {
      _id: recipe._id,
      name: recipe.name,
      description: recipe.menuDescription || recipe.description,
      category: recipe.category,
      subcategory: recipe.subcategory,
      imageUrls: recipe.imageUrls,
      allergens: recipe.allergens,
      dietaryInfo: recipe.dietaryInfo,
      price: recipe.price,
      ingredients: recipe.ingredients.map(i => ({ name: i.name })) // Only ingredient names
    };
  }

  return recipe;
}

export async function getAllRecipes(category = null, userRole = 'staff', brandId = null) {
  const query = { active: true };
  if (category) {
    query.category = category;
  }
  if (brandId) {
    query.brandId = brandId;
  }

  const recipes = await Recipe.find(query)
    .populate('createdBy lastUpdatedBy')
    .sort({ category: 1, name: 1 });

  // Filter based on user role
  if (userRole === 'staff') {
    return recipes.map(recipe => {
      if (recipe.visibility === 'menu-only') {
        return {
          _id: recipe._id,
          name: recipe.name,
          description: recipe.menuDescription || recipe.description,
          category: recipe.category,
          subcategory: recipe.subcategory,
          imageUrls: recipe.imageUrls,
          allergens: recipe.allergens,
          dietaryInfo: recipe.dietaryInfo,
          price: recipe.price,
          ingredients: recipe.ingredients.map(i => ({ name: i.name }))
        };
      }
      return recipe;
    });
  }

  return recipes;
}

export async function updateRecipe(recipeId, updates, userId) {
  updates.lastUpdatedBy = userId;
  return await Recipe.findByIdAndUpdate(
    recipeId,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('createdBy lastUpdatedBy');
}

// ============ TASKS ============

export async function createTask(data) {
  const task = new Task(data);
  await task.save();
  return await task.populate('createdBy');
}

export async function getTask(taskId) {
  return await Task.findById(taskId).populate('createdBy');
}

export async function getAllTasks(filters = {}, brandId = null) {
  const query = { active: true, ...filters };
  if (brandId) {
    query.brandId = brandId;
  }
  return await Task.find(query)
    .populate('createdBy')
    .sort({ type: 1, title: 1 });
}

export async function getTasksForEmployee(employeeRole, department, brandId = null) {
  const query = {
    active: true,
    $or: [
      { assignedRoles: employeeRole },
      { assignedRoles: 'all' }
    ],
    $and: [
      {
        $or: [
          { department: department },
          { department: 'all' }
        ]
      }
    ]
  };

  if (brandId) {
    query.brandId = brandId;
  }

  return await Task.find(query)
    .populate('createdBy')
    .sort({ type: 1, title: 1 });
}

export async function updateTask(taskId, updates) {
  return await Task.findByIdAndUpdate(
    taskId,
    { $set: updates },
    { new: true, runValidators: true }
  );
}

export async function completeTask(taskId, userId, stepsCompleted, notes = '', brandId = null) {
  const task = await Task.findById(taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const allStepsComplete = stepsCompleted.length === task.steps.length;

  const completionData = {
    taskId,
    completedBy: userId,
    stepsCompleted,
    allStepsComplete,
    notes
  };

  if (brandId) {
    completionData.brandId = brandId;
  }

  const completion = new TaskCompletion(completionData);

  await completion.save();
  return await completion.populate('completedBy taskId');
}

export async function getTaskCompletions(taskId, startDate = null, endDate = null) {
  const query = { taskId };

  if (startDate || endDate) {
    query.completionDate = {};
    if (startDate) query.completionDate.$gte = new Date(startDate);
    if (endDate) query.completionDate.$lte = new Date(endDate);
  }

  return await TaskCompletion.find(query)
    .populate('completedBy taskId verifiedBy')
    .sort({ completionDate: -1 });
}

export async function getEmployeeTaskHistory(userId, limit = 20) {
  return await TaskCompletion.find({ completedBy: userId })
    .populate('taskId')
    .sort({ completionDate: -1 })
    .limit(limit);
}

export async function verifyTaskCompletion(completionId, verifierId) {
  return await TaskCompletion.findByIdAndUpdate(
    completionId,
    {
      $set: {
        verifiedBy: verifierId,
        verifiedAt: new Date()
      }
    },
    { new: true }
  ).populate('completedBy taskId verifiedBy');
}
