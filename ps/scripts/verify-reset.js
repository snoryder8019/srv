#!/usr/bin/env node

/**
 * Verify Reset - Check character positions
 */

import { connectDB, closeDB, getDb } from '../plugins/mongo/mongo.js';
import fetch from 'node-fetch';

const GAME_STATE_URL = 'https://svc.madladslab.com';

async function verifyReset() {
  console.log('Verifying reset...\n');

  try {
    // Connect to database
    await connectDB();
    const db = getDb();

    // Get local characters
    const localChars = await db.collection('characters').find({}).toArray();
    console.log('Local Database Characters:');
    localChars.forEach(c => {
      console.log(`  - ${c.name.padEnd(20)} at (${Math.round(c.location.x).toString().padStart(4)}, ${Math.round(c.location.y).toString().padStart(4)})`);
    });

    // Get game state characters
    console.log('\nGame State Service Characters:');
    const response = await fetch(`${GAME_STATE_URL}/api/characters`);
    const data = await response.json();
    data.characters.forEach(c => {
      console.log(`  - ${c.name.padEnd(20)} at (${Math.round(c.location.x).toString().padStart(4)}, ${Math.round(c.location.y).toString().padStart(4)})`);
    });

    console.log('\nComparison:');
    let synced = 0;
    let outOfSync = 0;

    localChars.forEach(local => {
      const remote = data.characters.find(r => r._id === local._id.toString());
      if (remote) {
        const xMatch = Math.abs(local.location.x - remote.location.x) < 1;
        const yMatch = Math.abs(local.location.y - remote.location.y) < 1;
        if (xMatch && yMatch) {
          console.log(`  ✅ ${local.name.padEnd(20)} - SYNCED`);
          synced++;
        } else {
          console.log(`  ❌ ${local.name.padEnd(20)} - OUT OF SYNC`);
          console.log(`     Local:  (${Math.round(local.location.x)}, ${Math.round(local.location.y)})`);
          console.log(`     Remote: (${Math.round(remote.location.x)}, ${Math.round(remote.location.y)})`);
          outOfSync++;
        }
      } else {
        console.log(`  ⚠️  ${local.name.padEnd(20)} - NOT IN GAME STATE`);
        outOfSync++;
      }
    });

    console.log(`\nSummary: ${synced} synced, ${outOfSync} out of sync`);

    await closeDB();
    process.exit(outOfSync > 0 ? 1 : 0);
  } catch (error) {
    console.error('Error:', error);
    await closeDB();
    process.exit(1);
  }
}

verifyReset();
