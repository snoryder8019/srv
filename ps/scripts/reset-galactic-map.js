/**
 * Reset Galactic Map - Fully distribute simulation
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection - use the same as the app
const mongoUri = `${process.env.DB_URL}/${process.env.DB_NAME}`;

const galacticStateSchema = new mongoose.Schema({}, { strict: false });
const GalacticState = mongoose.model('GalacticState', galacticStateSchema);

async function resetGalacticMap() {
  try {
    console.log('🌌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    console.log('🗑️  Clearing existing galactic state...');
    const result = await GalacticState.deleteMany({});
    console.log(`✅ Cleared ${result.deletedCount} galactic state records`);

    console.log('');
    console.log('🚀 Galactic map has been reset!');
    console.log('📍 Assets will be fully redistributed across 5000x5000 space on next load');
    console.log('⚡ All assets will receive NEW random initial velocities');
    console.log('');
    console.log('✨ Physics will start fresh with full distribution');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetGalacticMap();
