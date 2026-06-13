/**
 * Fix Orbital-Planetary Relationships V2
 *
 * PROBLEM: Planets have orbitData.parentId pointing to orbitals (planets orbit orbitals)
 * CORRECT: Orbitals should orbit planets (orbitals should have orbitData pointing to planets)
 *
 * Strategy:
 * 1. For each planet with orbitData.parentId (pointing to orbital), find that orbital
 * 2. Add planetId and orbitData to the orbital (so orbital orbits the planet)
 * 3. Remove orbitData from the planet (planets don't orbit orbitals)
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function fixRelationships() {
  try {
    await connectDB();
    const db = getDb();
    const assetsCollection = db.collection('assets');

    console.log('🔧 Starting orbital-planetary relationship fix V2...\n');

    // Step 1: Get all planets with orbitData (they incorrectly orbit orbitals)
    const planetsWithOrbitData = await assetsCollection.find({
      assetType: 'planet',
      'orbitData.parentId': { $exists: true }
    }).toArray();

    console.log(`Found ${planetsWithOrbitData.length} planets with orbit data (incorrectly orbiting orbitals)`);

    // Step 2: Group planets by the orbital they're orbiting
    const orbitalToPlanets = {};
    for (const planet of planetsWithOrbitData) {
      const orbitalId = planet.orbitData.parentId;
      if (!orbitalToPlanets[orbitalId]) {
        orbitalToPlanets[orbitalId] = [];
      }
      orbitalToPlanets[orbitalId].push(planet);
    }

    console.log(`\nFound ${Object.keys(orbitalToPlanets).length} orbitals that have planets incorrectly orbiting them\n`);

    let updatedOrbitals = 0;
    let updatedPlanets = 0;
    let errors = 0;

    // Step 3: For each orbital, assign it to orbit one of its "child" planets
    for (const [orbitalId, planets] of Object.entries(orbitalToPlanets)) {
      console.log(`\n📍 Processing Orbital ID: ${orbitalId}`);
      console.log(`   ${planets.length} planet(s) currently orbit it: ${planets.map(p => p.title).join(', ')}`);

      // Find the orbital - convert string ID to ObjectId
      let orbital;
      try {
        orbital = await assetsCollection.findOne({
          _id: new ObjectId(orbitalId),
          assetType: 'orbital'
        });
      } catch (e) {
        // If ObjectId conversion fails, try as-is
        orbital = await assetsCollection.findOne({
          _id: orbitalId,
          assetType: 'orbital'
        });
      }

      if (!orbital) {
        console.log(`   ⚠️  Orbital not found! Skipping...`);
        errors++;
        continue;
      }

      console.log(`   Found orbital: "${orbital.title}"`);

      // Pick the first planet as the primary planet this orbital will orbit
      const primaryPlanet = planets[0];
      console.log(`   → Will make orbital "${orbital.title}" orbit planet "${primaryPlanet.title}"`);

      // Calculate orbit parameters for the orbital around the planet
      // Use the planet's current orbit data as a template but adjust
      const orbitRadius = primaryPlanet.orbitData.orbitRadius || 150;
      const orbitSpeed = (primaryPlanet.orbitData.orbitSpeed || 0.003) * 1.5; // Faster orbit
      const orbitAngle = Math.random() * Math.PI * 2;

      // Update the orbital to orbit this planet
      await assetsCollection.updateOne(
        { _id: orbital._id },
        {
          $set: {
            planetId: primaryPlanet._id,
            planetName: primaryPlanet.title,
            orbitData: {
              parentId: primaryPlanet._id,
              parentType: 'planet',
              orbitRadius: orbitRadius * 0.3, // Closer orbit for orbital station
              orbitSpeed: orbitSpeed,
              orbitAngle: orbitAngle
            }
          }
        }
      );
      updatedOrbitals++;
      console.log(`   ✓ Updated orbital to orbit planet "${primaryPlanet.title}"`);

      // Update all planets that were orbiting this orbital
      // Remove their orbitData (planets are now independent)
      for (const planet of planets) {
        await assetsCollection.updateOne(
          { _id: planet._id },
          {
            $unset: {
              orbitData: ''
            }
          }
        );
        updatedPlanets++;
        console.log(`   ✓ Removed orbit data from planet "${planet.title}"`);
      }
    }

    // Summary
    console.log(`\n✅ Fix completed!`);
    console.log(`   Updated ${updatedOrbitals} orbitals (now orbit planets)`);
    console.log(`   Updated ${updatedPlanets} planets (now independent)`);
    console.log(`   Errors: ${errors}`);

    // Verification
    console.log(`\n🔍 Verification:`);
    const orbitalsWithPlanetId = await assetsCollection.countDocuments({
      assetType: 'orbital',
      planetId: { $exists: true }
    });
    const orbitalsWithOrbitData = await assetsCollection.countDocuments({
      assetType: 'orbital',
      'orbitData.parentType': 'planet'
    });
    const remainingPlanetsWithOrbitData = await assetsCollection.countDocuments({
      assetType: 'planet',
      'orbitData': { $exists: true }
    });

    console.log(`   ✓ Orbitals with planetId: ${orbitalsWithPlanetId}`);
    console.log(`   ✓ Orbitals with orbitData (parent=planet): ${orbitalsWithOrbitData}`);
    console.log(`   ✓ Planets with orbitData: ${remainingPlanetsWithOrbitData} (should be 0)`);

    if (remainingPlanetsWithOrbitData === 0 && orbitalsWithPlanetId > 0) {
      console.log(`\n🎉 All relationships corrected successfully!`);
      console.log(`\n📊 New structure:`);
      console.log(`   ✓ Planets are independent celestial bodies (no orbitData)`);
      console.log(`   ✓ Orbitals reference planets via planetId`);
      console.log(`   ✓ Orbitals have orbitData with parentType='planet'`);
      console.log(`   ✓ Orbitals orbit around planets (correct astronomy) 🛰️ → 🌍`);
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
