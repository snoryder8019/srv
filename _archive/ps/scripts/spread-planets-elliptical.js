import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const assetsCollection = db.collection('assets');

  console.log('🔍 Analyzing current planet distribution...\n');

  const planets = await assetsCollection.find({
    assetType: 'planet',
    orbitRadius: { $exists: true }
  }).sort({ orbitRadius: 1 }).toArray();

  console.log(`Found ${planets.length} planets with orbits`);
  console.log('\nCurrent distribution:');
  console.log('=====================');

  const maxOrbit = Math.max(...planets.map(p => p.orbitRadius));
  const minOrbit = Math.min(...planets.map(p => p.orbitRadius));

  console.log(`Min orbit: ${minOrbit.toFixed(1)} (scaled: ${(minOrbit * 150).toFixed(0)} units)`);
  console.log(`Max orbit: ${maxOrbit.toFixed(1)} (scaled: ${(maxOrbit * 150).toFixed(0)} units)`);
  console.log(`\nPlanet positions:`);
  planets.forEach((p, i) => {
    const percent = ((p.orbitRadius / maxOrbit) * 100).toFixed(0);
    console.log(`  ${(i+1).toString().padStart(2)}. ${p.title.padEnd(30)} orbit: ${p.orbitRadius.toFixed(1).padStart(8)} (${percent}% of max)`);
  });

  console.log('\n📊 Redistributing planets with elliptical variety...\n');

  // Redistribute planets across wider range with elliptical orbits
  const MAX_ORBIT = 400; // Way out at edge (400 * 150 = 60,000 units)
  const MIN_ORBIT = 10;  // Keep minimum safe distance

  const updates = [];

  for (let i = 0; i < planets.length; i++) {
    const planet = planets[i];

    // Spread planets exponentially (inner planets closer, outer planets MUCH further)
    const position = i / (planets.length - 1); // 0 to 1
    const exponentialSpread = Math.pow(position, 1.5); // Exponential curve

    // New orbit radius
    const newOrbitRadius = MIN_ORBIT + (exponentialSpread * (MAX_ORBIT - MIN_ORBIT));

    // Add elliptical variation (eccentricity)
    // Some orbits are more elliptical than others
    const eccentricity = Math.random() * 0.3; // 0 to 0.3 (0 = circle, 1 = very elliptical)

    // Random orbital inclination (tilt)
    const inclination = (Math.random() - 0.5) * 0.2; // -0.1 to +0.1 radians (~-6° to +6°)

    updates.push({
      id: planet._id,
      title: planet.title,
      oldOrbit: planet.orbitRadius,
      newOrbit: newOrbitRadius,
      eccentricity: eccentricity,
      inclination: inclination,
      scaledOrbit: newOrbitRadius * 150
    });
  }

  console.log('New distribution:');
  console.log('=================');
  updates.forEach((u, i) => {
    console.log(`  ${(i+1).toString().padStart(2)}. ${u.title.padEnd(30)} ${u.oldOrbit.toFixed(1).padStart(8)} → ${u.newOrbit.toFixed(1).padStart(8)} (${u.scaledOrbit.toFixed(0).padStart(6)} units) ecc: ${u.eccentricity.toFixed(2)}`);
  });

  console.log('\n🔧 Updating database...');

  for (const update of updates) {
    await assetsCollection.updateOne(
      { _id: update.id },
      {
        $set: {
          orbitRadius: update.newOrbit,
          eccentricity: update.eccentricity,
          inclination: update.inclination
        }
      }
    );
  }

  console.log(`✅ Updated ${updates.length} planets with new orbital parameters!`);
  console.log(`   - Spread from ${MIN_ORBIT} to ${MAX_ORBIT} (${MIN_ORBIT * 150} to ${MAX_ORBIT * 150} units)`);
  console.log(`   - Added elliptical eccentricity variation`);
  console.log(`   - Added orbital inclination variation`);

  await client.close();
  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err);
  await client.close();
  process.exit(1);
}
