/**
 * Add local coordinates to stars within their parent galaxy
 * Each galaxy gets a 1000x1000 local coordinate space for its stars
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function addLocalStarCoordinates() {
  console.log('🌌 Adding local coordinates to stars within galaxies...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`Found ${galaxies.length} galaxies\n`);

    let totalUpdated = 0;

    for (const galaxy of galaxies) {
      console.log(`\n📍 Processing galaxy: ${galaxy.title}`);

      // Get all stars in this galaxy
      const stars = await assetsCollection.find({
        assetType: 'star',
        parentGalaxy: galaxy._id.toString()
      }).toArray();

      console.log(`   Found ${stars.length} stars`);

      // Assign local coordinates to each star
      // Distribute stars in a 1000x1000 space
      const localGridSize = 1000;

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Create local coordinates
        // For now, distribute stars in a grid pattern
        // In a real system, you'd want more sophisticated placement
        const angle = (i / stars.length) * Math.PI * 2;
        const radius = (i / stars.length) * (localGridSize / 2);

        const localX = Math.cos(angle) * radius;
        const localY = Math.sin(angle) * radius;
        const localZ = (Math.random() - 0.5) * 100; // Some vertical variation

        const localCoordinates = {
          x: localX,
          y: localY,
          z: localZ
        };

        // Update the star with local coordinates
        await assetsCollection.updateOne(
          { _id: star._id },
          {
            $set: {
              localCoordinates: localCoordinates,
              // Keep original universal coordinates for universe view
              universalCoordinates: star.coordinates
            }
          }
        );

        console.log(`   ✓ ${star.title}: local (${localX.toFixed(1)}, ${localY.toFixed(1)}, ${localZ.toFixed(1)})`);
        totalUpdated++;
      }
    }

    console.log(`\n\n✅ Updated ${totalUpdated} stars with local coordinates`);
    console.log(`\nEach star now has:`);
    console.log(`  - universalCoordinates: for universe-level view`);
    console.log(`  - localCoordinates: for galaxy interior view (1000x1000 grid)`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

addLocalStarCoordinates().catch(console.error);
