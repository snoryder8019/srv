import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function seedStarsAroundGalaxies() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Seeding Stars Around Galaxies ===\n');

  const galaxies = await db.collection('assets').find({ assetType: 'galaxy' }).toArray();
  const existingStars = await db.collection('assets').find({ assetType: 'star' }).toArray();

  const starNames = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Prime', 'Nova', 'Pulsar', 'Quasar', 'Nebula', 'Vortex', 'Beacon',
    'Radiant', 'Crimson', 'Azure', 'Ember', 'Frost', 'Storm', 'Dawn'
  ];

  let starsCreated = 0;

  for (const galaxy of galaxies) {
    // Check how many stars this galaxy has
    const galaxyStars = existingStars.filter(s =>
      s.parentGalaxy && s.parentGalaxy.toString() === galaxy._id.toString()
    );

    const starsNeeded = 5 - galaxyStars.length; // Target: 5 stars per galaxy

    if (starsNeeded <= 0) {
      console.log(galaxy.title + ': Already has ' + galaxyStars.length + ' stars');
      continue;
    }

    console.log(galaxy.title + ': Adding ' + starsNeeded + ' stars');

    for (let i = 0; i < starsNeeded; i++) {
      // Random position around galaxy (200-400 units away)
      const angle = Math.random() * Math.PI * 2;
      const distance = 200 + Math.random() * 200;
      const height = (Math.random() - 0.5) * 100;

      const x = galaxy.coordinates.x + Math.cos(angle) * distance;
      const y = galaxy.coordinates.y + height;
      const z = galaxy.coordinates.z + Math.sin(angle) * distance;

      const starName = starNames[Math.floor(Math.random() * starNames.length)] + ' ' + 
                      (galaxyStars.length + i + 1);

      const newStar = {
        title: starName,
        assetType: 'star',
        parentGalaxy: galaxy._id,
        coordinates: { x, y, z },
        stats: {
          mass: 5000 + Math.random() * 5000,
          temperature: 3000 + Math.random() * 20000,
          luminosity: 0.5 + Math.random() * 2
        },
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('assets').insertOne(newStar);
      starsCreated++;

      console.log('  Created: ' + starName + ' at (' + x.toFixed(0) + ', ' + y.toFixed(0) + ', ' + z.toFixed(0) + ')');
    }
  }

  console.log('\n✅ Created ' + starsCreated + ' new stars');
  console.log('Total stars now: ' + (existingStars.length + starsCreated));

  process.exit(0);
}

seedStarsAroundGalaxies();
