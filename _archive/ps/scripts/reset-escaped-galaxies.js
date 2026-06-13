/**
 * Reset Escaped Galaxies
 * Teleport out-of-bounds galaxies back to safe orbits around anomalies
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

const UNIVERSE_BOUNDS = {
  min: { x: -5000, y: -5000, z: -5000 },
  max: { x: 5000, y: 5000, z: 5000 }
};

async function resetEscapedGalaxies() {
  console.log('🚀 Resetting escaped galaxies...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all anomalies to use as orbit centers
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();
    console.log(`📍 Found ${anomalies.length} anomalies to orbit\n`);

    if (anomalies.length === 0) {
      console.error('❌ No anomalies found! Cannot reset galaxies.');
      process.exit(1);
    }

    // Find all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`🌌 Found ${galaxies.length} galaxies\n`);

    let resetCount = 0;
    const bulkOps = [];

    for (const galaxy of galaxies) {
      const coords = galaxy.coordinates;
      const x = coords.x || 0;
      const y = coords.y || 0;
      const z = coords.z || 0;

      // Check if out of bounds
      const outOfBounds =
        x < UNIVERSE_BOUNDS.min.x || x > UNIVERSE_BOUNDS.max.x ||
        y < UNIVERSE_BOUNDS.min.y || y > UNIVERSE_BOUNDS.max.y ||
        z < UNIVERSE_BOUNDS.min.z || z > UNIVERSE_BOUNDS.max.z;

      if (outOfBounds) {
        console.log(`⚠️  ${galaxy.title} is OUT OF BOUNDS`);
        console.log(`   Current: (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);

        // Pick a random anomaly to orbit
        const anomaly = anomalies[Math.floor(Math.random() * anomalies.length)];
        const ax = anomaly.coordinates?.x || 0;
        const ay = anomaly.coordinates?.y || 0;
        const az = anomaly.coordinates?.z || 0;

        // Place galaxy at safe distance from anomaly (500-2500 units)
        const distance = 800 + Math.random() * 1500;
        const theta = Math.random() * Math.PI * 2; // Random angle
        const phi = (Math.random() - 0.5) * Math.PI * 0.4; // Slight vertical variation

        const newX = Math.round(ax + distance * Math.cos(theta) * Math.cos(phi));
        const newY = Math.round(ay + distance * Math.sin(theta) * Math.cos(phi));
        const newZ = Math.round(az + distance * Math.sin(phi));

        // Calculate stable orbital velocity (perpendicular to radius vector)
        const rx = newX - ax;
        const ry = newY - ay;
        const rz = newZ - az;
        const r = Math.sqrt(rx*rx + ry*ry + rz*rz);

        // Orbital velocity magnitude for circular orbit: v = sqrt(G*M/r)
        // Using simplified physics constants from physics-service
        const G = 0.05;
        const M = 1000000; // Anomaly mass
        const orbitalSpeed = Math.sqrt(G * M / r) * 0.5; // Reduce by half for elliptical orbit

        // Velocity perpendicular to radius (cross product with up vector)
        const upX = 0, upY = 0, upZ = 1;
        let velX = ry * upZ - rz * upY;
        let velY = rz * upX - rx * upZ;
        let velZ = rx * upY - ry * upX;

        // Normalize and scale to orbital speed
        const velMag = Math.sqrt(velX*velX + velY*velY + velZ*velZ);
        if (velMag > 0) {
          velX = (velX / velMag) * orbitalSpeed;
          velY = (velY / velMag) * orbitalSpeed;
          velZ = (velZ / velMag) * orbitalSpeed;
        }

        console.log(`   New pos: (${newX}, ${newY}, ${newZ})`);
        console.log(`   Orbiting: ${anomaly.title}`);
        console.log(`   Velocity: (${velX.toFixed(2)}, ${velY.toFixed(2)}, ${velZ.toFixed(2)})\n`);

        bulkOps.push({
          updateOne: {
            filter: { _id: galaxy._id },
            update: {
              $set: {
                coordinates: { x: newX, y: newY, z: newZ },
                velocity: { x: velX, y: velY, z: velZ }
              }
            }
          }
        });

        resetCount++;
      } else {
        console.log(`✅ ${galaxy.title} is within bounds`);
      }
    }

    if (bulkOps.length > 0) {
      console.log(`\n💾 Resetting ${bulkOps.length} galaxies...`);
      const result = await assetsCollection.bulkWrite(bulkOps);
      console.log(`✅ Reset ${result.modifiedCount} galaxies`);
    } else {
      console.log('\n✅ All galaxies are within bounds - no reset needed');
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total galaxies: ${galaxies.length}`);
    console.log(`   Reset: ${resetCount}`);
    console.log(`   Within bounds: ${galaxies.length - resetCount}`);

    await client.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

resetEscapedGalaxies();
