/**
 * Seed Stars in Crimson Nebula Galaxy
 * Creates multiple star systems within the Crimson Nebula Galaxy
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

const crimsonNebulaStars = [
  {
    title: 'Crimson Heart',
    description: 'A massive red giant at the core of the Crimson Nebula, pulsating with ancient energy.',
    assetType: 'star',
    rarity: 'legendary',
    tags: ['star', 'red-giant', 'crimson-nebula', 'core'],
    lore: 'The Crimson Heart is believed to be the birthplace of the Crimson Nebula itself. Ancient texts speak of a civilization that once harvested its power.',
    backstory: 'Formed billions of years ago, this red giant has been slowly expanding, creating the crimson glow that gives the nebula its name.',
    flavor: '"The Heart beats eternal, painting the void in shades of blood and fire."',
    starType: 'Red Giant',
    spectralClass: 'M',
    mass: 15.5,
    radius: 800,
    temperature: 3500,
    luminosity: 10000,
    age: 8.2,
    coordinates: { x: 0, y: 0, z: 0 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  },
  {
    title: 'Ruby Beacon',
    description: 'A bright red star that serves as a navigational landmark in the outer regions of the Crimson Nebula.',
    assetType: 'star',
    rarity: 'rare',
    tags: ['star', 'red-star', 'crimson-nebula', 'navigation'],
    lore: 'Traders and explorers have used the Ruby Beacon as a waypoint for centuries. Its distinctive crimson light can be seen from parsecs away.',
    backstory: 'Named by the first explorers to chart the Crimson Nebula, the Ruby Beacon has guided countless ships through the nebulous clouds.',
    flavor: '"Follow the Ruby, and you\'ll find your way home." - Nebula Trader\'s Saying',
    starType: 'Red Star',
    spectralClass: 'K',
    mass: 0.8,
    radius: 0.7,
    temperature: 4500,
    luminosity: 0.4,
    age: 5.1,
    coordinates: { x: 1200, y: -800, z: 300 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  },
  {
    title: 'Scarlet Forge',
    description: 'An active stellar forge where new stars are being born from the nebula\'s gas and dust.',
    assetType: 'star',
    rarity: 'epic',
    tags: ['star', 'young-star', 'crimson-nebula', 'stellar-nursery'],
    lore: 'The Scarlet Forge is a stellar nursery, where protostars ignite and begin their journey through the cosmos. Scientists study this region to understand star formation.',
    backstory: 'Only recently discovered, the Scarlet Forge contains dozens of forming stars, some already igniting fusion in their cores.',
    flavor: '"Birth and fire, chaos and creation - the Forge makes stars." - Dr. Vex Starweaver',
    starType: 'Young Star',
    spectralClass: 'G',
    mass: 1.2,
    radius: 1.1,
    temperature: 5800,
    luminosity: 1.5,
    age: 0.1,
    coordinates: { x: -900, y: 1100, z: -400 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  },
  {
    title: 'Bloodstone Binary',
    description: 'A binary star system where two red stars orbit each other in a deadly dance.',
    assetType: 'star',
    rarity: 'epic',
    tags: ['star', 'binary-system', 'crimson-nebula', 'red-stars'],
    lore: 'The Bloodstone Binary is a gravitational anomaly. The two stars are slowly spiraling closer, and in a million years they will merge in a catastrophic event.',
    backstory: 'Discovered during the First Nebula Survey, the binary system has fascinated astronomers with its complex orbital mechanics.',
    flavor: '"Two hearts beating as one, dancing until the end of time."',
    starType: 'Binary Red Stars',
    spectralClass: 'K/K',
    mass: 1.6,
    radius: 0.9,
    temperature: 4200,
    luminosity: 0.8,
    age: 4.5,
    coordinates: { x: 600, y: 700, z: -600 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  },
  {
    title: 'Vermillion Outpost',
    description: 'A stable red star on the edge of the Crimson Nebula, home to several mining colonies.',
    assetType: 'star',
    rarity: 'uncommon',
    tags: ['star', 'red-star', 'crimson-nebula', 'colonized'],
    lore: 'Vermillion Outpost is the most heavily colonized star in the Crimson Nebula. Its stable output and rich asteroid belt make it ideal for resource extraction.',
    backstory: 'The first permanent settlement in the Crimson Nebula was established here over 200 years ago. Now it\'s a thriving hub of commerce.',
    flavor: '"Where the nebula meets civilization."',
    starType: 'Red Dwarf',
    spectralClass: 'M',
    mass: 0.4,
    radius: 0.5,
    temperature: 3200,
    luminosity: 0.05,
    age: 10.2,
    coordinates: { x: -1400, y: -500, z: 800 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  },
  {
    title: 'Garnet Prime',
    description: 'A brilliant red supergiant nearing the end of its lifecycle, destined to become a supernova.',
    assetType: 'star',
    rarity: 'legendary',
    tags: ['star', 'supergiant', 'crimson-nebula', 'dying-star'],
    lore: 'Garnet Prime is a ticking time bomb. Astronomers predict it will go supernova within the next 10,000 years, reshaping the entire nebula.',
    backstory: 'Once a bright blue star, Garnet Prime has exhausted its core hydrogen and swelled to enormous size. Its light bathes nearby systems in deep crimson.',
    flavor: '"The brightest stars burn the shortest. Garnet Prime\'s time is coming." - Nebula Observatory Report',
    starType: 'Red Supergiant',
    spectralClass: 'M',
    mass: 20,
    radius: 1200,
    temperature: 3600,
    luminosity: 50000,
    age: 8.8,
    coordinates: { x: 800, y: -1200, z: -200 },
    isPublished: true,
    approvalStatus: 'approved',
    creatorUsername: 'System'
  }
];

async function seedCrimsonNebulaStars() {
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
      console.log('Available galaxies:');
      const galaxies = await db.collection('assets').find({ assetType: 'galaxy' }).toArray();
      galaxies.forEach(g => console.log(`  - ${g.title}`));
      process.exit(1);
    }

    console.log(`✅ Found Crimson Nebula Galaxy: ${crimsonNebula._id}`);

    // Check for existing stars
    const existingStars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: crimsonNebula._id.toString()
    }).toArray();

    console.log(`Found ${existingStars.length} existing stars in Crimson Nebula`);

    // Add parentGalaxy reference to all stars
    const starsToInsert = crimsonNebulaStars.map(star => ({
      ...star,
      parentGalaxy: crimsonNebula._id.toString(),
      parentGalaxyName: crimsonNebula.title,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    // Insert stars
    const result = await db.collection('assets').insertMany(starsToInsert);
    console.log(`\n✅ Created ${result.insertedCount} new stars in Crimson Nebula Galaxy!`);

    // List all stars
    console.log('\n🌟 Stars in Crimson Nebula Galaxy:');
    const allStars = await db.collection('assets').find({
      assetType: 'star',
      parentGalaxy: crimsonNebula._id.toString()
    }).toArray();

    allStars.forEach((star, index) => {
      console.log(`\n${index + 1}. ${star.title} (${star.starType})`);
      console.log(`   Type: ${star.spectralClass} | Luminosity: ${star.luminosity}x`);
      console.log(`   Location: (${star.coordinates.x}, ${star.coordinates.y}, ${star.coordinates.z})`);
      console.log(`   ${star.description}`);
    });

    console.log(`\n📊 Total stars in Crimson Nebula: ${allStars.length}`);

  } catch (error) {
    console.error('Error seeding stars:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedCrimsonNebulaStars();
