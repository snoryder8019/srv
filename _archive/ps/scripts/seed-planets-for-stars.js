/**
 * Seed Planets for All Stars
 *
 * This script adds 2-8 planets to each star in the database
 * that doesn't already have planets.
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_USER_ID = '000000000000000000000000';

// Planet types with their characteristics
const PLANET_TYPES = [
  { type: 'rocky', colors: ['#AA6644', '#8B5A3C', '#A0826D'], atmosphere: false, landable: true },
  { type: 'garden', colors: ['#4A9B5F', '#6FB583', '#3D8B54'], atmosphere: true, landable: true },
  { type: 'desert', colors: ['#D4A373', '#C19A6B', '#E5C39F'], atmosphere: false, landable: true },
  { type: 'ice', colors: ['#B0D4E3', '#9FC5D6', '#C8E3F0'], atmosphere: false, landable: true },
  { type: 'gas_giant', colors: ['#D4A056', '#B88A4F', '#E5B76D'], atmosphere: true, landable: false },
  { type: 'lava', colors: ['#FF4500', '#FF6347', '#DC143C'], atmosphere: false, landable: false },
  { type: 'ocean', colors: ['#1E90FF', '#4169E1', '#0077BE'], atmosphere: true, landable: false },
  { type: 'frozen', colors: ['#E6F2FF', '#D4E9FF', '#BFD9FF'], atmosphere: false, landable: true }
];

// Generate random planet data
function generatePlanet(star, index, orbitRadius) {
  const planetType = PLANET_TYPES[Math.floor(Math.random() * PLANET_TYPES.length)];
  const color = planetType.colors[Math.floor(Math.random() * planetType.colors.length)];

  // Size based on type (gas giants are much larger)
  let size = 20;
  if (planetType.type === 'gas_giant') {
    size = 50 + Math.random() * 50; // 50-100
  } else {
    size = 10 + Math.random() * 30; // 10-40
  }

  // Calculate initial position on orbit
  const angle = (Math.PI * 2 * index) / 8; // Spread planets around star
  const x = star.coordinates.x + Math.cos(angle) * orbitRadius;
  const z = star.coordinates.z + Math.sin(angle) * orbitRadius;
  const y = star.coordinates.y + (Math.random() - 0.5) * 20; // Slight vertical variation

  // Orbital velocity for circular orbit: v = sqrt(G * M / r)
  // For game purposes, we'll use a simplified calculation
  const orbitalSpeed = Math.sqrt(500 / orbitRadius) * 0.1; // Scaled for game speed
  const velocityAngle = angle + Math.PI / 2; // Perpendicular to radius
  const velocity = {
    x: Math.cos(velocityAngle) * orbitalSpeed,
    y: 0,
    z: Math.sin(velocityAngle) * orbitalSpeed
  };

  return {
    userId: new ObjectId(ADMIN_USER_ID),
    title: `${star.title} ${String.fromCharCode(98 + index)}`, // b, c, d, e, etc.
    description: `A ${planetType.type} planet orbiting ${star.title}`,
    assetType: 'planet',
    subType: planetType.type,
    status: 'approved', // For voting system compatibility

    coordinates: { x, y, z },
    velocity: velocity,
    mass: size,
    radius: size,

    parentId: star._id,
    parentType: 'star',
    parentGalaxy: star.parentGalaxy, // Inherit galaxy from star

    orbitRadius: orbitRadius,
    eccentricity: Math.random() * 0.3, // 0-0.3 eccentricity
    inclination: (Math.random() - 0.5) * 0.1, // -0.05 to 0.05 radians

    planetData: {
      type: planetType.type,
      atmosphere: planetType.atmosphere,
      landable: planetType.landable
    },

    renderData: {
      color: color,
      size: size,
      type: planetType.type
    },

    tags: ['auto-generated', 'planet', planetType.type],
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

async function seedPlanetsForStars() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('🌌 Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all stars
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    console.log(`\n⭐ Found ${stars.length} stars in database`);

    let totalPlanetsCreated = 0;
    let starsWithPlanets = 0;

    for (const star of stars) {
      // Check if star already has planets
      const existingPlanets = await assetsCollection.countDocuments({
        assetType: 'planet',
        parentId: star._id
      });

      if (existingPlanets > 0) {
        console.log(`   ⏭️  Skipping "${star.title}" - already has ${existingPlanets} planet(s)`);
        continue;
      }

      // Generate 2-8 planets for this star
      const numPlanets = 2 + Math.floor(Math.random() * 7); // 2-8 planets
      const planets = [];

      console.log(`\n🌟 Creating ${numPlanets} planets for "${star.title}"`);

      for (let i = 0; i < numPlanets; i++) {
        // Orbit radius increases for each planet (50-500 units)
        const orbitRadius = 50 + (i * 50) + (Math.random() * 30);
        const planet = generatePlanet(star, i, orbitRadius);
        planets.push(planet);
        console.log(`   🌍 ${planet.title} (${planet.subType}) - orbit: ${orbitRadius.toFixed(0)} units`);
      }

      // Insert all planets for this star
      const result = await assetsCollection.insertMany(planets);
      totalPlanetsCreated += result.insertedCount;
      starsWithPlanets++;
    }

    console.log('\n✅ Planet seeding complete!');
    console.log(`   Stars processed: ${starsWithPlanets}`);
    console.log(`   Total planets created: ${totalPlanetsCreated}`);
    console.log(`   Average planets per star: ${(totalPlanetsCreated / starsWithPlanets).toFixed(1)}`);

  } catch (error) {
    console.error('❌ Error seeding planets:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the seeding
seedPlanetsForStars()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
