#!/usr/bin/env node

/**
 * Reset Galactic Map - Comprehensive Reset
 * Resets all asset positions, character locations, and spatial cache
 */

import { connectDB, closeDB, getDb } from '../plugins/mongo/mongo.js';
import fetch from 'node-fetch';

const GAME_STATE_SERVICE_URL = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 5000;
const PADDING = 200;
const STARTING_ZONE = {
  centerX: 2500,
  centerY: 2500,
  radius: 300
};

async function resetGalacticMap() {
  console.log('═══════════════════════════════════════');
  console.log('🌌 GALACTIC MAP RESET');
  console.log('═══════════════════════════════════════\n');

  try {
    // Connect to database
    console.log('📊 Connecting to database...');
    await connectDB();
    const db = getDb();
    console.log('✅ Connected to database\n');

    // Step 1: Clear spatial service cache
    console.log('🗑️  Step 1: Clearing spatial service cache...');
    try {
      const response = await fetch(`${GAME_STATE_SERVICE_URL}/api/spatial/assets`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Spatial service cache cleared');
        console.log(`   Response: ${JSON.stringify(data)}`);
      } else {
        console.log(`⚠️  Spatial service returned status: ${response.status}`);
      }
    } catch (err) {
      console.log(`⚠️  Could not reach spatial service: ${err.message}`);
      console.log('   (This is OK if service is not running)');
    }
    console.log('');

    // Step 2: Reset asset coordinates
    console.log('📍 Step 2: Resetting asset coordinates...');
    console.log('   Clearing coordinates and initialPosition fields...');

    const assetResult = await db.collection('assets').updateMany(
      { status: 'approved' },
      {
        $unset: {
          'coordinates': '',
          'initialPosition': ''
        }
      }
    );

    console.log(`✅ Reset ${assetResult.modifiedCount} approved assets`);
    console.log('   (Assets will generate new random positions on next map load)');
    console.log('');

    // Step 3: Reset character locations to starting zone
    console.log('👤 Step 3: Resetting character locations to starting zone...');
    const characters = await db.collection('characters').find({}).toArray();
    console.log(`   Found ${characters.length} characters to reset`);
    console.log(`   Starting zone: Center (${STARTING_ZONE.centerX}, ${STARTING_ZONE.centerY}), Radius ${STARTING_ZONE.radius}`);
    console.log('');

    let characterUpdateCount = 0;
    for (const char of characters) {
      // Generate random position within starting zone circle
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * STARTING_ZONE.radius;

      const newLocation = {
        type: 'galactic',
        x: STARTING_ZONE.centerX + Math.cos(angle) * distance,
        y: STARTING_ZONE.centerY + Math.sin(angle) * distance,
        vx: 0,
        vy: 0
      };

      await db.collection('characters').updateOne(
        { _id: char._id },
        { $set: { location: newLocation } }
      );

      characterUpdateCount++;
      console.log(`   ✓ ${char.name.padEnd(20)} → (${Math.round(newLocation.x).toString().padStart(4)}, ${Math.round(newLocation.y).toString().padStart(4)})`);
    }

    console.log('');
    console.log(`✅ Reset ${characterUpdateCount} character locations to starting zone`);
    console.log('');

    // Step 4: Sync characters to game state service
    console.log('🔄 Step 4: Syncing characters to game state service...');
    let syncSuccessCount = 0;
    let syncErrorCount = 0;

    for (const char of characters) {
      try {
        const syncData = {
          _id: char._id.toString(),
          userId: char.userId,
          name: char.name,
          level: char.level || 1,
          location: char.location,
          navigation: char.navigation || {}
        };

        const response = await fetch(`${GAME_STATE_SERVICE_URL}/api/characters/${char._id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncData)
        });

        if (response.ok) {
          syncSuccessCount++;
          console.log(`   ✓ ${char.name.padEnd(20)} → Synced to game state`);
        } else {
          syncErrorCount++;
          console.log(`   ✗ ${char.name.padEnd(20)} → Sync failed`);
        }
      } catch (err) {
        syncErrorCount++;
        console.log(`   ✗ ${char.name.padEnd(20)} → Error: ${err.message}`);
      }
    }

    console.log('');
    console.log(`✅ Synced ${syncSuccessCount}/${characters.length} characters to game state`);
    if (syncErrorCount > 0) {
      console.log(`⚠️  ${syncErrorCount} sync errors (game state service may be down)`);
    }
    console.log('');

    // Step 5: Clear legacy galactic state (if it exists)
    console.log('🧹 Step 5: Clearing legacy galactic state...');
    try {
      const stateResult = await db.collection('galacticStates').deleteMany({});
      if (stateResult.deletedCount > 0) {
        console.log(`✅ Cleared ${stateResult.deletedCount} legacy state records`);
      } else {
        console.log('   No legacy state records found (this is normal)');
      }
    } catch (err) {
      console.log('   No legacy galactic state collection (this is normal)');
    }
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ RESET COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`   Assets reset:           ${assetResult.modifiedCount}`);
    console.log(`   Characters reset:       ${characterUpdateCount}`);
    console.log(`   Game state synced:      ${syncSuccessCount}/${characters.length}`);
    console.log(`   Spatial cache:          Cleared`);
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('🔄 Next steps:');
    console.log('   1. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)');
    console.log('   2. Reload: https://ps.madladslab.com/universe/galactic-map');
    console.log('   3. Assets will redistribute with scatter repulsion');
    console.log('   4. All characters start at center (2500, 2500)');
    console.log('   5. Physics will apply balanced distribution');
    console.log('');

    // Close database connection
    await closeDB();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error resetting galactic map:', error);
    console.error(error.stack);
    await closeDB();
    process.exit(1);
  }
}

// Run the reset
resetGalacticMap();
