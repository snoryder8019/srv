import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function seedGalaxies() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    console.log('\n=== SEEDING GALAXIES ===\n');

    // Get existing anomalies to orbit around
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();
    console.log(`📊 Found ${anomalies.length} anomalies to orbit`);

    if (anomalies.length === 0) {
      console.log('⚠️  No anomalies found! Galaxies will be placed randomly.');
    }

    // Get existing galaxies to check count
    const existingGalaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`📊 Currently ${existingGalaxies.length} galaxies exist`);

    // Galaxy name pools
    const prefixes = ['Nova', 'Stellar', 'Cosmic', 'Celestial', 'Nebular', 'Quantum', 'Astral', 'Radiant', 'Mystic', 'Eternal'];
    const suffixes = ['Expanse', 'Domain', 'Realm', 'Haven', 'Collective', 'Convergence', 'Spiral', 'Cluster', 'Nexus', 'Archive'];

    // Calculate universe center based on anomalies
    let centerX = 0, centerY = 0, centerZ = 0;
    if (anomalies.length > 0) {
      centerX = anomalies.reduce((sum, a) => sum + (a.coordinates?.x || 0), 0) / anomalies.length;
      centerY = anomalies.reduce((sum, a) => sum + (a.coordinates?.y || 0), 0) / anomalies.length;
      centerZ = anomalies.reduce((sum, a) => sum + (a.coordinates?.z || 0), 0) / anomalies.length;
      console.log(`📍 Universe center: (${Math.round(centerX)}, ${Math.round(centerY)}, ${Math.round(centerZ)})`);
    }

    // Create new galaxies
    const numberOfGalaxies = 10; // Create 10 new galaxies
    const newGalaxies = [];

    console.log(`\n🌌 Creating ${numberOfGalaxies} new galaxies...\n`);

    for (let i = 0; i < numberOfGalaxies; i++) {
      // Generate random name
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      const title = `${prefix} ${suffix}`;

      // Position galaxies in orbits around anomalies or randomly
      let x, y, z;

      if (anomalies.length > 0) {
        // Pick a random anomaly to orbit
        const anomaly = anomalies[Math.floor(Math.random() * anomalies.length)];
        const ax = anomaly.coordinates?.x || 0;
        const ay = anomaly.coordinates?.y || 0;
        const az = anomaly.coordinates?.z || 0;

        // Place galaxy at random distance and angle from anomaly
        const distance = 500 + Math.random() * 2000; // 500-2500 units from anomaly
        const theta = Math.random() * Math.PI * 2; // Random angle
        const phi = (Math.random() - 0.5) * Math.PI * 0.5; // Slight vertical variation

        x = ax + distance * Math.cos(theta) * Math.cos(phi);
        y = ay + distance * Math.sin(theta) * Math.cos(phi);
        z = az + distance * Math.sin(phi);
      } else {
        // Random placement if no anomalies
        x = centerX + (Math.random() - 0.5) * 5000;
        y = centerY + (Math.random() - 0.5) * 5000;
        z = centerZ + (Math.random() - 0.5) * 2000;
      }

      const galaxy = {
        _id: new ObjectId(),
        title: title,
        assetType: 'galaxy',
        description: `A magnificent galaxy ${title.toLowerCase()}, home to countless star systems.`,
        coordinates: {
          x: Math.round(x),
          y: Math.round(y),
          z: Math.round(z)
        },
        velocity: {
          x: 0,
          y: 0,
          z: 0
        },
        mass: 100000, // Galaxy mass
        radius: 25,
        renderData: {
          galaxyShape: 'spiral-6',
          galaxyDimension: 1.0,
          galaxyTrim: 0.2,
          galaxyCurvature: 2.0
        },
        stats: {
          size: 25
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      newGalaxies.push(galaxy);
      console.log(`   ✓ ${galaxy.title}: (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`);
    }

    // Insert into database
    console.log(`\n💾 Inserting ${newGalaxies.length} galaxies into database...`);
    const result = await assetsCollection.insertMany(newGalaxies);
    console.log(`✅ Inserted ${result.insertedCount} galaxies`);

    // Show summary
    const totalGalaxies = existingGalaxies.length + newGalaxies.length;
    console.log(`\n📊 Summary:`);
    console.log(`   Previous galaxies: ${existingGalaxies.length}`);
    console.log(`   New galaxies: ${newGalaxies.length}`);
    console.log(`   Total galaxies: ${totalGalaxies}`);

    console.log('\n💡 Next steps:');
    console.log('   1. Refresh your browser to load the new galaxies');
    console.log('   2. Watch them initialize with orbital velocities');
    console.log('   3. Enjoy the enhanced galactic simulation!');

    console.log('\n=== SEEDING COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Database connection closed');
  }
}

// Run the seeding
seedGalaxies().catch(console.error);
