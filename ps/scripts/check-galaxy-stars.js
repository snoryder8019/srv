/**
 * Check if a galaxy has stars and add them if missing
 */
import { getDb, connectDB, closeDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

const GALAXY_ID = '68f7e1850f5ea5154eb24381';

async function checkAndAddStars() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🔍 Checking galaxy:', GALAXY_ID);
    console.log('');

    // Get the galaxy
    const galaxy = await db.collection('assets').findOne({
      _id: new ObjectId(GALAXY_ID)
    });

    if (!galaxy) {
      console.log('❌ Galaxy not found!');
      return;
    }

    console.log('✅ Galaxy found:', galaxy.title);
    console.log('   Type:', galaxy.galaxyType);
    console.log('   Location:', galaxy.coordinates);
    console.log('');

    // Check for existing stars
    const existingStars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: new ObjectId(GALAXY_ID)
    }).toArray();

    console.log(`📊 Existing stars: ${existingStars.length}`);
    console.log('');

    if (existingStars.length > 0) {
      console.log('Stars already exist:');
      existingStars.forEach((star, i) => {
        console.log(`  ${i + 1}. ${star.title} (${star.starType})`);
      });
      console.log('');
      console.log('✅ Galaxy is already populated!');
      return;
    }

    // Add stars if galaxy is empty
    console.log('⚠️  No stars found! Adding stars to', galaxy.title);
    console.log('');

    // Determine which star set to add based on galaxy name
    let stars = [];

    if (galaxy.title.includes('Elysium')) {
      stars = [
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
    } else if (galaxy.title.includes('Quantum')) {
      // Add Quantum Singularity stars if needed
      console.log('This appears to be Quantum Singularity - use seed-quantum-singularity.js');
      return;
    } else if (galaxy.title.includes('Andromeda')) {
      // Add Andromeda stars if needed
      console.log('This appears to be Andromeda - use seed-andromeda.js');
      return;
    } else {
      console.log('❌ Unknown galaxy type. Please create stars manually.');
      return;
    }

    console.log(`🌟 Adding ${stars.length} stars...`);
    console.log('');

    const starInserts = stars.map(star => {
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
        parentGalaxy: new ObjectId(GALAXY_ID),
        coordinates: { x, y, z: 0 },
        luminosity: star.luminosity,
        temperature: star.temperature,
        lore: `Located in the ${star.title.includes('Prime') ? 'core' : 'spiral arms'} of ${galaxy.title}.`,
        votes: 0,
        voters: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'system'
      };
    });

    const result = await db.collection('assets').insertMany(starInserts);
    console.log(`✅ Added ${result.insertedCount} stars!`);

    // Update galaxy star count
    await db.collection('assets').updateOne(
      { _id: new ObjectId(GALAXY_ID) },
      { $set: { starCount: result.insertedCount } }
    );

    console.log('');
    console.log('🎉 Stars added successfully!');
    console.log('');
    console.log('Stars added:');
    stars.forEach((star, i) => {
      console.log(`  ${i + 1}. ${star.title} (${star.starType})`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await closeDB();
  }
}

checkAndAddStars();
