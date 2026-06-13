/**
 * Database Integration Tests
 * Tests MongoDB connection and basic operations
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect } from '../utils/test-helpers.js';

// Ensure environment variables are loaded from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

await describe('Database Integration', runner => {
  runner.it('should connect to MongoDB', async () => {
    try {
      const { connectDB } = await import('../../plugins/mongo/mongo.js');
      const db = await connectDB();

      const collections = await db.listCollections().toArray();
      expect(collections.length).toBeGreaterThan(0);
    } catch (error) {
      throw new Error(`Database connection failed: ${error.message}`);
    }
  });

  runner.it('should have required collections', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    const requiredCollections = ['users', 'characters', 'assets'];

    for (const required of requiredCollections) {
      if (!collectionNames.includes(required)) {
        throw new Error(`Required collection "${required}" not found`);
      }
    }
  });

  runner.it('should query users collection', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const userCount = await db.collection('users').countDocuments();
    expect(userCount).toBeGreaterThan(-1); // Should be >= 0
  });

  runner.it('should query characters collection', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const charCount = await db.collection('characters').countDocuments();
    expect(charCount).toBeGreaterThan(-1);
  });

  runner.it('should query assets collection', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const assetCount = await db.collection('assets').countDocuments();
    expect(assetCount).toBeGreaterThan(-1);
  });

  runner.it('should perform aggregation query', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const result = await db.collection('assets')
      .aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
      .toArray();

    expect(Array.isArray(result)).toBeTruthy();
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
