/**
 * Update space hub status from 'published' to 'approved'
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function fixHubStatus() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');

    // Update all space hubs to have status: 'approved'
    const result = await assetsCollection.updateMany(
      { 'hubData.isStartingLocation': true },
      { $set: { status: 'approved' } }
    );

    console.log(`✓ Updated ${result.modifiedCount} space hubs to 'approved' status`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

fixHubStatus();
