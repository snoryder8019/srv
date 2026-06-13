/**
 * Verify planets in Elysium Cluster
 */
import { getDb, connectDB, closeDB } from '../plugins/mongo/mongo.js';

async function verifyElysiumPlanets() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🌌 Verifying Elysium Cluster planets...\n');

    // Find Elysium Cluster galaxy
    const elysiumGalaxy = await db.collection('assets').findOne({
      assetType: 'galaxy',
      title: /Elysium/i
    });

    if (!elysiumGalaxy) {
      console.log('❌ Elysium Cluster not found!');
      return;
    }

    console.log(`Galaxy: ${elysiumGalaxy.title}\n`);

    // Get all stars in Elysium Cluster
    const stars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: elysiumGalaxy._id,
      status: 'approved'
    }).toArray();

    console.log(`⭐ Stars in Elysium Cluster: ${stars.length}\n`);

    let totalPlanets = 0;

    for (const star of stars) {
      const planets = await db.collection('assets').find({
        assetType: { $in: ['planet', 'orbital'] },
        parentStar: star._id
      }).toArray();

      totalPlanets += planets.length;

      console.log(`🌟 ${star.title}`);
      console.log(`   Planets: ${planets.length}`);

      if (planets.length > 0) {
        planets.forEach(planet => {
          console.log(`   - ${planet.title} (${planet.subType || 'planet'})`);
        });
      }
      console.log('');
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total Stars: ${stars.length}`);
    console.log(`   Total Planets: ${totalPlanets}`);
    console.log(`   Average Planets per Star: ${(totalPlanets / stars.length).toFixed(1)}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await closeDB();
  }
}

verifyElysiumPlanets();
