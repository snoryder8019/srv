import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function resetGalaxyPhysics() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    console.log('\n=== GALAXY PHYSICS RESET ===\n');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`📊 Found ${galaxies.length} galaxies`);

    if (galaxies.length === 0) {
      console.log('   No galaxies to reset');
      return;
    }

    // Reset all galaxy velocities to zero
    console.log('\n🔄 Resetting galaxy velocities to zero...');

    const result = await assetsCollection.updateMany(
      { assetType: 'galaxy' },
      {
        $set: {
          velocity: { x: 0, y: 0, z: 0 }
        },
        $unset: {
          parentAnomaly: ""
        }
      }
    );

    console.log(`✅ Reset ${result.modifiedCount} galaxies`);
    console.log('   - Velocities set to (0, 0, 0)');
    console.log('   - Parent anomaly references removed');

    // Show current galaxy positions
    console.log('\n📍 Current galaxy positions:');
    for (const galaxy of galaxies) {
      const x = galaxy.coordinates?.x || 0;
      const y = galaxy.coordinates?.y || 0;
      const z = galaxy.coordinates?.z || 0;
      console.log(`   - ${galaxy.title}: (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`);
    }

    console.log('\n💡 Next steps:');
    console.log('   1. Refresh your browser to reload the galactic map');
    console.log('   2. The galaxies will initialize with new orbital velocities');
    console.log('   3. Watch them orbit the anomalies!');

    console.log('\n=== RESET COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during reset:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Database connection closed');
  }
}

// Run the reset
resetGalaxyPhysics().catch(console.error);
