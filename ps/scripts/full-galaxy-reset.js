#!/usr/bin/env node

/**
 * FULL GALAXY RESET
 * - Resets all orbital bodies (assets) to random positions
 * - Resets all characters to starting zone (center 2500,2500, radius 300)
 * - Clears spatial service cache
 * - Syncs everything to game state service
 */

import { connectDB, closeDB, getDb } from '../plugins/mongo/mongo.js';
import fetch from 'node-fetch';

const GAME_STATE_SERVICE_URL = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 5000;
const STARTING_ZONE = {
  centerX: 2500,
  centerY: 2500,
  radius: 300
};

async function fullGalaxyReset() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         FULL GALAXY RESET - COMPLETE RESTART          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    // Connect to database
    console.log('📊 Step 1: Connecting to database...');
    await connectDB();
    const db = getDb();
    console.log('   ✅ Connected to database\n');

    // Step 2: Clear spatial service cache FIRST
    console.log('🗑️  Step 2: Clearing spatial service cache...');
    try {
      const response = await fetch(`${GAME_STATE_SERVICE_URL}/api/spatial/assets`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        console.log('   ✅ Spatial service cache cleared');
        console.log(`   Response: ${JSON.stringify(data)}`);
      } else {
        console.log(`   ⚠️  Spatial service returned status: ${response.status}`);
      }
    } catch (err) {
      console.log(`   ⚠️  Could not reach spatial service: ${err.message}`);
      console.log('   (Continuing anyway...)');
    }
    console.log('');

    // Step 3: Reset asset coordinates (orbital bodies)
    console.log('🌍 Step 3: Resetting all orbital body positions...');
    console.log('   Clearing coordinates and initialPosition from all assets...');

    const assetResult = await db.collection('assets').updateMany(
      { status: 'approved' },
      {
        $unset: {
          'coordinates': '',
          'initialPosition': ''
        }
      }
    );

    console.log(`   ✅ Reset ${assetResult.modifiedCount} approved assets`);
    console.log('   Assets will generate NEW random positions on next map load\n');

    // Step 4: Reset ALL character locations to starting zone
    console.log('👥 Step 4: Resetting ALL characters to starting zone...');
    const characters = await db.collection('characters').find({}).toArray();
    console.log(`   Found ${characters.length} characters`);
    console.log(`   Starting zone: Center (${STARTING_ZONE.centerX}, ${STARTING_ZONE.centerY}), Radius ${STARTING_ZONE.radius}\n`);

    const resetCharacters = [];

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

      // Update local database
      await db.collection('characters').updateOne(
        { _id: char._id },
        { $set: { location: newLocation } }
      );

      // Store for game state sync
      resetCharacters.push({
        _id: char._id.toString(),
        userId: char.userId,
        name: char.name,
        level: char.level || 1,
        location: newLocation,
        navigation: char.navigation || {}
      });

      console.log(`   ✓ ${char.name.padEnd(20)} → (${Math.round(newLocation.x).toString().padStart(4)}, ${Math.round(newLocation.y).toString().padStart(4)})`);
    }

    console.log(`\n   ✅ Reset ${characters.length} character locations\n`);

    // Step 5: Sync to game state service
    console.log('🔄 Step 5: Syncing to game state service...');
    let syncSuccess = 0;
    let syncFail = 0;

    for (const char of resetCharacters) {
      try {
        const response = await fetch(`${GAME_STATE_SERVICE_URL}/api/characters/${char._id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(char)
        });

        if (response.ok) {
          syncSuccess++;
          console.log(`   ✓ ${char.name.padEnd(20)} → Synced`);
        } else {
          syncFail++;
          console.log(`   ✗ ${char.name.padEnd(20)} → Failed (${response.status})`);
        }
      } catch (err) {
        syncFail++;
        console.log(`   ✗ ${char.name.padEnd(20)} → Error: ${err.message}`);
      }
    }

    console.log(`\n   ✅ Synced ${syncSuccess}/${characters.length} characters\n`);

    // Step 6: Verify sync
    console.log('🔍 Step 6: Verifying synchronization...');
    try {
      const verifyResponse = await fetch(`${GAME_STATE_SERVICE_URL}/api/characters`);
      const verifyData = await verifyResponse.json();

      console.log(`   Game state service has ${verifyData.characters.length} characters`);

      let verified = 0;
      for (const local of resetCharacters) {
        const remote = verifyData.characters.find(r => r._id === local._id);
        if (remote) {
          const xMatch = Math.abs(local.location.x - remote.location.x) < 1;
          const yMatch = Math.abs(local.location.y - remote.location.y) < 1;
          if (xMatch && yMatch) {
            verified++;
          }
        }
      }

      console.log(`   ✅ Verified ${verified}/${characters.length} characters synced correctly\n`);
    } catch (err) {
      console.log(`   ⚠️  Could not verify: ${err.message}\n`);
    }

    // Summary
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                  RESET COMPLETE ✅                      ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`   📊 Assets reset:          ${assetResult.modifiedCount}`);
    console.log(`   👥 Characters reset:      ${characters.length}`);
    console.log(`   🔄 Game state synced:     ${syncSuccess}/${characters.length}`);
    console.log(`   🗑️  Spatial cache:         Cleared`);
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              BROWSER INSTRUCTIONS                      ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('   ⚠️  IMPORTANT: You must clear browser cache!');
    console.log('');
    console.log('   1. Close ALL open browser tabs with the galactic map');
    console.log('   2. Clear browser cache:');
    console.log('      - Chrome/Edge: Ctrl+Shift+Delete (Cmd+Shift+Delete on Mac)');
    console.log('      - Select "Cached images and files"');
    console.log('      - Click "Clear data"');
    console.log('   3. Open new tab and navigate to:');
    console.log('      https://ps.madladslab.com/universe/galactic-map');
    console.log('   4. The map should now show:');
    console.log('      - All characters clustered at center (2500, 2500)');
    console.log('      - All orbital bodies redistributed randomly');
    console.log('      - Scatter repulsion system active');
    console.log('');
    console.log('   If sync issues persist, the browser may still have');
    console.log('   old positions cached. Try incognito/private mode.');
    console.log('');

    await closeDB();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERROR during reset:', error);
    console.error(error.stack);
    await closeDB();
    process.exit(1);
  }
}

// Run the reset
fullGalaxyReset();
