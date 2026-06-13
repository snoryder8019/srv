/**
 * Master seed script - Seeds all galaxies and stars
 */
import { getDb, connectToDatabase, closeDatabase } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

// Import individual seed data
async function seedAllGalaxies() {
  try {
    await connectToDatabase();
    const db = getDb();

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  🌌 SEEDING ALL GALAXIES AND STAR SYSTEMS');
    console.log('════════════════════════════════════════════════');
    console.log('');

    // Clear existing galaxies and stars (optional - comment out to keep existing)
    console.log('🗑️  Clearing existing galaxies and stars...');
    await db.collection('assets').deleteMany({
      assetType: { $in: ['galaxy', 'star'] },
      userId: 'system'
    });
    console.log('✅ Cleared\n');

    // ============ ELYSIUM CLUSTER ============
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🌌 ELYSIUM CLUSTER (Spiral Galaxy)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const elysiumGalaxy = await db.collection('assets').insertOne({
      title: 'Elysium Cluster',
      description: 'A vibrant spiral galaxy teeming with life and ancient civilizations. Known for its three distinctive spiral arms that glow with stellar nurseries.',
      assetType: 'galaxy',
      galaxyType: 'spiral',
      status: 'approved',
      coordinates: { x: 2500, y: 2500, z: 0 },
      starCount: 0,
      lore: 'The Elysium Cluster was discovered during the First Convergence. Its spiral arms contain some of the most resource-rich star systems in known space.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const elysiumStars = [
      { title: 'Lumina Prime', starType: 'yellow star', luminosity: 1.2, temperature: 5800, description: 'The brightest star in Elysium Cluster, located at the galactic core.', angle: 0, radiusFromCenter: 150 },
      { title: 'Astra Nova', starType: 'blue giant', luminosity: 3.5, temperature: 12000, description: 'A massive blue giant marking the start of the first spiral arm.', angle: 0, radiusFromCenter: 300 },
      { title: 'Celestara', starType: 'yellow star', luminosity: 1.0, temperature: 5500, description: 'A stable yellow star perfect for colonization.', angle: 45, radiusFromCenter: 500 },
      { title: 'Voidstar Alpha', starType: 'white dwarf', luminosity: 0.01, temperature: 8000, description: 'An ancient white dwarf near the edge of the first arm.', angle: 90, radiusFromCenter: 700 },
      { title: 'Crimson Dawn', starType: 'red dwarf', luminosity: 0.3, temperature: 3500, description: 'A dim red dwarf that anchors the second spiral arm.', angle: 120, radiusFromCenter: 350 },
      { title: 'Nebula Heart', starType: 'yellow star', luminosity: 1.5, temperature: 6000, description: 'Surrounded by colorful nebulae, a beacon of beauty.', angle: 165, radiusFromCenter: 550 },
      { title: 'Phantom Star', starType: 'neutron star', luminosity: 0.001, temperature: 600000, description: 'An ultra-dense neutron star with powerful magnetic fields.', angle: 210, radiusFromCenter: 750 },
      { title: 'Aurora Majora', starType: 'blue giant', luminosity: 4.0, temperature: 15000, description: 'The largest and brightest star in the third arm.', angle: 240, radiusFromCenter: 320 },
      { title: 'Serenity Point', starType: 'yellow star', luminosity: 0.9, temperature: 5400, description: 'A peaceful system known for its stable planets.', angle: 285, radiusFromCenter: 520 },
      { title: 'Twilight Gate', starType: 'red dwarf', luminosity: 0.4, temperature: 3800, description: 'The outermost star, marking the edge of explored space.', angle: 330, radiusFromCenter: 720 }
    ];

    const elysiumStarDocs = elysiumStars.map(star => {
      const centerX = 1000, centerY = 1000;
      const angleRad = (star.angle * Math.PI) / 180;
      const x = centerX + Math.cos(angleRad) * star.radiusFromCenter;
      const y = centerY + Math.sin(angleRad) * star.radiusFromCenter;

      return {
        title: star.title,
        description: star.description,
        assetType: 'star',
        starType: star.starType,
        status: 'approved',
        parentGalaxy: elysiumGalaxy.insertedId,
        coordinates: { x, y, z: 0 },
        luminosity: star.luminosity,
        temperature: star.temperature,
        lore: `Located in the ${star.title.includes('Prime') ? 'core' : 'spiral arms'} of the Elysium Cluster.`,
        votes: 0,
        voters: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'system'
      };
    });

    await db.collection('assets').insertMany(elysiumStarDocs);
    await db.collection('assets').updateOne(
      { _id: elysiumGalaxy.insertedId },
      { $set: { starCount: elysiumStars.length } }
    );

    console.log(`✅ Elysium Cluster: ${elysiumStars.length} stars created\n`);

    // ============ QUANTUM SINGULARITY ============
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🌀 QUANTUM SINGULARITY (Irregular Galaxy)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const quantumGalaxy = await db.collection('assets').insertOne({
      title: 'Quantum Singularity',
      description: 'A mysterious irregular galaxy where the laws of physics bend and break. Home to black holes, neutron stars, and gravitational anomalies that defy explanation.',
      assetType: 'galaxy',
      galaxyType: 'irregular',
      status: 'approved',
      coordinates: { x: 3500, y: 1500, z: 0 },
      starCount: 0,
      lore: 'The Quantum Singularity was avoided for millennia until the Lantern Collective discovered it could be used to harvest dark matter. Now it serves as their primary research hub, though many ships have vanished in its depths.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const quantumStars = [
      { title: 'The Void Heart', starType: 'black hole', luminosity: 0.0001, temperature: 0, description: 'A supermassive black hole at the center of Quantum Singularity. Its event horizon distorts spacetime itself.', angle: 0, radiusFromCenter: 50, lore: 'Ships that venture too close report time dilation effects and glimpses of alternate realities.' },
      { title: 'Eventide Pulse', starType: 'neutron star', luminosity: 0.002, temperature: 600000, description: 'A rapidly spinning neutron star that emits deadly pulses of radiation.', angle: 30, radiusFromCenter: 250, lore: 'The Lanterns built a harvesting station here to collect exotic matter from the pulsar wind.' },
      { title: 'Null Point Zeta', starType: 'white dwarf', luminosity: 0.01, temperature: 15000, description: 'An ancient white dwarf on the verge of complete collapse.', angle: 90, radiusFromCenter: 280, lore: 'Sensors malfunction near Null Point. Some say it exists in multiple dimensions at once.' },
      { title: 'Obsidian Star', starType: 'neutron star', luminosity: 0.001, temperature: 800000, description: 'A neutron star so dense that light barely escapes its surface.', angle: 150, radiusFromCenter: 260, lore: 'Lantern scientists discovered a stable wormhole in orbit around Obsidian Star.' },
      { title: 'Crimson Whisper', starType: 'red dwarf', luminosity: 0.2, temperature: 3000, description: 'A dying red dwarf that flickers with mysterious dark energy emissions.', angle: 45, radiusFromCenter: 450, lore: 'Local spacers claim to hear voices in the static near Crimson Whisper.' },
      { title: 'Shadow Beacon', starType: 'red dwarf', luminosity: 0.15, temperature: 2800, description: 'This star emits more dark matter than light, creating an anti-gravitational field.', angle: 135, radiusFromCenter: 480, lore: 'The Lanterns use Shadow Beacon as a waypoint for dark matter collection routes.' },
      { title: 'Dusk Eternal', starType: 'red dwarf', luminosity: 0.25, temperature: 3200, description: 'Perpetually on the edge of stellar death, yet refuses to die.', angle: 225, radiusFromCenter: 460, lore: 'Scientists believe Dusk Eternal is artificially sustained by unknown technology.' },
      { title: 'Phantom Gate', starType: 'white dwarf', luminosity: 0.008, temperature: 12000, description: 'A white dwarf surrounded by a ring of quantum-locked matter.', angle: 0, radiusFromCenter: 650, lore: 'Ships passing through Phantom Gate report temporal anomalies and déjà vu.' },
      { title: 'Void Anchor', starType: 'neutron star', luminosity: 0.003, temperature: 700000, description: 'Anchors a stable pocket of null-space used for Lantern experiments.', angle: 90, radiusFromCenter: 680, lore: 'The most dangerous research station in the galaxy orbits Void Anchor.' },
      { title: 'Entropy Well', starType: 'red dwarf', luminosity: 0.1, temperature: 2500, description: 'The coldest star ever recorded. Matter near it decays at accelerated rates.', angle: 180, radiusFromCenter: 700, lore: 'Legend says the Well was artificially cooled as part of a failed experiment.' },
      { title: 'Dark Star Omega', starType: 'black hole', luminosity: 0.0002, temperature: 0, description: 'A wandering black hole captured by the Quantum Singularity\'s gravity.', angle: 270, radiusFromCenter: 720, lore: 'Dark Star Omega is slowly spiraling inward toward the Void Heart.' },
      { title: 'Lantern Outpost Alpha', starType: 'white dwarf', luminosity: 0.015, temperature: 10000, description: 'A stable white dwarf hosting the primary Lantern research facility.', angle: 60, radiusFromCenter: 850, lore: 'The most heavily defended location in Quantum Singularity.' },
      { title: 'Echo Prime', starType: 'neutron star', luminosity: 0.004, temperature: 650000, description: 'Every signal sent near Echo Prime returns duplicated and distorted.', angle: 240, radiusFromCenter: 880, lore: 'Some duplicates arrive before the original signal is sent.' },
      { title: 'Terminus Station', starType: 'red dwarf', luminosity: 0.3, temperature: 3400, description: 'The last safe harbor before the galaxy\'s chaotic outer rim.', angle: 330, radiusFromCenter: 900, lore: 'Traders stop at Terminus to trade salvage from the anomalous regions.' }
    ];

    const quantumStarDocs = quantumStars.map(star => {
      const centerX = 1000, centerY = 1000;
      const angleRad = (star.angle * Math.PI) / 180;
      const x = centerX + Math.cos(angleRad) * star.radiusFromCenter;
      const y = centerY + Math.sin(angleRad) * star.radiusFromCenter;

      return {
        title: star.title,
        description: star.description,
        assetType: 'star',
        starType: star.starType,
        status: 'approved',
        parentGalaxy: quantumGalaxy.insertedId,
        coordinates: { x, y, z: 0 },
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

    await db.collection('assets').insertMany(quantumStarDocs);
    await db.collection('assets').updateOne(
      { _id: quantumGalaxy.insertedId },
      { $set: { starCount: quantumStars.length } }
    );

    console.log(`✅ Quantum Singularity: ${quantumStars.length} stars created\n`);

    // ============ ANDROMEDA GALAXY ============
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🏛️ ANDROMEDA GALAXY (Spiral Galaxy)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const andromedaGalaxy = await db.collection('assets').insertOne({
      title: 'Andromeda Galaxy',
      description: 'The nearest major galaxy to our own, Andromeda is a massive spiral galaxy containing over a trillion stars. Ancient ruins and forgotten civilizations dot its systems.',
      assetType: 'galaxy',
      galaxyType: 'spiral',
      status: 'approved',
      coordinates: { x: 1500, y: 3500, z: 0 },
      starCount: 0,
      lore: 'Andromeda has been inhabited for billions of years. The Devan Empire claims it as their ancestral home, though archaeological evidence suggests even older civilizations once thrived here.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const andromedaStars = [
      { title: 'Aetheron Prime', starType: 'yellow star', luminosity: 1.8, temperature: 6200, description: 'The ancient capital star of the Devan Empire, surrounded by magnificent ring worlds.', angle: 0, radiusFromCenter: 100, lore: 'Home to the Grand Cathedral of Seraphon and the oldest continuously inhabited system in the galaxy.' },
      { title: 'Archival Star', starType: 'yellow star', luminosity: 1.3, temperature: 5900, description: 'Houses the Great Library of Andromeda, containing knowledge spanning billions of years.', angle: 45, radiusFromCenter: 280, lore: 'Scholars from across the universe make pilgrimage here to study ancient texts.' },
      { title: 'Sanctum Sol', starType: 'yellow star', luminosity: 1.5, temperature: 6000, description: 'A holy star system where the first Devan temples were built.', angle: 90, radiusFromCenter: 300, lore: 'The Covenant of Stars was signed in orbit around Sanctum Sol.' },
      { title: 'Memorium', starType: 'white dwarf', luminosity: 0.02, temperature: 9000, description: 'A memorial star dedicated to fallen civilizations.', angle: 135, radiusFromCenter: 290, lore: 'Monuments to extinct species orbit this dying star, preserved for eternity.' },
      { title: 'Azure Crown', starType: 'blue giant', luminosity: 5.0, temperature: 18000, description: 'A brilliant blue giant that marks the northern edge of Devan space.', angle: 0, radiusFromCenter: 450, lore: 'Navigation beacon for travelers entering Andromeda from the north.' },
      { title: 'Radiant Spire', starType: 'yellow star', luminosity: 1.1, temperature: 5700, description: 'Known for its perfect planetary system ideal for colonization.', angle: 30, radiusFromCenter: 550, lore: 'Home to the Academy of Stellar Sciences.' },
      { title: 'Mystic Gate', starType: 'yellow star', luminosity: 1.0, temperature: 5500, description: 'A star system with unusual quantum properties.', angle: 60, radiusFromCenter: 650, lore: 'The Devan use this system for advanced faith string experiments.' },
      { title: 'Golden Horizon', starType: 'yellow star', luminosity: 1.4, temperature: 5850, description: 'A prosperous trade hub connecting Andromeda to neighboring galaxies.', angle: 120, radiusFromCenter: 480, lore: 'The largest spaceport in Andromeda orbits Golden Horizon III.' },
      { title: 'Prosperity Prime', starType: 'yellow star', luminosity: 1.2, temperature: 5750, description: 'An economic powerhouse with thriving industrial worlds.', angle: 150, radiusFromCenter: 580, lore: 'Produces 30% of Andromeda\'s ship hulls and components.' },
      { title: 'Ember Light', starType: 'red dwarf', luminosity: 0.5, temperature: 3900, description: 'A humble red dwarf where ancient ruins were first discovered.', angle: 180, radiusFromCenter: 680, lore: 'The Ember Tablets found here predate the Devan Empire by eons.' },
      { title: 'Verdant Star', starType: 'yellow star', luminosity: 0.95, temperature: 5450, description: 'Surrounded by lush garden worlds and nature preserves.', angle: 240, radiusFromCenter: 500, lore: 'The Devan established their first ecological sanctuary here.' },
      { title: 'Titan\'s Rest', starType: 'blue giant', luminosity: 4.5, temperature: 16000, description: 'Named for the massive extinct species whose fossils orbit this star.', angle: 270, radiusFromCenter: 600, lore: 'Paleontologists study the Titan civilization that vanished 2 billion years ago.' },
      { title: 'Twilight Monastery', starType: 'red dwarf', luminosity: 0.4, temperature: 3700, description: 'A remote star hosting a monastery where Devan monks seek enlightenment.', angle: 300, radiusFromCenter: 700, lore: 'It is said those who meditate here can hear echoes of the First Song.' },
      { title: 'Pioneer\'s Beacon', starType: 'yellow star', luminosity: 1.0, temperature: 5600, description: 'The furthest settled system in Andromeda\'s southern reaches.', angle: 210, radiusFromCenter: 820, lore: 'Explorers use this as a staging point for expeditions into dark space.' },
      { title: 'Relic Star', starType: 'white dwarf', luminosity: 0.015, temperature: 8500, description: 'An ancient star surrounded by mysterious megastructures.', angle: 330, radiusFromCenter: 850, lore: 'The structures are made of materials that don\'t match any known technology.' },
      { title: 'Astralara\'s Light', starType: 'yellow star', luminosity: 1.6, temperature: 6100, description: 'Named after the Devan homeworld, this star guides lost travelers home.', angle: 15, radiusFromCenter: 880, lore: 'Every Devan ship carries coordinates to Astralara\'s Light as a sacred duty.' }
    ];

    const andromedaStarDocs = andromedaStars.map(star => {
      const centerX = 1000, centerY = 1000;
      const angleRad = (star.angle * Math.PI) / 180;
      const x = centerX + Math.cos(angleRad) * star.radiusFromCenter;
      const y = centerY + Math.sin(angleRad) * star.radiusFromCenter;

      return {
        title: star.title,
        description: star.description,
        assetType: 'star',
        starType: star.starType,
        status: 'approved',
        parentGalaxy: andromedaGalaxy.insertedId,
        coordinates: { x, y, z: 0 },
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

    await db.collection('assets').insertMany(andromedaStarDocs);
    await db.collection('assets').updateOne(
      { _id: andromedaGalaxy.insertedId },
      { $set: { starCount: andromedaStars.length } }
    );

    console.log(`✅ Andromeda Galaxy: ${andromedaStars.length} stars created\n`);

    // ============ SUMMARY ============
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  ✨ SEEDING COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log(`  Galaxies: 3`);
    console.log(`  Total Stars: ${elysiumStars.length + quantumStars.length + andromedaStars.length}`);
    console.log('');
    console.log('🌌 Galaxies Created:');
    console.log(`  1. Elysium Cluster (Spiral) - ${elysiumStars.length} stars @ (2500, 2500)`);
    console.log(`  2. Quantum Singularity (Irregular) - ${quantumStars.length} stars @ (3500, 1500)`);
    console.log(`  3. Andromeda Galaxy (Spiral) - ${andromedaStars.length} stars @ (1500, 3500)`);
    console.log('');
    console.log('💡 To explore:');
    console.log('  1. Go to /universe/galactic-map');
    console.log('  2. Click on a galaxy');
    console.log('  3. Travel there (must be within 50 units)');
    console.log('  4. Click "Explore Galaxy"');
    console.log('  5. Click on any star to view details');
    console.log('  6. Click "Explore Star System" for 3D view');
    console.log('');

  } catch (error) {
    console.error('❌ Error seeding galaxies:', error);
  } finally {
    await closeDatabase();
  }
}

// Run the seed script
seedAllGalaxies();
