import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { Physics3D, Vector3D } from '../api/v1/physics/physics3d.js';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);
const physics = new Physics3D();

/**
 * UNIVERSE REBUILD SCRIPT
 *
 * Creates a fresh universe with:
 * - 1 Central Anomaly (absolute orbital anchor at 0,0,0)
 * - 2 Galaxies orbiting the anomaly
 * - 2 Stars per galaxy (4 total)
 * - 2 Planets per star (8 total)
 *
 * All objects have 3D physics with proper orbital mechanics
 */

async function rebuildUniverse() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas\n');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');
    const charactersCollection = db.collection('characters');

    // ========================================
    // STEP 1: CLEAR EVERYTHING
    // ========================================
    console.log('🗑️  STEP 1: CLEARING EXISTING UNIVERSE...\n');

    const deleteResult = await assetsCollection.deleteMany({});
    console.log(`   Deleted ${deleteResult.deletedCount} assets`);

    // Reset characters to no location
    const characterUpdate = await charactersCollection.updateMany(
      {},
      {
        $set: {
          'location.x': 0,
          'location.y': 0,
          'location.z': 0,
          'location.type': 'space',
          'location.assetId': null,
          'location.zone': 'The Void'
        }
      }
    );
    console.log(`   Reset ${characterUpdate.modifiedCount} characters to void\n`);

    // ========================================
    // STEP 2: CREATE CENTRAL ANOMALY
    // ========================================
    console.log('🌀 STEP 2: CREATING CENTRAL ANOMALY...\n');

    const anomaly = {
      title: 'The Primordial Singularity',
      assetType: 'anomaly',
      description: 'The center of all existence. The absolute orbital anchor from which all galaxies orbit.',

      // Coordinates - absolute center
      coordinates: {
        x: 0,
        y: 0,
        z: 0
      },

      // Physics properties
      mass: 10000, // Very massive to create strong gravitational pull
      radius: 100,

      // Velocity (stationary)
      velocity: {
        x: 0,
        y: 0,
        z: 0
      },

      // Rendering properties
      renderData: {
        color: '#FF00FF',
        size: 100,
        glow: true,
        glowColor: '#FF00FF',
        glowIntensity: 2.0
      },

      // Hub data for spawning
      hubData: {
        isStartingLocation: true,
        spawnRadius: 150,
        stringDomain: 'Primordial Chaos'
      },

      // Hierarchy
      parentId: null,
      parentType: null,

      createdAt: new Date(),
      updatedAt: new Date()
    };

    const anomalyResult = await assetsCollection.insertOne(anomaly);
    const anomalyId = anomalyResult.insertedId;
    console.log(`   ✓ Created: ${anomaly.title}`);
    console.log(`     Position: (0, 0, 0)`);
    console.log(`     Mass: ${anomaly.mass}`);
    console.log(`     ID: ${anomalyId}\n`);

    // ========================================
    // STEP 3: CREATE GALAXIES
    // ========================================
    console.log('🌌 STEP 3: CREATING 2 GALAXIES...\n');

    const galaxies = [];
    const galaxyNames = ['Lumina Prime', 'Void\'s Edge'];
    const galaxyColors = ['#4488FF', '#FF8844'];
    const galaxyOrbitRadii = [4000, 5500]; // Different distances from anomaly
    const galaxyInclinations = [0.3, -0.4]; // Different orbital heights (radians)

    for (let i = 0; i < 2; i++) {
      // Calculate orbital position and velocity with varied height
      const angle = (i * Math.PI); // 180 degrees apart
      const orbitData = physics.setCircularOrbit(
        { position: { x: 0, y: 0, z: 0 }, mass: 100 },
        { position: anomaly.coordinates, mass: anomaly.mass },
        galaxyOrbitRadii[i], // Different orbit radius for each
        galaxyInclinations[i] // Different inclination for varied heights
      );

      const galaxy = {
        title: galaxyNames[i],
        assetType: 'galaxy',
        description: `A vast spiral galaxy orbiting the Primordial Singularity`,

        coordinates: orbitData.position,
        velocity: orbitData.velocity,

        // Physics
        mass: 1000,
        radius: 500,

        // Orbital parent
        parentId: anomalyId,
        parentType: 'anomaly',
        orbitRadius: galaxyOrbitRadii[i],

        // Rendering
        renderData: {
          color: galaxyColors[i],
          size: 500,
          type: 'spiral',
          arms: 4
        },

        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await assetsCollection.insertOne(galaxy);
      galaxies.push({ ...galaxy, _id: result.insertedId });

      console.log(`   ✓ Created: ${galaxy.title}`);
      console.log(`     Position: (${Math.round(orbitData.position.x)}, ${Math.round(orbitData.position.y)}, ${Math.round(orbitData.position.z)})`);
      console.log(`     Velocity: (${orbitData.velocity.x.toFixed(2)}, ${orbitData.velocity.y.toFixed(2)}, ${orbitData.velocity.z.toFixed(2)})`);
      console.log(`     Orbit Radius: ${galaxyOrbitRadii[i]} units`);
      console.log(`     Inclination: ${(galaxyInclinations[i] * 180 / Math.PI).toFixed(1)}°`);
      console.log(`     ID: ${result.insertedId}\n`);
    }

    // ========================================
    // STEP 4: CREATE STARS
    // ========================================
    console.log('⭐ STEP 4: CREATING 2 STARS PER GALAXY (4 total)...\n');

    const stars = [];
    const starTypes = [
      { name: 'Alpha', color: '#FFFF00', temp: 6000 },
      { name: 'Beta', color: '#FF6600', temp: 4000 }
    ];

    for (let galaxyIndex = 0; galaxyIndex < galaxies.length; galaxyIndex++) {
      const galaxy = galaxies[galaxyIndex];
      console.log(`   Galaxy: ${galaxy.title}`);

      for (let starIndex = 0; starIndex < 2; starIndex++) {
        const starType = starTypes[starIndex];
        const starOrbitRadius = 300 + (starIndex * 100); // 300, 400

        // Calculate orbital position relative to galaxy
        const orbitData = physics.setCircularOrbit(
          { position: { x: 0, y: 0, z: 0 }, mass: 10 },
          { position: galaxy.coordinates, mass: galaxy.mass },
          starOrbitRadius,
          Math.random() * 0.5 // Small random inclination
        );

        const star = {
          title: `${galaxy.title} ${starType.name}`,
          assetType: 'star',
          description: `A ${starType.name} class star in the ${galaxy.title} galaxy`,

          coordinates: orbitData.position,
          velocity: orbitData.velocity,

          // Physics
          mass: 500,
          radius: 50,

          // Hierarchy
          parentId: galaxy._id,
          parentType: 'galaxy',
          orbitRadius: starOrbitRadius,

          // Star properties
          starData: {
            type: starType.name,
            temperature: starType.temp,
            luminosity: 1.0
          },

          // Rendering
          renderData: {
            color: starType.color,
            size: 50,
            glow: true,
            glowColor: starType.color,
            glowIntensity: 1.5
          },

          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await assetsCollection.insertOne(star);
        stars.push({ ...star, _id: result.insertedId });

        console.log(`     ✓ ${star.title}`);
        console.log(`       Position: (${Math.round(orbitData.position.x)}, ${Math.round(orbitData.position.y)}, ${Math.round(orbitData.position.z)})`);
        console.log(`       Orbit Radius: ${starOrbitRadius}`);
        console.log(`       ID: ${result.insertedId}`);
      }
      console.log('');
    }

    // ========================================
    // STEP 5: CREATE PLANETS
    // ========================================
    console.log('🪐 STEP 5: CREATING 2 PLANETS PER STAR (8 total)...\n');

    const planetTypes = [
      { suffix: 'I', type: 'rocky', color: '#AA6644', size: 20 },
      { suffix: 'II', type: 'gas giant', color: '#6688FF', size: 40 }
    ];

    let totalPlanets = 0;

    for (let starIndex = 0; starIndex < stars.length; starIndex++) {
      const star = stars[starIndex];
      console.log(`   Star: ${star.title}`);

      for (let planetIndex = 0; planetIndex < 2; planetIndex++) {
        const planetType = planetTypes[planetIndex];
        const planetOrbitRadius = 80 + (planetIndex * 60); // 80, 140

        // Calculate orbital position relative to star
        const orbitData = physics.setCircularOrbit(
          { position: { x: 0, y: 0, z: 0 }, mass: 1 },
          { position: star.coordinates, mass: star.mass },
          planetOrbitRadius,
          Math.random() * 0.3 // Random inclination
        );

        const planet = {
          title: `${star.title} ${planetType.suffix}`,
          assetType: 'planet',
          description: `A ${planetType.type} orbiting ${star.title}`,

          coordinates: orbitData.position,
          velocity: orbitData.velocity,

          // Physics
          mass: planetType.type === 'gas giant' ? 50 : 20,
          radius: planetType.size,

          // Hierarchy
          parentId: star._id,
          parentType: 'star',
          orbitRadius: planetOrbitRadius,

          // Planet properties
          planetData: {
            type: planetType.type,
            atmosphere: planetType.type === 'gas giant',
            landable: planetType.type === 'rocky'
          },

          // Rendering
          renderData: {
            color: planetType.color,
            size: planetType.size,
            type: planetType.type
          },

          createdAt: new Date(),
          updatedAt: new Date()
        };

        await assetsCollection.insertOne(planet);
        totalPlanets++;

        console.log(`     ✓ ${planet.title} (${planetType.type})`);
        console.log(`       Position: (${Math.round(orbitData.position.x)}, ${Math.round(orbitData.position.y)}, ${Math.round(orbitData.position.z)})`);
        console.log(`       Orbit Radius: ${planetOrbitRadius}`);
      }
      console.log('');
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('═══════════════════════════════════════════');
    console.log('✅ UNIVERSE REBUILD COMPLETE!\n');
    console.log('📊 STATISTICS:');
    console.log(`   Anomalies: 1 (Primordial Singularity)`);
    console.log(`   Galaxies: ${galaxies.length}`);
    console.log(`   Stars: ${stars.length}`);
    console.log(`   Planets: ${totalPlanets}`);
    console.log(`   Total Assets: ${1 + galaxies.length + stars.length + totalPlanets}\n`);

    console.log('🌌 HIERARCHY:');
    console.log('   Primordial Singularity (0,0,0)');
    for (const galaxy of galaxies) {
      console.log(`   ├── ${galaxy.title}`);
      const galaxyStars = stars.filter(s => s.parentId.equals(galaxy._id));
      for (let i = 0; i < galaxyStars.length; i++) {
        const star = galaxyStars[i];
        const isLast = i === galaxyStars.length - 1;
        const prefix = isLast ? '└──' : '├──';
        console.log(`   │   ${prefix} ${star.title}`);
        console.log(`   │   ${isLast ? '    ' : '│   '}    ├── ${star.title} I (rocky)`);
        console.log(`   │   ${isLast ? '    ' : '│   '}    └── ${star.title} II (gas giant)`);
      }
    }
    console.log('\n═══════════════════════════════════════════\n');

    // Reset all characters to spawn at anomaly
    const characters = await charactersCollection.find({}).toArray();
    if (characters.length > 0) {
      console.log(`🎯 Spawning ${characters.length} characters at Primordial Singularity...\n`);

      for (const character of characters) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 150;

        await charactersCollection.updateOne(
          { _id: character._id },
          {
            $set: {
              'location.x': Math.cos(angle) * distance,
              'location.y': Math.sin(angle) * distance,
              'location.z': 0,
              'location.type': 'galactic',
              'location.assetId': anomalyId.toString(),
              'location.zone': 'Primordial Chaos'
            }
          }
        );
        console.log(`   ✓ ${character.name} spawned near anomaly`);
      }
    }

    console.log('\n✅ All done! Universe is ready for exploration.');

  } catch (error) {
    console.error('❌ Error during universe rebuild:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the rebuild
rebuildUniverse().catch(console.error);
