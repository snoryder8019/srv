import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function resetUniverseState() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');
    const charactersCollection = db.collection('characters');

    console.log('\n=== UNIVERSE STATE RESET ===\n');

    // 1. Find the starting location hub
    console.log('🔍 Finding starting location...');
    const startingHub = await assetsCollection.findOne({
      'hubData.isStartingLocation': true
    });

    if (!startingHub) {
      console.error('❌ No starting location found! Please create one first.');
      console.log('   Set hubData.isStartingLocation = true on an asset');
      return;
    }

    console.log(`✅ Starting location: ${startingHub.title}`);
    console.log(`   Type: ${startingHub.assetType}`);
    console.log(`   Position: (${startingHub.coordinates.x}, ${startingHub.coordinates.y}, ${startingHub.coordinates.z || 0})`);
    console.log(`   Spawn radius: ${startingHub.hubData?.spawnRadius || 50}`);

    // 2. Get all characters
    console.log('\n📊 Fetching all characters...');
    const characters = await charactersCollection.find({}).toArray();
    console.log(`   Found ${characters.length} characters`);

    if (characters.length === 0) {
      console.log('   No characters to reset');
      return;
    }

    // 3. Calculate spawn positions around starting hub
    const spawnRadius = startingHub.hubData?.spawnRadius || 50;
    const hubX = startingHub.coordinates.x;
    const hubY = startingHub.coordinates.y;
    const hubZ = startingHub.coordinates.z || 0;

    console.log(`\n🎯 Resetting ${characters.length} characters to starting location...`);

    let resetCount = 0;
    for (let i = 0; i < characters.length; i++) {
      const character = characters[i];

      // Random position within spawn radius
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * spawnRadius;

      const newX = hubX + Math.cos(angle) * distance;
      const newY = hubY + Math.sin(angle) * distance;
      const newZ = hubZ;

      // Update character location
      const result = await charactersCollection.updateOne(
        { _id: character._id },
        {
          $set: {
            'location.x': newX,
            'location.y': newY,
            'location.z': newZ,
            'location.type': 'galactic',
            'location.assetId': startingHub._id.toString(),
            'location.zone': startingHub.hubData?.stringDomain || 'Time String'
          }
        }
      );

      if (result.modifiedCount > 0) {
        resetCount++;
        console.log(`   ✓ ${character.name}: (${Math.round(newX)}, ${Math.round(newY)}, ${Math.round(newZ)})`);
      }
    }

    console.log(`\n✅ Reset complete: ${resetCount}/${characters.length} characters moved to starting location`);

    // 4. Verify universe scale
    console.log('\n🌍 Verifying universe scale...');

    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    const zones = await assetsCollection.find({ assetType: 'zone' }).toArray();
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();

    console.log(`\nUniverse-level assets:`);
    console.log(`   Galaxies: ${galaxies.length}`);
    console.log(`   Stars: ${stars.length}`);
    console.log(`   Zones: ${zones.length}`);
    console.log(`   Anomalies: ${anomalies.length}`);

    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const allUniverseAssets = [...galaxies, ...stars, ...zones, ...anomalies];
    allUniverseAssets.forEach(asset => {
      if (asset.coordinates) {
        const x = asset.coordinates.x || 0;
        const y = asset.coordinates.y || 0;
        const z = asset.coordinates.z || 0;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    });

    const universeWidth = maxX - minX;
    const universeHeight = maxY - minY;
    const universeDepth = maxZ - minZ;

    console.log(`\nUniverse bounding box:`);
    console.log(`   X: ${Math.round(minX)} to ${Math.round(maxX)} (width: ${Math.round(universeWidth)})`);
    console.log(`   Y: ${Math.round(minY)} to ${Math.round(maxY)} (height: ${Math.round(universeHeight)})`);
    console.log(`   Z: ${Math.round(minZ)} to ${Math.round(maxZ)} (depth: ${Math.round(universeDepth)})`);

    // Check if scale is appropriate
    if (universeWidth > 10000 || universeHeight > 10000) {
      console.log(`\n⚠️  WARNING: Universe is very large (${Math.round(universeWidth)} x ${Math.round(universeHeight)})`);
      console.log(`   Consider these scales for different views:`);
      console.log(`   - 2D Map canvas: 5000 x 5000 (current setting)`);
      console.log(`   - 3D Map scene: Unlimited, but use camera zoom`);
      console.log(`   - Assets should be spaced 100-500 units apart for visibility`);
    } else {
      console.log(`\n✅ Universe scale looks good: ${Math.round(universeWidth)} x ${Math.round(universeHeight)}`);
    }

    // 5. Show statistics by asset type
    console.log(`\n📊 Asset distribution:`);

    if (galaxies.length > 0) {
      console.log(`\nGalaxies (${galaxies.length}):`);
      galaxies.forEach(g => {
        console.log(`   - ${g.title}: (${Math.round(g.coordinates.x)}, ${Math.round(g.coordinates.y)}, ${Math.round(g.coordinates.z || 0)})`);
      });
    }

    if (stars.length > 0) {
      console.log(`\nStars (${stars.length}):`);
      const starsWithGalaxy = stars.filter(s => s.parentGalaxy).length;
      console.log(`   ${starsWithGalaxy} have parentGalaxy set`);
      console.log(`   ${stars.length - starsWithGalaxy} are orphaned (no parentGalaxy)`);
    }

    console.log('\n=== RESET COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during reset:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Database connection closed');
  }
}

// Run the reset
resetUniverseState().catch(console.error);
