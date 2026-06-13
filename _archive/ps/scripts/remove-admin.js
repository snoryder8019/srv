/**
 * Script to remove admin privileges from a user
 * Usage: node scripts/remove-admin.js <email>
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function removeAdmin(email) {
  try {
    await connectDB();
    const db = getDb();

    const result = await db.collection(collections.users).updateOne(
      { email: email },
      { $set: { isAdmin: false } }
    );

    if (result.matchedCount === 0) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    if (result.modifiedCount > 0) {
      console.log(`✅ Removed admin privileges from ${email}`);
    } else {
      console.log(`ℹ️  User ${email} was not an admin`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/remove-admin.js <email>');
  process.exit(1);
}

removeAdmin(email);
