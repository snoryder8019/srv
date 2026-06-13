import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

// Planet types and their properties
const planetTypes = [
  { type: 'rocky', colors: ['#8B4513', '#A0522D', '#CD853F'], sizes: [3, 5] },
  { type: 'gas-giant', colors: ['#FFD700', '#FFA500', '#FF6347'], sizes: [8, 12] },
  { type: 'ice', colors: ['#B0E0E6', '#87CEEB', '#4682B4'], sizes: [4, 6] },
  { type: 'desert', colors: ['#EDC9AF', '#DEB887', '#D2B48C'], sizes: [3, 5] },
  { type: 'oceanic', colors: ['#1E90FF', '#4169E1', '#0000CD'], sizes: [4, 7] }
];

const planetNames = [
  'Prime', 'Secundus', 'Tertius', 'Quartus', 'Quintus',
  'Sextus', 'Septimus', 'Octavus', 'Nonus', 'Decimus'
];

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

async function createPlanets() {
  console.log('🪐 Creating planet assets for all stars...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    console.log(`Found ${stars.length} stars\n`);

    let totalPlanetsCreated = 0;

    for (const star of stars) {
      console.log(`\n⭐ Creating planets for star: ${star.title}`);

      // Random number of planets (3-8 per star)
      const planetCount = Math.floor(randomRange(3, 9));
      console.log(`   Generating ${planetCount} planets`);

      for (let i = 0; i < planetCount; i++) {
        const planetTypeData = randomChoice(planetTypes);
        const planetName = `${star.title} ${planetNames[i]}`;
        const color = randomChoice(planetTypeData.colors);
        const size = randomRange(planetTypeData.sizes[0], planetTypeData.sizes[1]);

        // Orbital distance increases with each planet (50-100 units apart)
        const orbitRadius = 50 + (i * randomRange(50, 100));

        // Random angle around the star
        const angle = Math.random() * Math.PI * 2;

        // Calculate local coordinates (position around parent star)
        const localX = Math.cos(angle) * orbitRadius;
        const localY = Math.sin(angle) * orbitRadius;
        const localZ = randomRange(-10, 10); // Slight vertical variation

        // Universal coordinates = star's universal coords + local offset
        const universalX = star.universalCoordinates.x + localX;
        const universalY = star.universalCoordinates.y + localY;
        const universalZ = star.universalCoordinates.z + localZ;

        const planetAsset = {
          title: planetName,
          assetType: 'planet',
          description: `A ${planetTypeData.type} planet orbiting ${star.title}`,

          // Parent relationships
          parentStar: star._id.toString(),
          parentGalaxy: star.parentGalaxy,

          // Coordinates
          coordinates: {
            x: universalX,
            y: universalY,
            z: universalZ
          },
          universalCoordinates: {
            x: universalX,
            y: universalY,
            z: universalZ
          },
          localCoordinates: {
            x: localX,
            y: localY,
            z: localZ
          },

          // Orbital properties
          orbitRadius: orbitRadius,
          orbitSpeed: randomRange(0.0001, 0.001), // Radians per update
          orbitAngle: angle,

          // Render properties
          radius: size,
          renderData: {
            color: color,
            size: size,
            type: planetTypeData.type
          },

          // Metadata
          createdAt: new Date(),
          createdBy: 'system-generator'
        };

        const result = await assetsCollection.insertOne(planetAsset);
        console.log(`   ✓ Created: ${planetName} (${planetTypeData.type}, orbit: ${orbitRadius.toFixed(1)})`);
        totalPlanetsCreated++;
      }
    }

    console.log(`\n\n✅ Created ${totalPlanetsCreated} planets across ${stars.length} stars`);
    console.log(`\nPlanet distribution:`);

    const planetCounts = await assetsCollection.aggregate([
      { $match: { assetType: 'planet' } },
      { $group: { _id: '$parentStar', count: { $sum: 1 } } }
    ]).toArray();

    for (const count of planetCounts) {
      const star = stars.find(s => s._id.toString() === count._id);
      console.log(`  ${star?.title}: ${count.count} planets`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

createPlanets().catch(console.error);
