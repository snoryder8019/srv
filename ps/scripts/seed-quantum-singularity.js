/**
 * Seed script for Quantum Singularity galaxy with stars
 * Theme: Dark, mysterious, anomalous - featuring rare star types and gravitational anomalies
 */
import { getDb, connectToDatabase, closeDatabase } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function seedQuantumSingularity() {
  try {
    await connectToDatabase();
    const db = getDb();

    console.log('🌀 Creating Quantum Singularity galaxy...');

    // Create the Quantum Singularity galaxy
    const galaxyResult = await db.collection('assets').insertOne({
      title: 'Quantum Singularity',
      description: 'A mysterious irregular galaxy where the laws of physics bend and break. Home to black holes, neutron stars, and gravitational anomalies that defy explanation.',
      assetType: 'galaxy',
      galaxyType: 'irregular',
      status: 'approved',
      coordinates: {
        x: 3500,
        y: 1500,
        z: 0
      },
      starCount: 0, // Will be updated
      lore: 'The Quantum Singularity was avoided for millennia until the Lantern Collective discovered it could be used to harvest dark matter. Now it serves as their primary research hub, though many ships have vanished in its depths.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const galaxyId = galaxyResult.insertedId;
    console.log('✅ Galaxy created:', galaxyId);

    // Define stars - themed around darkness, anomalies, and exotic physics
    const stars = [
      // Central black hole
      {
        title: 'The Void Heart',
        starType: 'black hole',
        luminosity: 0.0001,
        temperature: 0,
        description: 'A supermassive black hole at the center of Quantum Singularity. Its event horizon distorts spacetime itself.',
        angle: 0,
        radiusFromCenter: 50,
        lore: 'Ships that venture too close report time dilation effects and glimpses of alternate realities.'
      },

      // Inner ring - Exotic stars
      {
        title: 'Eventide Pulse',
        starType: 'neutron star',
        luminosity: 0.002,
        temperature: 600000,
        description: 'A rapidly spinning neutron star that emits deadly pulses of radiation.',
        angle: 30,
        radiusFromCenter: 250,
        lore: 'The Lanterns built a harvesting station here to collect exotic matter from the pulsar wind.'
      },
      {
        title: 'Null Point Zeta',
        starType: 'white dwarf',
        luminosity: 0.01,
        temperature: 15000,
        description: 'An ancient white dwarf on the verge of complete collapse.',
        angle: 90,
        radiusFromCenter: 280,
        lore: 'Sensors malfunction near Null Point. Some say it exists in multiple dimensions at once.'
      },
      {
        title: 'Obsidian Star',
        starType: 'neutron star',
        luminosity: 0.001,
        temperature: 800000,
        description: 'A neutron star so dense that light barely escapes its surface.',
        angle: 150,
        radiusFromCenter: 260,
        lore: 'Lantern scientists discovered a stable wormhole in orbit around Obsidian Star.'
      },

      // Middle ring - Dim red dwarfs
      {
        title: 'Crimson Whisper',
        starType: 'red dwarf',
        luminosity: 0.2,
        temperature: 3000,
        description: 'A dying red dwarf that flickers with mysterious dark energy emissions.',
        angle: 45,
        radiusFromCenter: 450,
        lore: 'Local spacers claim to hear voices in the static near Crimson Whisper.'
      },
      {
        title: 'Shadow Beacon',
        starType: 'red dwarf',
        luminosity: 0.15,
        temperature: 2800,
        description: 'This star emits more dark matter than light, creating an anti-gravitational field.',
        angle: 135,
        radiusFromCenter: 480,
        lore: 'The Lanterns use Shadow Beacon as a waypoint for dark matter collection routes.'
      },
      {
        title: 'Dusk Eternal',
        starType: 'red dwarf',
        luminosity: 0.25,
        temperature: 3200,
        description: 'Perpetually on the edge of stellar death, yet refuses to die.',
        angle: 225,
        radiusFromCenter: 460,
        lore: 'Scientists believe Dusk Eternal is artificially sustained by unknown technology.'
      },

      // Outer ring - Rare phenomena
      {
        title: 'Phantom Gate',
        starType: 'white dwarf',
        luminosity: 0.008,
        temperature: 12000,
        description: 'A white dwarf surrounded by a ring of quantum-locked matter.',
        angle: 0,
        radiusFromCenter: 650,
        lore: 'Ships passing through Phantom Gate report temporal anomalies and déjà vu.'
      },
      {
        title: 'Void Anchor',
        starType: 'neutron star',
        luminosity: 0.003,
        temperature: 700000,
        description: 'Anchors a stable pocket of null-space used for Lantern experiments.',
        angle: 90,
        radiusFromCenter: 680,
        lore: 'The most dangerous research station in the galaxy orbits Void Anchor.'
      },
      {
        title: 'Entropy Well',
        starType: 'red dwarf',
        luminosity: 0.1,
        temperature: 2500,
        description: 'The coldest star ever recorded. Matter near it decays at accelerated rates.',
        angle: 180,
        radiusFromCenter: 700,
        lore: 'Legend says the Well was artificially cooled as part of a failed experiment.'
      },
      {
        title: 'Dark Star Omega',
        starType: 'black hole',
        luminosity: 0.0002,
        temperature: 0,
        description: 'A wandering black hole captured by the Quantum Singularity\'s gravity.',
        angle: 270,
        radiusFromCenter: 720,
        lore: 'Dark Star Omega is slowly spiraling inward toward the Void Heart.'
      },

      // Far reaches - Scout stations
      {
        title: 'Lantern Outpost Alpha',
        starType: 'white dwarf',
        luminosity: 0.015,
        temperature: 10000,
        description: 'A stable white dwarf hosting the primary Lantern research facility.',
        angle: 60,
        radiusFromCenter: 850,
        lore: 'The most heavily defended location in Quantum Singularity.'
      },
      {
        title: 'Echo Prime',
        starType: 'neutron star',
        luminosity: 0.004,
        temperature: 650000,
        description: 'Every signal sent near Echo Prime returns duplicated and distorted.',
        angle: 240,
        radiusFromCenter: 880,
        lore: 'Some duplicates arrive before the original signal is sent.'
      },
      {
        title: 'Terminus Station',
        starType: 'red dwarf',
        luminosity: 0.3,
        temperature: 3400,
        description: 'The last safe harbor before the galaxy\'s chaotic outer rim.',
        angle: 330,
        radiusFromCenter: 900,
        lore: 'Traders stop at Terminus to trade salvage from the anomalous regions.'
      }
    ];

    console.log(`🌟 Creating ${stars.length} stars in Quantum Singularity...`);

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
    console.log('🎉 Quantum Singularity seeded successfully!');
    console.log('');
    console.log('Galaxy Details:');
    console.log(`  ID: ${galaxyId}`);
    console.log(`  Name: Quantum Singularity`);
    console.log(`  Type: Irregular`);
    console.log(`  Stars: ${starsResult.insertedCount}`);
    console.log('');
    console.log('Star Types:');
    console.log(`  Black Holes: ${stars.filter(s => s.starType === 'black hole').length}`);
    console.log(`  Neutron Stars: ${stars.filter(s => s.starType === 'neutron star').length}`);
    console.log(`  White Dwarfs: ${stars.filter(s => s.starType === 'white dwarf').length}`);
    console.log(`  Red Dwarfs: ${stars.filter(s => s.starType === 'red dwarf').length}`);
    console.log('');
    console.log('💡 To view:');
    console.log('  1. Go to /universe/galactic-map');
    console.log('  2. Click on Quantum Singularity');
    console.log('  3. Travel there and explore!');
    console.log('');
    console.log('⚠️  Warning: This is a dangerous galaxy with extreme phenomena!');

  } catch (error) {
    console.error('❌ Error seeding Quantum Singularity:', error);
  } finally {
    await closeDatabase();
  }
}

// Run the seed script
seedQuantumSingularity();
