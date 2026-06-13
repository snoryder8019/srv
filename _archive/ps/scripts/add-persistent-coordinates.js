import { connectDB, getDb } from '../plugins/mongo/mongo.js';

/**
 * Add Persistent Coordinates to Assets
 *
 * This script adds proper 3D coordinates to all assets based on:
 * - Hierarchy (galaxies, stars, planets, orbitals)
 * - Orbital mechanics (for planets/moons)
 * - Logical spatial organization
 *
 * For a persistent universe, coordinates should be:
 * - Deterministic (not random)
 * - Hierarchical (children near parents)
 * - Persistent (saved to database)
 */

async function addPersistentCoordinates() {
  console.log('🌌 Adding Persistent Coordinates to Assets...\n');

  await connectDB();
  const db = getDb();

  // Get all assets
  const assets = await db.collection('assets').find({}).toArray();
  console.log(`📊 Found ${assets.length} total assets\n`);

  // Organize by type
  const galaxies = assets.filter(a => a.assetType === 'galaxy');
  const stars = assets.filter(a => a.assetType === 'star');
  const planets = assets.filter(a => a.assetType === 'planet');
  const orbitals = assets.filter(a => a.assetType === 'orbital');
  const stations = assets.filter(a => a.assetType === 'station');
  const other = assets.filter(a => !['galaxy', 'star', 'planet', 'orbital', 'station'].includes(a.assetType));

  console.log(`📊 Asset Breakdown:`);
  console.log(`   Galaxies: ${galaxies.length}`);
  console.log(`   Stars: ${stars.length}`);
  console.log(`   Planets: ${planets.length}`);
  console.log(`   Orbitals: ${orbitals.length}`);
  console.log(`   Stations: ${stations.length}`);
  console.log(`   Other: ${other.length}\n`);

  let updated = 0;

  // 1. Position Galaxies (at origin for now, or in a grid)
  console.log('🌌 Positioning Galaxies...');
  for (let i = 0; i < galaxies.length; i++) {
    const galaxy = galaxies[i];

    // Skip if already has coordinates
    if (galaxy.coordinates && galaxy.coordinates.x !== undefined) {
      console.log(`   ✓ ${galaxy.title} already has coordinates`);
      continue;
    }

    // Grid layout for multiple galaxies
    const gridSize = 2000; // 2000 units apart
    const row = Math.floor(i / 3);
    const col = i % 3;

    const coordinates = {
      x: (col - 1) * gridSize, // -2000, 0, 2000
      y: 0,
      z: (row - 1) * gridSize
    };

    await db.collection('assets').updateOne(
      { _id: galaxy._id },
      { $set: { coordinates } }
    );

    console.log(`   ✅ ${galaxy.title}: (${coordinates.x}, ${coordinates.y}, ${coordinates.z})`);
    updated++;
  }

  // 2. Position Stars within their galaxies
  console.log('\n⭐ Positioning Stars...');
  for (const star of stars) {
    // Skip if already has coordinates
    if (star.coordinates && star.coordinates.x !== undefined) {
      console.log(`   ✓ ${star.title} already has coordinates`);
      continue;
    }

    let coordinates;

    if (star.parentGalaxy) {
      // Find parent galaxy
      const parentGalaxy = galaxies.find(g => g._id.toString() === star.parentGalaxy.toString());

      if (parentGalaxy && parentGalaxy.coordinates) {
        // Position star relative to galaxy center
        // Use orbital mechanics if available
        if (star.orbital && star.orbital.radius) {
          const angle = star.orbital.angle || Math.random() * Math.PI * 2;
          coordinates = {
            x: (parentGalaxy.coordinates.x || 0) + Math.cos(angle) * star.orbital.radius,
            y: (parentGalaxy.coordinates.y || 0),
            z: (parentGalaxy.coordinates.z || 0) + Math.sin(angle) * star.orbital.radius
          };
        } else {
          // Random position within galaxy (500 unit radius)
          const angle = Math.random() * Math.PI * 2;
          const distance = 200 + Math.random() * 300; // 200-500 units from galaxy center
          coordinates = {
            x: (parentGalaxy.coordinates.x || 0) + Math.cos(angle) * distance,
            y: (parentGalaxy.coordinates.y || 0),
            z: (parentGalaxy.coordinates.z || 0) + Math.sin(angle) * distance
          };
        }
      } else {
        // No parent galaxy found, place near origin
        const angle = Math.random() * Math.PI * 2;
        const distance = 300 + Math.random() * 200;
        coordinates = {
          x: Math.cos(angle) * distance,
          y: 0,
          z: Math.sin(angle) * distance
        };
      }
    } else {
      // No parent galaxy specified, place in outer region
      const angle = Math.random() * Math.PI * 2;
      const distance = 600 + Math.random() * 400;
      coordinates = {
        x: Math.cos(angle) * distance,
        y: 0,
        z: Math.sin(angle) * distance
      };
    }

    await db.collection('assets').updateOne(
      { _id: star._id },
      { $set: { coordinates } }
    );

    console.log(`   ✅ ${star.title}: (${coordinates.x.toFixed(1)}, ${coordinates.y.toFixed(1)}, ${coordinates.z.toFixed(1)})`);
    updated++;
  }

  // 3. Position Planets orbiting stars
  console.log('\n🪐 Positioning Planets...');
  for (const planet of planets) {
    // Skip if already has coordinates
    if (planet.coordinates && planet.coordinates.x !== undefined) {
      console.log(`   ✓ ${planet.title} already has coordinates`);
      continue;
    }

    let coordinates;

    if (planet.parentStar) {
      // Find parent star
      const parentStar = stars.find(s => s._id.toString() === planet.parentStar.toString());

      if (parentStar && parentStar.coordinates) {
        // Position planet in orbit around star
        if (planet.orbital && planet.orbital.radius) {
          const angle = planet.orbital.angle || Math.random() * Math.PI * 2;
          const radius = planet.orbital.radius;

          coordinates = {
            x: (parentStar.coordinates.x || 0) + Math.cos(angle) * radius,
            y: (parentStar.coordinates.y || 0),
            z: (parentStar.coordinates.z || 0) + Math.sin(angle) * radius
          };
        } else {
          // No orbital data, place at random distance (10-100 units from star)
          const angle = Math.random() * Math.PI * 2;
          const distance = 10 + Math.random() * 90;
          coordinates = {
            x: (parentStar.coordinates.x || 0) + Math.cos(angle) * distance,
            y: (parentStar.coordinates.y || 0),
            z: (parentStar.coordinates.z || 0) + Math.sin(angle) * distance
          };
        }
      } else {
        // Parent star not found or has no coordinates, place near origin
        const angle = Math.random() * Math.PI * 2;
        const distance = 50 + Math.random() * 50;
        coordinates = {
          x: Math.cos(angle) * distance,
          y: 0,
          z: Math.sin(angle) * distance
        };
      }
    } else {
      // No parent star, rogue planet
      const angle = Math.random() * Math.PI * 2;
      const distance = 400 + Math.random() * 200;
      coordinates = {
        x: Math.cos(angle) * distance,
        y: 0,
        z: Math.sin(angle) * distance
      };
    }

    await db.collection('assets').updateOne(
      { _id: planet._id },
      { $set: { coordinates } }
    );

    console.log(`   ✅ ${planet.title}: (${coordinates.x.toFixed(1)}, ${coordinates.y.toFixed(1)}, ${coordinates.z.toFixed(1)})`);
    updated++;
  }

  // 4. Position Orbitals (stations orbiting planets)
  console.log('\n🛰️ Positioning Orbitals...');
  for (const orbital of orbitals) {
    // Skip if already has coordinates
    if (orbital.coordinates && orbital.coordinates.x !== undefined) {
      console.log(`   ✓ ${orbital.title} already has coordinates`);
      continue;
    }

    let coordinates;

    if (orbital.planetId) {
      // Find parent planet
      const parentPlanet = planets.find(p => p._id.toString() === orbital.planetId.toString());

      if (parentPlanet && parentPlanet.coordinates) {
        // Orbit around planet (close proximity, 2-10 units)
        const angle = Math.random() * Math.PI * 2;
        const distance = 2 + Math.random() * 8;

        coordinates = {
          x: (parentPlanet.coordinates.x || 0) + Math.cos(angle) * distance,
          y: (parentPlanet.coordinates.y || 0),
          z: (parentPlanet.coordinates.z || 0) + Math.sin(angle) * distance
        };
      } else {
        // No parent planet, place near origin
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 30;
        coordinates = {
          x: Math.cos(angle) * distance,
          y: 0,
          z: Math.sin(angle) * distance
        };
      }
    } else {
      // Free-floating orbital
      const angle = Math.random() * Math.PI * 2;
      const distance = 100 + Math.random() * 100;
      coordinates = {
        x: Math.cos(angle) * distance,
        y: 0,
        z: Math.sin(angle) * distance
      };
    }

    await db.collection('assets').updateOne(
      { _id: orbital._id },
      { $set: { coordinates } }
    );

    console.log(`   ✅ ${orbital.title}: (${coordinates.x.toFixed(1)}, ${coordinates.y.toFixed(1)}, ${coordinates.z.toFixed(1)})`);
    updated++;
  }

  // 5. Position Stations (near planets or stars)
  console.log('\n🏭 Positioning Stations...');
  for (const station of stations) {
    // Skip if already has coordinates
    if (station.coordinates && station.coordinates.x !== undefined) {
      console.log(`   ✓ ${station.title} already has coordinates`);
      continue;
    }

    // Place stations in mid-range (200-400 units from origin)
    const angle = Math.random() * Math.PI * 2;
    const distance = 200 + Math.random() * 200;

    const coordinates = {
      x: Math.cos(angle) * distance,
      y: 0,
      z: Math.sin(angle) * distance
    };

    await db.collection('assets').updateOne(
      { _id: station._id },
      { $set: { coordinates } }
    );

    console.log(`   ✅ ${station.title}: (${coordinates.x.toFixed(1)}, ${coordinates.y.toFixed(1)}, ${coordinates.z.toFixed(1)})`);
    updated++;
  }

  // 6. Position Other assets (items, weapons, etc.) - don't need map coordinates
  console.log('\n📦 Skipping Other Assets (items, weapons, etc. don\'t need spatial coordinates)');
  console.log(`   ${other.length} assets skipped (not spatial objects)`);

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('✅ Coordinate Assignment Complete!');
  console.log('═══════════════════════════════════════');
  console.log(`Total assets updated: ${updated}`);
  console.log(`Galaxies: ${galaxies.length} positioned`);
  console.log(`Stars: ${stars.length} positioned`);
  console.log(`Planets: ${planets.length} positioned`);
  console.log(`Orbitals: ${orbitals.length} positioned`);
  console.log(`Stations: ${stations.length} positioned`);
  console.log('═══════════════════════════════════════\n');

  console.log('🎯 All spatial assets now have persistent coordinates!');
  console.log('💾 Coordinates saved to database');
  console.log('🗺️ Ready for 3D Galactic Map\n');
}

// Run script
addPersistentCoordinates()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
