#!/usr/bin/env node

/**
 * Fix Employee Index - Drop old unique userId index
 *
 * This script drops the old userId_1 unique index that prevents
 * multi-brand support (where a user can have multiple employees).
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.DB_URL || 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net/madLadsLab';

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // List current indexes
    const indexes = await mongoose.connection.db.collection('employees').indexes();
    console.log('Current indexes:', indexes.map(i => i.name).join(', '));

    // Try to drop the old userId_1 unique index
    try {
      await mongoose.connection.db.collection('employees').dropIndex('userId_1');
      console.log('✅ Dropped userId_1 index successfully');
    } catch (e) {
      if (e.code === 27) {
        console.log('Index userId_1 does not exist (already dropped or never created)');
      } else {
        console.log('Error dropping index:', e.message);
      }
    }

    // List indexes after
    const indexesAfter = await mongoose.connection.db.collection('employees').indexes();
    console.log('Indexes after:', indexesAfter.map(i => i.name).join(', '));

    await mongoose.disconnect();
    console.log('Done!');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
