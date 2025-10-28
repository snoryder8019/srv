import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function expandStarLocalCoordinates() {
  console.log('🌌 Expanding star local coordinates for proper galactic scale...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`Found ${galaxies.length} galaxies\n`);

    let totalUpdated = 0;

    for (const galaxy of galaxies) {
      console.log(`\n📍 Processing galaxy: ${galaxy.title}`);

      const stars = await assetsCollection.find({
        assetType: 'star',
        parentGalaxy: galaxy._id.toString()
      }).toArray();

      console.log(`   Found ${stars.length} stars`);

      // Use much larger galaxy interior space: 5000x5000 units
      // This will give a proper galactic feel with stars spread far apart
      const galaxyRadius = 2500; // 5000 unit diameter

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Distribute stars in a spiral galaxy pattern across the full space
        // Use exponential distribution so stars spread out more naturally
        const angle = (i / stars.length) * Math.PI * 4; // 2 full spirals
        const spiralArm = i % 3; // 3 spiral arms
        const armAngle = angle + (spiralArm * (Math.PI * 2 / 3));

        // Exponential radius distribution (more stars toward edges)
        const radiusFraction = Math.sqrt(Math.random()); // Square root gives better distribution
        const radius = radiusFraction * galaxyRadius;

        // Add some randomness to break perfect spiral
        const randomOffset = (Math.random() - 0.5) * 400;

        const localX = Math.cos(armAngle) * radius + randomOffset;
        const localY = Math.sin(armAngle) * radius + randomOffset;
        const localZ = (Math.random() - 0.5) * 300; // Vertical spread (300 unit thickness)

        const localCoordinates = {
          x: localX,
          y: localY,
          z: localZ
        };

        // Update universal coordinates to match: galaxy center + local offset
        const universalCoordinates = {
          x: galaxy.coordinates.x + localX,
          y: galaxy.coordinates.y + localY,
          z: galaxy.coordinates.z + localZ
        };

        await assetsCollection.updateOne(
          { _id: star._id },
          {
            $set: {
              localCoordinates: localCoordinates,
              universalCoordinates: universalCoordinates,
              coordinates: universalCoordinates // Update main coordinates too
            }
          }
        );

        console.log(`   ✓ ${star.title}: local (${localX.toFixed(0)}, ${localY.toFixed(0)}, ${localZ.toFixed(0)}) - radius: ${radius.toFixed(0)}`);
        totalUpdated++;
      }

      // Calculate final spread
      const updatedStars = await assetsCollection.find({
        assetType: 'star',
        parentGalaxy: galaxy._id.toString()
      }).toArray();

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      updatedStars.forEach(s => {
        minX = Math.min(minX, s.localCoordinates.x);
        maxX = Math.max(maxX, s.localCoordinates.x);
        minY = Math.min(minY, s.localCoordinates.y);
        maxY = Math.max(maxY, s.localCoordinates.y);
      });

      console.log(`   Final spread: ${(maxX - minX).toFixed(0)} x ${(maxY - minY).toFixed(0)} units`);
    }

    console.log(`\n\n✅ Updated ${totalUpdated} stars with expanded local coordinates`);
    console.log(`   Galaxy interior space: 5000x5000 units (2500 radius)`);
    console.log(`   Stars distributed in spiral pattern across full galactic space`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

expandStarLocalCoordinates().catch(console.error);
