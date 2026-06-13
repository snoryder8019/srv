import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkStarDistribution() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Star Distribution Analysis ===\n');

  const galaxies = await db.collection('assets').find({ assetType: 'galaxy' }).toArray();
  const stars = await db.collection('assets').find({ assetType: 'star' }).toArray();

  console.log('Total galaxies:', galaxies.length);
  console.log('Total stars:', stars.length);
  console.log('');

  for (const galaxy of galaxies) {
    const galaxyStars = stars.filter(s => 
      s.parentGalaxy && s.parentGalaxy.toString() === galaxy._id.toString()
    );
    console.log(galaxy.title + ':');
    console.log('  Stars: ' + galaxyStars.length);
    console.log('  Position: (' + (galaxy.coordinates.x || 0) + ', ' + (galaxy.coordinates.y || 0) + ', ' + (galaxy.coordinates.z || 0) + ')');
  }

  const orphanStars = stars.filter(s => !s.parentGalaxy);
  console.log('\nOrphan stars (no parent galaxy): ' + orphanStars.length);

  process.exit(0);
}

checkStarDistribution();
