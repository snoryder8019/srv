import { connectDB, getDb } from '../plugins/mongo/mongo.js';

/**
 * Database Migration Script: Add Z Coordinates for 3D Galactic Map
 *
 * Purpose: Add Z coordinate to all collections that need 3D positioning
 * Run once: node scripts/migrate-to-3d-coordinates.js
 *
 * Collections Updated:
 * - characters (position.z)
 * - ships (position.z)
 * - stations (position.z)
 * - assets (coordinates.z - may already exist)
 * - planets (coordinates.z - may already exist)
 */

async function migrateCoordinates() {
  console.log('🚀 Starting 3D Coordinate Migration...\n');

  // Initialize database connection
  console.log('🔌 Connecting to database...\n');
  await connectDB();

  const db = getDb();
  const results = {};

  try {
    // 1. Characters Collection
    console.log('📍 Migrating Characters...');
    const charactersResult = await db.collection('characters').updateMany(
      { 'position.z': { $exists: false } },
      { $set: { 'position.z': 0 } }
    );
    results.characters = charactersResult.modifiedCount;
    console.log(`   ✓ Updated ${charactersResult.modifiedCount} characters\n`);

    // 2. Ships Collection (if exists)
    console.log('🚀 Migrating Ships...');
    try {
      const shipsResult = await db.collection('ships').updateMany(
        { 'position.z': { $exists: false } },
        { $set: { 'position.z': 0 } }
      );
      results.ships = shipsResult.modifiedCount;
      console.log(`   ✓ Updated ${shipsResult.modifiedCount} ships\n`);
    } catch (err) {
      console.log(`   ⚠ Ships collection not found or error: ${err.message}\n`);
      results.ships = 0;
    }

    // 3. Stations Collection (if exists)
    console.log('🏭 Migrating Stations...');
    try {
      const stationsResult = await db.collection('stations').updateMany(
        { 'position.z': { $exists: false } },
        { $set: { 'position.z': 0 } }
      );
      results.stations = stationsResult.modifiedCount;
      console.log(`   ✓ Updated ${stationsResult.modifiedCount} stations\n`);
    } catch (err) {
      console.log(`   ⚠ Stations collection not found or error: ${err.message}\n`);
      results.stations = 0;
    }

    // 4. Assets Collection (coordinates.z)
    console.log('🎨 Migrating Assets...');
    const assetsResult = await db.collection('assets').updateMany(
      { 'coordinates.z': { $exists: false } },
      { $set: { 'coordinates.z': 0 } }
    );
    results.assets = assetsResult.modifiedCount;
    console.log(`   ✓ Updated ${assetsResult.modifiedCount} assets\n`);

    // 5. Planets Collection (coordinates.z)
    console.log('🌍 Migrating Planets...');
    try {
      const planetsResult = await db.collection('planets').updateMany(
        { 'coordinates.z': { $exists: false } },
        { $set: { 'coordinates.z': 0 } }
      );
      results.planets = planetsResult.modifiedCount;
      console.log(`   ✓ Updated ${planetsResult.modifiedCount} planets\n`);
    } catch (err) {
      console.log(`   ⚠ Planets collection not found or error: ${err.message}\n`);
      results.planets = 0;
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ Migration Complete!');
    console.log('═══════════════════════════════════════');
    console.log(`Characters: ${results.characters} updated`);
    console.log(`Ships:      ${results.ships} updated`);
    console.log(`Stations:   ${results.stations} updated`);
    console.log(`Assets:     ${results.assets} updated`);
    console.log(`Planets:    ${results.planets} updated`);
    console.log('═══════════════════════════════════════\n');

    const totalUpdated = Object.values(results).reduce((sum, count) => sum + count, 0);
    console.log(`Total documents updated: ${totalUpdated}\n`);

    // Verification Query
    console.log('🔍 Verification: Checking sample documents...\n');

    const sampleCharacter = await db.collection('characters').findOne({ 'position.z': { $exists: true } });
    if (sampleCharacter) {
      console.log('Sample Character Position:', sampleCharacter.position);
    }

    const sampleAsset = await db.collection('assets').findOne({ 'coordinates.z': { $exists: true } });
    if (sampleAsset) {
      console.log('Sample Asset Coordinates:', sampleAsset.coordinates);
    }

    console.log('\n✅ All collections now have Z coordinates!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateCoordinates()
  .then(() => {
    console.log('✅ Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });
