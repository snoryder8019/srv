import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function addIndex() {
  try {
    // Connect to database
    console.log('Connecting to MongoDB...');
    await connectDB();

    const db = getDb();

    // Add index on assetType for faster queries
    console.log('Creating index on assets.assetType...');
    const result = await db.collection('assets').createIndex({ assetType: 1 });
    console.log('✅ Index on assetType created:', result);

    // Check existing indexes
    const indexes = await db.collection('assets').indexes();
    console.log('\nExisting indexes:');
    for (const idx of indexes) {
      console.log(' - ' + Object.keys(idx.key).join(', '));
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

addIndex();
