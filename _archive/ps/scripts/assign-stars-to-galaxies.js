/**
 * Assign orphan stars to their nearest galaxy
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function assignStarsToGalaxies() {
  console.log('🌌 Assigning orphan stars to nearest galaxies...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`Found ${galaxies.length} galaxies\n`);

    // Get all stars without a parent galaxy
    const orphanStars = await assetsCollection.find({
      assetType: 'star',
      $or: [
        { parentGalaxy: { $exists: false } },
        { parentGalaxy: null },
        { parentGalaxy: '' }
      ]
    }).toArray();

    console.log(`Found ${orphanStars.length} orphan stars\n`);

    let assigned = 0;

    for (const star of orphanStars) {
      const sx = star.coordinates.x;
      const sy = star.coordinates.y;
      const sz = star.coordinates.z || 0;

      // Find nearest galaxy
      let nearestGalaxy = null;
      let nearestDistance = Infinity;

      for (const galaxy of galaxies) {
        const gx = galaxy.coordinates.x;
        const gy = galaxy.coordinates.y;
        const gz = galaxy.coordinates.z || 0;

        const dx = sx - gx;
        const dy = sy - gy;
        const dz = sz - gz;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestGalaxy = galaxy;
        }
      }

      if (nearestGalaxy) {
        // Assign star to nearest galaxy
        await assetsCollection.updateOne(
          { _id: star._id },
          { $set: { parentGalaxy: nearestGalaxy._id.toString() } }
        );

        console.log(`✅ ${star.title}`);
        console.log(`   Assigned to: ${nearestGalaxy.title}`);
        console.log(`   Distance: ${nearestDistance.toFixed(1)} units\n`);

        assigned++;
      }
    }

    console.log(`\n✅ Assigned ${assigned} orphan stars to galaxies`);

    await client.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

assignStarsToGalaxies();
