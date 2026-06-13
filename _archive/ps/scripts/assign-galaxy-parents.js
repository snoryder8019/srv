/**
 * Assign parent anomalies to all galaxies
 */
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function assignGalaxyParents() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    console.log('🌌 Assigning parent anomalies to galaxies...\n');

    // Get all anomalies
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();
    console.log(`Found ${anomalies.length} anomalies:`);
    anomalies.forEach(a => console.log(`  - ${a.title} (${a._id})`));

    if (anomalies.length === 0) {
      console.error('❌ No anomalies found! Cannot assign parents.');
      return;
    }

    // Get all galaxies without parentId
    const galaxies = await assetsCollection.find({
      assetType: 'galaxy',
      parentId: { $exists: false }
    }).toArray();

    console.log(`\nFound ${galaxies.length} galaxies without parents\n`);

    // Distribute galaxies evenly among anomalies
    const updates = [];
    galaxies.forEach((galaxy, index) => {
      // Round-robin assignment
      const parentAnomaly = anomalies[index % anomalies.length];

      updates.push({
        updateOne: {
          filter: { _id: galaxy._id },
          update: {
            $set: {
              parentId: parentAnomaly._id,
              updatedAt: new Date()
            }
          }
        }
      });

      console.log(`✅ ${galaxy.title} -> ${parentAnomaly.title}`);
    });

    // Execute bulk update
    if (updates.length > 0) {
      const result = await assetsCollection.bulkWrite(updates);
      console.log(`\n✅ Updated ${result.modifiedCount} galaxies with parent assignments`);
    } else {
      console.log('\n⚠️  No galaxies to update');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the script
assignGalaxyParents()
  .then(() => {
    console.log('\n🎉 Galaxy parent assignment complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
