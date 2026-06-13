/**
 * Reposition stars to be INSIDE their parent galaxies
 * Stars should orbit within a galaxy, not be scattered randomly
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function repositionStars() {
  console.log('🌟 Repositioning stars inside their parent galaxies...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`Found ${galaxies.length} galaxies\n`);

    // Get all stars
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    console.log(`Found ${stars.length} stars\n`);

    let repositioned = 0;

    for (const star of stars) {
      const parentGalaxy = galaxies.find(g => g._id.toString() === (star.parentGalaxy?.toString() || star.parentGalaxy));

      if (!parentGalaxy) {
        console.log(`⚠️  Star "${star.title}" has no parent galaxy - skipping`);
        continue;
      }

      // Get galaxy center position
      const gx = parentGalaxy.coordinates.x;
      const gy = parentGalaxy.coordinates.y;
      const gz = parentGalaxy.coordinates.z || 0;

      // Position star INSIDE galaxy (within 50-150 units of center)
      const distance = 50 + Math.random() * 100; // 50-150 units from center
      const theta = Math.random() * Math.PI * 2; // Random angle
      const phi = (Math.random() - 0.5) * Math.PI * 0.3; // Slight vertical spread

      const sx = gx + distance * Math.cos(theta) * Math.cos(phi);
      const sy = gy + distance * Math.sin(theta) * Math.cos(phi);
      const sz = gz + distance * Math.sin(phi);

      // Update star position in database
      await assetsCollection.updateOne(
        { _id: star._id },
        {
          $set: {
            'coordinates.x': sx,
            'coordinates.y': sy,
            'coordinates.z': sz
          }
        }
      );

      console.log(`✅ ${star.title}`);
      console.log(`   Galaxy: ${parentGalaxy.title} at (${gx}, ${gy}, ${gz})`);
      console.log(`   New Position: (${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)})`);
      console.log(`   Distance from galaxy center: ${distance.toFixed(1)} units\n`);

      repositioned++;
    }

    console.log(`\n✅ Repositioned ${repositioned} stars inside their galaxies`);

    await client.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

repositionStars();
