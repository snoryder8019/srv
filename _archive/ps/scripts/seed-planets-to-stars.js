/**
 * Seed planets to all star systems
 */
import { getDb, connectDB, closeDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function seedPlanets() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🪐 Seeding planets to star systems...\n');

    // Get all stars
    const stars = await db.collection('assets').find({
      assetType: 'star',
      status: 'approved'
    }).toArray();

    console.log(`Found ${stars.length} stars`);

    let totalPlanetsCreated = 0;

    for (const star of stars) {
      // Check if star already has planets
      const existingPlanets = await db.collection('assets').countDocuments({
        assetType: { $in: ['planet', 'orbital'] },
        parentStar: star._id
      });

      if (existingPlanets > 0) {
        console.log(`⏭️  ${star.title} already has ${existingPlanets} planets, skipping`);
        continue;
      }

      // Generate 2-6 planets per star
      const planetCount = Math.floor(Math.random() * 5) + 2;
      console.log(`\n🌟 ${star.title} - Creating ${planetCount} planets`);

      const planets = [];

      for (let i = 0; i < planetCount; i++) {
        const planetTypes = ['Rocky', 'Gas Giant', 'Ice Giant', 'Desert', 'Ocean', 'Lava'];
        const planetType = planetTypes[Math.floor(Math.random() * planetTypes.length)];

        const planet = {
          title: `${star.title} ${String.fromCharCode(98 + i)}`, // b, c, d, e, f, g
          description: `A ${planetType.toLowerCase()} planet orbiting ${star.title}`,
          assetType: 'planet',
          subType: planetType.toLowerCase().replace(' ', '-'),
          status: 'approved',
          rarity: 'common',

          // Hierarchy
          parentGalaxy: star.parentGalaxy,
          parentStar: star._id,

          // Orbital properties
          orbital: {
            radius: 200 + (i * 150), // Increasing distance from star
            speed: 0.0001 - (i * 0.00001), // Astronomical creep - very slow
            angle: Math.random() * Math.PI * 2, // Random starting position
            clockwise: true
          },

          // Planet properties
          radius: planetType === 'Gas Giant' ? Math.random() * 40 + 60 : Math.random() * 20 + 20,
          mass: Math.random() * 100 + 10,

          // Visual
          color: getPlanetColor(planetType),

          // Metadata
          createdAt: new Date(),
          updatedAt: new Date(),
          creator: 'system',
          votes: 0
        };

        planets.push(planet);
      }

      // Insert planets
      const result = await db.collection('assets').insertMany(planets);
      totalPlanetsCreated += result.insertedCount;

      console.log(`   ✅ Created ${result.insertedCount} planets`);
    }

    console.log(`\n🎉 Total planets created: ${totalPlanetsCreated}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await closeDB();
  }
}

// Helper to get planet colors
function getPlanetColor(type) {
  const colors = {
    'Rocky': '#8B7355',
    'Gas Giant': '#DAA520',
    'Ice Giant': '#87CEEB',
    'Desert': '#EDC9AF',
    'Ocean': '#0077BE',
    'Lava': '#FF4500'
  };
  return colors[type] || '#888888';
}

seedPlanets();
