/**
 * Reset Galaxy Positions
 * Redistributes galaxies in orbital rings around anomalies
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MIN_ORBIT_RADIUS = 1500;
const MAX_ORBIT_RADIUS = 6000;

async function resetGalaxyPositions() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('🌌 Connected to MongoDB\n');

    const db = client.db(process.env.DB_NAME);
    const assets = db.collection('assets');

    const anomalies = await assets.find({ assetType: 'anomaly' }).toArray();
    const galaxies = await assets.find({ assetType: 'galaxy' }).toArray();

    console.log(`✅ Found ${anomalies.length} anomalies, ${galaxies.length} galaxies\n`);

    if (anomalies.length === 0) {
      console.error('❌ No anomalies!');
      process.exit(1);
    }

    const galaxiesPerAnomaly = Math.ceil(galaxies.length / anomalies.length);
    const updates = [];
    let galaxyIndex = 0;

    for (const anomaly of anomalies) {
      const anomalyGalaxies = galaxies.slice(galaxyIndex, galaxyIndex + galaxiesPerAnomaly);

      console.log(`\n🌀 ${anomaly.title}: Assigning ${anomalyGalaxies.length} galaxies`);

      anomalyGalaxies.forEach((galaxy, idx) => {
        const orbitRadius = MIN_ORBIT_RADIUS + (MAX_ORBIT_RADIUS - MIN_ORBIT_RADIUS) * (idx / anomalyGalaxies.length);
        const angle = (idx / anomalyGalaxies.length) * Math.PI * 2;
        const zOffset = (Math.random() - 0.5) * 1000;

        const newX = anomaly.coordinates.x + Math.cos(angle) * orbitRadius;
        const newY = anomaly.coordinates.y + (Math.random() - 0.5) * 500;
        const newZ = anomaly.coordinates.z + Math.sin(angle) * orbitRadius + zOffset;

        const orbitalSpeed = Math.sqrt(500 / orbitRadius) * 100;
        const vx = -Math.sin(angle) * orbitalSpeed;
        const vy = 0;
        const vz = Math.cos(angle) * orbitalSpeed;

        console.log(`   📍 ${galaxy.title}: ${Math.round(orbitRadius)} units @ ${Math.round(angle * 180 / Math.PI)}°`);

        updates.push({
          updateOne: {
            filter: { _id: galaxy._id },
            update: {
              $set: {
                coordinates: { x: newX, y: newY, z: newZ },
                parentId: anomaly._id,
                physics: { vx, vy, vz },
                updatedAt: new Date()
              }
            }
          }
        });
      });

      galaxyIndex += anomalyGalaxies.length;
    }

    console.log(`\n💾 Updating ${updates.length} galaxies...`);
    const result = await assets.bulkWrite(updates, { ordered: false });
    console.log(`✅ Updated ${result.modifiedCount} galaxies\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

resetGalaxyPositions();
