/**
 * Seed script for Andromeda Galaxy with stars
 * Theme: Ancient, vast, mysterious - the closest large spiral galaxy
 * Known for ancient civilizations and archaeological sites
 */
import { getDb, connectToDatabase, closeDatabase } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function seedAndromeda() {
  try {
    await connectToDatabase();
    const db = getDb();

    console.log('🌌 Creating Andromeda Galaxy...');

    // Create the Andromeda Galaxy
    const galaxyResult = await db.collection('assets').insertOne({
      title: 'Andromeda Galaxy',
      description: 'The nearest major galaxy to our own, Andromeda is a massive spiral galaxy containing over a trillion stars. Ancient ruins and forgotten civilizations dot its systems.',
      assetType: 'galaxy',
      galaxyType: 'spiral',
      status: 'approved',
      coordinates: {
        x: 1500,
        y: 3500,
        z: 0
      },
      starCount: 0, // Will be updated
      lore: 'Andromeda has been inhabited for billions of years. The Devan Empire claims it as their ancestral home, though archaeological evidence suggests even older civilizations once thrived here.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const galaxyId = galaxyResult.insertedId;
    console.log('✅ Galaxy created:', galaxyId);

    // Define stars - themed around ancient civilizations, archaeology, and grandeur
    const stars = [
      // Core - Ancient Capital Region
      {
        title: 'Aetheron Prime',
        starType: 'yellow star',
        luminosity: 1.8,
        temperature: 6200,
        description: 'The ancient capital star of the Devan Empire, surrounded by magnificent ring worlds.',
        angle: 0,
        radiusFromCenter: 100,
        lore: 'Home to the Grand Cathedral of Seraphon and the oldest continuously inhabited system in the galaxy.'
      },

      // Inner Ring - Heart of Civilization
      {
        title: 'Archival Star',
        starType: 'yellow star',
        luminosity: 1.3,
        temperature: 5900,
        description: 'Houses the Great Library of Andromeda, containing knowledge spanning billions of years.',
        angle: 45,
        radiusFromCenter: 280,
        lore: 'Scholars from across the universe make pilgrimage here to study ancient texts.'
      },
      {
        title: 'Sanctum Sol',
        starType: 'yellow star',
        luminosity: 1.5,
        temperature: 6000,
        description: 'A holy star system where the first Devan temples were built.',
        angle: 90,
        radiusFromCenter: 300,
        lore: 'The Covenant of Stars was signed in orbit around Sanctum Sol.'
      },
      {
        title: 'Memorium',
        starType: 'white dwarf',
        luminosity: 0.02,
        temperature: 9000,
        description: 'A memorial star dedicated to fallen civilizations.',
        angle: 135,
        radiusFromCenter: 290,
        lore: 'Monuments to extinct species orbit this dying star, preserved for eternity.'
      },

      // Spiral Arm 1 - Northern Reach
      {
        title: 'Azure Crown',
        starType: 'blue giant',
        luminosity: 5.0,
        temperature: 18000,
        description: 'A brilliant blue giant that marks the northern edge of Devan space.',
        angle: 0,
        radiusFromCenter: 450,
        lore: 'Navigation beacon for travelers entering Andromeda from the north.'
      },
      {
        title: 'Radiant Spire',
        starType: 'yellow star',
        luminosity: 1.1,
        temperature: 5700,
        description: 'Known for its perfect planetary system ideal for colonization.',
        angle: 30,
        radiusFromCenter: 550,
        lore: 'Home to the Academy of Stellar Sciences.'
      },
      {
        title: 'Mystic Gate',
        starType: 'yellow star',
        luminosity: 1.0,
        temperature: 5500,
        description: 'A star system with unusual quantum properties.',
        angle: 60,
        radiusFromCenter: 650,
        lore: 'The Devan use this system for advanced faith string experiments.'
      },

      // Spiral Arm 2 - Eastern Frontier
      {
        title: 'Golden Horizon',
        starType: 'yellow star',
        luminosity: 1.4,
        temperature: 5850,
        description: 'A prosperous trade hub connecting Andromeda to neighboring galaxies.',
        angle: 120,
        radiusFromCenter: 480,
        lore: 'The largest spaceport in Andromeda orbits Golden Horizon III.'
      },
      {
        title: 'Prosperity Prime',
        starType: 'yellow star',
        luminosity: 1.2,
        temperature: 5750,
        description: 'An economic powerhouse with thriving industrial worlds.',
        angle: 150,
        radiusFromCenter: 580,
        lore: 'Produces 30% of Andromeda\'s ship hulls and components.'
      },
      {
        title: 'Ember Light',
        starType: 'red dwarf',
        luminosity: 0.5,
        temperature: 3900,
        description: 'A humble red dwarf where ancient ruins were first discovered.',
        angle: 180,
        radiusFromCenter: 680,
        lore: 'The Ember Tablets found here predate the Devan Empire by eons.'
      },

      // Spiral Arm 3 - Southern Expanse
      {
        title: 'Verdant Star',
        starType: 'yellow star',
        luminosity: 0.95,
        temperature: 5450,
        description: 'Surrounded by lush garden worlds and nature preserves.',
        angle: 240,
        radiusFromCenter: 500,
        lore: 'The Devan established their first ecological sanctuary here.'
      },
      {
        title: 'Titan\'s Rest',
        starType: 'blue giant',
        luminosity: 4.5,
        temperature: 16000,
        description: 'Named for the massive extinct species whose fossils orbit this star.',
        angle: 270,
        radiusFromCenter: 600,
        lore: 'Paleontologists study the Titan civilization that vanished 2 billion years ago.'
      },
      {
        title: 'Twilight Monastery',
        starType: 'red dwarf',
        luminosity: 0.4,
        temperature: 3700,
        description: 'A remote star hosting a monastery where Devan monks seek enlightenment.',
        angle: 300,
        radiusFromCenter: 700,
        lore: 'It is said those who meditate here can hear echoes of the First Song.'
      },

      // Outer Regions - Frontier
      {
        title: 'Pioneer\'s Beacon',
        starType: 'yellow star',
        luminosity: 1.0,
        temperature: 5600,
        description: 'The furthest settled system in Andromeda\'s southern reaches.',
        angle: 210,
        radiusFromCenter: 820,
        lore: 'Explorers use this as a staging point for expeditions into dark space.'
      },
      {
        title: 'Relic Star',
        starType: 'white dwarf',
        luminosity: 0.015,
        temperature: 8500,
        description: 'An ancient star surrounded by mysterious megastructures.',
        angle: 330,
        radiusFromCenter: 850,
        lore: 'The structures are made of materials that don\'t match any known technology.'
      },
      {
        title: 'Astralara\'s Light',
        starType: 'yellow star',
        luminosity: 1.6,
        temperature: 6100,
        description: 'Named after the Devan homeworld, this star guides lost travelers home.',
        angle: 15,
        radiusFromCenter: 880,
        lore: 'Every Devan ship carries coordinates to Astralara\'s Light as a sacred duty.'
      }
    ];

    console.log(`🌟 Creating ${stars.length} stars in spiral pattern...`);

    const starInserts = stars.map(star => {
      // Convert polar coordinates to cartesian (centered at 1000, 1000)
      const centerX = 1000;
      const centerY = 1000;
      const angleRad = (star.angle * Math.PI) / 180;
      const x = centerX + Math.cos(angleRad) * star.radiusFromCenter;
      const y = centerY + Math.sin(angleRad) * star.radiusFromCenter;

      return {
        title: star.title,
        description: star.description,
        assetType: 'star',
        starType: star.starType,
        status: 'approved',
        parentGalaxy: galaxyId,
        coordinates: {
          x: x,
          y: y,
          z: 0
        },
        luminosity: star.luminosity,
        temperature: star.temperature,
        lore: star.lore,
        votes: 0,
        voters: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'system'
      };
    });

    const starsResult = await db.collection('assets').insertMany(starInserts);
    console.log(`✅ Created ${starsResult.insertedCount} stars`);

    // Update galaxy star count
    await db.collection('assets').updateOne(
      { _id: galaxyId },
      { $set: { starCount: starsResult.insertedCount } }
    );

    console.log('');
    console.log('🎉 Andromeda Galaxy seeded successfully!');
    console.log('');
    console.log('Galaxy Details:');
    console.log(`  ID: ${galaxyId}`);
    console.log(`  Name: Andromeda Galaxy`);
    console.log(`  Type: Spiral`);
    console.log(`  Stars: ${starsResult.insertedCount}`);
    console.log('');
    console.log('Star Types:');
    console.log(`  Yellow Stars: ${stars.filter(s => s.starType === 'yellow star').length}`);
    console.log(`  Blue Giants: ${stars.filter(s => s.starType === 'blue giant').length}`);
    console.log(`  Red Dwarfs: ${stars.filter(s => s.starType === 'red dwarf').length}`);
    console.log(`  White Dwarfs: ${stars.filter(s => s.starType === 'white dwarf').length}`);
    console.log('');
    console.log('💡 To view:');
    console.log('  1. Go to /universe/galactic-map');
    console.log('  2. Click on Andromeda Galaxy');
    console.log('  3. Travel there and explore the ancient Devan Empire!');
    console.log('');
    console.log('🏛️ Notable Locations:');
    console.log('  - Aetheron Prime: Ancient Devan capital');
    console.log('  - Archival Star: Great Library of Andromeda');
    console.log('  - Sanctum Sol: First Devan temples');
    console.log('  - Relic Star: Mysterious ancient megastructures');

  } catch (error) {
    console.error('❌ Error seeding Andromeda Galaxy:', error);
  } finally {
    await closeDatabase();
  }
}

// Run the seed script
seedAndromeda();
