/**
 * Adjust Universe Assets
 * 1. Remove half the planets (reduce clutter)
 * 2. Double the galaxies (more interesting trajectories)
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

async function adjustAssets() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME || 'projectStringborne');

    // ===== 1. REMOVE HALF THE PLANETS =====
    console.log('');
    console.log('🪐 REMOVING HALF THE PLANETS...');
    console.log('');

    const planets = await db.collection('assets').find({ assetType: 'planet' }).toArray();
    console.log('   Found', planets.length, 'planets');

    // Sort by _id and take every other planet (deterministic selection)
    const planetsToRemove = planets.filter((_, index) => index % 2 === 0);
    const planetIdsToRemove = planetsToRemove.map(p => p._id);

    console.log('   Removing', planetIdsToRemove.length, 'planets (keeping', planets.length - planetIdsToRemove.length, ')');

    const removeResult = await db.collection('assets').deleteMany({
      _id: { $in: planetIdsToRemove }
    });

    console.log('   ✅ Removed', removeResult.deletedCount, 'planets');

    // ===== 2. DOUBLE THE GALAXIES =====
    console.log('');
    console.log('🌌 DOUBLING THE GALAXIES...');
    console.log('');

    const anomalies = await db.collection('assets').find({ assetType: 'anomaly' }).toArray();
    const galaxies = await db.collection('assets').find({ assetType: 'galaxy' }).toArray();

    console.log('   Found', galaxies.length, 'existing galaxies');
    console.log('   Found', anomalies.length, 'anomalies');

    if (anomalies.length === 0) {
      console.error('   ❌ No anomalies found! Cannot create galaxies.');
      return;
    }

    // Use the first anomaly as the parent for new galaxies
    const primaryAnomaly = anomalies[0];
    console.log('   Using anomaly:', primaryAnomaly.title);
    console.log('   Anomaly position:', primaryAnomaly.coordinates);

    const newGalaxies = [];
    const galaxyTitles = [
      'Stellar Forge', 'Quantum Nexus', 'Crystal Expanse', 'Void Horizon',
      'Nova Sanctuary', 'Celestial Archive', 'Plasma Veil', 'Ethereal Domain',
      'Aurora Cluster', 'Nebula Core', 'Infinity Reach', 'Cosmic Cradle',
      'Starlight Haven'
    ];

    // Create 13 new galaxies (doubling from 13 to 26)
    for (let i = 0; i < 13; i++) {
      // Random orbital position around anomaly
      const theta = Math.random() * Math.PI * 2;  // Angle around anomaly
      const phi = (Math.random() - 0.5) * Math.PI; // Inclination (-90° to +90°)
      const distance = 1500 + Math.random() * 4000; // 1500-5500 units from anomaly

      const x = primaryAnomaly.coordinates.x + distance * Math.cos(theta) * Math.cos(phi);
      const y = primaryAnomaly.coordinates.y + distance * Math.sin(phi);
      const z = primaryAnomaly.coordinates.z + distance * Math.sin(theta) * Math.cos(phi);

      // Random initial velocity for orbital motion
      const speed = 5 + Math.random() * 10; // 5-15 units/sec
      const vTheta = theta + Math.PI / 2; // Perpendicular to radial direction

      const vx = speed * Math.cos(vTheta) * Math.cos(phi);
      const vy = speed * Math.random() * 2 - speed; // Vertical component
      const vz = speed * Math.sin(vTheta) * Math.cos(phi);

      const newGalaxy = {
        title: galaxyTitles[i] || `Galaxy-${i + 14}`,
        assetType: 'galaxy',
        parentId: primaryAnomaly._id,
        coordinates: {
          x: x,
          y: y,
          z: z
        },
        physics: {
          vx: vx,
          vy: vy,
          vz: vz
        },
        description: `A newly discovered galaxy in orbit around ${primaryAnomaly.title}`,
        discoveredBy: 'System Generator',
        isPublic: true,
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      newGalaxies.push(newGalaxy);
      console.log(`   ${i + 1}. Creating "${newGalaxy.title}" at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
    }

    // Insert new galaxies
    const insertResult = await db.collection('assets').insertMany(newGalaxies);
    console.log('');
    console.log('   ✅ Created', insertResult.insertedCount, 'new galaxies');
    console.log('   Total galaxies now:', galaxies.length + insertResult.insertedCount);

    console.log('');
    console.log('📊 FINAL ASSET COUNTS:');
    const finalPlanets = await db.collection('assets').countDocuments({ assetType: 'planet' });
    const finalGalaxies = await db.collection('assets').countDocuments({ assetType: 'galaxy' });
    const finalStars = await db.collection('assets').countDocuments({ assetType: 'star' });
    const finalAnomalies = await db.collection('assets').countDocuments({ assetType: 'anomaly' });

    console.log('   Planets:', finalPlanets);
    console.log('   Galaxies:', finalGalaxies);
    console.log('   Stars:', finalStars);
    console.log('   Anomalies:', finalAnomalies);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('');
    console.log('🔒 Connection closed');
  }
}

// Run the adjustment
adjustAssets()
  .then(() => {
    console.log('');
    console.log('✅ Universe assets adjusted!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart PS service');
    console.log('2. Refresh browser');
    console.log('3. Orbital trails will be visible showing galaxy trajectories');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
