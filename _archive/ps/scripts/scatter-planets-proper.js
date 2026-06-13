import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function scatterPlanets() {
  console.log('🌍 Scattering planets across proper orbital distances...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all stars
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    console.log(`Found ${stars.length} stars\n`);

    let totalUpdated = 0;

    for (const star of stars) {
      console.log(`\n⭐ Processing star: ${star.title}`);
      console.log(`   Star position: (${star.coordinates?.x || 0}, ${star.coordinates?.y || 0}, ${star.coordinates?.z || 0})`);
      console.log(`   Star scale: ${star.scale || 1}`);

      // Calculate effective star radius (visible size in scene)
      const baseStarSize = 50; // Base visual size
      const starScale = star.scale || 1;
      const starRadius = baseStarSize * starScale;
      console.log(`   Effective star radius: ${starRadius.toFixed(0)}`);

      // Get planets for this star
      const planets = await assetsCollection.find({
        assetType: 'planet',
        parentStar: star._id.toString()
      }).toArray();

      console.log(`   Found ${planets.length} planets to scatter`);

      if (planets.length === 0) continue;

      // Define orbital distances (well outside star radius)
      // Use much larger distances for proper spacing
      // Maximum scene size is ~100,000 units (based on ship starting at 85,000)
      const MIN_ORBIT = starRadius * 10; // Minimum orbit: 10x star radius
      const MAX_ORBIT = 75000; // Maximum orbit (system boundary as calculated in gravity)

      // Calculate orbital spacing
      const orbitStep = (MAX_ORBIT - MIN_ORBIT) / planets.length;

      for (let i = 0; i < planets.length; i++) {
        const planet = planets[i];

        // Assign orbital radius (increasing with each planet)
        const orbitRadius = MIN_ORBIT + (i * orbitStep);

        // Random angle for orbital position (full 360 degrees)
        const angle = Math.random() * Math.PI * 2;

        // Random vertical offset (but keep relatively flat like real solar systems)
        const verticalSpread = 2000; // 2000 units vertical spread
        const verticalOffset = (Math.random() - 0.5) * verticalSpread;

        // Calculate 3D position
        const x = Math.cos(angle) * orbitRadius;
        const y = verticalOffset;
        const z = Math.sin(angle) * orbitRadius;

        // Star is at (0, 0, 0) in system map
        const coordinates3D = { x, y, z };

        // Update planet in database
        await assetsCollection.updateOne(
          { _id: planet._id },
          {
            $set: {
              coordinates3D: coordinates3D,
              orbitRadius: orbitRadius,
              orbitAngle: angle,
              // Keep original universal/local coordinates for galactic map
              localCoordinates: planet.localCoordinates,
              universalCoordinates: planet.universalCoordinates
            }
          }
        );

        console.log(`   ✓ ${planet.title}: orbit ${orbitRadius.toFixed(0)}m at angle ${(angle * 180 / Math.PI).toFixed(0)}° - Position: (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
        totalUpdated++;
      }

      // Summary
      const firstOrbit = MIN_ORBIT;
      const lastOrbit = MIN_ORBIT + ((planets.length - 1) * orbitStep);
      console.log(`   📊 Orbits range: ${firstOrbit.toFixed(0)}m to ${lastOrbit.toFixed(0)}m`);
      console.log(`   📊 Star radius: ${starRadius.toFixed(0)}m (planets start at ${(MIN_ORBIT / starRadius).toFixed(1)}x star radius)`);
    }

    console.log(`\n\n✅ Scattered ${totalUpdated} planets across proper orbital distances`);
    console.log(`   Planets now properly distributed outside star radius`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

scatterPlanets().catch(console.error);
