/**
 * Assign planets to their nearest stars based on proximity
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function assignPlanetsToStars() {
  console.log('🪐 Assigning planets to their nearest stars...\n');

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all stars
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    console.log(`Found ${stars.length} stars\n`);

    // Get all planets without a parent star
    const planets = await assetsCollection.find({
      assetType: 'planet',
      $or: [
        { parentStar: { $exists: false } },
        { parentStar: null },
        { parentStar: '' }
      ]
    }).toArray();

    console.log(`Found ${planets.length} planets without a parent star\n`);

    let assigned = 0;

    for (const planet of planets) {
      const px = planet.coordinates.x;
      const py = planet.coordinates.y;
      const pz = planet.coordinates.z || 0;

      // Find nearest star
      let nearestStar = null;
      let nearestDistance = Infinity;

      for (const star of stars) {
        const sx = star.coordinates.x;
        const sy = star.coordinates.y;
        const sz = star.coordinates.z || 0;

        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestStar = star;
        }
      }

      if (nearestStar) {
        // Assign planet to nearest star (store as string ID, not ObjectId)
        await assetsCollection.updateOne(
          { _id: planet._id },
          { $set: { parentStar: nearestStar._id.toString() } }
        );

        console.log(`✅ ${planet.title}`);
        console.log(`   Assigned to: ${nearestStar.title}`);
        console.log(`   Distance: ${nearestDistance.toFixed(1)} units\n`);

        assigned++;
      }
    }

    // Also check orbitals
    const orbitals = await assetsCollection.find({
      assetType: 'orbital',
      $or: [
        { parentStar: { $exists: false } },
        { parentStar: null },
        { parentStar: '' }
      ]
    }).toArray();

    console.log(`\nFound ${orbitals.length} orbitals without a parent star\n`);

    for (const orbital of orbitals) {
      const ox = orbital.coordinates.x;
      const oy = orbital.coordinates.y;
      const oz = orbital.coordinates.z || 0;

      // Find nearest star
      let nearestStar = null;
      let nearestDistance = Infinity;

      for (const star of stars) {
        const sx = star.coordinates.x;
        const sy = star.coordinates.y;
        const sz = star.coordinates.z || 0;

        const dx = ox - sx;
        const dy = oy - sy;
        const dz = oz - sz;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestStar = star;
        }
      }

      if (nearestStar) {
        await assetsCollection.updateOne(
          { _id: orbital._id },
          { $set: { parentStar: nearestStar._id.toString() } }
        );

        console.log(`✅ ${orbital.title}`);
        console.log(`   Assigned to: ${nearestStar.title}`);
        console.log(`   Distance: ${nearestDistance.toFixed(1)} units\n`);

        assigned++;
      }
    }

    console.log(`\n✅ Assigned ${assigned} planets/orbitals to stars`);

    await client.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

assignPlanetsToStars();
