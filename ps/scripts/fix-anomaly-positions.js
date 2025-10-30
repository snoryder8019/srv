import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function fixAnomalyPositions() {
  let client;
  try {
    console.log('Connecting to MongoDB...');
    const uri = process.env.DB_URL;
    const dbName = process.env.DB_NAME;

    client = await MongoClient.connect(uri);
    const db = client.db(dbName);

    // Move The Nexus Singularity far away so it doesn't interfere with galactic orbits
    // Keep The Primordial Singularity at origin for galaxy orbits
    const updates = [
      {
        title: 'The Primordial Singularity',
        coordinates: { x: 0, y: 0, z: 0 }
      },
      {
        title: 'The Nexus Singularity',
        coordinates: { x: 50000, y: 50000, z: 50000 } // Move far away
      }
    ];

    console.log('\nUpdating anomaly positions...\n');

    for (const anomaly of updates) {
      const result = await db.collection('assets').updateOne(
        { title: anomaly.title, assetType: 'anomaly' },
        {
          $set: {
            coordinates: anomaly.coordinates,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ Updated ${anomaly.title}`);
        console.log(`   Position: (${anomaly.coordinates.x}, ${anomaly.coordinates.y}, ${anomaly.coordinates.z})`);
      } else {
        console.log(`⚠️  ${anomaly.title} not found or not modified`);
      }
    }

    console.log('\n✅ Anomaly positions fixed!');
    console.log('   Galaxies will now orbit The Primordial Singularity at origin.');
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    if (client) await client.close();
    process.exit(1);
  }
}

fixAnomalyPositions();
