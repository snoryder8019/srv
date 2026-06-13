import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function rescatterPlanetsWide() {
  console.log('🌍 RE-SCATTERING planets with proper visual distances...\n');

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

      // ACTUAL VISUAL SIZE IN SCENE
      // Star base size: 50 units
      // Rendered size multiplier: 8x (from system-map-3d.js line 323)
      // Glow multiplier: 1.1x (line 343)
      const baseStarSize = 50;
      const renderMultiplier = 8;
      const glowMultiplier = 1.1;
      const actualStarRadius = baseStarSize * renderMultiplier * glowMultiplier;

      console.log(`   Actual visual star radius: ${actualStarRadius.toFixed(0)} units`);

      // Get planets for this star
      const planets = await assetsCollection.find({
        assetType: 'planet',
        parentStar: star._id.toString()
      }).toArray();

      console.log(`   Found ${planets.length} planets to re-scatter`);

      if (planets.length === 0) continue;

      // NEW ORBITAL DISTANCES accounting for actual visual size
      // Planets should be WELL outside the visible star
      const MIN_ORBIT = actualStarRadius * 5;  // 5x visual star radius (~2,200 units)
      const MAX_ORBIT = 75000; // System boundary

      console.log(`   Orbit range: ${MIN_ORBIT.toFixed(0)} to ${MAX_ORBIT} units`);

      // Calculate orbital spacing
      const orbitStep = (MAX_ORBIT - MIN_ORBIT) / planets.length;

      for (let i = 0; i < planets.length; i++) {
        const planet = planets[i];

        // Assign orbital radius (increasing with each planet)
        const orbitRadius = MIN_ORBIT + (i * orbitStep);

        // Random angle for orbital position (full 360 degrees)
        const angle = Math.random() * Math.PI * 2;

        // ORBITAL INCLINATION - give each orbit a different tilt
        // Real solar systems have varying inclinations (Mercury: 7°, Earth: 0°, Pluto: 17°)
        const maxInclination = 25; // Max 25 degrees tilt
        const inclination = (Math.random() - 0.5) * maxInclination * (Math.PI / 180); // Convert to radians

        // ASCENDING NODE - rotate the entire orbital plane around the star
        const ascendingNode = Math.random() * Math.PI * 2; // Random rotation of orbital plane

        // Calculate base position on flat orbit
        let x = Math.cos(angle) * orbitRadius;
        let y = 0;
        let z = Math.sin(angle) * orbitRadius;

        // Apply inclination (tilt the orbit)
        const xTilted = x;
        const yTilted = y * Math.cos(inclination) - z * Math.sin(inclination);
        const zTilted = y * Math.sin(inclination) + z * Math.cos(inclination);

        // Apply ascending node rotation (rotate the tilted orbit)
        const xFinal = xTilted * Math.cos(ascendingNode) - zTilted * Math.sin(ascendingNode);
        const yFinal = yTilted;
        const zFinal = xTilted * Math.sin(ascendingNode) + zTilted * Math.cos(ascendingNode);

        // Star is at (0, 0, 0) in system map
        const coordinates3D = { x: xFinal, y: yFinal, z: zFinal };

        // Update planet in database
        await assetsCollection.updateOne(
          { _id: planet._id },
          {
            $set: {
              coordinates3D: coordinates3D,
              orbitRadius: orbitRadius,
              orbitAngle: angle,
              orbitInclination: inclination,
              orbitAscendingNode: ascendingNode
            }
          }
        );

        console.log(`   ✓ ${planet.title}: orbit ${orbitRadius.toFixed(0)}m, incl ${(inclination * 180 / Math.PI).toFixed(1)}°, node ${(ascendingNode * 180 / Math.PI).toFixed(0)}° - Pos: (${xFinal.toFixed(0)}, ${yFinal.toFixed(0)}, ${zFinal.toFixed(0)})`);
        totalUpdated++;
      }

      // Summary
      const firstOrbit = MIN_ORBIT;
      const lastOrbit = MIN_ORBIT + ((planets.length - 1) * orbitStep);
      console.log(`\n   📊 Summary:`);
      console.log(`      Visual star radius: ${actualStarRadius.toFixed(0)} units`);
      console.log(`      Orbits range: ${firstOrbit.toFixed(0)} to ${lastOrbit.toFixed(0)} units`);
      console.log(`      Closest planet: ${(firstOrbit / actualStarRadius).toFixed(1)}x visual star radius`);
    }

    console.log(`\n\n✅ Re-scattered ${totalUpdated} planets with proper visual distances`);
    console.log(`   Planets now well outside the visible star (~440 unit radius)`);
    console.log(`   Minimum orbit: ~2,200 units (5x visual star size)`);
    console.log(`   Maximum orbit: 75,000 units (system boundary)`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

rescatterPlanetsWide().catch(console.error);
