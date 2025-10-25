/**
 * Seed script for Elysium Cluster galaxy with spiral star layout
 */
import { getDb, connectToDatabase, closeDatabase } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function seedElysiumCluster() {
  try {
    await connectToDatabase();
    const db = getDb();

    console.log('🌌 Creating Elysium Cluster galaxy...');

    // Create the Elysium Cluster galaxy
    const galaxyResult = await db.collection('assets').insertOne({
      title: 'Elysium Cluster',
      description: 'A vibrant spiral galaxy teeming with life and ancient civilizations. Known for its three distinctive spiral arms that glow with stellar nurseries.',
      assetType: 'galaxy',
      galaxyType: 'spiral',
      status: 'approved',
      coordinates: {
        x: 2500,
        y: 2500,
        z: 0
      },
      starCount: 0, // Will be updated
      lore: 'The Elysium Cluster was discovered during the First Convergence. Its spiral arms contain some of the most resource-rich star systems in known space.',
      votes: 0,
      voters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'system'
    });

    const galaxyId = galaxyResult.insertedId;
    console.log('✅ Galaxy created:', galaxyId);

    // Define stars in spiral pattern
    const stars = [
      // Inner core stars
      {
        title: 'Lumina Prime',
        starType: 'yellow star',
        luminosity: 1.2,
        temperature: 5800,
        description: 'The brightest star in Elysium Cluster, located at the galactic core.',
        angle: 0,
        radiusFromCenter: 150
      },

      // Arm 1 - Starting at 0 degrees
      {
        title: 'Astra Nova',
        starType: 'blue giant',
        luminosity: 3.5,
        temperature: 12000,
        description: 'A massive blue giant marking the start of the first spiral arm.',
        angle: 0,
        radiusFromCenter: 300
      },
      {
        title: 'Celestara',
        starType: 'yellow star',
        luminosity: 1.0,
        temperature: 5500,
        description: 'A stable yellow star perfect for colonization.',
        angle: 45,
        radiusFromCenter: 500
      },
      {
        title: 'Voidstar Alpha',
        starType: 'white dwarf',
        luminosity: 0.01,
        temperature: 8000,
        description: 'An ancient white dwarf near the edge of the first arm.',
        angle: 90,
        radiusFromCenter: 700
      },

      // Arm 2 - Starting at 120 degrees
      {
        title: 'Crimson Dawn',
        starType: 'red dwarf',
        luminosity: 0.3,
        temperature: 3500,
        description: 'A dim red dwarf that anchors the second spiral arm.',
        angle: 120,
        radiusFromCenter: 350
      },
      {
        title: 'Nebula Heart',
        starType: 'yellow star',
        luminosity: 1.5,
        temperature: 6000,
        description: 'Surrounded by colorful nebulae, a beacon of beauty.',
        angle: 165,
        radiusFromCenter: 550
      },
      {
        title: 'Phantom Star',
        starType: 'neutron star',
        luminosity: 0.001,
        temperature: 600000,
        description: 'An ultra-dense neutron star with powerful magnetic fields.',
        angle: 210,
        radiusFromCenter: 750
      },

      // Arm 3 - Starting at 240 degrees
      {
        title: 'Aurora Majora',
        starType: 'blue giant',
        luminosity: 4.0,
        temperature: 15000,
        description: 'The largest and brightest star in the third arm.',
        angle: 240,
        radiusFromCenter: 320
      },
      {
        title: 'Serenity Point',
        starType: 'yellow star',
        luminosity: 0.9,
        temperature: 5400,
        description: 'A peaceful system known for its stable planets.',
        angle: 285,
        radiusFromCenter: 520
      },
      {
        title: 'Twilight Gate',
        starType: 'red dwarf',
        luminosity: 0.4,
        temperature: 3800,
        description: 'The outermost star, marking the edge of explored space.',
        angle: 330,
        radiusFromCenter: 720
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
        lore: `Located in the ${star.title.includes('Prime') ? 'core' : 'spiral arms'} of the Elysium Cluster.`,
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
    console.log('🎉 Elysium Cluster seeded successfully!');
    console.log('');
    console.log('Galaxy Details:');
    console.log(`  ID: ${galaxyId}`);
    console.log(`  Name: Elysium Cluster`);
    console.log(`  Type: Spiral`);
    console.log(`  Stars: ${starsResult.insertedCount}`);
    console.log('');
    console.log('💡 To view:');
    console.log('  1. Go to /universe/galactic-map');
    console.log('  2. Click on Elysium Cluster');
    console.log('  3. Travel there and explore!');

  } catch (error) {
    console.error('❌ Error seeding Elysium Cluster:', error);
  } finally {
    await closeDatabase();
  }
}

// Run the seed script
seedElysiumCluster();
