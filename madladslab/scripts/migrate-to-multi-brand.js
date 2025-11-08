#!/usr/bin/env node

/**
 * Migration Script: Single-tenant to Multi-brand Backoffice
 *
 * This script migrates existing backoffice data to support multi-brand architecture.
 *
 * IMPORTANT: Backup your database before running this script!
 *
 * Usage:
 *   node /srv/madladslab/scripts/migrate-to-multi-brand.js
 *
 * Or with custom brand name:
 *   node /srv/madladslab/scripts/migrate-to-multi-brand.js --name="My Business"
 */

import mongoose from 'mongoose';
import Brand from '../api/v1/models/gpc/Brand.js';
import User from '../api/v1/models/User.js';
import Employee from '../api/v1/models/gpc/Employee.js';
import OnboardingPacket from '../api/v1/models/gpc/OnboardingPacket.js';
import TrainingModule from '../api/v1/models/gpc/TrainingModule.js';
import TrainingProgress from '../api/v1/models/gpc/TrainingProgress.js';
import Communication from '../api/v1/models/gpc/Communication.js';
import Recipe from '../api/v1/models/gpc/Recipe.js';
import Task from '../api/v1/models/gpc/Task.js';
import TaskCompletion from '../api/v1/models/gpc/TaskCompletion.js';

// Parse command line arguments
const args = process.argv.slice(2);
const brandNameArg = args.find(arg => arg.startsWith('--name='));
const DEFAULT_BRAND_NAME = brandNameArg ? brandNameArg.split('=')[1] : 'Default Brand';

// MongoDB connection
const MONGODB_URI = process.env.DB_URL || 'mongodb://localhost:27017/madladslab';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function migrate() {
  console.log('\n🚀 Starting Multi-Brand Migration\n');
  console.log('═'.repeat(60));

  try {
    // Step 1: Check if migration already ran
    console.log('\n📋 Step 1: Checking existing brands...');
    const existingBrands = await Brand.find();

    if (existingBrands.length > 0) {
      console.log(`⚠️  Found ${existingBrands.length} existing brand(s).`);
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question('Continue migration anyway? (yes/no): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Migration cancelled');
        return;
      }
    }

    // Step 2: Find first admin user to own the default brand
    console.log('\n📋 Step 2: Finding admin user...');
    const adminUser = await User.findOne({
      $or: [
        { isAdmin: true },
        { isBackoffice: 'admin' }
      ]
    });

    if (!adminUser) {
      console.log('⚠️  No admin user found. Creating default user...');
      // You might want to create a default admin here or exit
      throw new Error('No admin user found. Please create an admin user first.');
    }

    console.log(`✅ Found admin user: ${adminUser.email}`);

    // Step 3: Create default brand
    console.log('\n📋 Step 3: Creating default brand...');
    const defaultBrand = new Brand({
      name: DEFAULT_BRAND_NAME,
      slug: DEFAULT_BRAND_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      description: 'Migrated from single-tenant system',
      industry: 'other',
      owner: adminUser._id,
      status: 'active',
      settings: {
        departments: ['kitchen', 'bar', 'floor', 'management', 'other'],
        currency: 'USD',
        timezone: 'America/New_York'
      }
    });

    await defaultBrand.save();
    console.log(`✅ Created brand: "${defaultBrand.name}" (${defaultBrand.slug})`);

    // Step 4: Migrate users with isBackoffice to new structure
    console.log('\n📋 Step 4: Migrating user backoffice permissions...');
    const usersWithBackoffice = await User.find({ isBackoffice: { $ne: null } });
    console.log(`Found ${usersWithBackoffice.length} users with backoffice access`);

    let usersMigrated = 0;
    for (const user of usersWithBackoffice) {
      if (!user.backoffice) {
        user.backoffice = { brands: [] };
      }

      // Check if already has this brand
      const hasBrand = user.backoffice.brands.some(
        b => b.brandId && b.brandId.toString() === defaultBrand._id.toString()
      );

      if (!hasBrand) {
        user.backoffice.brands.push({
          brandId: defaultBrand._id,
          role: user.isBackoffice,
          status: 'active',
          joinedAt: new Date()
        });

        user.backoffice.activeBrandId = defaultBrand._id;
        user.backoffice.lastAccessedAt = new Date();

        await user.save();
        usersMigrated++;
      }
    }
    console.log(`✅ Migrated ${usersMigrated} users`);

    // Step 5: Add brandId to all employees
    console.log('\n📋 Step 5: Migrating employees...');
    const employeesWithoutBrand = await Employee.find({ brandId: { $exists: false } });
    console.log(`Found ${employeesWithoutBrand.length} employees without brandId`);

    const employeeUpdateResult = await Employee.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${employeeUpdateResult.modifiedCount} employees`);

    // Step 6: Add brandId to onboarding packets
    console.log('\n📋 Step 6: Migrating onboarding packets...');
    const onboardingUpdateResult = await OnboardingPacket.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${onboardingUpdateResult.modifiedCount} onboarding packets`);

    // Step 7: Add brandId to training modules
    console.log('\n📋 Step 7: Migrating training modules...');
    const trainingModuleUpdateResult = await TrainingModule.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${trainingModuleUpdateResult.modifiedCount} training modules`);

    // Step 8: Add brandId to training progress
    console.log('\n📋 Step 8: Migrating training progress...');
    const trainingProgressUpdateResult = await TrainingProgress.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${trainingProgressUpdateResult.modifiedCount} training progress records`);

    // Step 9: Add brandId to communications
    console.log('\n📋 Step 9: Migrating communications...');
    const communicationUpdateResult = await Communication.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${communicationUpdateResult.modifiedCount} communications`);

    // Step 10: Add brandId to recipes
    console.log('\n📋 Step 10: Migrating recipes...');
    const recipeUpdateResult = await Recipe.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${recipeUpdateResult.modifiedCount} recipes`);

    // Step 11: Add brandId to tasks
    console.log('\n📋 Step 11: Migrating tasks...');
    const taskUpdateResult = await Task.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${taskUpdateResult.modifiedCount} tasks`);

    // Step 12: Add brandId to task completions
    console.log('\n📋 Step 12: Migrating task completions...');
    const taskCompletionUpdateResult = await TaskCompletion.updateMany(
      { brandId: { $exists: false } },
      { $set: { brandId: defaultBrand._id } }
    );
    console.log(`✅ Updated ${taskCompletionUpdateResult.modifiedCount} task completions`);

    // Step 13: Create indexes
    console.log('\n📋 Step 13: Creating database indexes...');
    await Promise.all([
      Brand.collection.createIndex({ slug: 1 }, { unique: true }),
      Employee.collection.createIndex({ userId: 1, brandId: 1 }, { unique: true }),
      Employee.collection.createIndex({ brandId: 1 }),
      OnboardingPacket.collection.createIndex({ brandId: 1 }),
      TrainingModule.collection.createIndex({ brandId: 1 }),
      TrainingProgress.collection.createIndex({ brandId: 1 }),
      Communication.collection.createIndex({ brandId: 1 }),
      Recipe.collection.createIndex({ brandId: 1 }),
      Task.collection.createIndex({ brandId: 1 }),
      TaskCompletion.collection.createIndex({ brandId: 1 })
    ]);
    console.log('✅ Indexes created');

    // Migration summary
    console.log('\n' + '═'.repeat(60));
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!\n');
    console.log('Summary:');
    console.log(`  • Created brand: ${defaultBrand.name}`);
    console.log(`  • Migrated users: ${usersMigrated}`);
    console.log(`  • Migrated employees: ${employeeUpdateResult.modifiedCount}`);
    console.log(`  • Migrated onboarding packets: ${onboardingUpdateResult.modifiedCount}`);
    console.log(`  • Migrated training modules: ${trainingModuleUpdateResult.modifiedCount}`);
    console.log(`  • Migrated training progress: ${trainingProgressUpdateResult.modifiedCount}`);
    console.log(`  • Migrated communications: ${communicationUpdateResult.modifiedCount}`);
    console.log(`  • Migrated recipes: ${recipeUpdateResult.modifiedCount}`);
    console.log(`  • Migrated tasks: ${taskUpdateResult.modifiedCount}`);
    console.log(`  • Migrated task completions: ${taskCompletionUpdateResult.modifiedCount}`);
    console.log('\n' + '═'.repeat(60));

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}

async function main() {
  try {
    await connectDB();
    await migrate();
    console.log('\n✅ All done! Disconnecting...\n');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();
