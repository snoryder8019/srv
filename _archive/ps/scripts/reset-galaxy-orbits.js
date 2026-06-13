import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function resetGalaxyOrbits() {
  let client;
  try {
    console.log('Connecting to MongoDB...');
    const uri = process.env.DB_URL;
    const dbName = process.env.DB_NAME;

    client = await MongoClient.connect(uri);
    const db = client.db(dbName);

    // Physics constants (must match physics-service.js)
    const G = 1.8;
    const ANOMALY_MASS = 1000000;
    const anomalyPos = { x: 0, y: 0, z: 0 }; // The Primordial Singularity

    // Original seed positions for galaxies
    const galaxyResets = [
      {
        title: 'Lumina Prime',
        coordinates: { x: 7446.285881727319, y: 1801.9840965279848, z: 2303.4061481746153 }
      },
      {
        title: "Void's Edge",
        coordinates: { x: 9961.299578914768, y: 2008.7781304226273, z: -4211.56991178447 }
      },
      {
        title: 'Elysium Cluster',
        coordinates: { x: 3200, y: -2400, z: 1600 }
      }
    ];

    // Calculate orbital velocities for each galaxy
    for (const galaxy of galaxyResets) {
      const dx = galaxy.coordinates.x - anomalyPos.x;
      const dy = galaxy.coordinates.y - anomalyPos.y;
      const dz = galaxy.coordinates.z - anomalyPos.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

      // Orbital velocity magnitude: v = sqrt(G * M / r)
      const orbitalSpeed = Math.sqrt(G * ANOMALY_MASS / distance);

      // Get unit radial vector (from anomaly to galaxy)
      const radialX = dx / distance;
      const radialY = dy / distance;
      const radialZ = dz / distance;

      // Create tangent vector perpendicular to radial in XY plane primarily
      // Use cross product with "up" vector to get tangent
      const upX = 0, upY = 1, upZ = 0;
      let tangentX = radialY * upZ - radialZ * upY;
      let tangentY = radialZ * upX - radialX * upZ;
      let tangentZ = radialX * upY - radialY * upX;

      // Normalize tangent vector
      const tangentLen = Math.sqrt(tangentX*tangentX + tangentY*tangentY + tangentZ*tangentZ);
      if (tangentLen > 0) {
        tangentX /= tangentLen;
        tangentY /= tangentLen;
        tangentZ /= tangentLen;
      }

      // Apply orbital speed to tangent direction
      galaxy.physics = {
        vx: tangentX * orbitalSpeed,
        vy: tangentY * orbitalSpeed,
        vz: tangentZ * orbitalSpeed
      };

      console.log(`${galaxy.title}: r=${distance.toFixed(0)}, v=${orbitalSpeed.toFixed(2)}`);
    }

    console.log('\nResetting galaxy positions and adding orbital velocities...\n');

    for (const galaxy of galaxyResets) {
      const result = await db.collection('assets').updateOne(
        { title: galaxy.title, assetType: 'galaxy' },
        {
          $set: {
            coordinates: galaxy.coordinates,
            physics: galaxy.physics,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ Reset ${galaxy.title}`);
        console.log(`   Position: (${galaxy.coordinates.x.toFixed(0)}, ${galaxy.coordinates.y.toFixed(0)}, ${galaxy.coordinates.z.toFixed(0)})`);
        console.log(`   Velocity: (${galaxy.physics.vx}, ${galaxy.physics.vy}, ${galaxy.physics.vz})`);
      } else {
        console.log(`⚠️  ${galaxy.title} not found or not modified`);
      }
    }

    console.log('\n✅ Galaxy orbits reset! Galaxies should now orbit instead of collapsing.');
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    if (client) await client.close();
    process.exit(1);
  }
}

resetGalaxyOrbits();
