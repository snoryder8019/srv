import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// Star glow is MASSIVE - need planets MUCH further
// Star base size: 50, adjusted: 400, glow multiplier: 1.1 = 440 units
// But visually it looks bigger - let's be safe
const STAR_GLOW_RADIUS = 600; // Conservative estimate of visible glow
const MIN_ORBIT_RADIUS = 30; // 30 * 150 = 4500 units from center (way beyond glow)
const MAX_ORBIT_RADIUS = 500; // 500 * 150 = 75,000 units (massive outer edge)

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const assetsCollection = db.collection('assets');

  console.log('🚀 Pushing ALL planets MUCH further from star...');
  console.log(`   Star glow radius: ~${STAR_GLOW_RADIUS} units`);
  console.log(`   New minimum: ${MIN_ORBIT_RADIUS} (${MIN_ORBIT_RADIUS * 150} units - WAY beyond glow)`);
  console.log(`   New maximum: ${MAX_ORBIT_RADIUS} (${MAX_ORBIT_RADIUS * 150} units - outer edge)\n`);

  const planets = await assetsCollection.find({
    assetType: 'planet',
    orbitRadius: { $exists: true }
  }).sort({ orbitRadius: 1 }).toArray();

  console.log(`Found ${planets.length} planets to redistribute\n`);

  const updates = [];

  for (let i = 0; i < planets.length; i++) {
    const planet = planets[i];
    const position = i / (planets.length - 1); // 0 to 1
    const exponentialSpread = Math.pow(position, 1.3); // Exponential curve

    // New orbit radius - MUCH further out
    const newOrbitRadius = MIN_ORBIT_RADIUS + (exponentialSpread * (MAX_ORBIT_RADIUS - MIN_ORBIT_RADIUS));

    // Keep eccentricity if it exists
    const eccentricity = planet.eccentricity || Math.random() * 0.3;
    const inclination = planet.inclination || (Math.random() - 0.5) * 0.2;

    updates.push({
      id: planet._id,
      title: planet.title,
      oldOrbit: planet.orbitRadius,
      newOrbit: newOrbitRadius,
      eccentricity: eccentricity,
      scaledOrbit: newOrbitRadius * 150
    });
  }

  console.log('New distribution (inner 10 and outer 10):');
  console.log('==========================================');
  updates.slice(0, 10).forEach((u, i) => {
    console.log(`  ${(i+1).toString().padStart(2)}. ${u.title.padEnd(35)} ${u.oldOrbit.toFixed(1).padStart(8)} → ${u.newOrbit.toFixed(1).padStart(8)} (${u.scaledOrbit.toFixed(0).padStart(6)} units)`);
  });
  console.log('  ...');
  updates.slice(-10).forEach((u, i) => {
    const idx = updates.length - 10 + i;
    console.log(`  ${(idx+1).toString().padStart(2)}. ${u.title.padEnd(35)} ${u.oldOrbit.toFixed(1).padStart(8)} → ${u.newOrbit.toFixed(1).padStart(8)} (${u.scaledOrbit.toFixed(0).padStart(6)} units)`);
  });

  console.log('\n🔧 Updating database...');

  for (const update of updates) {
    await assetsCollection.updateOne(
      { _id: update.id },
      {
        $set: {
          orbitRadius: update.newOrbit,
          eccentricity: update.eccentricity
        }
      }
    );
  }

  console.log(`✅ Updated ${updates.length} planets!`);
  console.log(`   Range: ${MIN_ORBIT_RADIUS} to ${MAX_ORBIT_RADIUS} (${MIN_ORBIT_RADIUS * 150} to ${MAX_ORBIT_RADIUS * 150} units)`);
  console.log(`   Inner planets now at ${MIN_ORBIT_RADIUS * 150} units - CLEAR of star glow!`);

  await client.close();
  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err);
  await client.close();
  process.exit(1);
}
