import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function setupMultiAnomalyOrbits() {
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

    // Define anomalies with their positions
    const anomalies = [
      {
        title: 'The Primordial Singularity',
        _id: '69000d0360596973e9afc4fe', // Keep existing ID
        coordinates: { x: 0, y: 0, z: 0 }
      },
      {
        title: 'The Nexus Singularity',
        coordinates: { x: 15000, y: 0, z: 0 } // Far enough apart
      }
    ];

    // Define galaxies with parent anomaly assignments
    const galaxySetup = [
      {
        title: 'Lumina Prime',
        parentAnomaly: 'The Primordial Singularity',
        orbitRadius: 8000,
        orbitInclination: 0.3, // Radians - tilts orbit in 3D space
        orbitPhase: 0 // Starting angle
      },
      {
        title: "Void's Edge",
        parentAnomaly: 'The Primordial Singularity',
        orbitRadius: 11000,
        orbitInclination: -0.5, // Different tilt
        orbitPhase: Math.PI / 3 // 60 degrees offset
      },
      {
        title: 'Elysium Cluster',
        parentAnomaly: 'The Nexus Singularity',
        orbitRadius: 6000,
        orbitInclination: 0.8, // Steep tilt for dramatic twist
        orbitPhase: Math.PI / 2 // 90 degrees offset
      }
    ];

    console.log('\n=== Setting up Multi-Anomaly Orbital System ===\n');

    // Update anomaly positions
    console.log('Positioning anomalies...');
    for (const anomaly of anomalies) {
      const filter = anomaly._id
        ? { _id: anomaly._id }
        : { title: anomaly.title, assetType: 'anomaly' };

      const result = await db.collection('assets').updateOne(
        filter,
        {
          $set: {
            coordinates: anomaly.coordinates,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ ${anomaly.title} at (${anomaly.coordinates.x}, ${anomaly.coordinates.y}, ${anomaly.coordinates.z})`);
      }
    }

    // Calculate and set galaxy orbits
    console.log('\nCalculating galaxy orbits with 3D inclination...');
    for (const galaxy of galaxySetup) {
      // Find parent anomaly
      const parentAnomaly = anomalies.find(a => a.title === galaxy.parentAnomaly);
      if (!parentAnomaly) {
        console.error(`❌ Parent anomaly ${galaxy.parentAnomaly} not found for ${galaxy.title}`);
        continue;
      }

      // Calculate starting position on orbit
      // Use inclination to create 3D orbits that twist through space
      const phase = galaxy.orbitPhase;
      const inclination = galaxy.orbitInclination;

      // Position in orbital plane
      const x = parentAnomaly.coordinates.x + galaxy.orbitRadius * Math.cos(phase);
      const y = parentAnomaly.coordinates.y + galaxy.orbitRadius * Math.sin(phase) * Math.cos(inclination);
      const z = parentAnomaly.coordinates.z + galaxy.orbitRadius * Math.sin(phase) * Math.sin(inclination);

      // Orbital velocity magnitude
      const orbitalSpeed = Math.sqrt(G * ANOMALY_MASS / galaxy.orbitRadius);

      // Velocity perpendicular to radius, accounting for inclination
      // This creates the "twist" effect
      const vx = -orbitalSpeed * Math.sin(phase);
      const vy = orbitalSpeed * Math.cos(phase) * Math.cos(inclination);
      const vz = orbitalSpeed * Math.cos(phase) * Math.sin(inclination);

      const coordinates = { x, y, z };
      const physics = { vx, vy, vz };

      // Store parent anomaly reference
      const parentAnomalyDoc = await db.collection('assets').findOne({ title: parentAnomaly.title, assetType: 'anomaly' });

      const result = await db.collection('assets').updateOne(
        { title: galaxy.title, assetType: 'galaxy' },
        {
          $set: {
            coordinates,
            physics,
            parentId: parentAnomalyDoc ? parentAnomalyDoc._id : null,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ ${galaxy.title}`);
        console.log(`   Parent: ${galaxy.parentAnomaly}`);
        console.log(`   Radius: ${galaxy.orbitRadius} units, Speed: ${orbitalSpeed.toFixed(2)} units/sec`);
        console.log(`   Inclination: ${(galaxy.orbitInclination * 180 / Math.PI).toFixed(1)}°`);
        console.log(`   Position: (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
        console.log(`   Velocity: (${vx.toFixed(2)}, ${vy.toFixed(2)}, ${vz.toFixed(2)})`);
      }
    }

    console.log('\n✅ Multi-anomaly orbital system configured!');
    console.log('   Galaxies will orbit their assigned anomalies with 3D inclination.');
    console.log('   The scene will show dynamic twisting motion.');

    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    if (client) await client.close();
    process.exit(1);
  }
}

setupMultiAnomalyOrbits();
