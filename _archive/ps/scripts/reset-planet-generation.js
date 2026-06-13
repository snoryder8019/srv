/**
 * Reset Planet Generation Data
 * Clears all planet generation, chunks, and pioneer achievements
 * for fresh testing
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function resetPlanetGeneration() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Get all planet generation records
    const planetGenRecords = await db.collection('planetGeneration').find({}).toArray();
    console.log(`Found ${planetGenRecords.length} planet generation records`);

    // Delete all planet chunks
    const chunksResult = await db.collection('planetChunks').deleteMany({});
    console.log(`Deleted ${chunksResult.deletedCount} planet chunks`);

    // Delete all planet generation data
    const genResult = await db.collection('planetGeneration').deleteMany({});
    console.log(`Deleted ${genResult.deletedCount} planet generation records`);

    // Delete all pioneer achievements
    const achievementsResult = await db.collection('achievements').deleteMany({
      type: 'pioneer'
    });
    console.log(`Deleted ${achievementsResult.deletedCount} pioneer achievements`);

    // Reset user analytics pioneer counts
    const analyticsResult = await db.collection('userAnalytics').updateMany(
      { 'achievements.pioneer': { $exists: true } },
      {
        $set: { 'achievements.pioneer': 0 },
        $inc: { totalExperience: -1000 } // Remove pioneer XP
      }
    );
    console.log(`Reset ${analyticsResult.modifiedCount} user analytics records`);

    console.log('\n✅ Planet generation reset complete!');
    console.log('All planets can now be visited fresh with new pioneer achievements.');

  } catch (error) {
    console.error('Error resetting planet generation:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

resetPlanetGeneration();
