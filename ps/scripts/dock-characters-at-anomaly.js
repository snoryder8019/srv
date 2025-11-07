/**
 * Dock All Characters at Anomaly (Primordial Singularity)
 *
 * This sets characters to be "docked" at the anomaly itself,
 * preventing physics service from auto-docking them to galaxies
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

async function dockAtAnomaly() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME || 'projectStringborne');

    // 1. Get the anomaly
    const anomaly = await db.collection('assets').findOne({ assetType: 'anomaly' });

    if (!anomaly) {
      console.error('❌ No anomaly found!');
      return;
    }

    console.log('🌀 Primordial Singularity:');
    console.log('   Title:', anomaly.title);
    console.log('   Position:', anomaly.coordinates);
    console.log('   ID:', anomaly._id);
    console.log('');

    // 2. Get all characters
    const characters = await db.collection('characters').find({
      'location.type': 'galactic'
    }).toArray();

    console.log(`👥 Found ${characters.length} characters to dock at anomaly`);
    console.log('');

    if (characters.length === 0) {
      console.log('✅ No characters to dock');
      return;
    }

    // 3. Dock all characters at the anomaly
    const bulkUpdates = [];

    for (const char of characters) {
      console.log(`📍 ${char.name}: Docking at anomaly`);

      bulkUpdates.push({
        updateOne: {
          filter: { _id: char._id },
          update: {
            $set: {
              // Set position to anomaly
              'location.x': anomaly.coordinates.x,
              'location.y': anomaly.coordinates.y,
              'location.z': anomaly.coordinates.z,
              'location.type': 'galactic',
              // Dock at ANOMALY (use anomaly ID as "docked galaxy")
              // This tells physics service: "This character is docked somewhere, don't auto-dock"
              'location.dockedGalaxyId': anomaly._id.toString(),
              'location.dockedGalaxyName': anomaly.title,
              'location.assetId': anomaly._id.toString(),
              'location.zone': anomaly.title,
              'location.lastUpdated': new Date()
            },
            $unset: {
              // Clear any old offset fields
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
      console.log('✅ Docked', result.modifiedCount, 'characters at anomaly');
      console.log('');
      console.log('🎯 All characters now docked at:', anomaly.title);
      console.log(`   Position: (${anomaly.coordinates.x}, ${anomaly.coordinates.y}, ${anomaly.coordinates.z})`);
      console.log('');
      console.log('⚠️  Physics service will NOT auto-move them now');
      console.log('   They are "docked" at the anomaly and will stay there');
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
dockAtAnomaly()
  .then(() => {
    console.log('');
    console.log('✅ Characters docked at anomaly!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart PS service (if needed)');
    console.log('2. Refresh browser with hard reload (Ctrl+Shift+R)');
    console.log('3. Characters should be visible at the anomaly and STAY there');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
