/**
 * Seed Planets in Crimson Nebula Star Systems
 * Creates planets for each star in the Crimson Nebula Galaxy
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

// Planet templates for different star types
const planetsByStarType = {
  'Crimson Heart': [
    {
      title: 'Ember Core',
      description: 'A scorched world orbiting dangerously close to the red giant.',
      climate: 'infernal',
      atmosphere: 'toxic',
      gravity: 1.2,
      radius: 8000,
      orbitDistance: 2
    },
    {
      title: 'Ash Veil',
      description: 'A dark planet shrouded in volcanic ash from ancient eruptions.',
      climate: 'volcanic',
      atmosphere: 'sulfuric',
      gravity: 0.9,
      radius: 6500,
      orbitDistance: 4
    }
  ],
  'Ruby Beacon': [
    {
      title: 'Beacon Prime',
      description: 'The main hub world for navigation and trade in this sector.',
      climate: 'temperate',
      atmosphere: 'breathable',
      gravity: 1.0,
      radius: 6400,
      orbitDistance: 1
    },
    {
      title: 'Ruby Minor',
      description: 'A small ice world with valuable mineral deposits.',
      climate: 'frozen',
      atmosphere: 'thin',
      gravity: 0.4,
      radius: 3200,
      orbitDistance: 3
    }
  ],
  'Scarlet Forge': [
    {
      title: 'Forge Alpha',
      description: 'A young molten planet still cooling from its formation.',
      climate: 'molten',
      atmosphere: 'primordial',
      gravity: 1.3,
      radius: 7000,
      orbitDistance: 1
    },
    {
      title: 'Protoworld Beta',
      description: 'A forming planet with active accretion of material.',
      climate: 'chaotic',
      atmosphere: 'unstable',
      gravity: 0.7,
      radius: 5000,
      orbitDistance: 2
    },
    {
      title: 'Dust Ring Gamma',
      description: 'A planetary disk that may one day become a world.',
      climate: 'none',
      atmosphere: 'none',
      gravity: 0.1,
      radius: 2000,
      orbitDistance: 4
    }
  ],
  'Bloodstone Binary': [
    {
      title: 'Twin Shadow',
      description: 'A tidally locked world eternally caught between two suns.',
      climate: 'extreme-variable',
      atmosphere: 'turbulent',
      gravity: 1.1,
      radius: 6800,
      orbitDistance: 3
    },
    {
      title: 'Eclipse Haven',
      description: 'A habitable moon that experiences frequent double eclipses.',
      climate: 'temperate',
      atmosphere: 'breathable',
      gravity: 0.8,
      radius: 4500,
      orbitDistance: 5
    }
  ],
  'Vermillion Outpost': [
    {
      title: 'Vermillion Prime',
      description: 'The capital world of Crimson Nebula colonization, home to millions.',
      climate: 'temperate',
      atmosphere: 'breathable',
      gravity: 1.0,
      radius: 6371,
      orbitDistance: 1
    },
    {
      title: 'Outpost II',
      description: 'An industrial world focused on mining and manufacturing.',
      climate: 'arid',
      atmosphere: 'thin',
      gravity: 0.9,
      radius: 5200,
      orbitDistance: 2
    },
    {
      title: 'Resource Belt',
      description: 'A rich asteroid belt providing raw materials.',
      climate: 'none',
      atmosphere: 'none',
      gravity: 0.05,
      radius: 1000,
      orbitDistance: 3
    }
  ],
  'Garnet Prime': [
    {
      title: 'Dying Light',
      description: 'A doomed world bathed in the intense radiation of the dying star.',
      climate: 'radiation-soaked',
      atmosphere: 'stripped',
      gravity: 1.4,
      radius: 7500,
      orbitDistance: 5
    },
    {
      title: 'Refuge Station',
      description: 'An abandoned research outpost orbiting at a safe distance.',
      climate: 'frozen',
      atmosphere: 'artificial',
      gravity: 0.6,
      radius: 4000,
      orbitDistance: 10
    }
  ]
};

async function seedCrimsonPlanets() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Find Crimson Nebula Galaxy
    const crimsonNebula = await db.collection('assets').findOne({
      title: 'Crimson Nebula Galaxy',
      assetType: 'galaxy'
    });

    if (!crimsonNebula) {
      console.error('❌ Crimson Nebula Galaxy not found!');
      process.exit(1);
    }

    // Get all stars in Crimson Nebula
    const stars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: crimsonNebula._id.toString()
    }).toArray();

    console.log(`Found ${stars.length} stars in Crimson Nebula Galaxy\n`);

    let totalPlanets = 0;

    for (const star of stars) {
      console.log(`\n🌟 Seeding planets for ${star.title}...`);

      const planetTemplates = planetsByStarType[star.title] || [];

      if (planetTemplates.length === 0) {
        console.log(`  ⚠️  No planet templates found for ${star.title}`);
        continue;
      }

      const planetsToInsert = planetTemplates.map((template, index) => ({
        ...template,
        assetType: 'planet',
        parentGalaxy: crimsonNebula._id.toString(),
        parentGalaxyName: crimsonNebula.title,
        parentStar: star._id.toString(),
        parentStarName: star.title,
        rarity: 'rare',
        tags: ['planet', 'crimson-nebula', star.title.toLowerCase().replace(/\s+/g, '-')],
        coordinates: {
          x: star.coordinates.x + (template.orbitDistance * Math.cos(index * Math.PI / 3)),
          y: star.coordinates.y + (template.orbitDistance * Math.sin(index * Math.PI / 3)),
          z: star.coordinates.z + (Math.random() * 200 - 100)
        },
        lore: `Orbiting ${star.title} in the Crimson Nebula, ${template.title} is shaped by the unique conditions of its stellar environment.`,
        backstory: `Discovered during the survey of the ${star.title} system.`,
        flavor: `"${template.title} - where the crimson light paints reality." - Nebula Explorer's Log`,
        isPublished: true,
        approvalStatus: 'approved',
        creatorUsername: 'System',
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const result = await db.collection('assets').insertMany(planetsToInsert);
      console.log(`  ✅ Created ${result.insertedCount} planets`);

      planetsToInsert.forEach(p => {
        console.log(`    - ${p.title} (${p.climate} climate, ${p.orbitDistance} AU)`);
      });

      totalPlanets += result.insertedCount;
    }

    console.log(`\n✅ Total planets created: ${totalPlanets}`);

    // Summary
    console.log('\n📊 Crimson Nebula Summary:');
    const allStars = await db.collection('assets').countDocuments({
      assetType: 'star',
      parentGalaxy: crimsonNebula._id.toString()
    });

    const allPlanets = await db.collection('assets').countDocuments({
      assetType: 'planet',
      parentGalaxy: crimsonNebula._id.toString()
    });

    console.log(`  Stars: ${allStars}`);
    console.log(`  Planets: ${allPlanets}`);
    console.log(`  Average planets per star: ${(allPlanets / allStars).toFixed(1)}`);

  } catch (error) {
    console.error('Error seeding planets:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedCrimsonPlanets();
