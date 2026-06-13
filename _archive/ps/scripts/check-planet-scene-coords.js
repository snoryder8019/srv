import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function checkPlanetSceneCoords() {
  console.log('🔍 Checking planet coordinates in scene...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all stars
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();

    for (const star of stars) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`⭐ STAR: ${star.title}`);
      console.log(`${'='.repeat(80)}`);

      // Star coordinates (should be 0,0,0 in system map)
      console.log(`\nStar Coordinates:`);
      console.log(`  coordinates3D: ${JSON.stringify(star.coordinates3D || { x: 0, y: 0, z: 0 })}`);
      console.log(`  scale: ${star.scale || 1}`);
      console.log(`  Visual radius in scene: ~${(50 * (star.scale || 1)).toFixed(0)} units`);

      // Get planets for this star
      const planets = await assetsCollection.find({
        assetType: 'planet',
        parentStar: star._id.toString()
      }).sort({ orbitRadius: 1 }).toArray();

      console.log(`\nPlanets: ${planets.length}`);
      console.log(`\n${'Planet'.padEnd(40)} | ${'Orbit'.padStart(8)} | ${'Coords (x, y, z)'.padEnd(40)} | Distance`);
      console.log('-'.repeat(110));

      planets.forEach(planet => {
        const coords = planet.coordinates3D || { x: 0, y: 0, z: 0 };
        const distance = Math.sqrt(coords.x**2 + coords.y**2 + coords.z**2);
        const orbitRadius = planet.orbitRadius || 0;

        console.log(
          `${planet.title.substring(0, 38).padEnd(40)} | ` +
          `${orbitRadius.toFixed(0).padStart(8)} | ` +
          `(${coords.x.toFixed(0).padStart(8)}, ${coords.y.toFixed(0).padStart(8)}, ${coords.z.toFixed(0).padStart(8)}) | ` +
          `${distance.toFixed(0)}`
        );
      });

      // Analysis
      console.log(`\n📊 Analysis:`);
      if (planets.length > 0) {
        const minDist = Math.min(...planets.map(p => {
          const c = p.coordinates3D || { x: 0, y: 0, z: 0 };
          return Math.sqrt(c.x**2 + c.y**2 + c.z**2);
        }));
        const maxDist = Math.max(...planets.map(p => {
          const c = p.coordinates3D || { x: 0, y: 0, z: 0 };
          return Math.sqrt(c.x**2 + c.y**2 + c.z**2);
        }));
        const starRadius = 50 * (star.scale || 1);

        console.log(`  Star radius: ${starRadius.toFixed(0)} units`);
        console.log(`  Closest planet: ${minDist.toFixed(0)} units (${(minDist / starRadius).toFixed(1)}x star radius)`);
        console.log(`  Furthest planet: ${maxDist.toFixed(0)} units`);
        console.log(`  System span: ${maxDist.toFixed(0)} units`);

        if (minDist < starRadius) {
          console.log(`  ⚠️  WARNING: Closest planet is INSIDE star radius!`);
        } else if (minDist < starRadius * 5) {
          console.log(`  ⚠️  WARNING: Planets too close to star (< 5x radius)`);
        } else {
          console.log(`  ✅ Planets are at safe distance from star`);
        }
      }

      // Export to console-friendly format
      console.log(`\n📋 Export (Copy/Paste friendly):`);
      console.log(`\nStar: ${star.title} (ID: ${star._id})`);
      planets.forEach((planet, i) => {
        const coords = planet.coordinates3D || { x: 0, y: 0, z: 0 };
        console.log(`Planet ${i+1}: ${planet.title}`);
        console.log(`  ID: ${planet._id}`);
        console.log(`  coordinates3D: { x: ${coords.x}, y: ${coords.y}, z: ${coords.z} }`);
        console.log(`  orbitRadius: ${planet.orbitRadius || 0}`);
        console.log(`  distance from star: ${Math.sqrt(coords.x**2 + coords.y**2 + coords.z**2).toFixed(2)}`);
        console.log();
      });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('SCENE SCALE REFERENCE:');
    console.log(`${'='.repeat(80)}`);
    console.log(`  Ship starting position: 85,000 units from center`);
    console.log(`  System boundary (gravity): 75,000 units`);
    console.log(`  Suggested minimum planet orbit: 1,000 - 5,000 units`);
    console.log(`  Suggested maximum planet orbit: 50,000 - 70,000 units`);
    console.log(`  Scene visible range: ~100,000 units`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkPlanetSceneCoords().catch(console.error);
