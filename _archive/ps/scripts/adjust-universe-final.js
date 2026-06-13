/**
 * Final Universe Adjustments
 * 1. Increase galaxies by 30% (26 → 34, add 8 more)
 * 2. Remove 60% of planets (450 → 180, remove 270)
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

async function adjustUniverse() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME || 'projectStringborne');

    // ===== 1. REMOVE 60% OF PLANETS =====
    console.log('');
    console.log('🪐 REMOVING 60% OF PLANETS...');
    console.log('');

    const planets = await db.collection('assets').find({ assetType: 'planet' }).toArray();
    console.log('   Current planets:', planets.length);

    // Target: 180 planets (40% of 450)
    const targetCount = 180;
    const toRemove = planets.length - targetCount;

    // Sort and take every 3rd planet to remove 60%
    const planetsToRemove = [];
    for (let i = 0; i < planets.length && planetsToRemove.length < toRemove; i++) {
      if (i % 5 < 3) { // Remove 3 out of every 5
        planetsToRemove.push(planets[i]._id);
      }
    }

    console.log('   Removing', planetsToRemove.length, 'planets');

    const removeResult = await db.collection('assets').deleteMany({
      _id: { $in: planetsToRemove }
    });

    console.log('   ✅ Removed', removeResult.deletedCount, 'planets');

    // ===== 2. ADD 8 MORE GALAXIES (30% increase) =====
    console.log('');
    console.log('🌌 ADDING 8 MORE GALAXIES (30% increase)...');
    console.log('');

    const anomalies = await db.collection('assets').find({ assetType: 'anomaly' }).toArray();
    const galaxies = await db.collection('assets').find({ assetType: 'galaxy' }).toArray();

    console.log('   Current galaxies:', galaxies.length);
    console.log('   Adding: 8 new galaxies');

    if (anomalies.length === 0) {
      console.error('   ❌ No anomalies found!');
      return;
    }

    const primaryAnomaly = anomalies[0];
    console.log('   Using anomaly:', primaryAnomaly.title);

    const newGalaxyNames = [
      'Tempest Nebula',
      'Frozen Expanse',
      'Luminous Core',
      'Shadow Realm',
      'Phoenix Cluster',
      'Quantum Fields',
      'Eternal Void',
      'Prismatic Haven'
    ];

    const newGalaxies = [];

    for (let i = 0; i < 8; i++) {
      // Random orbital position around anomaly
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const distance = 1500 + Math.random() * 4500; // 1500-6000 units

      const x = primaryAnomaly.coordinates.x + distance * Math.cos(theta) * Math.cos(phi);
      const y = primaryAnomaly.coordinates.y + distance * Math.sin(phi);
      const z = primaryAnomaly.coordinates.z + distance * Math.sin(theta) * Math.cos(phi);

      // Random initial velocity
      const speed = 5 + Math.random() * 15;
      const vTheta = theta + Math.PI / 2;

      const vx = speed * Math.cos(vTheta) * Math.cos(phi);
      const vy = speed * (Math.random() * 2 - 1);
      const vz = speed * Math.sin(vTheta) * Math.cos(phi);

      const newGalaxy = {
        title: newGalaxyNames[i],
        assetType: 'galaxy',
        parentId: primaryAnomaly._id,
        coordinates: { x, y, z },
        physics: { vx, vy, vz },
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

    const insertResult = await db.collection('assets').insertMany(newGalaxies);
    console.log('');
    console.log('   ✅ Created', insertResult.insertedCount, 'new galaxies');

    // ===== FINAL COUNT =====
    console.log('');
    console.log('📊 FINAL ASSET COUNTS:');
    const finalPlanets = await db.collection('assets').countDocuments({ assetType: 'planet' });
    const finalGalaxies = await db.collection('assets').countDocuments({ assetType: 'galaxy' });
    const finalStars = await db.collection('assets').countDocuments({ assetType: 'star' });
    const finalAnomalies = await db.collection('assets').countDocuments({ assetType: 'anomaly' });

    console.log('   Planets:', finalPlanets, '(target: ~180)');
    console.log('   Galaxies:', finalGalaxies, '(target: 34)');
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

adjustUniverse()
  .then(() => {
    console.log('');
    console.log('✅ Universe adjusted!');
    console.log('');
    console.log('Next: Restart PS service and check connection lines visibility');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
