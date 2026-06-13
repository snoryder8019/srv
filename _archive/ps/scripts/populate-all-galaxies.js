import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

// Star name prefixes
const starPrefixes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];

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

async function populateAllGalaxies() {
  console.log('🌌 Populating ALL galaxies with stars and planets...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`Found ${galaxies.length} galaxies\n`);

    let totalStarsCreated = 0;
    let totalPlanetsCreated = 0;

    for (const galaxy of galaxies) {
      console.log(`\n🌌 Processing galaxy: ${galaxy.title}`);
      console.log(`   Galaxy position: (${galaxy.coordinates.x.toFixed(1)}, ${galaxy.coordinates.y.toFixed(1)}, ${galaxy.coordinates.z.toFixed(1)})`);

      // Check if galaxy already has stars
      const existingStars = await assetsCollection.countDocuments({
        assetType: 'star',
        parentGalaxy: galaxy._id.toString()
      });

      if (existingStars > 0) {
        console.log(`   ⚠️ Galaxy already has ${existingStars} stars, skipping...`);
        continue;
      }

      // Create 3-8 stars per galaxy
      const starCount = Math.floor(randomRange(3, 9));
      console.log(`   Creating ${starCount} stars...`);

      for (let i = 0; i < starCount; i++) {
        const starName = `${galaxy.title} ${starPrefixes[i] || `Star-${i+1}`}`;

        // Generate local coordinates within galaxy (spread across 5000x5000 area)
        const localX = randomRange(-2500, 2500);
        const localY = randomRange(-2500, 2500);
        const localZ = randomRange(-500, 500);

        // Universal coordinates = galaxy position + local offset
        const universalX = galaxy.coordinates.x + localX;
        const universalY = galaxy.coordinates.y + localY;
        const universalZ = galaxy.coordinates.z + localZ;

        const starAsset = {
          title: starName,
          assetType: 'star',
          description: `A star in the ${galaxy.title} galaxy`,

          // Parent relationships
          parentGalaxy: galaxy._id.toString(),

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

          // Star properties
          radius: randomRange(50, 150),
          mass: randomRange(100000, 500000),

          // Rendering
          renderData: {
            color: randomChoice(['#FFFF00', '#FFD700', '#FFA500', '#FF6347', '#87CEEB']),
            size: randomRange(5, 10)
          },

          status: 'approved',
          submittedBy: 'system',
          votes: { upvotes: 0, downvotes: 0 },
          createdAt: new Date()
        };

        const starResult = await assetsCollection.insertOne(starAsset);
        totalStarsCreated++;
        console.log(`      ⭐ Created star: ${starName}`);

        // Create 3-8 planets for this star
        const planetCount = Math.floor(randomRange(3, 9));
        console.log(`         Creating ${planetCount} planets...`);

        for (let j = 0; j < planetCount; j++) {
          const planetTypeData = randomChoice(planetTypes);
          const planetName = `${starName} ${planetNames[j]}`;
          const color = randomChoice(planetTypeData.colors);
          const size = randomRange(planetTypeData.sizes[0], planetTypeData.sizes[1]);

          // Orbital distance increases with each planet (50-100 units apart)
          const orbitRadius = 50 + (j * randomRange(50, 100));

          // Random angle around the star
          const angle = Math.random() * Math.PI * 2;

          // Calculate local coordinates (position around parent star)
          const localPlanetX = Math.cos(angle) * orbitRadius;
          const localPlanetY = Math.sin(angle) * orbitRadius;
          const localPlanetZ = randomRange(-10, 10);

          // Universal coordinates = star's universal coords + local offset
          const universalPlanetX = universalX + localPlanetX;
          const universalPlanetY = universalY + localPlanetY;
          const universalPlanetZ = universalZ + localPlanetZ;

          const planetAsset = {
            title: planetName,
            assetType: 'planet',
            description: `A ${planetTypeData.type} planet orbiting ${starName}`,

            // Parent relationships
            parentStar: starResult.insertedId.toString(),
            parentGalaxy: galaxy._id.toString(),

            // Coordinates
            coordinates: {
              x: universalPlanetX,
              y: universalPlanetY,
              z: universalPlanetZ
            },
            universalCoordinates: {
              x: universalPlanetX,
              y: universalPlanetY,
              z: universalPlanetZ
            },
            localCoordinates: {
              x: localPlanetX,
              y: localPlanetY,
              z: localPlanetZ
            },

            // Orbital properties
            orbitRadius: orbitRadius,
            orbitAngle: angle,
            orbitSpeed: randomRange(0.001, 0.005),

            // Planet properties
            radius: size,
            mass: randomRange(1000, 10000),

            // Rendering
            renderData: {
              color: color,
              size: size,
              type: planetTypeData.type
            },

            status: 'approved',
            submittedBy: 'system',
            votes: { upvotes: 0, downvotes: 0 },
            createdAt: new Date()
          };

          await assetsCollection.insertOne(planetAsset);
          totalPlanetsCreated++;
        }
      }

      console.log(`   ✅ Created ${starCount} stars with planets for ${galaxy.title}`);
    }

    console.log(`\n✅ COMPLETE!`);
    console.log(`   Total stars created: ${totalStarsCreated}`);
    console.log(`   Total planets created: ${totalPlanetsCreated}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

populateAllGalaxies();
