/**
 * Add userRole field to all users
 * Sets all existing users to 'tester' role
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function addUserRoles() {
  try {
    // Initialize database connection
    await connectDB();
    const db = getDb();

    console.log('🔧 Adding userRole field to all users...');

    // Update all users without userRole to have 'tester' role
    const result = await db.collection('users').updateMany(
      { userRole: { $exists: false } },
      {
        $set: {
          userRole: 'tester',
          updatedAt: new Date()
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} users with 'tester' role`);

    // Show current user roles
    const users = await db.collection('users')
      .find({})
      .project({ username: 1, email: 1, userRole: 1 })
      .toArray();

    console.log('\n📊 Current User Roles:');
    users.forEach(user => {
      console.log(`  - ${user.username} (${user.email}): ${user.userRole || 'none'}`);
    });

    console.log('\n✨ User roles updated successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error updating user roles:', error);
    process.exit(1);
  }
}

// Run the script
addUserRoles();
