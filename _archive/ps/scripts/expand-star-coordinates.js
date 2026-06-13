/**
 * Expand star local coordinates - spread stars further from galaxy center
 * Multiplies all star local coordinates by a factor to increase spread
 */

import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const EXPANSION_FACTOR = 3.0; // Multiply distances by 3x

async function expandStarCoordinates() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all stars with local coordinates
    const stars = await assetsCollection.find({
      assetType: 'star',
      localCoordinates: { $exists: true }
    }).toArray();

    console.log(`\n📊 Found ${stars.length} stars with local coordinates`);
    console.log(`🔧 Expansion factor: ${EXPANSION_FACTOR}x\n`);

    let updated = 0;

    for (const star of stars) {
      const oldCoords = star.localCoordinates;

      // Multiply each coordinate by expansion factor
      const newCoords = {
        x: oldCoords.x * EXPANSION_FACTOR,
        y: oldCoords.y * EXPANSION_FACTOR,
        z: oldCoords.z * EXPANSION_FACTOR
      };

      // Calculate distance from center
      const oldDist = Math.sqrt(oldCoords.x ** 2 + oldCoords.y ** 2 + oldCoords.z ** 2);
      const newDist = Math.sqrt(newCoords.x ** 2 + newCoords.y ** 2 + newCoords.z ** 2);

      console.log(`⭐ ${star.title}`);
      console.log(`   Old: (${oldCoords.x.toFixed(0)}, ${oldCoords.y.toFixed(0)}, ${oldCoords.z.toFixed(0)}) - dist: ${oldDist.toFixed(0)}`);
      console.log(`   New: (${newCoords.x.toFixed(0)}, ${newCoords.y.toFixed(0)}, ${newCoords.z.toFixed(0)}) - dist: ${newDist.toFixed(0)}`);

      // Update in database
      await assetsCollection.updateOne(
        { _id: star._id },
        { $set: { localCoordinates: newCoords } }
      );

      updated++;
    }

    console.log(`\n✅ Updated ${updated} stars`);
    console.log(`📏 Stars are now spread ${EXPANSION_FACTOR}x further from galaxy centers`);

  } catch (error) {
    console.error('❌ Error expanding star coordinates:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

expandStarCoordinates();
