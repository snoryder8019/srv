/**
 * Fix Orbital-Planetary Relationships
 *
 * PROBLEM: Currently planets reference orbitals (planets orbit orbitals)
 * CORRECT: Orbitals should reference planets (orbitals orbit planets)
 *
 * This script:
 * 1. Finds all planets with orbitalId references
 * 2. Finds all orbitals
 * 3. Swaps the relationship:
 *    - Removes orbitalId from planets
 *    - Adds planetId to orbitals that were being "orbited" by those planets
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function fixRelationships() {
  try {
    await connectDB();
    const db = getDb();
    const assetsCollection = db.collection('assets');

    console.log('🔧 Starting orbital-planetary relationship fix...\n');

    // Step 1: Get all planets with orbitalId
    const planetsWithOrbitalId = await assetsCollection.find({
      assetType: 'planet',
      orbitalId: { $exists: true }
    }).toArray();

    console.log(`Found ${planetsWithOrbitalId.length} planets with orbitalId references`);

    // Step 2: Build a mapping of orbital -> planets that reference it
    const orbitalToPlanets = {};
    for (const planet of planetsWithOrbitalId) {
      if (!orbitalToPlanets[planet.orbitalId]) {
        orbitalToPlanets[planet.orbitalId] = [];
      }
      orbitalToPlanets[planet.orbitalId].push({
        _id: planet._id.toString(),
        title: planet.title
      });
    }

    console.log(`\nOrbitals being referenced by planets:`);
    for (const [orbitalId, planets] of Object.entries(orbitalToPlanets)) {
      console.log(`  ${orbitalId}: ${planets.length} planet(s)`);
    }

    // Step 3: For each orbital that has planets, pick the first planet as the one it orbits
    // (In reality, orbitals can orbit planets, not the other way around)
    let updatedOrbitals = 0;
    let updatedPlanets = 0;

    for (const [orbitalIdStr, planets] of Object.entries(orbitalToPlanets)) {
      // Get the orbital - try both string and ObjectId matching
      let orbital = await assetsCollection.findOne({
        $or: [
          { _id: { $eq: orbitalIdStr } },
          { _id: { $eq: orbitalIdStr } }  // MongoDB auto-converts strings to ObjectId in some cases
        ],
        assetType: 'orbital'
      });

      // Also try finding by searching all orbitals and matching ID as string
      if (!orbital) {
        const allOrbitals = await assetsCollection.find({ assetType: 'orbital' }).toArray();
        orbital = allOrbitals.find(o => o._id.toString() === orbitalIdStr);
      }

      if (!orbital) {
        console.log(`  ⚠️  Orbital ${orbitalIdStr} not found, skipping...`);
        console.log(`      (Planets referencing it: ${planets.map(p => p.title).join(', ')})`);
        continue;
      }

      // Pick the first planet as the one this orbital orbits
      const primaryPlanet = planets[0];

      console.log(`\n📍 Processing: Orbital "${orbital.title}"`);
      console.log(`   Will orbit: Planet "${primaryPlanet.title}"`);

      // Update orbital to reference the planet
      await assetsCollection.updateOne(
        { _id: orbital._id },
        {
          $set: {
            planetId: primaryPlanet._id,
            planetName: planets.find(p => p._id === primaryPlanet._id)?.title || 'Unknown'
          },
          $unset: {
            orbitalId: ''  // Remove any old orbitalId if it exists
          }
        }
      );
      updatedOrbitals++;
      console.log(`   ✓ Updated orbital to reference planet`);

      // Update orbit data if it exists
      if (orbital.orbitData) {
        await assetsCollection.updateOne(
          { _id: orbital._id },
          {
            $set: {
              'orbitData.parentId': primaryPlanet._id,
              'orbitData.parentType': 'planet'
            }
          }
        );
        console.log(`   ✓ Updated orbit data`);
      }
    }

    // Step 4: Remove orbitalId from all planets
    console.log(`\n🧹 Cleaning up planet references...`);
    const planetUpdateResult = await assetsCollection.updateMany(
      {
        assetType: 'planet',
        orbitalId: { $exists: true }
      },
      {
        $unset: {
          orbitalId: '',
          orbitalName: ''
        }
      }
    );
    updatedPlanets = planetUpdateResult.modifiedCount;
    console.log(`   ✓ Removed orbitalId from ${updatedPlanets} planets`);

    // Step 5: Summary
    console.log(`\n✅ Fix completed!`);
    console.log(`   Updated ${updatedOrbitals} orbitals`);
    console.log(`   Cleaned ${updatedPlanets} planets`);
    console.log(`\n📊 New structure:`);
    console.log(`   - Planets are independent celestial bodies`);
    console.log(`   - Orbitals reference planets via planetId`);
    console.log(`   - Orbitals orbit around planets (correct astronomy)`);

    // Verify the fix
    console.log(`\n🔍 Verification:`);
    const orbitalsWithPlanetId = await assetsCollection.countDocuments({
      assetType: 'orbital',
      planetId: { $exists: true }
    });
    const remainingPlanetsWithOrbitalId = await assetsCollection.countDocuments({
      assetType: 'planet',
      orbitalId: { $exists: true }
    });
    console.log(`   Orbitals with planetId: ${orbitalsWithPlanetId}`);
    console.log(`   Planets with orbitalId: ${remainingPlanetsWithOrbitalId} (should be 0)`);

    if (remainingPlanetsWithOrbitalId === 0 && orbitalsWithPlanetId > 0) {
      console.log(`\n🎉 All relationships corrected successfully!`);
    } else {
      console.log(`\n⚠️  Some relationships may still need attention.`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

fixRelationships();
