/**
 * Assign Stars to Parent Galaxies
 * Finds stars without parentGalaxy and assigns them to the nearest galaxy
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function assignStarsToGalaxies() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('🌌 Connected to MongoDB\n');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({
      assetType: 'galaxy'
    }).toArray();

    console.log(`✅ Found ${galaxies.length} galaxies`);

    // Get stars without parentGalaxy
    const starsWithoutParent = await assetsCollection.find({
      assetType: 'star',
      $or: [
        { parentGalaxy: { $exists: false } },
        { parentGalaxy: null }
      ]
    }).toArray();

    console.log(`🔍 Found ${starsWithoutParent.length} stars without parentGalaxy\n`);

    if (starsWithoutParent.length === 0) {
      console.log('✅ All stars already have parent galaxies!\n');
      await client.close();
      process.exit(0);
    }

    // Assign each star to nearest galaxy
    const updates = [];
    for (const star of starsWithoutParent) {
      if (!star.coordinates) {
        console.log(`  ⚠️  Star "${star.title}" has no coordinates, skipping`);
        continue;
      }

      // Find nearest galaxy
      let nearestGalaxy = null;
      let minDistance = Infinity;

      for (const galaxy of galaxies) {
        if (!galaxy.coordinates) continue;

        const dx = star.coordinates.x - galaxy.coordinates.x;
        const dy = star.coordinates.y - galaxy.coordinates.y;
        const dz = (star.coordinates.z || 0) - (galaxy.coordinates.z || 0);
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < minDistance) {
          minDistance = distance;
          nearestGalaxy = galaxy;
        }
      }

      if (nearestGalaxy) {
        const distStr = minDistance.toFixed(0);
        console.log(`  📍 "${star.title}" → "${nearestGalaxy.title}" (${distStr} units)`);
        updates.push({
          updateOne: {
            filter: { _id: star._id },
            update: {
              $set: {
                parentGalaxy: nearestGalaxy._id,
                updatedAt: new Date()
              }
            }
          }
        });
      }
    }

    if (updates.length > 0) {
      console.log(`\n💾 Updating ${updates.length} stars...`);
      const result = await assetsCollection.bulkWrite(updates, { ordered: false });
      console.log(`✅ Updated ${result.modifiedCount} stars with parent galaxies\n`);
    }

    console.log('✨ Star assignment complete!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

assignStarsToGalaxies();
