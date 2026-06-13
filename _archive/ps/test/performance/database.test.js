/**
 * Database Performance Tests
 * Tests database query performance and optimization
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect } from '../utils/test-helpers.js';

// Ensure environment variables are loaded from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  SIMPLE_QUERY: 100,      // Simple find queries
  COMPLEX_QUERY: 500,     // Aggregation queries
  BULK_OPERATION: 1000,   // Bulk inserts/updates
  INDEX_QUERY: 100        // Indexed queries (relaxed from 50ms for network variability)
};

await describe('Database Performance', runner => {
  runner.it('should perform simple queries quickly', async () => {
    const { connectDB } = await import('../../plugins/mongo/mongo.js');
    const db = await connectDB();

    const startTime = Date.now();
    const users = await db.collection('users').find({}).limit(10).toArray();
    const duration = Date.now() - startTime;

    console.log(`    Simple query took ${duration}ms`);
    expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_QUERY);
  });

  runner.it('should perform indexed queries efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    // Create a test user ID (first user in collection)
    const firstUser = await db.collection('users').findOne({});
    if (!firstUser) {
      console.log('    Skipped: No users in database');
      return;
    }

    const startTime = Date.now();
    const user = await db.collection('users').findOne({ _id: firstUser._id });
    const duration = Date.now() - startTime;

    console.log(`    Indexed query took ${duration}ms`);
    expect(duration).toBeLessThan(THRESHOLDS.INDEX_QUERY);
  });

  runner.it('should handle aggregation queries efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const startTime = Date.now();
    const results = await db.collection('characters')
      .aggregate([
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
      .toArray();
    const duration = Date.now() - startTime;

    console.log(`    Aggregation query took ${duration}ms (${results.length} results)`);
    expect(duration).toBeLessThan(THRESHOLDS.COMPLEX_QUERY);
  });

  runner.it('should handle asset queries with filters efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const startTime = Date.now();
    const assets = await db.collection('assets')
      .find({
        status: { $in: ['approved', 'pending'] },
        category: { $exists: true }
      })
      .limit(50)
      .toArray();
    const duration = Date.now() - startTime;

    console.log(`    Filtered asset query took ${duration}ms (${assets.length} results)`);
    expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_QUERY);
  });

  runner.it('should handle character lookup by user efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // Get a user with characters
    const userWithChar = await db.collection('characters').findOne({});
    if (!userWithChar) {
      console.log('    Skipped: No characters in database');
      return;
    }

    const startTime = Date.now();
    const characters = await db.collection('characters')
      .find({ userId: userWithChar.userId })
      .toArray();
    const duration = Date.now() - startTime;

    console.log(`    User character lookup took ${duration}ms (${characters.length} results)`);
    expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_QUERY);
  });

  runner.it('should handle complex joins efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const startTime = Date.now();
    const results = await db.collection('characters')
      .aggregate([
        { $limit: 20 },
        {
          $lookup: {
            from: 'users',
            let: { userId: '$userId' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', { $toObjectId: '$$userId' }] } } }
            ],
            as: 'user'
          }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
      ])
      .toArray();
    const duration = Date.now() - startTime;

    console.log(`    Join query took ${duration}ms (${results.length} results)`);
    expect(duration).toBeLessThan(THRESHOLDS.COMPLEX_QUERY);
  });

  runner.it('should measure collection sizes', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const collections = ['users', 'characters', 'assets'];
    const stats = [];

    for (const collectionName of collections) {
      const count = await db.collection(collectionName).countDocuments();
      stats.push({ collection: collectionName, count });
    }

    console.log('    Collection sizes:');
    stats.forEach(({ collection, count }) => {
      console.log(`      ${collection}: ${count} documents`);
    });

    // This test always passes - it's informational
    expect(stats.length).toBeGreaterThan(0);
  });

}).then(async () => {
  // Cleanup: Close database connection after all tests complete
  const { closeDB } = await import('../../plugins/mongo/mongo.js');
  await closeDB();
  process.exit(0);
}).catch(async (error) => {
  // Cleanup: Close database connection even on failure
  const { closeDB } = await import('../../plugins/mongo/mongo.js');
  await closeDB();
  process.exit(1);
});
