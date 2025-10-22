/**
 * Initialize User Analytics
 * Adds stats and achievements fields to existing users
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

async function initializeUserAnalytics() {
  try {
    await connectDB();
    const db = getDb();

    console.log('Initializing user analytics...');

    // Update all users to have stats and achievements fields
    const result = await db.collection(collections.users).updateMany(
      {
        $or: [
          { stats: { $exists: false } },
          { achievements: { $exists: false } }
        ]
      },
      {
        $set: {
          stats: {
            totalActions: 0,
            assetsCreated: 0,
            assetsSubmitted: 0,
            votesCast: 0,
            suggestionsMade: 0,
            pageViews: 0,
            logins: 0,
            charactersCreated: 0,
            zonesVisited: 0,
            pagesByType: {}
          },
          achievements: [],
          lastActive: new Date()
        }
      }
    );

    console.log(`Updated ${result.modifiedCount} users with analytics fields`);

    // Create indexes for better performance
    await db.collection(collections.userActions).createIndex({ userId: 1, timestamp: -1 });
    await db.collection(collections.userActions).createIndex({ actionType: 1, timestamp: -1 });
    await db.collection(collections.users).createIndex({ lastActive: -1 });

    console.log('Created indexes for analytics');

    console.log('User analytics initialization complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing user analytics:', error);
    process.exit(1);
  }
}

initializeUserAnalytics();
