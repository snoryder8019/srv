/**
 * Seed Test Universe
 * Creates a complete test universe with:
 * - 1 Anomaly
 * - 1 Galaxy
 * - 1 Star System
 * - Multiple Planets
 *
 * Perfect for testing the 3D simulation engine
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_USER_ID = '000000000000000000000000'; // System/built-in assets

// Generate random coordinates in a sphere around origin
function randomSphereCoords(radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.random() * radius;

  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.sin(phi) * Math.sin(theta),
    z: r * Math.cos(phi)
  };
}

async function seedTestUniverse() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('🌌 Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Clear existing test universe assets
    console.log('\n🧹 Cleaning up old test universe assets...');
    const deleteResult = await assetsCollection.deleteMany({
      isBuiltIn: true,
      tags: { $in: ['test-universe'] }
    });
    console.log(`   Deleted ${deleteResult.deletedCount} old test universe assets`);

    // ===== CREATE ANOMALY =====
    console.log('\n✨ Creating Anomaly...');
    // Place anomaly FAR away from galaxy - extreme distance for clear separation
    const anomalyCoords = { x: -3500, y: 2800, z: -2100 };

    const anomaly = {
      userId: new ObjectId(ADMIN_USER_ID),
      title: 'The Nexus Singularity',
      description: 'A mysterious anomaly at the center of all things. Reality bends around it.',
      assetType: 'anomaly',
      subType: 'singularity',
      status: 'published',

      lore: 'Scientists believe The Nexus is a tear in spacetime itself, connecting multiple dimensions.',
      backstory: 'Discovered in the early days of galactic exploration, The Nexus has been the subject of countless studies.',
      flavor: '"Approach with caution. The laws of physics are merely suggestions here." - Explorer Log 001',

      coordinates: anomalyCoords,

      stats: {
        mass: 1000000, // Massive gravitational pull
        radius: 50,
        energyOutput: 9999,
        dangerLevel: 10
      },

      tags: ['test-universe', 'anomaly', 'singularity', 'nexus'],
      isBuiltIn: true,
      isPublished: true,
      approvalStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const anomalyResult = await assetsCollection.insertOne(anomaly);
    console.log(`   ✅ Created anomaly: ${anomaly.title} at (${anomalyCoords.x}, ${anomalyCoords.y}, ${anomalyCoords.z})`);

    // ===== CREATE GALAXY =====
    console.log('\n🌀 Creating Galaxy...');
    // Place galaxy on opposite side of universe from anomaly
    const galaxyCoords = { x: 3200, y: -2400, z: 1600 };

    const galaxy = {
      userId: new ObjectId(ADMIN_USER_ID),
      title: 'Elysium Cluster',
      description: 'A vibrant spiral galaxy teeming with stars, planets, and mysteries waiting to be discovered.',
      assetType: 'galaxy',
      subType: 'spiral',
      status: 'published',

      lore: 'The Elysium Cluster is known for its unusually high concentration of habitable worlds.',
      backstory: 'Named by the first explorers who were awed by its beauty, Elysium has become a hub of civilization.',
      flavor: '"Home to billions, mystery to all." - Galactic Survey Corps',

      coordinates: galaxyCoords,

      galaxyType: 'spiral',
      starCount: 1,

      stats: {
        mass: 500000,
        radius: 300,
        starDensity: 'high'
      },

      tags: ['test-universe', 'galaxy', 'spiral', 'elysium'],
      isBuiltIn: true,
      isPublished: true,
      approvalStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const galaxyResult = await assetsCollection.insertOne(galaxy);
    console.log(`   ✅ Created galaxy: ${galaxy.title} at (${galaxyCoords.x}, ${galaxyCoords.y}, ${galaxyCoords.z})`);

    // ===== CREATE STAR SYSTEM =====
    console.log('\n⭐ Creating Star System...');

    // Star coordinates relative to galaxy center
    const starOffset = randomSphereCoords(150);
    const starCoords = {
      x: galaxyCoords.x + starOffset.x,
      y: galaxyCoords.y + starOffset.y,
      z: galaxyCoords.z + starOffset.z
    };

    const star = {
      userId: new ObjectId(ADMIN_USER_ID),
      title: 'Sol Prime',
      description: 'A bright yellow star, the heart of a thriving planetary system.',
      assetType: 'star',
      subType: 'yellow-star',
      status: 'published',

      lore: 'Sol Prime has been a beacon for travelers for millennia, its stable output making it ideal for life.',
      backstory: 'The first star to be fully charted in the Elysium Cluster, Sol Prime is home to several colonies.',
      flavor: '"Like our ancient sun, but somehow more." - Colonial Survey Report',

      coordinates: starCoords,
      parentGalaxy: galaxyResult.insertedId,

      starType: 'yellow-star',
      luminosity: 1.0,
      temperature: 5778,

      stats: {
        mass: 10000,
        radius: 30,
        lifespan: 'stable',
        spectralClass: 'G2V'
      },

      tags: ['test-universe', 'star', 'yellow-star', 'sol-prime'],
      isBuiltIn: true,
      isPublished: true,
      approvalStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const starResult = await assetsCollection.insertOne(star);
    console.log(`   ✅ Created star: ${star.title} at (${starCoords.x.toFixed(1)}, ${starCoords.y.toFixed(1)}, ${starCoords.z.toFixed(1)})`);

    // ===== CREATE PLANETS =====
    console.log('\n🪐 Creating Planets...');

    const planets = [
      {
        title: 'Primus',
        description: 'A scorched rocky world, closest to Sol Prime.',
        subType: 'terrestrial',
        environmentType: 'barren',
        climate: 'scorching',
        atmosphere: 'none',
        gravity: 0.8,
        lore: 'Primus bears the full fury of Sol Prime. Only automated mining operations can survive here.',
        flavor: '"Hell has coordinates." - Miner\'s Guild',
        orbital: {
          radius: 80,
          speed: 0.02,
          angle: 0,
          clockwise: true
        },
        stats: {
          mass: 800,
          radius: 8,
          temperature: 450,
          dayLength: 58.6,
          yearLength: 88
        },
        resources: ['iron', 'titanium', 'rare-metals']
      },
      {
        title: 'Secundus',
        description: 'A lush garden world with sprawling oceans and verdant continents.',
        subType: 'terrestrial',
        environmentType: 'garden',
        climate: 'temperate',
        atmosphere: 'breathable',
        gravity: 1.0,
        lore: 'Secundus is the crown jewel of Sol Prime, home to millions of colonists.',
        flavor: '"If this isn\'t paradise, it\'s close enough." - Colonial Governor',
        orbital: {
          radius: 140,
          speed: 0.015,
          angle: Math.PI / 2,
          clockwise: true
        },
        stats: {
          mass: 1000,
          radius: 12,
          temperature: 15,
          dayLength: 24,
          yearLength: 365
        },
        resources: ['water', 'biomass', 'food', 'minerals']
      },
      {
        title: 'Tertius',
        description: 'A rust-colored desert world with ancient mysteries.',
        subType: 'terrestrial',
        environmentType: 'desert',
        climate: 'arid',
        atmosphere: 'thin',
        gravity: 0.7,
        lore: 'Strange ruins dot the surface of Tertius, hinting at a civilization long gone.',
        flavor: '"Every dune hides a secret." - Xenoarchaeologist Report',
        orbital: {
          radius: 200,
          speed: 0.01,
          angle: Math.PI,
          clockwise: true
        },
        stats: {
          mass: 700,
          radius: 10,
          temperature: -20,
          dayLength: 24.6,
          yearLength: 687
        },
        resources: ['iron', 'silicon', 'ancient-artifacts']
      },
      {
        title: 'Quartus',
        description: 'A massive gas giant with swirling storms and dozens of moons.',
        subType: 'gas-giant',
        environmentType: 'gas-giant',
        climate: 'stormy',
        atmosphere: 'toxic',
        gravity: 2.5,
        lore: 'Quartus\' Great Red Storm has raged for centuries, visible from across the system.',
        flavor: '"A monster of a planet." - Astrophysics Journal',
        orbital: {
          radius: 300,
          speed: 0.008,
          angle: Math.PI * 1.5,
          clockwise: true
        },
        stats: {
          mass: 5000,
          radius: 40,
          temperature: -120,
          dayLength: 9.9,
          yearLength: 4331
        },
        resources: ['hydrogen', 'helium', 'rare-gases']
      },
      {
        title: 'Quintus',
        description: 'A frozen ice world at the edge of the habitable zone.',
        subType: 'terrestrial',
        environmentType: 'ice',
        climate: 'frozen',
        atmosphere: 'thin',
        gravity: 0.9,
        lore: 'Beneath Quintus\' icy crust lies a vast subsurface ocean, possibly harboring life.',
        flavor: '"Cold outside, mystery inside." - Survey Team Delta',
        orbital: {
          radius: 380,
          speed: 0.006,
          angle: Math.PI / 4,
          clockwise: true
        },
        stats: {
          mass: 900,
          radius: 11,
          temperature: -180,
          dayLength: 17.2,
          yearLength: 10585
        },
        resources: ['water-ice', 'frozen-gases', 'exotic-minerals']
      }
    ];

    let planetCount = 0;
    for (const planetData of planets) {
      const planet = {
        userId: new ObjectId(ADMIN_USER_ID),
        title: planetData.title,
        description: planetData.description,
        assetType: 'planet',
        subType: planetData.subType,
        status: 'published',

        lore: planetData.lore,
        flavor: planetData.flavor,

        // Calculate orbital position
        coordinates: {
          x: starCoords.x + planetData.orbital.radius * Math.cos(planetData.orbital.angle),
          y: starCoords.y + planetData.orbital.radius * Math.sin(planetData.orbital.angle),
          z: starCoords.z
        },

        parentGalaxy: galaxyResult.insertedId,
        parentStar: starResult.insertedId,

        orbital: planetData.orbital,

        environmentType: planetData.environmentType,
        climate: planetData.climate,
        atmosphere: planetData.atmosphere,
        gravity: planetData.gravity,
        resources: planetData.resources,

        stats: planetData.stats,

        tags: ['test-universe', 'planet', planetData.environmentType],
        isBuiltIn: true,
        isPublished: true,
        approvalStatus: 'approved',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await assetsCollection.insertOne(planet);
      console.log(`   ✅ Created planet: ${planet.title} (${planetData.environmentType}) - Orbit: ${planetData.orbital.radius} units`);
      planetCount++;
    }

    // ===== SUMMARY =====
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST UNIVERSE CREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   ✨ 1 Anomaly: ${anomaly.title}`);
    console.log(`   🌀 1 Galaxy: ${galaxy.title}`);
    console.log(`   ⭐ 1 Star: ${star.title}`);
    console.log(`   🪐 ${planetCount} Planets:`);
    planets.forEach(p => console.log(`      - ${p.title} (${p.environmentType})`));

    console.log(`\n📍 Coordinates:`);
    console.log(`   Anomaly: (${anomalyCoords.x}, ${anomalyCoords.y}, ${anomalyCoords.z})`);
    console.log(`   Galaxy:  (${galaxyCoords.x}, ${galaxyCoords.y}, ${galaxyCoords.z})`);
    console.log(`   Star:    (${starCoords.x.toFixed(1)}, ${starCoords.y.toFixed(1)}, ${starCoords.z.toFixed(1)})`);

    console.log(`\n🎮 Ready for 3D simulation testing!`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error seeding test universe:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedTestUniverse();
