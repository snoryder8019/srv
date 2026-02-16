import Brand from "../models/gpc/Brand.js";
import User from "../models/User.js";
import Employee from "../models/gpc/Employee.js";

// ============ BRAND CRUD ============

export async function createBrand(data, ownerId) {
  // Auto-generate slug from name if not provided
  if (!data.slug && data.name) {
    data.slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Ensure slug is unique by checking and appending number if needed
    let slugBase = data.slug;
    let counter = 1;
    while (await Brand.findOne({ slug: data.slug })) {
      data.slug = `${slugBase}-${counter}`;
      counter++;
    }
  }

  const brand = new Brand({
    ...data,
    owner: ownerId
  });

  await brand.save();

  // Add owner to brand with admin role
  try {
    await addUserToBrand(ownerId, brand._id, 'admin');
  } catch (error) {
    console.error('Error adding owner to brand:', error);
    // Rethrow to ensure the caller knows about the error
    throw new Error(`Brand created but failed to add owner: ${error.message}`);
  }

  return await brand.populate('owner');
}

export async function getBrand(brandId) {
  return await Brand.findById(brandId).populate('owner');
}

export async function getBrandBySlug(slug) {
  return await Brand.findOne({ slug }).populate('owner');
}

export async function getUserBrands(userId) {
  const user = await User.findById(userId).populate('backoffice.brands.brandId');

  if (!user || !user.backoffice || !user.backoffice.brands) {
    return [];
  }

  // Filter active brands and populate full brand data
  const activeBrands = user.backoffice.brands
    .filter(b => b.status === 'active' && b.brandId)
    .map(b => ({
      ...b.brandId.toObject(),
      userRole: b.role,
      joinedAt: b.joinedAt
    }));

  return activeBrands;
}

export async function getAllBrands(filters = {}) {
  const query = { status: 'active', ...filters };
  return await Brand.find(query)
    .populate('owner')
    .sort({ createdAt: -1 });
}

export async function updateBrand(brandId, updates) {
  // Don't allow updating slug or owner through this function
  delete updates.slug;
  delete updates.owner;

  return await Brand.findByIdAndUpdate(
    brandId,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('owner');
}

export async function deleteBrand(brandId) {
  // Soft delete by setting status to archived
  return await Brand.findByIdAndUpdate(
    brandId,
    { $set: { status: 'archived' } },
    { new: true }
  );
}

// ============ BRAND MEMBERSHIP ============

export async function addUserToBrand(userId, brandId, role = 'staff') {
  const brand = await Brand.findById(brandId);
  if (!brand) {
    throw new Error('Brand not found');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Initialize backoffice object if it doesn't exist
  if (!user.backoffice) {
    user.backoffice = { brands: [] };
  } else if (!user.backoffice.brands) {
    user.backoffice.brands = [];
  }

  // Check if user is already in this brand
  const existingBrand = user.backoffice.brands.find(
    b => b.brandId && b.brandId.toString() === brandId.toString()
  );

  if (existingBrand) {
    // Update existing role
    existingBrand.role = role;
    existingBrand.status = 'active';
  } else {
    // Add new brand association
    user.backoffice.brands.push({
      brandId,
      role,
      status: 'active',
      joinedAt: new Date()
    });
  }

  // Set as active brand if user has no active brand
  if (!user.backoffice.activeBrandId) {
    user.backoffice.activeBrandId = brandId;
  }

  user.backoffice.lastAccessedAt = new Date();

  await user.save();

  // Create or update employee record
  let employee = await Employee.findOne({ userId, brandId });

  if (!employee) {
    employee = new Employee({
      brandId,
      userId,
      role,
      position: 'Team Member', // Default position
      department: 'other',
      status: 'active'
    });
    try {
      await employee.save();
      console.log(`Created employee record for user ${userId} in brand ${brandId}`);
    } catch (empError) {
      console.error('Error creating employee record:', empError);
      throw empError;
    }
  } else {
    employee.role = role;
    employee.status = 'active';
    await employee.save();
    console.log(`Updated employee record for user ${userId} in brand ${brandId}`);
  }

  return user;
}

export async function removeUserFromBrand(userId, brandId) {
  const user = await User.findById(userId);
  if (!user || !user.backoffice || !user.backoffice.brands) {
    throw new Error('User or brand association not found');
  }

  // Find and update brand status to inactive
  const brandIndex = user.backoffice.brands.findIndex(
    b => b.brandId && b.brandId.toString() === brandId.toString()
  );

  if (brandIndex === -1) {
    throw new Error('User is not associated with this brand');
  }

  user.backoffice.brands[brandIndex].status = 'inactive';

  // If this was the active brand, clear it
  if (user.backoffice.activeBrandId &&
      user.backoffice.activeBrandId.toString() === brandId.toString()) {
    user.backoffice.activeBrandId = null;

    // Set new active brand to first active brand
    const activeBrand = user.backoffice.brands.find(b => b.status === 'active');
    if (activeBrand) {
      user.backoffice.activeBrandId = activeBrand.brandId;
    }
  }

  await user.save();

  // Update employee status
  await Employee.findOneAndUpdate(
    { userId, brandId },
    { $set: { status: 'inactive' } }
  );

  return user;
}

export async function updateUserBrandRole(userId, brandId, newRole) {
  const user = await User.findById(userId);
  if (!user || !user.backoffice || !user.backoffice.brands) {
    throw new Error('User or brand association not found');
  }

  // Find and update role
  const brand = user.backoffice.brands.find(
    b => b.brandId && b.brandId.toString() === brandId.toString()
  );

  if (!brand) {
    throw new Error('User is not associated with this brand');
  }

  brand.role = newRole;
  await user.save();

  // Update employee role
  await Employee.findOneAndUpdate(
    { userId, brandId },
    { $set: { role: newRole } }
  );

  return user;
}

export async function getUserBrandRole(userId, brandId) {
  const user = await User.findById(userId);
  if (!user || !user.backoffice || !user.backoffice.brands) {
    return null;
  }

  const brand = user.backoffice.brands.find(
    b => b.brandId && b.brandId.toString() === brandId.toString() && b.status === 'active'
  );

  return brand ? brand.role : null;
}

export async function setActiveBrand(userId, brandId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify user has access to this brand
  const hasAccess = user.backoffice && user.backoffice.brands &&
    user.backoffice.brands.some(
      b => b.brandId && b.brandId.toString() === brandId.toString() && b.status === 'active'
    );

  if (!hasAccess) {
    throw new Error('User does not have access to this brand');
  }

  if (!user.backoffice) {
    user.backoffice = {};
  }

  user.backoffice.activeBrandId = brandId;
  user.backoffice.lastAccessedAt = new Date();

  await user.save();
  return user;
}

// ============ HELPER FUNCTIONS ============

export async function getBrandEmployees(brandId) {
  return await Employee.find({ brandId, status: 'active' })
    .populate('userId')
    .sort({ createdAt: -1 });
}

export async function getBrandStats(brandId) {
  const employees = await Employee.countDocuments({ brandId, status: 'active' });
  const admins = await Employee.countDocuments({ brandId, role: 'admin', status: 'active' });
  const managers = await Employee.countDocuments({ brandId, role: 'manager', status: 'active' });
  const staff = await Employee.countDocuments({ brandId, role: 'staff', status: 'active' });

  return {
    totalEmployees: employees,
    admins,
    managers,
    staff
  };
}

export async function transferBrandOwnership(brandId, currentOwnerId, newOwnerId) {
  const brand = await Brand.findById(brandId);
  if (!brand) {
    throw new Error('Brand not found');
  }

  if (brand.owner.toString() !== currentOwnerId.toString()) {
    throw new Error('Only the current owner can transfer ownership');
  }

  brand.owner = newOwnerId;
  await brand.save();

  // Ensure new owner has admin role
  await addUserToBrand(newOwnerId, brandId, 'admin');

  return brand;
}

// Get employee by user and brand
export async function getEmployeeByUserAndBrand(userId, brandId) {
  return await Employee.findOne({ userId, brandId, status: 'active' })
    .populate('userId assignedBy trainingModulesCompleted');
}
