/**
 * Script to make a user an admin
 * Usage: node scripts/make-admin.js <email>
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function makeAdmin(email) {
  try {
    await connectDB();
    const db = getDb();

    const result = await db.collection(collections.users).updateOne(
      { email: email },
      { $set: { isAdmin: true } }
    );

    if (result.matchedCount === 0) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    if (result.modifiedCount > 0) {
      console.log(`✅ User ${email} is now an admin!`);
    } else {
      console.log(`ℹ️  User ${email} was already an admin`);
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
  console.error('Usage: node scripts/make-admin.js <email>');
  process.exit(1);
}

makeAdmin(email);
