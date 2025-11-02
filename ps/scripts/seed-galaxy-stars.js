/**
 * Seed Galaxy Stars
 * Add 1-5 stars to each galaxy with proper local coordinates
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

// Star naming components
const greekLetters = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
const suffixes = ['Prime', 'Major', 'Minor', 'A', 'B', 'C', 'Secundus', 'Tertius'];

// Star types with properties
const starTypes = [
  { type: 'yellow-star', color: '#FFFF00', temp: 5778, lum: 1.0, radius: 8, name: 'Yellow Dwarf' },
  { type: 'red-giant', color: '#FF6B6B', temp: 3500, lum: 2.5, radius: 12, name: 'Red Giant' },
  { type: 'blue-star', color: '#4A9EFF', temp: 10000, lum: 3.0, radius: 10, name: 'Blue Star' },
  { type: 'white-dwarf', color: '#E0E0FF', temp: 7500, lum: 0.5, radius: 6, name: 'White Dwarf' },
  { type: 'orange-star', color: '#FF8C42', temp: 4500, lum: 0.8, radius: 7, name: 'Orange Dwarf' }
];

async function seedGalaxyStars() {
  console.log('⭐ Seeding stars for each galaxy...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all galaxies
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`🌌 Found ${galaxies.length} galaxies\n`);

    let totalStarsCreated = 0;
    const allStars = [];

    for (const galaxy of galaxies) {
      // Random number of stars (1-5) per galaxy
      const numStars = Math.floor(Math.random() * 5) + 1;
      console.log(`🌌 ${galaxy.title}: Creating ${numStars} star${numStars > 1 ? 's' : ''}...`);

      const galaxyStars = [];

      for (let i = 0; i < numStars; i++) {
        // Generate unique name for this star
        const greekLetter = greekLetters[i % greekLetters.length];
        const suffix = i >= greekLetters.length ? suffixes[i - greekLetters.length] : '';
        const galaxyName = galaxy.title.split(' ')[0]; // First word of galaxy name
        const starName = suffix ? `${greekLetter} ${galaxyName} ${suffix}` : `${greekLetter} ${galaxyName}`;

        // Random star type
        const starType = starTypes[Math.floor(Math.random() * starTypes.length)];

        // Generate local coordinates within galaxy (spread across 5000x5000 grid)
        // Ensure stars aren't too close to each other (min 500 units apart)
        let localX, localY, localZ;
        let tooClose = true;
        let attempts = 0;

        while (tooClose && attempts < 20) {
          localX = Math.round((Math.random() - 0.5) * 4000); // -2000 to +2000
          localY = Math.round((Math.random() - 0.5) * 4000);
          localZ = Math.round((Math.random() - 0.5) * 1000); // Less Z variation

          // Check distance from other stars in this galaxy
          tooClose = false;
          for (const existingStar of galaxyStars) {
            const dx = localX - existingStar.localCoordinates.x;
            const dy = localY - existingStar.localCoordinates.y;
            const dz = localZ - existingStar.localCoordinates.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < 500) {
              tooClose = true;
              break;
            }
          }
          attempts++;
        }

        // Create star object
        const star = {
          _id: new ObjectId(),
          title: starName,
          assetType: 'star',
          starType: starType.type,
          description: `${starType.name} in the ${galaxy.title} galaxy, a beacon for exploration.`,

          // Galactic coordinates (same as parent galaxy for positioning in universe view)
          coordinates: {
            x: galaxy.coordinates.x,
            y: galaxy.coordinates.y,
            z: galaxy.coordinates.z || 0
          },

          // Local coordinates within galaxy interior (used in galaxy view)
          localCoordinates: {
            x: localX,
            y: localY,
            z: localZ
          },

          // Parent relationship
          parentGalaxy: galaxy._id.toString(),

          // Star properties
          luminosity: starType.lum,
          temperature: starType.temp,
          radius: starType.radius,
          color: starType.color,

          // Stats for rendering
          stats: {
            size: starType.radius,
            color: starType.color
          },

          status: 'published',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        galaxyStars.push(star);
        allStars.push(star);

        console.log(`   ⭐ ${starName} (${starType.name})`);
        console.log(`      Local: (${localX}, ${localY}, ${localZ})`);
      }

      totalStarsCreated += numStars;
      console.log('');
    }

    // Insert all stars into database
    if (allStars.length > 0) {
      console.log(`💾 Inserting ${allStars.length} stars into database...`);
      const result = await assetsCollection.insertMany(allStars);
      console.log(`✅ Inserted ${result.insertedCount} stars\n`);
    }

    // Show summary
    console.log(`📊 Summary:`);
    console.log(`   Galaxies: ${galaxies.length}`);
    console.log(`   Stars created: ${totalStarsCreated}`);
    console.log(`   Average stars per galaxy: ${(totalStarsCreated / galaxies.length).toFixed(1)}`);

    console.log('\n💡 Next steps:');
    console.log('   1. Restart the service to load new stars');
    console.log('   2. Click on a galaxy in the galactic map');
    console.log('   3. See stars appear in the galaxy interior view!');

    console.log('\n✅ Star seeding complete!\n');

    await client.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

seedGalaxyStars();
