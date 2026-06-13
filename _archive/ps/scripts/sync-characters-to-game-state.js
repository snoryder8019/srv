#!/usr/bin/env node

/**
 * Sync Characters to Game State Service
 * Syncs all local characters to the game state service
 */

import { connectDB, closeDB, getDb } from '../plugins/mongo/mongo.js';
import fetch from 'node-fetch';

const GAME_STATE_URL = process.env.GAME_STATE_SERVICE_URL || 'http://localhost:3500';

async function syncCharactersToGameState() {
  console.log('═══════════════════════════════════════');
  console.log('🔄 SYNC CHARACTERS TO GAME STATE');
  console.log('═══════════════════════════════════════\n');

  try {
    // Connect to database
    console.log('📊 Connecting to database...');
    await connectDB();
    const db = getDb();
    console.log('✅ Connected to database\n');

    // Get all characters
    console.log('👥 Fetching characters from local database...');
    const characters = await db.collection('characters').find({}).toArray();
    console.log(`   Found ${characters.length} characters\n`);

    // Check game state service
    console.log('🔌 Checking game state service...');
    try {
      const healthResponse = await fetch(`${GAME_STATE_URL}/health`);
      if (!healthResponse.ok) {
        throw new Error('Game state service not healthy');
      }
      console.log('✅ Game state service is running\n');
    } catch (err) {
      console.error('❌ Game state service is not reachable:', err.message);
      console.log('\nPlease start the game state service first.');
      await closeDB();
      process.exit(1);
    }

    // Sync each character
    console.log('🔄 Syncing characters...\n');
    let successCount = 0;
    let errorCount = 0;

    for (const char of characters) {
      try {
        const syncData = {
          _id: char._id.toString(),
          userId: char.userId,
          name: char.name,
          level: char.level || 1,
          location: char.location || { type: 'galactic', x: 2500, y: 2500 },
          navigation: char.navigation || {}
        };

        const response = await fetch(`${GAME_STATE_URL}/api/characters/${char._id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncData)
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`   ✅ ${char.name.padEnd(20)} → Synced (${char.location?.x || 0}, ${char.location?.y || 0})`);
          successCount++;
        } else {
          const error = await response.text();
          console.log(`   ❌ ${char.name.padEnd(20)} → Failed: ${error}`);
          errorCount++;
        }
      } catch (err) {
        console.log(`   ❌ ${char.name.padEnd(20)} → Error: ${err.message}`);
        errorCount++;
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('✅ SYNC COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors:  ${errorCount}`);
    console.log(`   Total:   ${characters.length}`);
    console.log('═══════════════════════════════════════\n');

    // Verify sync
    console.log('🔍 Verifying sync...');
    const verifyResponse = await fetch(`${GAME_STATE_URL}/api/characters`);
    const verifyData = await verifyResponse.json();
    console.log(`   Game state now has ${verifyData.characters.length} characters`);
    console.log('');

    if (verifyData.characters.length === characters.length) {
      console.log('✅ All characters synced successfully!\n');
    } else {
      console.log(`⚠️  Sync count mismatch: ${verifyData.characters.length} synced vs ${characters.length} local\n`);
    }

    // Close database connection
    await closeDB();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error syncing characters:', error);
    console.error(error.stack);
    await closeDB();
    process.exit(1);
  }
}

// Run the sync
syncCharactersToGameState();
