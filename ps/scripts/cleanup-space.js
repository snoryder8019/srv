/**
 * Cleanup Database Space
 * Remove unnecessary data to free up space
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function cleanupSpace() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Check collection sizes
    const collections = await db.listCollections().toArray();

    console.log('\n📊 Collection Sizes:');
    for (const col of collections) {
      const stats = await db.command({ collStats: col.name });
      const sizeMB = (stats.storageSize / 1024 / 1024).toFixed(2);
      const count = stats.count;
      console.log(`  ${col.name}: ${sizeMB} MB (${count} documents)`);
    }

    // Clean up planet chunks (largest data usually)
    console.log('\n🧹 Cleaning up planet chunks...');
    const chunksResult = await db.collection('planetChunks').deleteMany({});
    console.log(`  Deleted ${chunksResult.deletedCount} planet chunks`);

    // Clean up planet generation data
    const genResult = await db.collection('planetGeneration').deleteMany({});
    console.log(`  Deleted ${genResult.deletedCount} planet generation records`);

    // Clean up old sessions
    const sessionsResult = await db.collection('sessions').deleteMany({
      expires: { $lt: new Date() }
    });
    console.log(`  Deleted ${sessionsResult.deletedCount} expired sessions`);

    console.log('\n✅ Cleanup complete!');

  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

cleanupSpace();
