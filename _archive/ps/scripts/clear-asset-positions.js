/**
 * Clear asset positions from database
 * This resets the spatial physics data so assets can be randomly positioned again
 */
import dotenv from 'dotenv';
import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

dotenv.config();

async function clearAssetPositions() {
  try {
    console.log('🔌 Connecting to database...');
    await connectDB();
    const db = getDb();
    console.log('✅ Connected to database');

    console.log('🧹 Clearing spatial data from all assets...');

    // Clear x, y, vx, vy, staticCharge, radius, mass from all assets
    const result = await db.collection(collections.assets).updateMany(
      {},
      {
        $unset: {
          x: '',
          y: '',
          vx: '',
          vy: '',
          staticCharge: '',
          radius: '',
          mass: '',
          isStationary: ''
        }
      }
    );

    console.log(`✅ Cleared spatial data from ${result.modifiedCount} assets`);
    console.log('📍 Assets will be randomly positioned when the map loads next');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

clearAssetPositions();
