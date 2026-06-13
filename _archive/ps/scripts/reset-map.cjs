/**
 * Reset Galactic Map - Fully distribute simulation
 */

require('dotenv').config();
const mongoose = require('mongoose');

const uri = `${process.env.DB_URL}/${process.env.DB_NAME}`;

const GalacticState = mongoose.model('GalacticState', new mongoose.Schema({}, { strict: false }));

async function resetMap() {
  try {
    console.log('🌌 Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    console.log('🗑️  Clearing existing galactic state...');
    const result = await GalacticState.deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} galactic state records`);

    await mongoose.disconnect();

    console.log('');
    console.log('🚀 Galactic map reset complete!');
    console.log('');
    console.log('📍 On next page load, all assets will:');
    console.log('   ✨ Be randomly distributed across 5000x5000 space');
    console.log('   ⚡ Receive new random velocities');
    console.log('   🌊 Start moving with live physics');
    console.log('');
    console.log('🎮 Tip: Increase movement speed in admin settings for faster action!');
    console.log('   https://ps.madladslab.com/admin/galactic-map-settings');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetMap();
