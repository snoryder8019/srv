/**
 * Verify Crimson Nebula Galaxy Hierarchy
 * Display the complete galaxy -> stars -> planets structure
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function verifyCrimsonNebula() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    // Get Crimson Nebula Galaxy
    const galaxy = await db.collection('assets').findOne({
      title: 'Crimson Nebula Galaxy',
      assetType: 'galaxy'
    });

    if (!galaxy) {
      console.error('❌ Crimson Nebula Galaxy not found!');
      process.exit(1);
    }

    console.log('\n🌌 CRIMSON NEBULA GALAXY');
    console.log('=' .repeat(80));
    console.log(`ID: ${galaxy._id}`);
    console.log(`Description: ${galaxy.description || 'A galaxy shrouded in crimson nebulae'}`);
    console.log('\n');

    // Get all stars
    const stars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: galaxy._id.toString()
    }).sort({ title: 1 }).toArray();

    console.log(`⭐ STARS (${stars.length}):`);
    console.log('-'.repeat(80));

    for (const star of stars) {
      console.log(`\n${star.title}`);
      console.log(`  Type: ${star.starType} (${star.spectralClass})`);
      console.log(`  Luminosity: ${star.luminosity}x | Temperature: ${star.temperature}K`);
      console.log(`  Mass: ${star.mass} M☉ | Radius: ${star.radius} R☉`);
      console.log(`  Age: ${star.age} billion years`);
      console.log(`  Position: (${star.coordinates.x}, ${star.coordinates.y}, ${star.coordinates.z})`);
      console.log(`  ${star.description}`);

      // Get planets for this star
      const planets = await db.collection('assets').find({
        assetType: 'planet',
        parentStar: star._id.toString()
      }).sort({ orbitDistance: 1 }).toArray();

      if (planets.length > 0) {
        console.log(`\n  🌍 PLANETS (${planets.length}):`);
        planets.forEach(planet => {
          console.log(`    • ${planet.title}`);
          console.log(`      Climate: ${planet.climate} | Atmosphere: ${planet.atmosphere}`);
          console.log(`      Gravity: ${planet.gravity}g | Radius: ${planet.radius}km`);
          console.log(`      Orbit: ${planet.orbitDistance} AU`);
          console.log(`      ${planet.description}`);
        });
      } else {
        console.log(`  (No planets)`);
      }
    }

    // Summary statistics
    const totalPlanets = await db.collection('assets').countDocuments({
      assetType: 'planet',
      parentGalaxy: galaxy._id.toString()
    });

    console.log('\n');
    console.log('=' .repeat(80));
    console.log('📊 STATISTICS:');
    console.log(`  Total Stars: ${stars.length}`);
    console.log(`  Total Planets: ${totalPlanets}`);
    console.log(`  Planets per Star (avg): ${(totalPlanets / stars.length).toFixed(2)}`);
    console.log('=' .repeat(80));

    // Check published status
    const publishedStars = stars.filter(s => s.isPublished).length;
    const publishedPlanets = await db.collection('assets').countDocuments({
      assetType: 'planet',
      parentGalaxy: galaxy._id.toString(),
      isPublished: true
    });

    console.log('\n✅ PUBLISHED STATUS:');
    console.log(`  Galaxy: ${galaxy.isPublished ? 'Published' : 'Not Published'}`);
    console.log(`  Stars: ${publishedStars}/${stars.length} published`);
    console.log(`  Planets: ${publishedPlanets}/${totalPlanets} published`);

    if (publishedStars === stars.length && publishedPlanets === totalPlanets && galaxy.isPublished) {
      console.log('\n🎉 All assets are published and ready for exploration!');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

verifyCrimsonNebula();
