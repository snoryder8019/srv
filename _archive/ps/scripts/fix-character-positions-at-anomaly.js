/**
 * Fix Character Positions - Move All to Primordial Singularity
 *
 * All characters should start at the anomaly (primordial singularity)
 * This script moves all characters to the anomaly's position
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

async function fixCharacterPositions() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME || 'projectStringborne');

    // 1. Get the anomaly (primordial singularity)
    const anomaly = await db.collection('assets').findOne({ assetType: 'anomaly' });

    if (!anomaly) {
      console.error('❌ No anomaly found! Cannot proceed.');
      return;
    }

    console.log('🌀 Primordial Singularity:');
    console.log('   Title:', anomaly.title);
    console.log('   Position:', anomaly.coordinates);
    console.log('   ID:', anomaly._id);
    console.log('');

    // 2. Get all characters with galactic locations
    const characters = await db.collection('characters').find({
      'location.type': 'galactic'
    }).toArray();

    console.log(`👥 Found ${characters.length} characters to reposition`);
    console.log('');

    if (characters.length === 0) {
      console.log('✅ No characters to fix');
      return;
    }

    // 3. Move all characters to the anomaly position
    const bulkUpdates = [];

    for (const char of characters) {
      console.log(`📍 ${char.name}:`);
      console.log(`   Current: (${char.location.x?.toFixed(0)}, ${char.location.y?.toFixed(0)}, ${char.location.z?.toFixed(0)})`);
      console.log(`   New:     (${anomaly.coordinates.x}, ${anomaly.coordinates.y}, ${anomaly.coordinates.z})`);
      console.log(`   Clearing docked galaxy: ${char.location.dockedGalaxyName || 'none'}`);

      bulkUpdates.push({
        updateOne: {
          filter: { _id: char._id },
          update: {
            $set: {
              'location.x': anomaly.coordinates.x,
              'location.y': anomaly.coordinates.y,
              'location.z': anomaly.coordinates.z,
              'location.type': 'galactic',
              'location.lastUpdated': new Date()
            },
            $unset: {
              // Remove docked galaxy info - they're at the anomaly now, not docked
              'location.dockedGalaxyId': '',
              'location.dockedGalaxyName': '',
              // Remove old offset fields if they exist
              'location.offsetX': '',
              'location.offsetY': '',
              'location.offsetZ': ''
            }
          }
        }
      });
    }

    // 4. Execute bulk update
    if (bulkUpdates.length > 0) {
      const result = await db.collection('characters').bulkWrite(bulkUpdates, { ordered: false });
      console.log('');
      console.log('✅ Updated', result.modifiedCount, 'characters');
      console.log('');
      console.log('🎯 All characters now at Primordial Singularity position:');
      console.log(`   (${anomaly.coordinates.x}, ${anomaly.coordinates.y}, ${anomaly.coordinates.z})`);
      console.log('');
      console.log('⚠️  NOTE: Characters are NO LONGER docked at galaxies');
      console.log('   Physics service will auto-dock them to nearest galaxy on next tick');
      console.log('   Or they can manually dock by navigating to a galaxy');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('');
    console.log('🔒 Connection closed');
  }
}

// Run the fix
fixCharacterPositions()
  .then(() => {
    console.log('');
    console.log('✅ Character positions fixed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart PS service: tmux kill-session -t ps && tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"');
    console.log('2. Refresh browser with hard reload (Ctrl+Shift+R)');
    console.log('3. Characters should now be visible at the anomaly');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
