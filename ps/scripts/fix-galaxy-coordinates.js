/**
 * Fix Galaxy and Star Coordinates
 * Sets proper positions for galaxies and fixes stars at (0,0,0)
 */
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

// Galaxy positions - spread across the 5000x5000 map
const galaxyPositions = {
  'Stellar Crown': { x: 2500, y: 1000, z: 0 },       // North center
  'Andromeda Spiral': { x: 4000, y: 2500, z: 0 },   // East
  'Elysium Cluster': { x: 2500, y: 4000, z: 0 },     // South center
  'Crimson Nebula Galaxy': { x: 1000, y: 2500, z: 0 }, // West
  'Void Edge Galaxy': { x: 2500, y: 2500, z: 0 }     // Dead center
};

async function fixCoordinates() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Fix galaxies
    console.log('\n🌌 Updating Galaxy Coordinates:\n');
    for (const [title, coords] of Object.entries(galaxyPositions)) {
      const result = await db.collection('assets').updateOne(
        { title: title, assetType: 'galaxy' },
        {
          $set: {
            coordinates: coords,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        console.log(`✅ ${title}: (${coords.x}, ${coords.y}, ${coords.z})`);
      } else {
        console.log(`⚠️  ${title}: Not found`);
      }
    }

    // Fix Crimson Heart star (should be at center of Crimson Nebula)
    console.log('\n⭐ Fixing Crimson Heart Star:\n');
    const crimsonNebula = await db.collection('assets').findOne({
      title: 'Crimson Nebula Galaxy',
      assetType: 'galaxy'
    });

    if (crimsonNebula) {
      const result = await db.collection('assets').updateOne(
        { title: 'Crimson Heart', assetType: 'star' },
        {
          $set: {
            coordinates: {
              x: crimsonNebula.coordinates.x,
              y: crimsonNebula.coordinates.y,
              z: 0
            },
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        console.log(`✅ Crimson Heart: (${crimsonNebula.coordinates.x}, ${crimsonNebula.coordinates.y}, 0)`);
        console.log('   Positioned at center of Crimson Nebula Galaxy');
      }
    }

    // Summary
    console.log('\n📊 Summary:');
    const galaxies = await db.collection('assets')
      .find({ assetType: 'galaxy' })
      .project({ title: 1, coordinates: 1 })
      .toArray();

    console.log(`\nGalaxies with coordinates:`);
    galaxies.forEach(g => {
      const hasCoords = g.coordinates && (g.coordinates.x !== 0 || g.coordinates.y !== 0);
      const symbol = hasCoords ? '✅' : '❌';
      console.log(`  ${symbol} ${g.title}: (${g.coordinates?.x || 0}, ${g.coordinates?.y || 0})`);
    });

    const starsAt00 = await db.collection('assets')
      .countDocuments({
        assetType: 'star',
        'coordinates.x': 0,
        'coordinates.y': 0
      });

    console.log(`\nStars at (0, 0): ${starsAt00}`);

    console.log('\n✅ Coordinates fixed!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

fixCoordinates();
