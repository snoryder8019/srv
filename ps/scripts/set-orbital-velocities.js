import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

// Physics constants (matching physics-service.js)
const GRAVITATIONAL_CONSTANT = 0.05; // Reduced for stable orbits
const ANOMALY_MASS = 1000000;
const GALAXY_MASS = 100000;

async function setOrbitalVelocities() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    console.log('\n=== SETTING ORBITAL VELOCITIES ===\n');

    // Get all anomalies and galaxies
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();

    console.log(`📊 Found ${anomalies.length} anomalies and ${galaxies.length} galaxies`);

    if (anomalies.length === 0) {
      console.log('❌ No anomalies found - cannot calculate orbital velocities');
      return;
    }

    console.log('\n🔄 Calculating orbital velocities...\n');

    let updateCount = 0;

    for (const galaxy of galaxies) {
      const gx = galaxy.coordinates.x;
      const gy = galaxy.coordinates.y;
      const gz = galaxy.coordinates.z;

      // Find nearest anomaly
      let nearestAnomaly = null;
      let minDistance = Infinity;

      for (const anomaly of anomalies) {
        const ax = anomaly.coordinates.x;
        const ay = anomaly.coordinates.y;
        const az = anomaly.coordinates.z;

        const dx = ax - gx;
        const dy = ay - gy;
        const dz = az - gz;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (distance < minDistance) {
          minDistance = distance;
          nearestAnomaly = anomaly;
        }
      }

      if (!nearestAnomaly || minDistance < 10) {
        console.log(`   ⚠️  ${galaxy.title}: No valid anomaly found or too close`);
        continue;
      }

      // Calculate orbital velocity: v = sqrt(G * M / r)
      const orbitalSpeed = Math.sqrt((GRAVITATIONAL_CONSTANT * ANOMALY_MASS) / minDistance);

      // Direction from galaxy to anomaly
      const ax = nearestAnomaly.coordinates.x;
      const ay = nearestAnomaly.coordinates.y;
      const az = nearestAnomaly.coordinates.z;

      const dx = ax - gx;
      const dy = ay - gy;
      const dz = az - gz;

      // Create perpendicular velocity vector (cross product with up vector)
      // This gives us tangential velocity for orbit
      const upX = 0, upY = 1, upZ = 0;

      // Cross product: (dx, dy, dz) × (0, 1, 0)
      let tangentX = dz * upY - dy * upZ;  // = dz
      let tangentY = dx * upZ - dz * upX;  // = 0
      let tangentZ = dy * upX - dx * upY;  // = -dx

      // Normalize tangent vector
      const tangentMag = Math.sqrt(tangentX*tangentX + tangentY*tangentY + tangentZ*tangentZ);
      if (tangentMag < 0.001) {
        // If aligned with up vector, use different cross product
        tangentX = dy;
        tangentY = -dx;
        tangentZ = 0;
        const newMag = Math.sqrt(tangentX*tangentX + tangentY*tangentY);
        tangentX /= newMag;
        tangentY /= newMag;
        tangentZ /= newMag;
      } else {
        tangentX /= tangentMag;
        tangentY /= tangentMag;
        tangentZ /= tangentMag;
      }

      // Apply orbital speed with some randomness (0.8 to 1.2 for elliptical orbits)
      const speedFactor = 0.8 + Math.random() * 0.4;
      const finalSpeed = orbitalSpeed * speedFactor;

      const vx = tangentX * finalSpeed;
      const vy = tangentY * finalSpeed;
      const vz = tangentZ * finalSpeed;

      // Update galaxy with orbital velocity and parent anomaly
      await assetsCollection.updateOne(
        { _id: galaxy._id },
        {
          $set: {
            physics: {
              vx: vx,
              vy: vy,
              vz: vz
            },
            parentId: nearestAnomaly._id,
            updatedAt: new Date()
          }
        }
      );

      updateCount++;
      console.log(`   ✓ ${galaxy.title}:`);
      console.log(`      Distance to ${nearestAnomaly.title}: ${minDistance.toFixed(0)} units`);
      console.log(`      Orbital speed: ${finalSpeed.toFixed(2)} units/sec`);
      console.log(`      Velocity: (${vx.toFixed(2)}, ${vy.toFixed(2)}, ${vz.toFixed(2)})`);
    }

    console.log(`\n✅ Updated ${updateCount}/${galaxies.length} galaxies with orbital velocities`);

    console.log('\n💡 Next steps:');
    console.log('   1. The physics service will now use these velocities');
    console.log('   2. Refresh your browser to see galaxies in stable orbits');
    console.log('   3. They will orbit around their assigned anomalies!');

    console.log('\n=== VELOCITIES SET ===\n');

  } catch (error) {
    console.error('❌ Error setting velocities:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Database connection closed');
  }
}

// Run the script
setOrbitalVelocities().catch(console.error);
